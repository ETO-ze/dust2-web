"""Prepare matching Valve VPK dependencies and export stock knife meshes & viewmodel clips.

Uses the pinned Steam depot from build-skin-reference.py. With --fetch, missing VPK
volumes are requested from Steam through DepotDownloader's anonymous account.
Requires Pillow, NumPy, SciPy, and Source 2 Viewer 20.0.7308 (or set SOURCE2VIEWER_CLI).
Large intermediate files are kept under artifacts/stock-knife-work.
"""

import argparse
import concurrent.futures
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import struct
import subprocess
import zlib

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
STAGE = ROOT / "artifacts/stock-knife-work"
PUBLIC = ROOT / "public/assets/weapons/cs2-skins/knives"
SOURCE = ROOT / "artifacts/performance-maps/source-extra"
CLI = pathlib.Path(os.getenv("SOURCE2VIEWER_CLI") or ROOT / "tools/source2viewer/Source2Viewer-CLI.exe")
DEPOT = STAGE / "depot"
GAME = STAGE / "loose/game/csgo"
ref_spec = importlib.util.spec_from_file_location(
    "reference", HERE / "build-skin-reference.py"
)
ref = importlib.util.module_from_spec(ref_spec)
ref_spec.loader.exec_module(ref)
EXT = {
    "bayonet": "weapon_bayonet",
    "default_ct": "weapon_knife",
    "default_t": "weapon_knife_t",
    "navaja": "weapon_knife_gypsy_jackknife",
    "m9": "weapon_knife_m9_bayonet",
    "talon": "weapon_knife_widowmaker",
    "bowie": "weapon_knife_survival_bowie",
}
REUSED = {"m9", "butterfly"}
CLIPS = {
    "draw": ("draw", "draw1"),
    "idle": ("idle1", "idle", "idle2"),
    "shoot": ("light_miss1", "light_hita", "light_hit1"),
    "shoot2": ("light_miss2", "light_hit2"),
    "heavy": ("heavy_miss1", "heavy_hit1"),
    "inspect": ("lookat01", "lookat1", "inspect"),
}


def sha(file):
    with file.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def readjson(file):
    return json.loads(file.read_bytes())


def plan(index):
    source = readjson(ROOT / "artifacts/skin-library-review/reference.json")
    types = {
        r["valveWeapon"]: (r["weaponName"], r["weaponNameEn"], r["definition"])
        for r in source["rows"]
        if r["category"] == "刀具"
    }
    types.update(
        weapon_knife=("反恐精英匕首", "Counter-Terrorist Knife", 42),
        weapon_knife_t=("恐怖分子匕首", "Terrorist Knife", 59),
    )
    rows = []
    for model in sorted(
        k
        for k in index
        if k.startswith("weapons/models/knife/")
        and k.endswith(".vmdl_c")
        and "/weapon_knife_" in k
    ):
        family = model.split("/")[3][6:]
        if family in REUSED:
            continue
        econ = EXT.get(family, "weapon_knife_" + family)
        cn, en, definition = types[econ]
        folder = "_default_knife" if family == "default_ct" else "knife_" + family
        candidates = {
            pathlib.PurePosixPath(k).stem: k
            for k in index
            if k.startswith("animation/anims/viewmodel/knife/" + folder + "/")
            and k.endswith(".vnmclip_c")
        }
        clips = {}
        for action, prefixes in CLIPS.items():
            hits = [
                k
                for pre in prefixes
                for name, k in candidates.items()
                if name.startswith(pre + "_")
            ]
            if not hits:
                raise ValueError((family, action, list(candidates)))
            actor = "knife" if family == "default_ct" else family
            exact = [
                candidates[pre + "_" + actor]
                for pre in prefixes
                if pre + "_" + actor in candidates
            ]
            clips[action] = (exact or hits)[0]
        row = dict(
            family=family,
            id=family.replace("_", "-") + "-vanilla",
            cn=cn,
            en=en,
            definition=definition,
            econ=econ,
            model=model,
            clips=clips,
            preview="panorama/images/econ/weapons/base_weapons/" + econ + "_png.vtex_c",
        )
        if row["preview"] not in index:
            raise ValueError(row)
        if family == "push":
            row["worldGrip"] = (
                "animation/anims/world/knife/knife_push/idle_push.vnmclip+non_additive.vnmclip_c"
            )
        rows.append(row)
    if len(rows) != 20:
        raise ValueError("Unexpected model set")
    return rows


