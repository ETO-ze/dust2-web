"""Create a small delta plus a complete SHA-256 manifest; no local app files are edited.

  python deploy/package-delta.py --base-tar artifacts/deploy/previous.tar.gz --release STAMP
  python deploy/package-delta.py --base-manifest downloaded-base.manifest.json --release STAMP
  python deploy/package-delta.py --base-tar OLD.tar.gz --new-tar NEW.tar.gz --release STAMP

The base manifest must describe the currently active remote release, not merely any
older build. activate-delta verifies every base file before copying/activating it.
Keep activate-delta.py beside this script; it provides the shared validation helpers.
"""
import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import gzip
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tarfile
import tempfile

spec = importlib.util.spec_from_file_location('dust2_delta', Path(__file__).with_name('activate-delta.py'))
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)
PATHS = ['dist', 'server', 'shared', 'package.json', 'package-lock.json', 'node_modules/three',
         'node_modules/three-mesh-bvh', 'node_modules/ws', 'public/assets/map/collision.json',
         'deploy/dust2-web.service', 'deploy/dust2-web.location.conf']
COMPRESS = {'.js', '.css', '.json', '.gltf', '.bin', '.f32', '.svg'}


def tar_inventory(tar):
    files, sources, seen = {}, {}, set()
    for member in tar.getmembers():
        name = member.name.rstrip('/') if member.isdir() else member.name
        delta.safe_path(name)
        if name in seen:
            raise ValueError(f'Duplicate full archive path: {name}')
        seen.add(name)
        if member.isdir():
            continue
        if not member.isfile() or member.issym() or member.islnk():
            raise ValueError(f'Full archive contains a link/non-regular file: {name}')
        if name == delta.MANIFEST_FILE:
            continue
        with tar.extractfile(member) as source:
            sha256 = delta.stream_digest(source)
        files[name] = {'sha256': sha256, 'bytes': member.size}
        sources[name] = member
    return delta.validate_manifest({'schema': delta.SCHEMA, 'files': files}), sources


def root_inventory(root):
    files, sources = {}, {}
    if not (root / 'dist/index.html').is_file():
        raise ValueError('Run npm run build before packaging a project directory.')
    for relative in PATHS:
        source = root / relative
        if not source.exists() or source.is_symlink():
            raise ValueError(f'Missing or linked runtime path: {relative}')
        candidates = source.rglob('*') if source.is_dir() else [source]
        for item in candidates:
            if item.is_symlink():
                raise ValueError(f'Runtime symlink rejected: {item}')
            if item.is_dir():
                continue
            if not item.is_file():
                raise ValueError(f'Non-regular runtime file: {item}')
            name = item.relative_to(root).as_posix()
            # Rebuild or inherit every eligible gzip companion; never package an old stale .gz.
            if name.startswith('dist/assets/') and item.suffix == '.gz' and item.with_suffix('').suffix in COMPRESS:
                continue
            files[name] = {'sha256': delta.digest(item), 'bytes': item.stat().st_size}
            sources[name] = item
    return delta.validate_manifest({'schema': delta.SCHEMA, 'files': files}), sources


def prepare_gzip(manifest, sources, base, temporary):
    inherited, generated = 0, 0
    for name, entry in list(manifest['files'].items()):
        if not name.startswith('dist/assets/') or Path(name).suffix not in COMPRESS:
            continue
        packed_name = name + '.gz'
        # An unchanged resource can keep its exact previous gzip bytes on the host.
        # This also avoids a one-time map re-upload caused solely by old gzip timestamps.
        if base['files'].get(name) == entry and packed_name in base['files']:
            manifest['files'][packed_name] = dict(base['files'][packed_name]); inherited += 1
            continue
        packed = temporary / (str(generated) + '.gz')
        with sources[name].open('rb') as source, packed.open('wb') as raw:
            with gzip.GzipFile(filename='', mode='wb', fileobj=raw, compresslevel=6, mtime=0) as target:
                shutil.copyfileobj(source, target)
        if packed.stat().st_size <= entry['bytes'] * .95:
            manifest['files'][packed_name] = {'sha256': delta.digest(packed), 'bytes': packed.stat().st_size}
            sources[packed_name] = packed; generated += 1
        else:
            packed.unlink()
    return inherited, generated


