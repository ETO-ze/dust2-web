"""Restore only pinned ladder components from the matching original CS2 map export.
Run from build-source-ladder-overlay.py in the parent directory.
"""

import argparse
import hashlib
import json
import mmap
import runpy
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent


def sha(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def part_color(name):
    if "shunter" in name:
        return [0.33, 0.35, 0.32]
    if "rusted" in name:
        return [0.43, 0.39, 0.32]
    if "wood" in name:
        return [0.30, 0.176, 0.083]
    if "vertigo" in name:
        return [0.46, 0.52, 0.54]
    return [0.61, 0.59, 0.52]


def collect(raw, pin, surface, rgb_from_uvs):
    doc = surface["read"](raw)
    grouped = defaultdict(list)
    for part in pin["parts"]:
        grouped[part["node"], part["primitive"]].append(part)
    parts = []
    with (raw.parent / doc["buffers"][0]["uri"]).open("rb") as stream:
        data = mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ)

        def view(index):
            return surface["data_view"](doc, data, index)

        for ni, node, world in surface["world_nodes"](doc):
            if "mesh" not in node:
                continue
            for pi, prim in enumerate(doc["meshes"][node["mesh"]]["primitives"]):
                selections = grouped.get((ni, pi))
                if not selections:
                    continue
                at = prim["attributes"]
                assert not doc["accessors"][at["POSITION"]].get("normalized")
                points = view(at["POSITION"]) @ world[:3, :3].T + world[:3, 3]
                indices = view(prim["indices"]).reshape(-1, 3)
                mat = doc["materials"][prim["material"]]
                name = Path(
                    mat.get("extras", {}).get("vmat", {}).get("Name", mat["name"])
                ).name.lower()
                assert all(p["material"] == name for p in selections)
                pbr = mat.get("pbrMetallicRoughness", {})
                if "baseColorTexture" in pbr:
                    image = doc["textures"][pbr["baseColorTexture"]["index"]]["source"]
                    color = rgb_from_uvs(
                        raw.parent / doc["images"][image]["uri"], view(at["TEXCOORD_0"])
                    )
                    color *= np.array(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3])
                else:
                    color = np.broadcast_to(part_color(name), points.shape)
                for part in selections:
                    rows = np.concatenate(
                        [np.arange(a, a + n) for a, n in part["faces"]]
                    )
                    flat = indices[rows].ravel()
                    _, first, ix = np.unique(
                        np.round(points[flat], 6),
                        axis=0,
                        return_index=True,
                        return_inverse=True,
                    )
                    parts.append(
                        {
                            "id": part["rail"],
                            "pts": points[flat[first]],
                            "ix": ix.reshape(-1, 3),
                            "color": color[flat[first]],
                        }
                    )
    assert len(parts) == len(pin["parts"])
    return parts


def simplify(parts):
    data = [
        {"positions": p["pts"].ravel().tolist(), "indices": p["ix"].ravel().tolist()}
        for p in parts
    ]
    result = subprocess.run(
        ["node", str(HERE / "simplify-ladder-components.mjs")],
        input=json.dumps(data),
        check=True,
        capture_output=True,
        text=True,
    )
    for p, (ix, error) in zip(parts, json.loads(result.stdout), strict=True):
        p["slim"] = np.array(ix, dtype="u4").reshape(-1, 3)
        assert len(p["slim"]) and error <= 0.00801
        p["error"] = float(error)


def source_trees(parts):
    grouped = defaultdict(list)
    for p in parts:
        grouped[p["id"]].append(p["pts"][p["ix"]])
    out = []
    for groups in grouped.values():
        points = np.concatenate(groups).reshape(-1, 3)
        tree = BVHTree.FromPolygons(
            points.tolist(),
            np.arange(len(points)).reshape(-1, 3).tolist(),
            all_triangles=True,
        )
        out.append((tree, points.min(0) - 0.04, points.max(0) + 0.04))
    return out


