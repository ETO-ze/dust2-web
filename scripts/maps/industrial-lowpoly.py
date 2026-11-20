"""Build Train/Vertigo artwork when only their visibility geometry is available.

Bake colour and cut architectural details directly onto coplanar source surfaces.
Decorations have no collision, and may never span an opening in the source mesh.
Input positions use the match coordinate frame (metres, Y up).
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import box, Polygon, MultiPolygon
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

PALETTES = {
    'de_train': dict(masonry=(167,119,95), plaster=(201,192,165), concrete=(151,155,149),
                     metal=(80,108,110), roof=(84,105,108), beam=(65,83,86), freight=(160,102,69),
                     timber=(156,131,94), glass=(89,139,149), reveal=(57,77,79), accent=(211,174,97)),
    'de_vertigo': dict(masonry=(186,168,147), plaster=(202,202,187), concrete=(179,184,182),
                       metal=(107,138,151), roof=(139,162,167), beam=(77,106,120), freight=(219,131,59),
                       timber=(195,155,105), glass=(127,171,181), reveal=(91,118,129), accent=(240,186,71)),
}


def material_ids(world, map_id, normals):
    points, inv = np.unique(np.rint(world.reshape(-1, 3) * 500).astype('i4'), axis=0, return_inverse=True)
    corners = inv.reshape(-1, 3)
    edges = corners[:, [0, 1, 1, 2]].reshape(-1, 2).T
    graph = coo_matrix((np.ones(edges.shape[1], dtype=bool), edges), shape=(len(points), len(points)))
    n, groups = connected_components(graph.tocsr(), directed=False)
    low = np.full((n, 3), np.inf)
    high = -low.copy()
    np.minimum.at(low, groups, points * .002)
    np.maximum.at(high, groups, points * .002)
    span = high - low
    component = groups[corners[:, 0]]
    height = span[:, 1]
    width = span[:, [0, 2]].min(1)
    length = span[:, [0, 2]].max(1)
    large = (length > 22) & (width > 15)
    pillar = (height > 2 * width) & (width < 1.5)
    beam = (width < .8) | ((length > 2.2 * width) & (height < .9))
    centre = (low + high) / 2
    surfaces = np.full(n, 'metal', dtype=object)
    if map_id == 'de_train':
        wagons = (length > 6) & (width >= 2.1) & (width <= 4.8) & (height > 2) & (height < 5)
        surfaces[wagons] = 'freight'
        surfaces[(width > 1.0) & (width < 3) & (length < 4) & (height < 3)] = 'timber'
    else:
        surfaces[(height < 3.1) & (length < 4.5) & (width > .9)] = 'freight'
        surfaces[(height < .65) & (length > 1.5) & (width > .7)] = 'timber'
    surfaces[beam | pillar] = 'beam'
    if map_id == 'de_vertigo':
        surfaces[(centre[:, 1] > 308) & (height > 6) & (width < 10)] = 'accent'
    surfaces = surfaces[component]
    centres = world.mean(1)
    for axis in (0, 2):
        # Stable blocks across adjacent triangles lying on the same facade.
        parallel = np.abs(normals[:, axis]) > .68
        coord = np.floor((centres[:, axis] + .07) / .3).astype(int)
        district = (coord * 7 + axis * 13) % 10
        colors = (['masonry'] * 5 + ['plaster'] * 3 + ['metal'] * 2 if map_id == 'de_train'
                  else ['concrete'] * 5 + ['plaster'] * 3 + ['metal'] * 2)
        selected = large[component] & parallel
        surfaces[selected] = np.asarray(colors)[district[selected]]
    structural = large[component]
    surfaces[structural & (normals[:, 1] > .62)] = 'concrete'
    surfaces[structural & (normals[:, 1] < -.62)] = 'roof'
    return surfaces


def split_polys(geometry):
    if isinstance(geometry, Polygon):
        yield geometry
    elif isinstance(geometry, MultiPolygon) or geometry.geom_type == 'GeometryCollection':
        for item in geometry.geoms:
            yield from split_polys(item)


def wall_details(world, normals, names, map_id):
    """Project new polygons into the union of actual, outward-facing wall triangles."""
    records = []
    level = 297.2 if map_id == 'de_vertigo' else -5.3
    for axis, along in ((0, 2), (2, 0)):
        selected = np.abs(normals[:, axis]) > .99997
        selected &= np.ptp(world[:, :, axis], axis=1) < .009
        selected &= np.isin(names, ['plaster', 'masonry', 'concrete', 'metal', 'freight'])
        selected &= (world[:, :, 1].min(1) < level + 24) & (world[:, :, 1].max(1) > level - 7)
        batch = {}
        for index in np.flatnonzero(selected):
            face = world[index]
            key = (round(face[:, axis].mean() * 200), int(np.sign(normals[index, axis])), names[index])
            batch.setdefault(key, []).append(face[:, [along, 1]])
        for (plane, sign, material), source in batch.items():
            if len(source) < 2:
                continue
            polys = shapely.polygons(np.asarray(source))
            combined = shapely.union_all(polys, grid_size=.006)
            for wall in split_polys(combined):
                x0, y0, x1, y1 = wall.bounds
                if wall.area < 13 or x1 - x0 < 3.5 or y1 - y0 < 2.0:
                    continue

                def apply(bounds, finish, depth):
                    if bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
                        return
                    cut = wall.intersection(box(*bounds))
                    if cut.is_empty or cut.area < .012:
                        return
                    for region in split_polys(cut):
                        for tri in shapely.constrained_delaunay_triangles(region).geoms:
                            uv = np.asarray(tri.exterior.coords)[:3]
                            xyz = np.empty((3, 3))
                            xyz[:, along], xyz[:, 1] = uv[:, 0], uv[:, 1]
                            xyz[:, axis] = plane / 200 + sign * depth
                            records.append((xyz, finish, sign, axis))

                # High parapet / sill and a darker weather plinth give scale without wireframe.
                apply((x0, y0+.08, x1, min(y0+.54, y1)), 'beam', .012)
                if y1 - y0 >= 3.4:
                    apply((x0, y1-.20, x1, y1-.08), 'roof', .012)
                if map_id == 'de_train' and material in ('masonry', 'plaster') and y1-y0 >= 3.8:
                    # Glazed clerestories remain high above travel openings.
                    high = min(y1-.42, y0+4.6)
                    for x in np.arange(x0+1.0, x1-1.5, 3.2):
                        apply((x, high-1.10, x+1.55, high), 'reveal', .016)
                        for dx in (.08, .81):
                            apply((x+dx, high-.99, x+dx+.65, high-.13), 'glass', .021)
                        apply((x-.09, high-1.17, x+1.63, high-1.1), 'concrete', .015)
                elif map_id == 'de_vertigo' and material in ('metal','freight') and y1-y0 > 2.0:
                    # Safety paint and sheet-metal ribs follow the original panel.
                    apply((x0, y0+.8, x1, min(y0+.96, y1)), 'accent', .017)
                    for x in np.arange(x0+1.3, x1-.5, 2.0):
                        apply((x, y0+.16, x+.065, y1-.12), 'roof', .022)
                elif material == 'freight':
                    for x in np.arange(x0+.45, x1-.45, 1.65):
                        apply((x, y0+.22, x+.09, y1-.23), 'roof', .017)
    return records


def bake_colors(world, names, normals, palette, map_id):
    base = np.zeros((len(world), 3))
    for name, value in palette.items():
        base[names == name] = np.asarray(value) / 255.
    sun = np.array([-.43, .78, .46])
    diffuse = normals @ sun
    # Baked face light, cooler hemisphere fill and subtle ground contact graduated at vertices.
    brightness = .84 + .19 * np.maximum(diffuse, 0) + .07 * np.maximum(normals[:, 1], 0)
    grade = np.array([.97, 1.0, 1.025])[None, :] + np.maximum(diffuse, 0)[:, None] * [.060, .013, -.048]
    rgb = base * grade * brightness[:, None]
    h = world[:, :, 1]
    contact_floor = 297.2 if map_id == 'de_vertigo' else -5.3
    contact = 1 - .115 * np.exp(-np.abs(h - contact_floor) / 1.45)
    srgb = np.clip(rgb[:, None, :] * contact[:, :, None], 0, 1)
    linear = np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055) ** 2.4)
    return np.uint8(np.rint(255 * linear))


def build(folder, target):
    key = folder.name
    palette = PALETTES[key]
    target.mkdir(parents=True, exist_ok=True)
    original = folder / 'compiled/physics.f32'
    with tempfile.TemporaryDirectory(dir=target) as work:
        faces = Path(work) / 'faces.f32'
        subprocess.run(['node', str(Path(__file__).with_name('simplify-visibility.mjs')), str(original),
                        str(faces), '65000' if key == 'de_train' else '34000'], check=True)
        world = np.fromfile(faces, '<f4').reshape(-1, 3, 3)
    n = np.cross(world[:, 1]-world[:, 0], world[:, 2]-world[:, 0])
    length = np.linalg.norm(n, axis=1)
    valid = length > .000006
    world, normals = world[valid], n[valid] / length[valid, None]
    names = material_ids(world, key, normals)
    trim = wall_details(world, normals, names, key)
    if trim:
        axes = np.zeros((len(trim), 3))
        for i, (_, _, sign, axis) in enumerate(trim):
            axes[i, axis] = sign
        world = np.concatenate([world, np.asarray([r[0] for r in trim], dtype='f4')])
        names = np.r_[names, [r[1] for r in trim]]
        normals = np.concatenate([normals, axes])
    colors = bake_colors(world, names, normals, palette, key)
    # Encode in the source glTF orientation used by the match renderer.
    points = world[:, :, [2, 1, 0]].copy()
    points[:, :, 0] *= -1
    nodes, meshes, views, accessors, blob = [], [], [], [], bytearray()

    def attribute(data, kind, gl_type, target, bounds=False):
        offset = len(blob)
        raw = data.tobytes()
        blob.extend(raw)
        blob.extend(bytes((-len(blob)) % 4))
        views.append(dict(buffer=0, byteOffset=offset, byteLength=len(raw), target=target))
        acc = dict(bufferView=len(views)-1, componentType=gl_type, count=len(data), type=kind)
        if bounds:
            acc.update(min=data.min(0).tolist(), max=data.max(0).tolist())
        if gl_type == 5121:
            acc['normalized'] = True
        accessors.append(acc)
        return len(accessors)-1

    tile = np.floor(world.mean(1)[:, [0, 2]] / 32).astype(int)
    tiles, group = np.unique(tile, axis=0, return_inverse=True)
    for index, cell in enumerate(tiles):
        pick = group.ravel() == index
        pack = np.c_[np.rint(1000 * points[pick].reshape(-1, 3)).astype('i4'), colors[pick].reshape(-1, 3)]
        unique, inv = np.unique(pack, axis=0, return_inverse=True)
        pos = attribute((unique[:, :3] * .001).astype('<f4'), 'VEC3', 5126, 34962, True)
        rgba = np.c_[unique[:, 3:], np.full(len(unique), 255)].astype('u1')
        col = attribute(rgba, 'VEC4', 5121, 34962)
        compact = len(unique) <= 65535
        elems = attribute(inv.ravel().astype('<u2' if compact else '<u4'), 'SCALAR', 5123 if compact else 5125, 34963)
        meshes.append(dict(primitives=[dict(attributes=dict(POSITION=pos, COLOR_0=col), indices=elems, material=0)]))
        nodes.append(dict(name='sector_%d_%d' % tuple(cell), mesh=len(meshes)-1))
    extras = dict(source='awpy-visibility-redraw', renderSource='awpy-visibility-redraw', style='industrial-lowpoly', sourceTriangles=original.stat().st_size//36,
                  outputTriangles=len(world), facadeTriangles=len(trim), geometrySource='Awpy visibility mesh, authored structural facades')
    doc = dict(asset=dict(version='2.0'), scene=0, scenes=[dict(nodes=list(range(len(nodes))))], nodes=nodes, meshes=meshes,
               extensionsUsed=['KHR_materials_unlit'], materials=[dict(name='Industrial architectural colour', doubleSided=True,
               extensions={'KHR_materials_unlit':{}}, pbrMetallicRoughness=dict(baseColorFactor=[1,1,1,1], metallicFactor=0, roughnessFactor=1))],
               buffers=[dict(uri='map.bin', byteLength=len(blob))], bufferViews=views, accessors=accessors, extras=extras)
    (target/'map.bin').write_bytes(blob)
    (target/'map.gltf').write_text(json.dumps(doc,separators=(',',':')), encoding='utf8')
    print(key, extras, len(blob), 'bytes', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('render', type=Path)
    args = parser.parse_args()
    build(args.source, args.render)