def package(args):
    root = Path(args.root).resolve()
    output = Path(args.output_dir).resolve(); output.mkdir(parents=True, exist_ok=True)
    if not delta.re.fullmatch(r'[A-Za-z0-9]{1,80}', args.release):
        raise ValueError('Release must be an alphanumeric identifier.')
    archive = output / f'dust2-delta-{args.release}.tar.gz'
    manifest_file = output / f'dust2-delta-{args.release}.manifest.json'
    report_file = output / f'dust2-delta-{args.release}.json'
    if any(path.exists() for path in [archive, manifest_file, report_file]):
        raise ValueError('Output for this release already exists; choose a new release name.')
    with ExitStack() as stack:
        if args.base_tar:
            base_tar = stack.enter_context(tarfile.open(args.base_tar, 'r:*'))
            base, _ = tar_inventory(base_tar)
        else:
            base = delta.validate_manifest(json.loads(Path(args.base_manifest).read_text(encoding='utf8')))
        new_tar = stack.enter_context(tarfile.open(args.new_tar, 'r:*')) if args.new_tar else None
        inherited = generated = 0
        if new_tar:
            manifest, sources = tar_inventory(new_tar)
        else:
            manifest, sources = root_inventory(root)
            temporary = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='dust2-delta-gzip-')))
            inherited, generated = prepare_gzip(manifest, sources, base, temporary)
            manifest = delta.validate_manifest(manifest)
        changed = sorted(name for name, entry in manifest['files'].items() if base['files'].get(name) != entry)
        deleted = sorted(set(base['files']) - set(manifest['files']))
        metadata = {'schema': delta.SCHEMA, 'release': args.release, 'baseManifest': base, 'manifest': manifest,
                    'baseManifestSha256': delta.manifest_hash(base), 'manifestSha256': delta.manifest_hash(manifest),
                    'changed': changed, 'deleted': deleted}
        with tarfile.open(archive, 'x:gz', compresslevel=6) as tar:
            content = delta.canonical(metadata)
            info = tarfile.TarInfo('delta.json'); info.size = len(content); info.mode = 0o644
            tar.addfile(info, io.BytesIO(content))
            for name in changed:
                entry = manifest['files'][name]
                info = tarfile.TarInfo('payload/' + name); info.size = entry['bytes']; info.mode = 0o644
                with (new_tar.extractfile(sources[name]) if new_tar else sources[name].open('rb')) as source:
                    tar.addfile(info, source)
                # A concurrent build/edit is an error, not a package with silently stale hashes.
                if not new_tar and delta.digest(sources[name]) != entry['sha256']:
                    raise ValueError(f'Source changed while packaging: {name}')
        delta.write_json(manifest_file, manifest)
        report = {'release': args.release, 'archive': str(archive), 'sha256': delta.digest(archive), 'bytes': archive.stat().st_size,
                  'manifest': str(manifest_file), 'manifestSha256': delta.manifest_hash(manifest), 'baseManifestSha256': delta.manifest_hash(base),
                  'files': len(manifest['files']), 'changedFiles': len(changed), 'deletedFiles': len(deleted),
                  'changedUncompressedBytes': sum(manifest['files'][name]['bytes'] for name in changed),
                  'inheritedGzipAssets': inherited, 'generatedGzipAssets': generated,
                  'prepare': 'Upload only this delta tar and activate-delta.py. Verify current release/vhost, then run activate with the reported archive SHA-256.'}
        delta.write_json(report_file, report)
        return report


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    baseline = parser.add_mutually_exclusive_group(required=True)
    baseline.add_argument('--base-tar'); baseline.add_argument('--base-manifest')
    parser.add_argument('--root', default=str(root))
    parser.add_argument('--new-tar', help='Use an already built complete new release archive instead of --root')
    parser.add_argument('--release', default=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    parser.add_argument('--output-dir', default=str(root / 'artifacts/deploy'))
    print(json.dumps(package(parser.parse_args()), indent=2))


if __name__ == '__main__':
    main()