def remove_old(doc, raw, chunks, surface, parts):
    trees = source_trees(parts)
    removed = {}

    def view(index):
        return surface["data_view"](doc, raw, index)

    for _, node, world in surface["world_nodes"](doc):
        if not node.get("name", "").startswith("tile_"):
            continue
        for pi, prim in enumerate(doc["meshes"][node["mesh"]]["primitives"]):
            if prim.get("mode", 4) != 4:
                continue
            attrs = prim["attributes"]
            pos = view(attrs["POSITION"]).astype("f8")
            if doc["accessors"][attrs["POSITION"]].get("normalized"):
                pos /= 65535
            pos = pos @ world[:3, :3].T + world[:3, 3]
            ix = view(prim["indices"]).reshape(-1, 3)
            tri = pos[ix]
            lo = tri.min(1)
            hi = tri.max(1)
            mark = set()
            for tree, bottom, top in trees:
                for j in np.flatnonzero((lo >= bottom).all(1) & (hi <= top).all(1)):
                    if all(
                        tree.find_nearest(vertex, 0.038)[3] is not None
                        for vertex in tri[j]
                    ):
                        mark.add(int(j))
            if not mark:
                continue
            assert pi == 0
            rows = sorted(mark)
            removed[node["name"]] = rows
            counts = doc["extras"]["surfaceTriangles"]
            for tag, count in Counter(view(attrs["COLOR_0"])[ix[rows, 0], 3]).items():
                if str(tag) in counts:
                    counts[str(tag)] -= int(count)
            acc = doc["accessors"][prim["indices"]]
            assert (
                not acc.get("byteOffset")
                and sum(a["bufferView"] == acc["bufferView"] for a in doc["accessors"])
                == 1
            )
            kept = np.delete(ix, rows, axis=0).ravel()
            assert len(kept) > 0
            chunks[acc["bufferView"]] = kept.tobytes()
            acc["count"] = len(kept)
            if "min" in acc:
                acc["min"] = [int(kept.min())]
            if "max" in acc:
                acc["max"] = [int(kept.max())]
    return removed


