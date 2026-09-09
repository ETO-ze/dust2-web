"""Build a bounded gameplay overlay against a verified local base archive.

Existing .gz files are never trusted or copied: changed raw files receive fresh
sidecars. This module is importable for isolated tests and never deploys a site.
"""
from pathlib import Path
import gzip
import hashlib
import importlib.util
import io
import json
import os
import tarfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
BASE_NAME = 'dust2-web-20260909T032013Z.tar.gz'
BASE_SHA = '09568d081227f8e0bb65a20ddb71f9384d85e707bf692ea867d39cf0e93809eb'
COMPRESSIBLE = {'.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.txt', '.md'}
spec = importlib.util.spec_from_file_location('gameplay_policy', Path(__file__).with_name('gameplay-overlay.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
receiver = policy.module


def digest(file):
    value = hashlib.sha256()
    while chunk := file.read(1024**2):
        value.update(chunk)
    return value.hexdigest()


def inventory_base(base, expected):
    if base.is_symlink() or not base.is_file():
        raise ValueError('Base must be a regular non-symlink archive')
    if not receiver.HASH.fullmatch(expected):
        raise ValueError('Invalid base SHA-256')
    with base.open('rb') as source:
        if digest(source) != expected:
            raise ValueError('Base archive SHA mismatch')
        source.seek(0)
        old, seen, parents, total = {}, {}, set(), 0
        with tarfile.open(fileobj=source, mode='r|gz', tarinfo=receiver.CheckedInfo) as archive:
            for info in archive:
                receiver.checked_member(info, seen, parents)
                total += info.size
                if total > receiver.MAX_TOTAL:
                    raise ValueError('Base archive payload too large')
                if info.isfile():
                    with archive.extractfile(info) as content:
                        old[info.name] = digest(content)
        source.seek(0)
        if digest(source) != expected:
            raise ValueError('Base changed during inventory')
    return old


def candidate_paths(root):
    paths = []
    for folder in ('dist', 'server', 'shared'):
        directory = root / folder
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError(f'Missing or symlink source directory: {folder}')
        for path in directory.rglob('*'):
            if path.is_symlink():
                raise ValueError(f'Symlink in build source: {path}')
            if not path.is_file() or path.suffix == '.gz':
                continue
            if not path.resolve().is_relative_to(root):
                raise ValueError(f'Source escapes workspace: {path}')
            if folder in ('server', 'shared') and path.suffix != '.js':
                continue
            paths.append(path)
    for suffix in ('.u8', '.json'):
        path = root / f'public/assets/map/penetration-materials{suffix}'
        if path.is_symlink():
            raise ValueError('Symlink material table')
        if path.is_file():
            if not path.resolve().is_relative_to(root):
                raise ValueError('Material table escapes workspace')
            paths.append(path)
    return sorted(paths)


def build_overlay(root, base, expected, output, release):
    root, base, output = Path(root).resolve(), Path(base), Path(output)
    old = inventory_base(base, expected)
    paths = candidate_paths(root)
    if not (root / 'dist/index.html').is_file():
        raise ValueError('Build is missing dist/index.html')
    if output.exists() or output.is_symlink():
        raise FileExistsError('Overlay output already exists')
    changed, seen, parents, total = [], {}, set(), 0
    created = None
    try:
        with output.open('xb') as raw_output:
            created = os.fstat(raw_output.fileno())
            with tarfile.open(fileobj=raw_output, mode='w:gz', compresslevel=6) as archive:
                def add(name, data):
                    nonlocal total
                    info = tarfile.TarInfo(name)
                    info.size, info.mode = len(data), 0o644
                    receiver.checked_member(info, seen, parents, overlay=True)
                    total += info.size
                    if total > receiver.MAX_OVERLAY_TOTAL:
                        raise ValueError('Overlay payload exceeds receiver limit')
                    archive.addfile(info, io.BytesIO(data))
                    changed.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})

                for path in paths:
                    name = path.relative_to(root).as_posix()
                    with path.open('rb') as source:
                        sha = digest(source)
                        if old.get(name) == sha and name != 'dist/index.html':
                            continue
                        source.seek(0)
                        data = source.read(receiver.MAX_OVERLAY_FILE + 1)
                    if hashlib.sha256(data).hexdigest() != sha:
                        raise ValueError(f'Source changed during packaging or exceeds member limit: {name}')
                    add(name, data)
                    # Forced index.html is also paired; binary assets get a fresh
                    # gzip if the base already has one, irrespective of suffix.
                    if name.startswith('dist/') and (path.suffix in COMPRESSIBLE or name + '.gz' in old):
                        add(name + '.gz', gzip.compress(data, compresslevel=6, mtime=0))
            raw_output.flush()
            os.fsync(raw_output.fileno())
        with output.open('rb') as source:
            policy.read_overlay(source)
            source.seek(0)
            sha = digest(source)
        return {'release': release, 'base': base.name, 'baseSha256': expected,
                'archive': str(output), 'bytes': output.stat().st_size,
                'sha256': sha, 'payloadBytes': total, 'files': changed}
    except BaseException:
        if created is not None and output.exists():
            current = output.lstat()
            if (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino):
                output.unlink()
        raise


def main():
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = ROOT / 'artifacts/deploy' / f'gameplay-overlay-{stamp}.tar.gz'
    report = build_overlay(ROOT, ROOT / 'artifacts/deploy' / BASE_NAME, BASE_SHA, output, stamp)
    (ROOT / 'artifacts/deploy/gameplay-overlay.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'files'}, indent=2))
    print('Changed files:', len(report['files']))


if __name__ == '__main__':
    main()
