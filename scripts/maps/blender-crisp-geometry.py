"""Build editable Blender scenes and simplify only bounded, locally planar fans in a sealed map pool.

blender -b -t 3 -P scripts/maps/blender-crisp-geometry.py -- geometry --source artifacts/local-perf7/maps-v1 --output artifacts/blender-nine-crisp
blender -b -t 3 -P scripts/maps/blender-crisp-geometry.py -- scenes --source artifacts/local-perf7/maps-v1 --output artifacts/blender-nine-crisp
python scripts/maps/seal-performance-maps.py artifacts/blender-nine-crisp/maps-v1
"""
import argparse
import base64
import hashlib
import json
import pathlib
import runpy
import shutil
import struct
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = pathlib.Path(__file__).resolve().parents[2]
MAPS = "dust2 mirage inferno nuke ancient anubis cache train vertigo".split()
DTYPE = {5121: np.dtype("u1"), 5123: np.dtype("<u2"), 5125: np.dtype("<u4"), 5126: np.dtype("<f4")}
SIZE = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}
MAX_PLANE = 0.00065  # metres, all one-ring vertices relative to the same plane
MAX_COLOR_SPAN = 5   # within any original linear-RGB byte channel, across the whole fan
PASSES = 4


def read(path):
    return json.loads(path.read_bytes())