def add_map_batch(doc, chunks, parts, tag):
    alltri = []
    allrgb = []
    for p in parts:
        tri = p["pts"][p["slim"]]
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        area = np.linalg.norm(n, axis=1)
        valid = area > 1e-10
        lighting = 0.78 + 0.22 * np.maximum(
            0, n[valid] / area[valid, None] @ np.array([0.4, 0.74, 0.54])
        )
        rgb = np.rint(
            255
            * np.clip(
                p["color"][p["slim"][valid]] * lighting[:, None, None] + 0.006, 0, 1
            )
        ).astype("u1")
        alltri.append(tri[valid])
        allrgb.append(rgb)
    pts = np.concatenate(alltri).reshape(-1, 3)
    rgb = np.concatenate(allrgb).reshape(-1, 3)
    lo = pts.min(0)
    scale = pts.max(0) - lo
    packed = np.rint(65535 * (pts - lo) / scale).astype("<u2")
    error = np.linalg.norm(packed / 65535 * scale + lo - pts, axis=1).max()
    assert error < 0.0008
    fields = np.empty(len(pts), [("pos", "<u2", (3,)), ("rgb", "u1", (3,))])
    fields["pos"] = packed
    fields["rgb"] = rgb
    unique, ix = np.unique(fields, return_inverse=True)
    assert len(unique) < 65536
    pos = np.zeros((len(unique), 4), "<u2")
    pos[:, :3] = unique["pos"]
    cols = np.empty((len(unique), 4), "u1")
    cols[:, :3] = unique["rgb"]
    cols[:, 3] = tag

    def add(data, kind, component, target, normalized=False, stride=None, bounds=False):
        view = {"buffer": 0, "byteLength": data.nbytes, "target": target}
        if stride:
            view["byteStride"] = stride
        doc["bufferViews"].append(view)
        chunks.append(data.tobytes())
        accessor = {
            "bufferView": len(chunks) - 1,
            "componentType": component,
            "count": len(data),
            "type": kind,
        }
        if normalized:
            accessor["normalized"] = True
        if bounds:
            accessor.update(
                min=data[:, :3].min(0).tolist(), max=data[:, :3].max(0).tolist()
            )
        doc["accessors"].append(accessor)
        return len(doc["accessors"]) - 1

    p = add(pos, "VEC3", 5123, 34962, True, 8, True)
    c = add(cols, "VEC4", 5121, 34962, True)
    i = add(ix.ravel().astype("<u2"), "SCALAR", 5123, 34963)
    name = "source-ladder-" + (
        "-".join(map(str, sorted({part["id"] for part in parts})))
    )
    mesh = len(doc["meshes"])
    doc["meshes"].append(
        {
            "name": name,
            "primitives": [
                {
                    "attributes": {"POSITION": p, "COLOR_0": c},
                    "indices": i,
                    "material": 0,
                }
            ],
        }
    )
    doc["scenes"][doc.get("scene", 0)]["nodes"].append(len(doc["nodes"]))
    doc["nodes"].append(
        {
            "name": name,
            "mesh": mesh,
            "translation": lo.tolist(),
            "scale": scale.tolist(),
        }
    )
    return {
        "triangles": len(pts) // 3,
        "vertices": len(unique),
        "quantizationErrorMm": round(1000 * error, 4),
        "node": name,
    }


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("map", type=Path)
    args.add_argument("source", type=Path)
    args.add_argument("report", type=Path)
    opt = args.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    key = opt.map.name
    pin = json.loads((HERE / "ladder-source-components.json").read_bytes())[key]
    surface = runpy.run_path(str(HERE / "source-ladder-gltf.py"))
    rgb_from_uvs = surface["rgb_from_uvs"]
    read = surface["read"]
    assert read(opt.map / "compiled/map.json")["sourceSha256"] == pin["gameSource"]
    file = opt.map / "render/map.gltf"
    binfile = file.with_name("map.bin")
    sourcebin = opt.source.parent / read(opt.source)["buffers"][0]["uri"]
    for f, k in (
        (file, "inputGltf"),
        (binfile, "inputBin"),
        (opt.source, "sourceGltf"),
        (sourcebin, "sourceBin"),
    ):
        if sha(f) != pin[k]:
            raise ValueError(f"{key}: wrong {k}")
    parts = collect(opt.source, pin, surface, rgb_from_uvs)
    simplify(parts)
    doc = read(file)
    raw = binfile.read_bytes()
    chunks = [
        raw[v.get("byteOffset", 0) : v.get("byteOffset", 0) + v["byteLength"]]
        for v in doc["bufferViews"]
    ]
    removed = remove_old(doc, raw, chunks, surface, parts)
    tag = {"de_mirage": 33, "de_vertigo": 34, "de_train": 35}[key]
    added = add_map_batch(doc, chunks, parts, tag)
    extras = doc["extras"]
    counts = extras["surfaceTriangles"]
    counts[str(tag)] = counts.get(str(tag), 0) + added["triangles"]
    extras["outputTriangles"] += added["triangles"] - sum(map(len, removed.values()))
    extras["sourceLadderAssemblies"] = sorted({p["id"] for p in parts})
    surface["write_model"](file, doc, chunks)
    report = {k: v for k, v in pin.items() if k != "parts"}
    report.update(
        added=added,
        sourceFaces=sum(len(p["ix"]) for p in parts),
        sourceParts=len(parts),
        simplificationErrorMm=round(1000 * max(p["error"] for p in parts), 4),
        removedTriangles=removed,
        outputGltf=sha(file),
        outputBin=sha(binfile),
    )
    opt.report.write_text(json.dumps(report, indent=2), "utf8")
    print(
        key,
        added,
        "replaced",
        sum(map(len, removed.values())),
        "faces",
        "tiles",
        list(removed),
        flush=True,
    )


if __name__ == "__main__":
    main()
