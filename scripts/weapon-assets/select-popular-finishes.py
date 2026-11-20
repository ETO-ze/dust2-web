"""Rank eligible new Valve finishes using Skinport's sales-history JSON snapshot.

Run at the repository root after build-skin-reference.py. Capture the public
/v1/sales/history?app_id=730&currency=USD response with Brotli support and pass
the decompressed JSON file as the argument. Rerunning against a later sales
snapshot can legitimately select other finishes.
"""
import argparse
import collections
import importlib.util
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'scripts/weapon-assets'


def load(filename):
    return json.loads(filename.read_bytes())


def choose(sales_file, index_file, archive_dirs, reference):
    module = importlib.util.spec_from_file_location('schema', ASSETS / 'build-skin-reference.py')
    schema = importlib.util.module_from_spec(module)
    module.loader.exec_module(schema)
    index, checksum = schema.read_index(index_file)
    if checksum != schema.INDEX_HASH:
        raise ValueError('Use the VPK index matching the finish reference')
    text, _ = schema.text_resource(index, archive_dirs, schema.TEXT_FILES[0])
    kits = schema.parse_schema(text)['paint_kits']
    variants = collections.Counter()
    for sale in load(sales_file):
        name = sale['market_hash_name'].removeprefix('StatTrak™ ').removeprefix('Souvenir ').split(' (')[0]
        variants[name] += sale['last_30_days']['volume']

    defaults = {s['id']: s for s in load(ASSETS / 'default-skins.json') if s['id'] != 'knife'}
    legacy_glock = next(s for s in load(ASSETS / 'legacy-skins.json') if s['id'] == 'pistol')
    client_assets = subprocess.check_output(['node','--input-type=module','-e',
        "import{SKINS}from './shared/skins.js';console.log(JSON.stringify(SKINS))"], cwd=ROOT)
    existing = {(s['weapon'], s.get('paintkit')) for s in json.loads(client_assets) if '/popular/' not in s['model']}
    candidates = collections.defaultdict(list)
    for item in load(reference)['rows']:
        weapon, kit_id = item['weapon'], item['paintkit']
        if item['category'] != '枪械' or not item['factoryNew'] or (weapon, kit_id) in existing:
            continue
        kit = kits[str(kit_id)]
        if kit.get('use_legacy_model') != '1' or int(kit.get('style',0)) not in (5,7,9):
            continue
        paint = item['paint']
        if not paint.startswith(('am_','cu_','gs_')):
            continue
        full_name = item['weaponNameEn'] + ' | ' + item['nameEn']
        volume = variants[full_name]
        if not volume:
            continue
        base = legacy_glock if weapon == 'pistol' else defaults[weapon]
        inventory = pathlib.PurePosixPath(item['inventoryPath']).name.removesuffix('_light_png.vtex_c')
        slug = re.sub(r'[^a-z0-9]+','-',item['nameEn'].lower()).strip('-')
        candidates[weapon].append(dict(paintkit=kit_id,paint=paint,name=full_name,chineseName=item['name'],
            body='legacy',wearMin=item['wearMin'],wearMax=item['wearMax'],officialFactoryNewPossible=True,
            material=f'materials/models/weapons/customization/paints/vmats/{paint}.vmat_c',
            inventory=inventory,preview=item['inventoryPath'],id=weapon,weapon=weapon,englishName=item['nameEn'],
            file=f'{weapon}-{slug}-{kit_id}',rawGLB=base['rawGLB'],input=base['input'],marketVolume30d=volume))
    result = []
    for weapon in defaults:
        options = sorted(candidates[weapon], key=lambda s: (-s['marketVolume30d'],s['paintkit']))[:3]
        if len(options) != 3:
            raise ValueError('Insufficient eligible finishes for ' + weapon)
        result.extend(options)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sales',type=pathlib.Path)
    parser.add_argument('--reference',type=pathlib.Path,default=ROOT/'artifacts/skin-library-review/reference.json')
    parser.add_argument('--index',type=pathlib.Path,default=ROOT/'artifacts/flat-sky-source/current/game/csgo/pak01_dir.vpk')
    parser.add_argument('--archive-dir',dest='archives',type=pathlib.Path,action='append')
    parser.add_argument('--output',type=pathlib.Path,default=ASSETS/'popular-skins.json')
    args = parser.parse_args()
    dirs = args.archives or [ROOT/'artifacts/skin-library-review/depot/game/csgo',ROOT/'artifacts/performance-maps/source-extra/steam-files/game/csgo']
    specs = choose(args.sales,args.index,dirs,args.reference)
    args.output.write_text(json.dumps(specs,ensure_ascii=False,indent=2)+'\n','utf8')