def write(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    tmp.replace(path)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def attribute(gltf, blob, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    kind = DTYPE[acc["componentType"]]
    size = SIZE[acc["type"]]
    return np.ndarray((acc["count"], size), dtype=kind, buffer=blob,
                      offset=view.get("byteOffset", 0) + acc.get("byteOffset", 0),
                      strides=(view.get("byteStride", kind.itemsize * size), kind.itemsize))


def unpack(gltf, blob, node):
    prim, = gltf["meshes"][node["mesh"]]["primitives"]
    assert prim.get("mode", 4) == 4 and set(prim["attributes"]) == {"POSITION", "COLOR_0"}
    assert not any(k in node for k in ("rotation", "matrix", "children"))
    pos_acc = prim["attributes"]["POSITION"]
    positions = attribute(gltf, blob, pos_acc).astype("f8")
    if gltf["accessors"][pos_acc].get("normalized"):
        positions /= 65535
    positions = positions * node.get("scale", [1, 1, 1]) + node.get("translation", [0, 0, 0])
    col = attribute(gltf, blob, prim["attributes"]["COLOR_0"])
    if col.dtype != np.uint8:
        col = np.rint(col * 255).clip(0, 255).astype("u1")
    faces = attribute(gltf, blob, prim["indices"]).reshape((-1, 3)).astype("i4")
    return prim, positions, col, faces


def simplify_pass(positions, colors, faces):
    # One directed edge per corner. Opposite, exactly paired edges are required
    # throughout a removable star. Open boundaries and nonmanifold edges survive.
    center = faces.ravel()
    nxt = np.roll(faces, -1, axis=1).ravel()
    prev = np.roll(faces, 1, axis=1).ravel()
    n = len(positions)
    key = np.minimum(center, nxt).astype("i8") * n + np.maximum(center, nxt)
    keys, inverse, counts = np.unique(key, return_inverse=True, return_counts=True)
    balance = np.bincount(inverse, weights=np.where(center < nxt, 1, -1))
    bad_edges = keys[(counts != 2) | (balance != 0)]
    okay = np.ones(n, dtype=bool)
    okay[bad_edges // n] = False
    okay[bad_edges % n] = False

    order = np.argsort(center, kind="stable")
    degree = np.bincount(center, minlength=n)
    offsets = np.r_[0, np.cumsum(degree)]
    okay &= (degree >= 3) & (degree <= 32)
    if not okay.any():
        return faces, 0

    normals = np.cross(positions[faces[:, 1]] - positions[faces[:, 0]], positions[faces[:, 2]] - positions[faces[:, 0]])
    areas = np.linalg.norm(normals, axis=1)
    okay[faces[areas < 1e-9].ravel()] = False
    normals /= np.maximum(areas[:, None], 1e-30)
    first = order[np.minimum(offsets[:-1], len(order) - 1)]
    axis = normals[first // 3]
    delta = positions[nxt] - positions[center]
    def dot(a, b):
        return np.einsum("ij,ij->i", a, b)

    plane_height = np.abs(dot(delta, axis[center]))
    # Two layers of overlapping/folded triangles cannot satisfy both tests.
    okay[center[(plane_height > MAX_PLANE) | (dot(np.repeat(normals, 3, axis=0), axis[center]) < .999)]] = False
    okay[center[colors[center, 3] != colors[nxt, 3]]] = False
    # All interpolated colours before and after a collapse lie within this fan's
    # RGB convex hull, hence their numerical difference is also bounded by its span.
    for channel in range(3):
        neighbor_colors = colors[nxt[order], channel]
        starts = offsets[:-1][degree > 0]
        low = np.minimum.reduceat(neighbor_colors, starts)
        high = np.maximum.reduceat(neighbor_colors, starts)
        own = colors[degree > 0, channel]
        okay[degree > 0] &= (np.maximum(high, own).astype(int) - np.minimum(low, own) <= MAX_COLOR_SPAN)

    distances = dot(delta, delta)
    ordered_edges = np.lexsort((nxt, distances, center))
    target = nxt[ordered_edges[np.minimum(offsets[:-1], len(order) - 1)]]
    dest = target[center]
    retained = (nxt != dest) & (prev != dest)
    cross = np.cross(positions[nxt] - positions[dest], positions[prev] - positions[dest])
    area_after = np.linalg.norm(cross, axis=1)
    # The projected fan must retain its winding and all remaining faces must
    # have positive area. Its boundary is identical on both sides of the edit.
    inward = dot(cross, axis[center])
    okay[center[retained & ((inward < 1e-9) | (inward < area_after * .998))]] = False

    original_neighbors = nxt[order]
    occupied = np.zeros(n, dtype=bool)
    mapping = np.arange(n, dtype="i4")
    removed = 0
    for v in np.flatnonzero(okay):
        if occupied[v]:
            continue
        neighbors = original_neighbors[offsets[v]:offsets[v + 1]]
        t = target[v]
        # Link condition: avoid joining a separate flap via an existing edge.
        t_neighbors = original_neighbors[offsets[t]:offsets[t + 1]]
        if len(set(neighbors).intersection(t_neighbors)) != 2:
            continue
        corners = order[offsets[v]:offsets[v + 1]]
        successor = dict(zip(nxt[corners], prev[corners]))
        cursor = neighbors[0]
        for step in range(len(neighbors)):
            cursor = successor[cursor]
            if cursor == neighbors[0]:
                break
        if step + 1 != len(neighbors):
            continue
        mapping[v] = t
        occupied[neighbors] = True
        occupied[v] = True
        removed += 1
    out = mapping[faces]
    # Strip only the two faces of each intentional edge collapse. Existing
    # degenerate source triangles (if any) remain byte-identical.
    was_distinct = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    now_duplicate = (out[:, 0] == out[:, 1]) | (out[:, 1] == out[:, 2]) | (out[:, 0] == out[:, 2])
    out = out[~(was_distinct & now_duplicate)]
    assert len(faces) - len(out) == 2 * removed
    return out, removed


def signed_source_paint(map_id, source, gltf_path, bin_path):
    sites = read(ROOT / "client/flat-site-markings-data.json")[map_id]
    patch = sites.get("replace")
    if not patch:
        return {}
    # Keep this guard in sync with flat-site-markings.js. A subset of older
    # authored paint patches no longer match current sealed geometry.
    if sites["source"] != source or patch["render"] != digest(gltf_path) or patch["geometry"] != digest(bin_path):
        return {}
    return patch["ranges"]


def keep_paint_mask(faces, ranges):
    keep = np.ones(len(faces), dtype=bool)
    for first, count in zip(ranges[::2], ranges[1::2]):
        assert first >= 0 and count > 0 and first + count <= len(faces)
        assert keep[first:first + count].all()
        keep[first:first + count] = False
    return faces[keep]


def verify_surface(positions, before, after):
    # Positive projected triangulations of one planar fan with its boundary
    # fixed have the same footprint. Also measure embedded surface distance in
    # both directions against Blender's BVH, independent of collapse decisions.
    if len(before) == len(after):
        return 0, 0.
    trees = [BVHTree.FromPolygons(positions.tolist(), tris.tolist(), all_triangles=True) for tris in (before, after)]
    rng = np.random.default_rng(0)
    sample_count = 0
    max_error = 0.
    def keys(tris):
        return (tris[:, 0].astype("i8") * len(positions) + tris[:, 1]) * len(positions) + tris[:, 2]
    identifiers = [keys(tris) for tris in (before, after)]
    for tris, ids, other_ids, tree in zip((before, after), identifiers, reversed(identifiers), reversed(trees)):
        changed = tris[~np.isin(ids, other_ids)]
        if not len(changed):
            continue
        chosen = changed[rng.choice(len(changed), min(850, len(changed)), replace=False)]
        for p in positions[chosen].mean(axis=1):
            distance = tree.find_nearest(p)[3]
            max_error = max(max_error, distance)
            sample_count += 1
    return sample_count, max_error


def constrained_candidate(worker, pos, colors, tris):
    if len(tris) < 24:
        return tris
    # The sealed map has many split vertex indices even on continuous floors.
    # Compare geometric edges when locking borders, including duplicated
    # positions at lighting seams. Colour attributes themselves stay separate.
    xyz, vertex = np.unique(pos, axis=0, return_inverse=True)
    vertex = vertex.ravel()
    corners = vertex[tris]
    a, b = corners.ravel(), np.roll(corners, -1, axis=1).ravel()
    n = len(pos)
    keys = np.minimum(a, b).astype("i8") * n + np.maximum(a, b)
    order = np.argsort(keys, kind="stable")
    sorted_keys = keys[order]
    unique, starts, counts = np.unique(sorted_keys, return_index=True, return_counts=True)
    fixed = counts != 2
    normals = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-20)
    pairs = starts[~fixed]
    n1 = normals[order[pairs] // 3]
    n2 = normals[order[pairs + 1] // 3]
    fixed[~fixed] = np.einsum("ij,ij->i", n1, n2) < .978   # 12 degrees
    edges = unique[fixed]
    fixed_vertex = np.zeros(len(xyz), dtype="u1")
    fixed_vertex[edges // n] = 1
    fixed_vertex[edges % n] = 1
    # On a long straight footprint or stair rail, keep the two feature endpoints
    # and allow interior subdivisions whose removal moves that line by <0.4 mm.
    ends = np.r_[edges // n, edges % n]
    neighbor = np.r_[edges % n, edges // n]
    order = np.argsort(ends)
    ids, first, valence = np.unique(ends[order], return_index=True, return_counts=True)
    middle = ids[valence == 2]
    pair = first[valence == 2]
    left = xyz[neighbor[order[pair]]] - xyz[middle]
    right = xyz[neighbor[order[pair+1]]] - xyz[middle]
    distance = np.linalg.norm(np.cross(left, right), axis=1) / np.maximum(np.linalg.norm(left-right, axis=1), 1e-20)
    straight = (distance < .0004) & (np.einsum("ij,ij->i",left,right) < 0)
    fixed_vertex[middle[straight]] = 0
    color_order = np.argsort(vertex)
    split = np.flatnonzero(np.r_[True, np.diff(vertex[color_order]) != 0])
    low = np.minimum.reduceat(colors[color_order], split, axis=0)
    high = np.maximum.reduceat(colors[color_order], split, axis=0)
    fixed_vertex[(high[:,3] != low[:,3]) | ((high[:,:3]-low[:,:3]).max(axis=1)>21)] = 1
    lock = fixed_vertex[vertex]
    packet = struct.pack("<II", n, 3*len(tris)) + pos.astype("<f4").tobytes() + colors.tobytes() + lock.tobytes() + vertex.astype("<u4").tobytes() + tris.astype("<u4").tobytes()
    worker.stdin.write(packet)
    worker.stdin.flush()
    length, = struct.unpack("<I", worker.stdout.read(4))
    result = np.frombuffer(worker.stdout.read(length * 4), dtype="<u4").reshape(-1, 3)
    return result if len(result) < len(tris) else tris


def identical_surfaces(pos, colors, faces):
    # Double-sided batches: identical three signed positions AND RGBA values
    # render identically regardless of starting corner or winding. Discard
    # coincident repeats and only faces with mathematically zero raster area.
    coordinate = np.ascontiguousarray(np.c_[pos,colors]).view(np.dtype((np.void, 7*8))).ravel()
    _, vertex = np.unique(coordinate, return_inverse=True)
    triangles = np.sort(vertex.ravel()[faces], axis=1)
    _, keep = np.unique(triangles, axis=0, return_index=True)
    keep.sort()
    unique = faces[keep]
    a, b, c = pos[unique].transpose(1,0,2)
    nonzero = np.any(np.cross(b-a,c-a) != 0, axis=1)
    return unique[nonzero]


def pack_views(gltf, blob, overrides):
    out = bytearray()
    for i, v in enumerate(gltf["bufferViews"]):
        start, size = v.get("byteOffset", 0), v["byteLength"]
        payload = overrides.get(i, blob[start:start + size])
        out.extend(bytes((-len(out)) % 4))
        v.update(byteOffset=len(out), byteLength=len(payload))
        out.extend(payload)
    out.extend(bytes((-len(out)) % 4))
    gltf["buffers"][0]["byteLength"] = len(out)
    return out


def compact_attributes(gltf, blob, primitive, tris, replacements):
    """Deduplicate only byte-identical position and RGBA pairs on static geometry."""
    readbacks = []
    original = None
    for attr_id in primitive["attributes"].values():
        acc = gltf["accessors"][attr_id]
        view = gltf["bufferViews"][acc["bufferView"]]
        assert not acc.get("byteOffset")
        values = attribute(gltf, blob, attr_id)
        original = len(values)
        meaningful = np.ascontiguousarray(values).view("u1").reshape(original,-1)
        stride = view.get("byteStride", meaningful.shape[1])
        raw = np.ndarray((original,stride), dtype="u1", buffer=blob, offset=view.get("byteOffset",0))
        readbacks.append((acc, values, meaningful, raw))
    row = np.ascontiguousarray(np.column_stack([record[2] for record in readbacks]))
    keys = row.view(np.dtype((np.void,row.shape[1]))).ravel()
    used = np.unique(tris)
    _, positions, back = np.unique(keys[used], return_index=True, return_inverse=True)
    # Original ordering is valuable for gzip and sector-local GPU caching.
    order = np.argsort(positions)
    ids = used[positions[order]]
    if len(ids) == original:
        return tris, original, original
    mapping = np.zeros(original, dtype="i4")
    mapping[used] = np.argsort(order)[back.ravel()]
    for acc, values, _, raw in readbacks:
        replacements[acc["bufferView"]] = np.ascontiguousarray(raw[ids]).tobytes()
        acc["count"] = len(ids)
        if "min" in acc:
            acc["min"] = values[ids].min(axis=0).tolist()
        if "max" in acc:
            acc["max"] = values[ids].max(axis=0).tolist()
    return mapping[tris], original, len(ids)


def geometry(source, destination, audit_path, worker):
    gltf_path, bin_path = source / "render/map.gltf", source / "render/map.bin"
    gltf, blob = read(gltf_path), bin_path.read_bytes()
    mapdata = read(source / "compiled/map.json")
    paint = signed_source_paint(source.name, mapdata["sourceSha256"], gltf_path, bin_path)
    totals = dict(before=0, after=0, beforeVertices=0, afterVertices=0, removedPaint=0, samples=0, maxSampleDeviationMm=0., drawBatches=len(gltf["meshes"]), batches=[])
    replacements = {}
    surface_totals = {}
    for node in gltf["nodes"]:
        name = node["name"]
        prim, pos, colors, faces = unpack(gltf, blob, node)
        original = keep_paint_mask(faces, paint.get(name, []))
        current = original
        passes = []
        if name.startswith("tile_"):
            assert gltf["materials"][prim["material"]].get("doubleSided"), "Duplicate winding requires two-sided drawing"
            clean = identical_surfaces(pos, colors, original)
            current = constrained_candidate(worker, pos, colors, clean)
            for _ in range(PASSES):
                current, collapsed = simplify_pass(pos, colors, current)
                passes.append(collapsed)
                if not collapsed:
                    break
        else:
            clean = original
        samples, error = verify_surface(pos, clean, current)
        rejected = error > .016
        if rejected:
            current = clean
        totals["samples"] += samples
        if not rejected:
            totals["maxSampleDeviationMm"] = max(totals["maxSampleDeviationMm"], error * 1000)
        totals["before"] += len(faces)
        totals["after"] += len(current)
        totals["removedPaint"] += len(faces) - len(original)
        totals["batches"].append(dict(node=name, before=len(faces), after=len(current), identicalOrZeroArea=len(original)-len(clean), collapses=passes, candidateRejected=rejected))
        values, counts = np.unique(colors[current[:, 0], 3], return_counts=True)
        for value, count in zip(values, counts):
            surface_totals[str(value)] = surface_totals.get(str(value), 0) + int(count)
        old_vertices = new_vertices = len(pos)
        if name.startswith("tile_"):
            current, old_vertices, new_vertices = compact_attributes(gltf, blob, prim, current, replacements)
        totals["beforeVertices"] += old_vertices
        totals["afterVertices"] += new_vertices
        if len(current) != len(faces) or old_vertices != new_vertices:
            acc = gltf["accessors"][prim["indices"]]
            assert not acc.get("byteOffset") and acc["bufferView"] not in replacements
            replacements[acc["bufferView"]] = current.astype(DTYPE[acc["componentType"]]).tobytes()
            acc["count"] = 3 * len(current)
            if "min" in acc: acc["min"] = [int(current.min())]
            if "max" in acc: acc["max"] = [int(current.max())]
    assert set(paint) <= {n["name"] for n in gltf["nodes"]}
    assert totals["after"] < totals["before"] - totals["removedPaint"]
    gltf["extras"].update(outputTriangles=totals["after"], surfaceTriangles=surface_totals, crispPlanarPass=1)
    packed = pack_views(gltf, blob, replacements)
    render = destination / "render"
    render.mkdir(parents=True, exist_ok=True)
    temp = render / "map.bin.part"
    temp.write_bytes(packed)
    temp.replace(render / "map.bin")
    write(render / "map.gltf", gltf)
    totals.update(map=source.name, beforeBytes=len(blob), afterBytes=len(packed), sourceVisibleTriangles=gltf["extras"].get("visibleTriangles"),
                  byteExactRetainedAttributes=["POSITION", "COLOR_0"], surfaceMaterialVersion=gltf["extras"]["surfaceMaterialVersion"])
    write(audit_path, totals)
    print(source.name, totals["before"], "->", totals["after"], "removed paint", totals["removedPaint"], "mm", round(totals["maxSampleDeviationMm"], 3), flush=True)


def build_mesh(name, vertices, tris):
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(vertices))
    mesh.vertices.foreach_set("co", np.ascontiguousarray(vertices, dtype="f4").ravel())
    mesh.loops.add(3 * len(tris))
    mesh.loops.foreach_set("vertex_index", np.ascontiguousarray(tris, dtype="i4").ravel())
    mesh.polygons.add(len(tris))
    mesh.polygons.foreach_set("loop_start", np.arange(0, 3 * len(tris), 3, dtype="i4"))
    mesh.update(calc_edges=True)
    return mesh


def fence_material():
    # Same 16 cm projected diamond period and 5.5% wire fraction as the
    # browser shader. A repeating coverage tile preserves transparency at a
    # distance through texture filtering in the editor/renderer.
    side = 128
    step = np.arange(side, dtype="f4")
    def integral(x):
        return np.floor(x)*.055 + np.minimum(x-np.floor(x),.055)
    lanes = side*(integral((step+1)/side+.0275) - integral(step/side+.0275))
    coverage = np.clip(1-(1-lanes[None,:])*(1-lanes[:,None]),0,1)
    pixels = np.ones((side,side,4),dtype="f4")
    pixels[:,:,:3] = coverage[:,:,None]
    image = bpy.data.images.new("Chain link / coverage",width=side,height=side,alpha=False)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    mat = bpy.data.materials.new("Chain link / 160 mm diamond wire")
    mat.use_nodes = True
    mat.diffuse_color = (.0844,.1195,.1441,.11)
    mat.surface_render_method = "BLENDED"
    tree = mat.node_tree
    tree.nodes.clear()
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    emit = tree.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (.0844,.1195,.1441,1)
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(tex.outputs["Color"], mix.inputs[0])
    tree.links.new(tree.nodes.new("ShaderNodeBsdfTransparent").outputs[0], mix.inputs[1])
    tree.links.new(emit.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], tree.nodes.new("ShaderNodeOutputMaterial").inputs[0])
    return mat


def set_fence_uv(mesh, coords, tris):
    points = coords[tris]
    normal = np.cross(points[:,1]-points[:,0], points[:,2]-points[:,0])
    normal /= np.maximum(np.linalg.norm(normal,axis=1,keepdims=True),1e-12)
    right = np.c_[-normal[:,1],normal[:,0],np.zeros(len(tris))]
    right[np.abs(normal[:,2])>.97] = [1.,0.,0.]
    right /= np.maximum(np.linalg.norm(right,axis=1,keepdims=True),1e-12)
    up = np.cross(normal,right)
    x,y = (np.einsum("tki,ti->tk",points,direction) for direction in (right,up))
    uv = np.dstack((x+y,x-y))/.16
    mesh.uv_layers.new(name="Wire spacing").uv.foreach_set("vector",uv.astype("f4").ravel())


def add_stencils(scene, mapdata):
    entry = read(ROOT / "client/flat-site-markings-data.json")[mapdata["id"]]
    if entry["source"] != mapdata["sourceSha256"]:
        return
    positions, texcoords, triangles = [], [], []
    for site in ("A", "B"):
        stencil = entry[site]
        offset = len(positions)
        for dx, dy, dz, tu, tv in struct.iter_unpack("<hhhBB", base64.b64decode(stencil["vertices"])):
            x, y, z = np.asarray(stencil["anchor"]) + np.asarray([dx,dy,dz]) / 5000
            positions.append([x, -z, y])
            u = (.5 + 191 * tu / 255) / 192
            v = (.5 + 191 * tv / 255) / 192
            texcoords.append([((site == "B") + u) / 2, ((not stencil.get("wall")) + v) / 2])
        references = np.frombuffer(base64.b64decode(stencil["indices"]), dtype="<u2").reshape(-1, 3).astype("i4")
        triangles.extend((references + offset).tolist())
    mesh = build_mesh("A+B / authored stencil geometry", positions, triangles)
    uv = mesh.uv_layers.new(name="Stencil")
    uvs = np.asarray(texcoords, dtype="f4")[np.asarray(triangles).ravel()]
    uv.uv.foreach_set("vector", uvs.ravel())
    # Blender uses bottom-left image coordinates; both runtime and source PNG
    # use the same glTF/Three UVs here (TextureLoader's default flipY=true).
    mat = bpy.data.materials.new("A+B / site paint")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    pic = tree.nodes.new("ShaderNodeTexImage")
    pic.image = bpy.data.images.load(str(ROOT / "client/flat-site-stencils.png"))
    pic.image.pack()
    emit = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(pic.outputs["Color"], emit.inputs["Color"])
    mix = tree.nodes.new("ShaderNodeMixShader")
    clear = tree.nodes.new("ShaderNodeBsdfTransparent")
    tree.links.new(pic.outputs["Alpha"], mix.inputs[0])
    tree.links.new(clear.outputs[0], mix.inputs[1])
    tree.links.new(emit.outputs[0], mix.inputs[2])
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(mix.outputs[0], output.inputs[0])
    mesh.materials.append(mat)
    scene.collection.objects.link(bpy.data.objects.new("World bombsite stencils", mesh))


def create_scene(folder, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    gltf, blob = read(folder / "render/map.gltf"), (folder / "render/map.bin").read_bytes()
    mapdata = read(folder / "compiled/map.json")
    scene.name = mapdata["name"]
    scene.unit_settings.system = "METRIC"
    pigment = bpy.data.materials.new("Map pigment / retained source lighting")
    pigment.use_nodes = True
    tree = pigment.node_tree
    tree.nodes.clear()
    color_node = tree.nodes.new("ShaderNodeVertexColor")
    color_node.layer_name = "COLOR_0"
    emit = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(color_node.outputs["Color"], emit.inputs["Color"])
    tree.links.new(emit.outputs[0], tree.nodes.new("ShaderNodeOutputMaterial").inputs[0])
    bounds = []
    base_count = 0
    fence = None
    angle = mapdata["renderRotationY"]
    cs, sn = np.cos(angle), np.sin(angle)
    for node in gltf["nodes"]:
        prim, pos, rgba, tris = unpack(gltf, blob, node)
        # Apply the exact runtime root rotation before converting Y-up to Z-up.
        coords = np.column_stack((cs*pos[:,0] + sn*pos[:,2], sn*pos[:,0] - cs*pos[:,2], pos[:,1]))
        used = np.unique(tris)
        bounds += [coords[used].min(axis=0), coords[used].max(axis=0)]
        mesh = build_mesh(node["name"], coords, tris)
        colors = mesh.color_attributes.new(name="COLOR_0", type="FLOAT_COLOR", domain="POINT")
        colors.data.foreach_set("color", (rgba.astype("f4")/255).ravel())
        mesh.color_attributes.active_color = colors
        tags = mesh.attributes.new("surface_id", "INT", "POINT")
        tags.data.foreach_set("value", rgba[:,3].astype("i4"))
        is_fence = gltf["materials"][prim["material"]].get("extras",{}).get("performanceFence")
        if is_fence:
            if fence is None:
                fence = fence_material()
            mesh.materials.append(fence)
            set_fence_uv(mesh, coords, tris)
        else:
            mesh.materials.append(pigment)
        obj = bpy.data.objects.new(node["name"], mesh)
        scene.collection.objects.link(obj)
        if folder.name == "de_nuke" and node["name"] == "nuke-vent-slats":
            # Retain both editable poses; the open pose is active at spawn.
            obj.hide_render = True
            obj.hide_set(True)
        base_count += len(tris)
    bind = runpy.run_path(str(ROOT / "scripts/maps/assign-nine-map-finishes.py"))["bind_map_finishes"]
    bind(scene, folder.name, output / "Map-Finishes.blend")
    add_stencils(scene, mapdata)
    bounds = np.asarray(bounds)
    lower, upper = bounds.min(axis=0), bounds.max(axis=0)
    center = Vector((lower+upper)*.5)
    camera = bpy.data.cameras.new("Full map")
    camera.type = "ORTHO"
    eye = Vector((.74,-.92,1.02)).normalized()
    rotation = (-eye).to_track_quat("-Z", "Y")
    cam = bpy.data.objects.new("Full map / architectural overview", camera)
    cam.rotation_euler = rotation.to_euler()
    cam.location = center + eye * (np.linalg.norm(upper-lower) + 5.)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.resolution_percentage = 100
    corner = [Vector((x,y,z)) for x in (lower[0],upper[0]) for y in (lower[1],upper[1]) for z in (lower[2],upper[2])]
    local = np.asarray([rotation.inverted() @ (v-center) for v in corner])
    camera.ortho_scale = float(max(np.ptp(local[:,0]), np.ptp(local[:,1])*1.6) * 1.05)
    camera.clip_end = max(1500, np.linalg.norm(upper-lower)*4)
    scene.world = bpy.data.worlds.new("Studio background")
    scene.world.color = (.12,.14,.16)
    scene.view_settings.view_transform = "Standard"
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_perspective = "CAMERA"
                area.spaces.active.shading.type = "MATERIAL"
                area.spaces.active.shading.use_scene_world = True
                area.spaces.active.shading.use_scene_lights = True
                area.spaces.active.overlay.show_overlays = False
                area.spaces.active.clip_end = camera.clip_end
    scene["render_triangles"] = base_count
    scene["source_map"] = mapdata["sourceSha256"]
    scene["source_geometry"] = digest(folder / "render/map.bin")
    scene["render_batches"] = len(gltf["meshes"])
    scene["world_bounds_metres"] = list(lower) + list(upper)
    scene_path = (output / "scenes" / (folder.name + ".blend")).resolve()
    scene_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(scene_path), compress=True)
    print("EDITABLE", folder.name, base_count, scene_path.stat().st_size, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("geometry", "scenes"))
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--maps", nargs="+", choices=MAPS, default=MAPS)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    worker = None
    if args.stage == "geometry":
        worker = subprocess.Popen(["node", str(ROOT / "scripts/maps/crisp-simplifier.mjs")], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    for short in args.maps:
        key = "de_" + short
        src, dest = args.source / key, args.output / "maps-v1" / key
        if args.stage == "geometry":
            if not dest.exists():
                shutil.copytree(src, dest)
            geometry(src, dest, args.output / "geometry-audit" / (key + ".json"), worker)
        else:
            create_scene(dest, args.output)
    if args.stage == "geometry":
        worker.stdin.close()
        if worker.wait() != 0:
            raise RuntimeError("Geometry worker failed")
        for name in ("radars", "exports.json"):
            source = args.source / name
            target = args.output / "maps-v1" / name
            if source.is_dir():
                shutil.copytree(source, target, dirs_exist_ok=True)
            elif source.is_file():
                shutil.copy2(source, target)


if __name__ == "__main__":
    main()
