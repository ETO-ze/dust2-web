#!/usr/bin/env python3
"""Merge a small verified client overlay into a release archive, without extraction.

All CLI paths must be direct children of /opt/dust2-web/incoming. Both inputs are
read-only; the output must not exist. This helper never activates a release.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tarfile

INCOMING = Path('/opt/dust2-web/incoming')
ROOTS = {'dist', 'server', 'shared', 'package.json', 'package-lock.json',
         'node_modules', 'public', 'deploy'}
HASH = re.compile(r'[0-9a-f]{64}')
OVERLAY_NAME = re.compile(r'dist/assets/index-[A-Za-z0-9_-]+\.(?:js|css)(?:\.gz)?')
MAX_MEMBERS = 100000
MAX_TOTAL = 8 * 1024**3
MAX_FILE = 1024**3
MAX_OVERLAY_TOTAL = 64 * 1024**2
MAX_OVERLAY_FILE = 32 * 1024**2
MAX_OVERLAY_MEMBERS = 64
CHUNK = 1024**2


def digest(source):
    value = hashlib.sha256()
    while chunk := source.read(CHUNK):
        value.update(chunk)
    return value.hexdigest()


class CheckedInfo(tarfile.TarInfo):
    """Bound extended headers before tarfile allocates their declared payload."""
    def _proc_member(self, archive):
        if self.size < 0:
            raise ValueError('Negative archive member size.')
        extensions = {tarfile.XHDTYPE, tarfile.XGLTYPE,
                      tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK}
        if self.type in extensions and self.size > CHUNK:
            raise ValueError('Oversized extended archive header.')
        return super()._proc_member(archive)


def checked_member(info, seen, parents, overlay=False):
    name = info.name
    parts = name.split('/')
    if (not name or len(name) > 4096 or '\\' in name or ':' in name
            or any(ord(c) < 32 or ord(c) == 127 for c in name)
            or any(part in ('', '.', '..') for part in parts)
            or parts[0] not in ROOTS):
        raise ValueError(f'Unsafe archive path: {name!r}')
    if (not (info.isfile() or info.isdir()) or info.sparse is not None
            or any(key.startswith('GNU.sparse') for key in info.pax_headers)):
        raise ValueError(f'Non-regular archive member: {name}')
    if name in seen:
        raise ValueError(f'Duplicate archive member: {name}')
    if parts[0] in {'package.json', 'package-lock.json'} and (len(parts) != 1 or not info.isfile()):
        raise ValueError(f'Invalid package root: {name}')
    if info.isdir() and info.size != 0:
        raise ValueError(f'Directory has a payload: {name}')
    if not 0 <= info.size <= (MAX_OVERLAY_FILE if overlay else MAX_FILE):
        raise ValueError(f'Oversized archive member: {name}')
    if overlay and (not info.isfile() or not (name == 'dist/index.html' or OVERLAY_NAME.fullmatch(name))):
        raise ValueError(f'Unexpected overlay member: {name}')
    for i in range(1, len(parts)):
        parent = '/'.join(parts[:i])
        if seen.get(parent) == 'file':
            raise ValueError(f'File is also a parent: {parent}')
        parents.add(parent)
    if info.isfile() and name in parents:
        raise ValueError(f'File is also a parent: {name}')
    seen[name] = 'file' if info.isfile() else 'directory'
    if len(seen) > (MAX_OVERLAY_MEMBERS if overlay else MAX_MEMBERS):
        raise ValueError('Too many archive members.')


def clean_info(info):
    # Only safe, ordinary file metadata survives into the new archive.
    result = tarfile.TarInfo(info.name)
    result.type = tarfile.DIRTYPE if info.isdir() else tarfile.REGTYPE
    result.mode = 0o755 if info.isdir() else 0o644
    result.size = info.size
    result.mtime = max(0, min(int(info.mtime), 0x7fffffff))
    return result


def read_overlay(source):
    entries, seen, parents = {}, {}, set()
    total = 0
    with tarfile.open(fileobj=source, mode='r|gz', tarinfo=CheckedInfo) as archive:
        for info in archive:
            checked_member(info, seen, parents, overlay=True)
            total += info.size
            if total > MAX_OVERLAY_TOTAL:
                raise ValueError('Oversized overlay payload.')
            with archive.extractfile(info) as payload:
                content = payload.read(MAX_OVERLAY_FILE + 1)
            if len(content) != info.size:
                raise ValueError(f'Truncated overlay member: {info.name}')
            entries[info.name] = (clean_info(info), content)
    if 'dist/index.html' not in entries:
        raise ValueError('Overlay must include dist/index.html.')
    return entries


def rewrite(base, overlay, output):
    """Stream the large base payload; only the bounded overlay stays in memory."""
    seen, parents, replaced = {}, set(), []
    base_total = result_total = 0
    with gzip.GzipFile(filename='', mode='wb', fileobj=output, compresslevel=1, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as result:
            with tarfile.open(fileobj=base, mode='r|gz', tarinfo=CheckedInfo) as archive:
                for info in archive:
                    checked_member(info, seen, parents)
                    base_total += info.size
                    if base_total > MAX_TOTAL:
                        raise ValueError('Oversized base payload.')
                    if info.name in overlay:
                        if not info.isfile():
                            raise ValueError(f'Overlay cannot replace a directory: {info.name}')
                        target, content = overlay[info.name]
                        result_total += target.size
                        if result_total > MAX_TOTAL:
                            raise ValueError('Oversized combined payload.')
                        result.addfile(target, io.BytesIO(content))
                        replaced.append(info.name)
                    else:
                        result_total += info.size
                        if result_total > MAX_TOTAL:
                            raise ValueError('Oversized combined payload.')
                        if info.isfile():
                            with archive.extractfile(info) as payload:
                                result.addfile(clean_info(info), payload)
                        else:
                            result.addfile(clean_info(info))
            appended = sorted(set(overlay) - set(seen))
            for name in appended:
                info, content = overlay[name]
                checked_member(info, seen, parents)
                result_total += info.size
                if result_total > MAX_TOTAL:
                    raise ValueError('Oversized combined payload.')
                result.addfile(info, io.BytesIO(content))
            for name in ('server/index.js', 'dist/index.html', 'public/assets/map/collision.json'):
                if seen.get(name) != 'file':
                    raise ValueError(f'Incomplete release: {name}')
    return {'members': len(seen), 'payloadBytes': result_total,
            'replaced': replaced, 'appended': appended}


def archive_path(value, incoming, must_exist):
    path = Path(value)
    if (not path.is_absolute() or path.parent != incoming
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.tar\.gz', path.name)
            or path.is_symlink()):
        raise ValueError('Archive paths must be direct, non-symlink .tar.gz children of incoming.')
    if must_exist:
        if path.resolve(strict=True).parent != incoming or not path.is_file():
            raise ValueError('Input must be a regular archive in incoming.')
    elif path.exists():
        raise FileExistsError('Output already exists; refusing to overwrite.')
    return path


def open_verified(path, expected, limit):
    if not HASH.fullmatch(expected):
        raise ValueError('Expected SHA-256 must be 64 lowercase hex characters.')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    source = os.fdopen(descriptor, 'rb')
    try:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= limit:
            raise ValueError('Input is non-regular, empty or oversized.')
        if digest(source) != expected:
            raise ValueError(f'Input SHA-256 mismatch: {path.name}')
        source.seek(0)
        return source
    except BaseException:
        source.close()
        raise


def combine(base_path, base_sha, overlay_path, overlay_sha, output_path, *, incoming=INCOMING):
    # The alternate incoming argument is for isolated local tests, not a CLI option.
    incoming = Path(incoming)
    if incoming.is_symlink() or incoming.resolve(strict=True) != incoming or not incoming.is_dir():
        raise ValueError('Incoming must be an existing real directory.')
    base_path = archive_path(base_path, incoming, True)
    overlay_path = archive_path(overlay_path, incoming, True)
    output_path = archive_path(output_path, incoming, False)
    if len({base_path, overlay_path, output_path}) != 3:
        raise ValueError('Base, overlay and output must be different paths.')
    created = None
    try:
        with open_verified(base_path, base_sha, MAX_TOTAL) as base:
            with open_verified(overlay_path, overlay_sha, MAX_OVERLAY_TOTAL) as source:
                overlay = read_overlay(source)
                with output_path.open('xb') as output:
                    created = os.fstat(output.fileno())
                    report = rewrite(base, overlay, output)
                    # Recheck the same open inputs; in-place changes cannot silently
                    # produce a combined archive from data different to the hashes.
                    for stream, expected in ((base, base_sha), (source, overlay_sha)):
                        stream.seek(0)
                        if digest(stream) != expected:
                            raise ValueError('Input changed during rewrite.')
                    output.flush()
                    os.fsync(output.fileno())
        with output_path.open('rb') as output:
            report.update(output=str(output_path), bytes=output_path.stat().st_size,
                          sha256=digest(output), baseSha256=base_sha, overlaySha256=overlay_sha)
        return report
    except BaseException:
        # Only remove the exact new output owned by this invocation.
        if created is not None and output_path.exists():
            current = output_path.lstat()
            if (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino):
                output_path.unlink()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--base-sha256', required=True)
    parser.add_argument('--overlay', required=True)
    parser.add_argument('--overlay-sha256', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(combine(args.base, args.base_sha256, args.overlay,
                                 args.overlay_sha256, args.output), indent=2))
    except (OSError, ValueError, tarfile.TarError, EOFError) as error:
        parser.exit(1, f'Archive merge rejected: {error}\n')


if __name__ == '__main__':
    main()