def deps(data):
    block = 8 + struct.unpack_from("<I", data, 8)[0]
    for j in range(struct.unpack_from("<I", data, 12)[0]):
        p = block + j * 12
        if data[p : p + 4] != b"RERL":
            continue
        r = p + 4 + struct.unpack_from("<I", data, p + 4)[0]
        start, count = struct.unpack_from("<II", data, r)
        for n in range(count):
            entry = r + start + 16 * n + 8
            pos = entry + struct.unpack_from("<q", data, entry)[0]
            value = data[pos : data.index(b"\x00", pos)].decode().lower() + "_c"
            if value.endswith(
                (".vtex_c", ".vmat_c", ".vnmskel_c", ".vmesh_c", ".vnmclip_c")
            ):
                yield value


def prepare(index, rows, fetch):
    stores = [
        DEPOT / "game/csgo",
        SOURCE / "steam-files/game/csgo",
        ROOT / "artifacts/flat-sky-source/current/game/csgo",
        ROOT / "artifacts/skin-library-review/depot/game/csgo",
    ]
    stores += [ROOT / "artifacts/stock-library-review/depot/game/csgo"]
    stores += sorted((ROOT / "artifacts/skin-expansion-work").glob("*/game/csgo"))
    stores += [
        p.parent
        for p in (ROOT / "artifacts").glob("**/pak01_dir.vpk")
        if p.stat().st_size
        == (SOURCE / "steam-files/game/csgo/pak01_dir.vpk").stat().st_size
    ]
    stores = list(dict.fromkeys(stores))
    extra = [
        pathlib.Path(e)
        for e in os.getenv("CS2_CACHED_VOLUMES", "").split(os.pathsep)
        if e
    ]
    stores.extend(extra)
    GAME.mkdir(parents=True, exist_ok=True)
    DEPOT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE / "standalone/game/csgo/gameinfo.gi", GAME / "gameinfo.gi")
    start = set()
    for row in rows:
        start.update([row["model"], row["preview"], *row["clips"].values()])
        if row.get("worldGrip"):
            start.add(row["worldGrip"])
    previous = None
    for iteration in range(8):
        todo = list(start)
        seen = set()
        missing = set()
        while todo:
            key = todo.pop()
            if key in seen:
                continue
            seen.add(key)
            crc, pre, ar, off, size = index[key]
            file = GAME / key
            data = file.read_bytes() if file.is_file() else None
            if data is None or zlib.crc32(data) != crc:
                data = None
                for store in stores:
                    vol = store / ("pak01_%03d.vpk" % ar)
                    if not vol.is_file():
                        continue
                    try:
                        with vol.open("rb") as f:
                            f.seek(off)
                            b = pre + f.read(size)
                    except PermissionError:
                        continue
                    if zlib.crc32(b) != crc:
                        continue
                    data = b
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_bytes(b)
                    break
            if data is None:
                missing.add(ar)
                continue
            todo.extend(deps(data))
        if not missing:
            return
        print(
            "Needed Valve volumes",
            sorted(missing),
            "known entries",
            len(seen),
            flush=True,
        )
        if not fetch or previous == missing:
            raise RuntimeError("Missing verified Valve assets")
        previous = missing
        listing = DEPOT / "files.txt"
        listing.write_text(
            "\n".join("game/csgo/pak01_%03d.vpk" % a for a in sorted(missing)) + "\n"
        )
        dd = os.environ.get("DEPOT_DOWNLOADER", str(SOURCE / "dd/DepotDownloader.exe"))
        with (STAGE / ("download-" + str(iteration) + ".log")).open("w") as log:
            subprocess.run(
                [
                    dd,
                    "-app",
                    "730",
                    "-depot",
                    "2347770",
                    "-manifest",
                    ref.MANIFEST,
                    "-filelist",
                    str(listing),
                    "-dir",
                    str(DEPOT),
                    "-max-downloads",
                    "8",
                ],
                stdout=log,
                stderr=subprocess.STDOUT,
                check=True,
            )
    raise RuntimeError("Dependency depth")


