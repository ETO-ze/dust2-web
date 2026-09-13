"""Package original map textures for phones, keeping geometry, UVs and alpha."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'public/assets'
source = root / 'map-cs2/dust2-web.gltf'
target = root / 'map-mobile'
(target / 'textures').mkdir(parents=True, exist_ok=True)
gltf = json.loads(source.read_text(encoding='utf-8'))
color_images = set()
for material in gltf['materials']:
    for slot in [material.get('pbrMetallicRoughness', {}).get('baseColorTexture'), material.get('emissiveTexture')]:
        if slot is not None:
            texture = gltf['textures'][slot['index']]
            color_images.add(texture.get('source', texture.get('extensions', {}).get('EXT_texture_webp', {}).get('source')))

def convert(pair):
    index, entry = pair
    color = index in color_images
    limit = 512 if color else 128
    original = source.parent / entry['uri']
    with Image.open(original) as image:
        before = image.width * image.height * 4
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        name = hashlib.sha256(original.read_bytes() + f':mobile-clear-v1:{limit}:{color}'.encode()).hexdigest()[:20] + '.webp'
        output = target / 'textures' / name
        if not output.exists():
            image.save(output, 'WEBP', quality=92, method=4, exact=True, lossless=not color)
        return {**entry, 'uri': 'textures/' + name}, before, image.width * image.height * 4

with ThreadPoolExecutor(max_workers=4) as pool:
    converted = list(pool.map(convert, enumerate(gltf['images'])))
gltf['images'] = [item[0] for item in converted]
for buffer in gltf['buffers']:
    if 'uri' in buffer:
        buffer['uri'] = '../map-cs2/' + buffer['uri']
(target / 'dust2-clear.gltf').write_text(json.dumps(gltf, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
report = {'profile': 'mobile-clear', 'images': len(converted),
          'sourceRgbaMiB': round(sum(item[1] for item in converted) / 1048576, 1),
          'mobileRgbaMiB': round(sum(item[2] for item in converted) / 1048576, 1),
          'geometryUnchanged': True, 'maxTextureSize': 512, 'colorMaxSize': 512, 'dataMaxSize': 128}
(target / 'profile-clear.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
