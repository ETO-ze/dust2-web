"""Pack the Valve HD stock firearm bodies, bone weights and inventory artwork."""
import argparse
import copy
import hashlib
import importlib.util
import io
import json
import pathlib
import struct
import subprocess
import zlib

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
STAGE = ROOT / 'artifacts/stock-library-review'
PUBLIC = ROOT / 'public'
OUT = PUBLIC / 'assets/weapons/cs2-skins/stock-guns'
reference_module = importlib.util.spec_from_file_location('valve_reference', HERE / 'build-skin-reference.py')
reference = importlib.util.module_from_spec(reference_module)
reference_module.loader.exec_module(reference)


def digest(blob):
    return hashlib.sha256(blob).hexdigest()


def file_meta(file):
    blob = file.read_bytes()
    return {'file': file.relative_to(ROOT).as_posix(), 'bytes': len(blob), 'sha256': digest(blob)}


def pack_model(raw, out):
    data = raw.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + size])
    binary = memoryview(data)[28 + size:]
    selected, = (i for i, mesh in enumerate(doc['meshes']) if mesh['name'].endswith('.body_hd'))
    mesh = doc['meshes'][selected]
    result = {'asset': {'version': '2.0', 'generator': 'Source 2 Viewer; Valve HD stock weapon packing'},
              'scene': 0, 'nodes': copy.deepcopy(doc['nodes']), 'scenes': [], 'meshes': [],
              'skins': [], 'accessors': [], 'bufferViews': [], 'buffers': [], 'materials': [],
              'textures': [], 'images': [], 'samplers': doc.get('samplers', [])}
    blob = bytearray()
    views, accessors, textures, materials, skins = {}, {}, {}, {}, {}
    inputs = {}

    def append_view(b, props):
        vi = len(result['bufferViews'])
        result['bufferViews'].append(dict(props, buffer=0, byteOffset=len(blob), byteLength=len(b)))
        blob.extend(b)
        blob.extend(b'\0' * (-len(blob) % 4))
        return vi

    def accessor(ai):
        if ai not in accessors:
            a = dict(doc['accessors'][ai])
            if 'sparse' in a:
                raise ValueError(('Unexpected sparse accessor', raw))
            n = a['bufferView']
            if n not in views:
                v = doc['bufferViews'][n]
                start = v.get('byteOffset', 0)
                views[n] = append_view(binary[start:start + v['byteLength']], v)
            a['bufferView'] = views[n]
            accessors[ai] = len(result['accessors'])
            result['accessors'].append(a)
        return accessors[ai]

    def texture(ref, max_px, retain_alpha):
        index = ref['index']
        key = (index, max_px, retain_alpha)
        if key not in textures:
            tex = doc['textures'][index]
            im = doc['images'][tex['source']]
            f = raw.parent / im['uri']
            inputs[f] = file_meta(f)
            with Image.open(f) as src:
                img = src.convert('RGBA' if retain_alpha else 'RGB')
            img.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
            compressed = io.BytesIO()
            if retain_alpha:
                img.save(compressed, 'PNG')
            else:
                img.save(compressed, 'JPEG', quality=95, subsampling=0)
            vi = append_view(compressed.getvalue(), {})
            ii = len(result['images'])
            result['images'].append({'name': im.get('name', f.stem), 'bufferView': vi,
                                     'mimeType': 'image/png' if retain_alpha else 'image/jpeg'})
            textures[key] = len(result['textures'])
            result['textures'].append(dict(tex, source=ii))
        ref['index'] = textures[key]

    def material(mi):
        if mi not in materials:
            m = copy.deepcopy(doc['materials'][mi])
            m.pop('extras', None)
            if m['name'] == 'shared_scope_lens':
                m = {'name': m['name'], 'alphaMode': 'BLEND', 'doubleSided': True,
                     'pbrMetallicRoughness': {'baseColorFactor': [.86, .94, .98, .035],
                                              'metallicFactor': 0, 'roughnessFactor': .08}}
            else:
                pbr = m.get('pbrMetallicRoughness', {})
                for ref, px, alpha in [(pbr.get('baseColorTexture'), 1536, m.get('alphaMode', 'OPAQUE') != 'OPAQUE'),
                                        (pbr.get('metallicRoughnessTexture'), 1024, False),
                                        (m.get('normalTexture'), 1024, False),
                                        (m.get('occlusionTexture'), 1024, False),
                                        (m.get('emissiveTexture'), 1024, False)]:
                    if ref:
                        texture(ref, px, alpha)
            materials[mi] = len(result['materials'])
            result['materials'].append(m)
        return materials[mi]

    prims = []
    bounds = []
    for p in mesh['primitives']:
        if doc['materials'][p['material']]['name'] == 'sticker_gaps':
            continue
        attrs = p['attributes']
        prims.append(dict(p, attributes={k: accessor(i) for k, i in attrs.items()},
                          indices=accessor(p['indices']), material=material(p['material'])))
        bounds.append(doc['accessors'][attrs['POSITION']])
    result['meshes'].append({'name': mesh['name'], 'primitives': prims})
    keep = []
    for i, node in enumerate(result['nodes']):
        if 'mesh' not in node:
            continue
        if node.pop('mesh') != selected:
            node.pop('skin', None)
            continue
        node['mesh'] = 0
        keep.append(i)
        if 'skin' in node:
            si = node['skin']
            if si not in skins:
                skin = dict(doc['skins'][si])
                skin['inverseBindMatrices'] = accessor(skin['inverseBindMatrices'])
                skins[si] = len(result['skins'])
                result['skins'].append(skin)
            node['skin'] = skins[si]
    if not prims or not skins or not inputs:
        raise ValueError(('Incomplete stock body', raw))
    cx, cy, cz = [(min(b['min'][i] for b in bounds) + max(b['max'][i] for b in bounds)) / 2 for i in range(3)]
    roots = [i for i in doc['scenes'][doc.get('scene', 0)]['nodes'] if 'mesh' not in doc['nodes'][i] or i in keep]
    result['scenes'] = [{'nodes': [len(result['nodes'])]}]
    result['nodes'].append({'name': 'normalization', 'children': roots,
                            'matrix': [-1,0,0,0, 0,1,0,0, 0,0,-1,0, cx,-cy,cz,1]})
    result['buffers'].append({'byteLength': len(blob)})
    js = json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    out.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 28 + len(js) + len(blob), len(js), 0x4e4f534a)
                    + js + struct.pack('<I4s', len(blob), b'BIN\0') + blob)
    return {'rawGLB': file_meta(raw), 'sourceMesh': mesh['name'], 'sourceFiles': list(inputs.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=pathlib.Path, default=ROOT / 'artifacts/performance-maps/source-extra/steam-files/game/csgo/pak01_dir.vpk')
    parser.add_argument('--archives', type=pathlib.Path, default=STAGE / 'depot/game/csgo')
    parser.add_argument('--cli', type=pathlib.Path, default=ROOT / 'tools/source2viewer/Source2Viewer-CLI.exe')
    args = parser.parse_args()
    index, index_hash = reference.read_index(args.index)
    if index_hash != reference.INDEX_HASH:
        raise ValueError('Mismatched Valve depot index')
    rows = json.loads((ROOT / 'artifacts/skin-library-review/reference.json').read_text('utf8'))['rows']
    by_weapon = {r['weapon']: r for r in rows if r['category'] == '枪械'}
    icons = STAGE / 'icons'
    icons.mkdir(parents=True, exist_ok=True)
    (OUT / 'previews').mkdir(parents=True, exist_ok=True)
    catalog = {'depot': 2347770, 'depotManifest': reference.MANIFEST,
               'directorySha256': index_hash, 'skins': [], 'sources': {}}
    for spec in json.loads((HERE / 'default-skins.json').read_text('utf8')):
        w = spec['id']
        if w == 'knife':
            continue
        official = by_weapon[w]
        skin_id = w + '-vanilla'
        icon_key = 'panorama/images/econ/weapons/base_weapons/' + official['valveWeapon'] + '_png.vtex_c'
        crc, pre, volume, offset, length = index[icon_key]
        with (args.archives / f'pak01_{volume:03d}.vpk').open('rb') as archive:
            archive.seek(offset)
            tex = pre + archive.read(length)
        if zlib.crc32(tex) != crc:
            raise ValueError('Incorrect Valve inventory texture: ' + icon_key)
        icon_src = icons / pathlib.Path(icon_key).name
        icon_src.write_bytes(tex)
        png = icon_src.with_suffix('.png')
        subprocess.run([str(args.cli), '-i', str(icon_src), '-o', str(png), '-d'], stdout=subprocess.DEVNULL, check=True)
        preview = OUT / 'previews' / (skin_id + '.webp')
        with Image.open(png) as img:
            img.thumbnail((512, 384), Image.Resampling.LANCZOS)
            img.save(preview, 'WEBP', quality=92)
        model = OUT / (skin_id + '.glb')
        provenance = pack_model(ROOT / spec['rawGLB'], model)
        provenance.update(inventoryIcon=icon_key, inventorySource=file_meta(icon_src))
        catalog['sources'][skin_id] = provenance
        m, p = file_meta(model), file_meta(preview)
        catalog['skins'].append({'id': skin_id, 'weapon': w, 'name': '原厂涂装', 'englishName': official['weaponNameEn'] + ' | Vanilla',
                                  'vanillaWeaponName': official['weaponName'], 'vanillaWeaponNameEn': official['weaponNameEn'],
                                  'condition': 'Vanilla', 'isDefault': False, 'wear': None,
                                  'model': model.relative_to(PUBLIC).as_posix(), 'bytes': m['bytes'], 'sha256': m['sha256'],
                                  'preview': preview.relative_to(PUBLIC).as_posix(), 'previewBytes': p['bytes'], 'previewSha256': p['sha256']})
        print(skin_id, m['bytes'], flush=True)
    (OUT / 'manifest.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', 'utf8')


if __name__ == '__main__':
    main()