def read_glb(path):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", raw)
    if (magic, version, length) != (b"glTF", 2, len(raw)):
        raise ValueError(path)
    n = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20 : 20 + n])
    size = struct.unpack_from("<I", raw, 20 + n)[0]
    return doc, bytearray(raw[28 + n : 28 + n + size])


def write_glb(path, doc, blob):
    doc["buffers"] = [dict(byteLength=len(blob))]
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    blob += b"\0" * (-len(blob) % 4)
    with path.open("wb") as f:
        f.write(
            struct.pack(
                "<4sIIII", b"glTF", 2, 28 + len(text) + len(blob), len(text), 0x4E4F534A
            )
        )
        f.write(text)
        f.write(struct.pack("<I4s", len(blob), b"BIN\0"))
        f.write(blob)
    return dict(bytes=path.stat().st_size, sha256=sha(path))


def export_resource(source, out, kind):
    out.parent.mkdir(parents=True, exist_ok=True)
    temp = out.parent / "temp"
    temp.mkdir(exist_ok=True)
    args = [
        str(CLI),
        "-i",
        str(GAME / source),
        "-o",
        str(out),
        "-d",
        "--game",
        str(GAME / "gameinfo.gi"),
    ]
    if kind != "icon":
        args.extend(["--gltf_export_format", "glb"])
    if kind in ("clip", "mesh"):
        args.append("--gltf_export_animations")
    if kind == "mesh":
        args.extend(
            ["--gltf_export_materials", "--gltf_textures_adapt", "--gltf_export_extras"]
        )
    log = out.with_suffix(".log")
    with log.open("w") as f:
        subprocess.run(
            args,
            env=dict(os.environ, TEMP=str(temp), TMP=str(temp)),
            stdout=f,
            stderr=subprocess.STDOUT,
            check=True,
            timeout=180,
        )
    if not out.is_file() or not out.stat().st_size:
        raise IOError(log)
    failures = [
        line
        for line in log.read_text("utf8", errors="replace").splitlines()
        if "Failed to load" in line
    ]
    if failures:
        raise ValueError((source, failures))


def world_dagger_grips(clip):
    # The Shadow Daggers mesh contains two bone-weighted blades at the same
    # bind position. Recover each blade's authored transform in hand space
    # from Valve's non-additive third-person standing pose.
    import numpy as np
    from scipy.spatial.transform import Rotation

    doc, data = read_glb(clip)
    nodes = doc["nodes"]
    animation = doc["animations"][0]
    for channel in animation["channels"]:
        target = channel["target"]
        prop = target["path"]
        acc = doc["accessors"][animation["samplers"][channel["sampler"]]["output"]]
        if (
            prop not in ("translation", "rotation", "scale")
            or acc["componentType"] != 5126
        ):
            raise ValueError(channel)
        view = doc["bufferViews"][acc["bufferView"]]
        offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        nodes[target["node"]][prop] = struct.unpack_from(
            "<4f" if prop == "rotation" else "<3f", data, offset
        )
    matrices = {}

    def visit(i, parent):
        node = nodes[i]
        transform = np.eye(4)
        transform[:3, :3] = Rotation.from_quat(
            node.get("rotation", [0, 0, 0, 1])
        ).as_matrix() @ np.diag(node.get("scale", [1, 1, 1]))
        transform[:3, 3] = node.get("translation", [0, 0, 0])
        if "matrix" in node:
            transform = np.array(node["matrix"]).reshape(4, 4).T
        world = parent @ transform
        matrices[node["name"]] = world
        for c in node.get("children", []):
            visit(c, world)

    for i in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        visit(i, np.eye(4))
    basis = np.eye(4)
    basis[:3, :3] = Rotation.from_quat([-0.5, -0.5, -0.5, 0.5]).as_matrix()
    grip = {}
    for hand in ["L", "R"]:
        name = "weapon_" + hand.lower()
        offset = (
            np.linalg.inv(matrices["hand_" + hand])
            @ matrices["wpn"]
            @ np.linalg.inv(basis)
            @ matrices[name]
        )
        grip[name] = dict(
            hand=hand, offset=[round(float(v), 8) for v in offset.T.flatten()]
        )
    return grip


