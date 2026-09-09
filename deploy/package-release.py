"""Package the built client and a minimal, platform-independent Node runtime app."""
from pathlib import Path
import hashlib
import json
import tarfile
import gzip
import shutil
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
out = root / 'artifacts' / 'deploy'
out.mkdir(parents=True, exist_ok=True)
archive = out / f'dust2-web-{stamp}.tar.gz'
paths = ['dist', 'server', 'shared', 'package.json', 'package-lock.json',
         'node_modules/three', 'node_modules/three-mesh-bvh', 'node_modules/ws',
         'public/assets/map/collision.json', 'public/assets/map/penetration-materials.u8', 'deploy/dust2-web.service',
         'deploy/dust2-web.location.conf']
if not (root / 'dist/index.html').is_file():
    raise SystemExit('Run npm run build before packaging.')
compressed = 0
for asset in (root / 'dist/assets').rglob('*'):
    if asset.is_file() and asset.suffix in {'.js', '.css', '.json', '.gltf', '.bin', '.f32', '.svg'}:
        packed = asset.with_name(asset.name + '.gz')
        with asset.open('rb') as source, gzip.open(packed, 'wb', compresslevel=6) as target:
            shutil.copyfileobj(source, target)
        if packed.stat().st_size > asset.stat().st_size * .95:
            packed.unlink()
        else:
            compressed += 1
with tarfile.open(archive, 'w:gz', compresslevel=6) as tar:
    for relative in paths:
        tar.add(root / relative, arcname=relative)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
report = {'release': stamp, 'archive': str(archive), 'bytes': archive.stat().st_size, 'precompressedAssets': compressed,
          'sha256': digest, 'runtime': 'Node 22; pure-JavaScript production dependencies'}
(out / 'latest.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report, indent=2))