def normalized_mesh(raw, out, family, grips):
    doc, blob = read_glb(raw)
    if not doc.get("images"):
        raise ValueError("No original model textures " + family)
    for image in doc["images"]:
        if "uri" not in image:
            continue
        source = raw.parent / image.pop("uri")
        with Image.open(source) as img:
            img.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            packed = io.BytesIO()
            img.save(packed, format="PNG", optimize=True)
        payload = packed.getvalue()
        blob.extend(b"\0" * (-len(blob) % 4))
        image.update(bufferView=len(doc["bufferViews"]), mimeType="image/png")
        doc["bufferViews"].append(
            dict(buffer=0, byteOffset=len(blob), byteLength=len(payload))
        )
        blob.extend(payload)
    # VRF labels the exported body using its absolute input filename.
    for obj in doc.get("nodes", []) + doc.get("meshes", []):
        name = obj.get("name", "")
        if ".vmdl_c" in name:
            obj["name"] = family + name.split(".vmdl_c")[-1]
        if name in grips:
            obj.setdefault("extras", {})["cs2WorldGrip"] = grips[name]
    positions = [
        doc["accessors"][p["attributes"]["POSITION"]]
        for m in doc["meshes"]
        for p in m["primitives"]
    ]
    center = [
        (min(p["min"][i] for p in positions) + max(p["max"][i] for p in positions))
        * 0.5
        for i in range(3)
    ]
    scene = doc["scenes"][doc.get("scene", 0)]
    children = scene["nodes"]
    scene["nodes"] = [len(doc["nodes"])]
    doc["nodes"].append(
        dict(
            name="normalization",
            matrix=[
                -1,
                0,
                0,
                0,
                0,
                1,
                0,
                0,
                0,
                0,
                -1,
                0,
                center[0],
                -center[1],
                center[2],
                1,
            ],
            children=children,
        )
    )
    return write_glb(out, doc, blob)


def packed_clips(raw, out, family):
    doc = dict(
        asset=dict(version="2.0"),
        scene=0,
        scenes=[dict(nodes=[])],
        nodes=[],
        animations=[],
        accessors=[],
        bufferViews=[],
    )
    blob = bytearray()
    node_ids = {}
    for action in CLIPS:
        clip, src = read_glb(raw / (action + ".glb"))
        animation = clip["animations"][0]
        views = {}
        indices = {}

        def accessor(i):
            if i in indices:
                return indices[i]
            a = dict(clip["accessors"][i])
            v = a["bufferView"]
            if v not in views:
                view = clip["bufferViews"][v]
                off = view.get("byteOffset", 0)
                blob.extend(b"\0" * (-len(blob) % 4))
                views[v] = len(doc["bufferViews"])
                doc["bufferViews"].append(dict(view, buffer=0, byteOffset=len(blob)))
                blob.extend(src[off : off + view["byteLength"]])
            a["bufferView"] = views[v]
            indices[i] = len(doc["accessors"])
            doc["accessors"].append(a)
            return indices[i]

        samplers = [
            dict(s, input=accessor(s["input"]), output=accessor(s["output"]))
            for s in animation["samplers"]
        ]
        channels = []
        for channel in animation["channels"]:
            target = channel["target"]
            name = clip["nodes"][target["node"]]["name"]
            if name not in node_ids:
                node_ids[name] = len(doc["nodes"])
                doc["nodes"].append(dict(name=name))
                doc["scenes"][0]["nodes"].append(node_ids[name])
            channels.append(dict(channel, target=dict(target, node=node_ids[name])))
        if not channels:
            raise ValueError((family, action))
        doc["animations"].append(
            dict(name=family + "/" + action, samplers=samplers, channels=channels)
        )
    return write_glb(out, doc, blob)


def pack(row):
    family = row["family"]
    raw = STAGE / "raw" / family
    dest = STAGE / "publish"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "previews").mkdir(exist_ok=True)
    model = raw / "weapon.glb"
    icon = raw / "preview.png"
    export_resource(row["model"], model, "mesh")
    export_resource(row["preview"], icon, "icon")
    for action, path in row["clips"].items():
        export_resource(path, raw / (action + ".glb"), "clip")
    prefix = "assets/weapons/cs2-skins/knives/"
    grips = {}
    if row.get("worldGrip"):
        world = raw / "world-grip.glb"
        export_resource(row["worldGrip"], world, "clip")
        grips = world_dagger_grips(world)
    spec = normalized_mesh(model, dest / (family + ".glb"), family, grips)
    anim = packed_clips(raw, dest / (family + "-animations.glb"), family)
    preview = dest / "previews" / (family + ".webp")
    with Image.open(icon) as img:
        img.save(preview, "WEBP", quality=92, method=6)
    source = dict(
        definition=row["definition"],
        valveWeapon=row["econ"],
        model=row["model"],
        modelSourceSha256=sha(GAME / row["model"]),
        preview=row["preview"],
        previewSourceSha256=sha(GAME / row["preview"]),
        clips={a: dict(path=p, sha256=sha(GAME / p)) for a, p in row["clips"].items()},
    )
    if grips:
        source["worldGrip"] = dict(
            path=row["worldGrip"], sha256=sha(GAME / row["worldGrip"])
        )
    skin = dict(
        id=row["id"],
        weapon="knife",
        name=row["cn"] + " · 原厂涂装",
        englishName=row["en"],
        vanillaWeaponName=row["cn"],
        vanillaWeaponNameEn=row["en"],
        model=prefix + family + ".glb",
        preview=prefix + "previews/" + preview.name,
        previewBytes=preview.stat().st_size,
        previewSha256=sha(preview),
        **spec,
        isDefault=False,
        downloadRequired=True,
        condition="Vanilla",
        wear=0,
        animation=dict(model=prefix + family + "-animations.glb", **anim),
        animationFamily=family,
    )
    print("Packed %s (%d bytes)" % (family, spec["bytes"] + anim["bytes"]), flush=True)
    return skin, source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    index, hs = ref.read_index(SOURCE / "steam-files/game/csgo/pak01_dir.vpk")
    if hs != ref.INDEX_HASH:
        raise ValueError("Unexpected Valve depot directory hash")
    rows = plan(index)
    STAGE.mkdir(parents=True, exist_ok=True)
    (STAGE / "plan.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), "utf8"
    )
    prepare(index, rows, args.fetch)
    if args.prepare_only:
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(pack, rows))
    skins = [s for s, _ in results]
    sources = dict(
        steamApp=730,
        depot=2347770,
        manifest=ref.MANIFEST,
        directorySha256=hs,
        reused=["m9-vanilla", "butterfly-vanilla"],
        items={s["id"]: source for s, source in results},
    )
    dest = STAGE / "publish"
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for file in dest.rglob("*"):
        if not file.is_file():
            continue
        target = PUBLIC / file.relative_to(dest)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target.with_suffix(".tmp"))
        target.with_suffix(".tmp").replace(target)
    manifest = PUBLIC / "manifest.json"
    scratch = manifest.with_suffix(".json.tmp")
    scratch.write_text(
        json.dumps(dict(skins=skins, sources=sources), ensure_ascii=False, indent=2)
        + "\n",
        "utf8",
    )
    scratch.replace(manifest)


if __name__ == "__main__":
    main()
