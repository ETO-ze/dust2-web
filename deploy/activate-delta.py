"""Stage or activate a verified delta without modifying the previous release.

Read-only inventory:
  python3 activate-delta.py manifest --release-dir /opt/dust2-web/current --output /opt/dust2-web/incoming/base.manifest.json
Temporary/offline staging (no nginx/systemd operations):
  python3 activate-delta.py stage --archive delta.tar.gz --sha256 HEX --base-dir OLD --release-dir NEW
Production activation, run as root only after reviewing/uploading the delta:
  python3 activate-delta.py activate --archive /opt/dust2-web/incoming/delta.tar.gz --sha256 HEX --release STAMP --vhost-sha256 HEX

No credentials, hard links, archive extractall, or writes to the original homepage.
Failed staging leaves its new directory for inspection; it is never activated.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

MANIFEST_FILE = '.release-manifest.json'
SCHEMA = 1
HASH = re.compile(r'^[0-9a-f]{64}$')


def digest(path):
    with Path(path).open('rb') as source:
        return stream_digest(source)


def stream_digest(source):
    value = hashlib.sha256()
    while chunk := source.read(1024 * 1024):
        value.update(chunk)
    return value.hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf8')


def manifest_hash(manifest):
    return hashlib.sha256(canonical(manifest)).hexdigest()


def safe_path(name):
    if not isinstance(name, str) or not name or '\\' in name or ':' in name or '\x00' in name or len(name) > 4096:
        raise ValueError(f'Unsafe release path: {name!r}')
    if name.startswith('/') or any(part in ('', '.', '..') for part in name.split('/')):
        raise ValueError(f'Unsafe release path: {name!r}')
    if PurePosixPath(name).is_absolute():
        raise ValueError(f'Absolute release path: {name!r}')
    return name


def validate_manifest(value):
    if not isinstance(value, dict) or value.get('schema') != SCHEMA or not isinstance(value.get('files'), dict):
        raise ValueError('Unsupported release manifest.')
    files = {}
    folded = set()
    for name, entry in value['files'].items():
        safe_path(name)
        if name == MANIFEST_FILE or not isinstance(entry, dict):
            raise ValueError('Reserved or invalid manifest entry.')
        if not HASH.fullmatch(str(entry.get('sha256', ''))) or type(entry.get('bytes')) is not int or entry['bytes'] < 0:
            raise ValueError(f'Invalid file hash/size: {name}')
        if name.casefold() in folded:
            raise ValueError(f'Case-colliding manifest path: {name}')
        folded.add(name.casefold())
        files[name] = {'sha256': entry['sha256'], 'bytes': entry['bytes']}
    for name in files:
        if any(str(parent) in files for parent in PurePosixPath(name).parents if str(parent) != '.'):
            raise ValueError(f'A file is also a parent directory: {name}')
    return {'schema': SCHEMA, 'files': dict(sorted(files.items()))}


def scan_manifest(directory):
    directory = Path(directory).resolve(strict=True)
    if not directory.is_dir():
        raise ValueError('Release directory does not exist.')
    files = {}
    for folder, dirs, names in os.walk(directory, followlinks=False):
        for name in dirs + names:
            item = Path(folder) / name
            if item.is_symlink():
                raise ValueError(f'Release contains a symbolic link: {item.relative_to(directory)}')
        for name in names:
            item = Path(folder) / name
            relative = item.relative_to(directory).as_posix()
            if relative == MANIFEST_FILE:
                if not item.is_file():
                    raise ValueError('Invalid stored manifest.')
                continue
            if not item.is_file():
                raise ValueError(f'Release contains a non-regular file: {relative}')
            files[relative] = {'sha256': digest(item), 'bytes': item.stat().st_size}
    return validate_manifest({'schema': SCHEMA, 'files': files})


def destination(root, relative):
    safe_path(relative)
    root = Path(root).resolve(strict=True)
    path = root.joinpath(*relative.split('/'))
    if not path.resolve().is_relative_to(root):
        raise ValueError(f'Path escapes new release: {relative}')
    current = path
    while current != root:
        if current.is_symlink():
            raise ValueError(f'Symlink in new release path: {relative}')
        current = current.parent
    return path


def write_json(path, value):
    path = Path(path)
    with tempfile.NamedTemporaryFile(prefix='.dust2-', dir=path.parent, delete=False) as temporary:
        pending = Path(temporary.name)
        # Canonical bytes make the manifest file's SHA identical to manifestSha256.
        temporary.write(canonical(value))
    try:
        os.chmod(pending, 0o644)
        os.replace(pending, path)
    finally:
        if pending.exists():
            pending.unlink()


def delta_metadata(tar):
    members = tar.getmembers()
    if len(members) > 100000:
        raise ValueError('Too many delta members.')
    entries = {}
    for member in members:
        safe_path(member.name)
        if not member.isfile() or member.issym() or member.islnk() or member.name in entries:
            raise ValueError(f'Non-regular or duplicate delta member: {member.name}')
        entries[member.name] = member
    info = entries.get('delta.json')
    if info is None or info.size > 32 * 1024 * 1024:
        raise ValueError('Missing/oversized delta metadata.')
    with tar.extractfile(info) as source:
        metadata = json.load(source)
    if not isinstance(metadata, dict) or metadata.get('schema') != SCHEMA or not re.fullmatch(r'[A-Za-z0-9]{1,80}', str(metadata.get('release', ''))):
        raise ValueError('Unsupported delta schema/release.')
    base = validate_manifest(metadata.get('baseManifest'))
    result = validate_manifest(metadata.get('manifest'))
    if manifest_hash(base) != metadata.get('baseManifestSha256') or manifest_hash(result) != metadata.get('manifestSha256'):
        raise ValueError('Delta manifest digest mismatch.')
    changed = sorted(name for name, entry in result['files'].items() if base['files'].get(name) != entry)
    deleted = sorted(set(base['files']) - set(result['files']))
    if metadata.get('changed') != changed or metadata.get('deleted') != deleted:
        raise ValueError('Delta change/delete lists do not match full manifests.')
    if set(entries) != {'delta.json'} | {f'payload/{name}' for name in changed}:
        raise ValueError('Unexpected or missing delta payload path.')
    for name in changed:
        if entries[f'payload/{name}'].size != result['files'][name]['bytes']:
            raise ValueError(f'Delta member size mismatch: {name}')
    return metadata, base, result, entries


def verify_tree(directory, expected):
    actual = scan_manifest(directory)
    if actual != expected:
        names = sorted(set(actual['files']) | set(expected['files']))
        differences = [name for name in names if actual['files'].get(name) != expected['files'].get(name)]
        raise ValueError('Full release hash mismatch: ' + ', '.join(differences[:8]))


def stage_delta(archive, expected_sha256, base_dir, release_dir):
    archive = Path(archive).resolve(strict=True)
    base_dir = Path(base_dir).resolve(strict=True)
    target = Path(release_dir).absolute()
    target.parent.mkdir(parents=True, exist_ok=True)
    target = target.parent.resolve(strict=True) / target.name
    if target.exists() or target.is_symlink() or target == base_dir or target.is_relative_to(base_dir) or base_dir.is_relative_to(target):
        raise ValueError('New release must be a new, separate directory.')
    if not HASH.fullmatch(expected_sha256) or digest(archive) != expected_sha256:
        raise ValueError('Delta archive SHA-256 mismatch.')
    with tarfile.open(archive, 'r:*') as tar:
        metadata, base, result, members = delta_metadata(tar)
        verify_tree(base_dir, base)
        required = sum(entry['bytes'] for entry in base['files'].values()) + sum(result['files'][name]['bytes'] for name in metadata['changed'])
        if shutil.disk_usage(target.parent).free < required + 32 * 1024 * 1024:
            raise ValueError('Insufficient disk space for an independent rollback-safe release copy.')
        # copy2 creates independent files. No hard links or mutations under base_dir.
        shutil.copytree(base_dir, target, copy_function=shutil.copy2, symlinks=False)
        for name in metadata['deleted']:
            destination(target, name).unlink()
        for folder, dirs, files in os.walk(target, topdown=False, followlinks=False):
            if Path(folder) != target:
                try:
                    Path(folder).rmdir()
                except OSError:
                    pass
        for name in metadata['changed']:
            path = destination(target, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(members[f'payload/{name}']) as source, path.open('wb') as output:
                value = hashlib.sha256()
                while chunk := source.read(1024 * 1024):
                    value.update(chunk)
                    output.write(chunk)
            if value.hexdigest() != result['files'][name]['sha256']:
                raise ValueError(f'Delta payload SHA-256 mismatch: {name}')
        verify_tree(target, result)
        write_json(target / MANIFEST_FILE, result)
        for folder, dirs, files in os.walk(target):
            os.chmod(folder, 0o755)
            for name in files:
                os.chmod(Path(folder) / name, 0o644)
    return {'release': metadata['release'], 'directory': str(target), 'baseManifestSha256': manifest_hash(base),
            'manifestSha256': manifest_hash(result), 'files': len(result['files']), 'changed': len(metadata['changed']),
            'deleted': len(metadata['deleted']), 'archiveSha256': expected_sha256}


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def validate_location_snippet(text):
    """Only three dedicated location blocks may be injected at vhost scope."""
    remaining = text
    routes = []
    while remaining.strip():
        remaining = remaining.lstrip()
        if remaining.startswith('#'):
            remaining = remaining.partition('\n')[2]
            continue
        match = re.match(r'location\s+(?:=|\^~)\s+([^\s{]+)\s*\{', remaining)
        if not match:
            raise ValueError('Unexpected top-level Nginx directive outside the dedicated game locations.')
        routes.append(match.group(1))
        depth, quote, escaped, comment = 1, None, False, False
        index = match.end()
        while index < len(remaining) and depth:
            char = remaining[index]
            if comment:
                if char == '\n':
                    comment = False
            elif quote:
                if escaped:
                    escaped = False
                elif char == '\\':
                    escaped = True
                elif char == quote:
                    quote = None
            elif char in "\"'":
                quote = char
            elif char == '#':
                comment = True
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
            index += 1
        if depth or quote:
            raise ValueError('Unbalanced dedicated Nginx location block.')
        remaining = remaining[index:]
    if sorted(routes) != ['/dust2', '/dust2/', '/dust2/assets/']:
        raise ValueError('Nginx snippet is outside the dedicated /dust2 routes.')


def activate(args):
    if os.name != 'posix' or os.geteuid() != 0:
        raise ValueError('Production activation requires root on the supplied Linux host; use stage for offline QA.')
    base = Path('/opt/dust2-web')
    if base.resolve(strict=True) != base or not re.fullmatch(r'[A-Za-z0-9]{1,80}', args.release):
        raise ValueError('Invalid managed application/release path.')
    archive = Path(args.archive)
    if archive.is_symlink() or archive.resolve(strict=True).parent != base / 'incoming':
        raise ValueError('Delta archive must be a regular file directly under the app incoming directory.')
    current = base / 'current'
    if not current.is_symlink():
        raise ValueError('Incremental activation requires an existing managed current symlink.')
    previous = current.resolve(strict=True)
    if not previous.is_relative_to(base / 'releases') or previous.parent != base / 'releases':
        raise ValueError('Current target is outside the managed releases directory.')
    release = base / 'releases' / args.release
    vhost = Path('/www/server/panel/vhost/nginx/freqtrade-openclaw-api.conf')
    homepage = Path('/www/wwwroot/duskrain.cn/landing/index.html')
    location = Path('/www/server/nginx/conf/dust2-web.location.conf')
    unit = Path('/etc/systemd/system/dust2-web.service')
    before_home = digest(homepage)
    if not HASH.fullmatch(args.vhost_sha256) or digest(vhost) != args.vhost_sha256:
        raise ValueError('Vhost changed since inspection; refusing activation.')
    original = vhost.read_bytes()
    anchor = b'    server_name duskrain.cn;\n'
    inclusion = b'    include /www/server/nginx/conf/dust2-web.location.conf;\n'
    if original.count(anchor) != 1 or original.count(inclusion) > 1:
        raise ValueError('Cannot uniquely locate the intended virtual host.')
    node = Path('/opt/dust2-runtime/current/bin/node')
    if not node.is_file() or not os.access(node, os.X_OK):
        raise ValueError('Existing verified Node runtime is required; bootstrap with the full release workflow.')
    print('Runtime:', run(str(node), '--version'), flush=True)
    staged = stage_delta(archive, args.sha256, previous, release)
    if staged['release'] != args.release:
        raise ValueError('Requested release does not match delta metadata.')
    # Require only the dedicated /dust2 routes; never allow a delta snippet to replace the homepage route.
    snippet = (release / 'deploy/dust2-web.location.conf').read_text()
    validate_location_snippet(snippet)
    unit_source = (release / 'deploy/dust2-web.service').read_text()
    if unit_source.count('Environment=NODE_ENV=production') != 1:
        raise ValueError('Service template release-stamp marker is missing/ambiguous.')
    # Recheck guards immediately before any live configuration change.
    if digest(vhost) != args.vhost_sha256 or digest(homepage) != before_home or current.resolve(strict=True) != previous:
        raise ValueError('Live site/current release changed during staging; nothing activated.')
    backup = base / 'backups' / args.release
    backup.mkdir(parents=True, exist_ok=False)
    previous_target = os.readlink(current)
    previous_active = subprocess.run(['systemctl', 'is-active', '--quiet', 'dust2-web.service'], capture_output=True).returncode == 0
    previous_enabled = subprocess.run(['systemctl', 'is-enabled', 'dust2-web.service'], capture_output=True, text=True).stdout.strip()
    for source in [vhost, location, unit]:
        if source.is_symlink():
            raise ValueError(f'Unexpected configuration symlink: {source}')
        if source.exists():
            shutil.copy2(source, backup / ('vhost.conf' if source == vhost else source.name))
    write_json(backup / 'state.json', {'previousTarget': previous_target, 'active': previous_active, 'enabled': previous_enabled, 'homepageSha256': before_home, 'vhostSha256': args.vhost_sha256})

    def switch(target):
        pending = base / ('current-next-' + args.release)
        if pending.exists() or pending.is_symlink():
            raise ValueError('Temporary current symlink already exists.')
        pending.symlink_to(target, target_is_directory=True)
        try:
            os.replace(pending, current)
        finally:
            if pending.is_symlink():
                pending.unlink()

    activated = False
    try:
        switch(release)
        unit.write_text(unit_source.replace('Environment=NODE_ENV=production', 'Environment=NODE_ENV=production\nEnvironment=DUST2_RELEASE=' + args.release))
        os.chmod(unit, 0o644)
        shutil.copy2(release / 'deploy/dust2-web.location.conf', location)
        changed = original if inclusion in original else original.replace(anchor, anchor + inclusion, 1)
        temporary_vhost = vhost.with_suffix('.dust2.tmp')
        temporary_vhost.write_bytes(changed)
        os.replace(temporary_vhost, vhost)
        run('nginx', '-t')
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', 'dust2-web.service')
        run('systemctl', 'restart', 'dust2-web.service')
        health = None
        for attempt in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:3005/health', timeout=2) as response:
                    health = json.load(response)
                if health.get('ok') and health.get('service') == 'dust2-web' and health.get('release') == args.release:
                    run('systemctl', 'is-active', '--quiet', 'dust2-web.service')
                    if int(run('systemctl', 'show', '--property=MainPID', '--value', 'dust2-web.service')) > 0:
                        break
            except Exception:
                pass
            time.sleep(.5)
        else:
            raise RuntimeError('New release service/health identity failed.')
        if digest(homepage) != before_home:
            raise RuntimeError('Existing homepage changed during activation.')
        run('nginx', '-s', 'reload')
        if digest(homepage) != before_home:
            raise RuntimeError('Existing homepage changed while reloading Nginx.')
        report = {**staged, 'url': 'https://duskrain.cn/dust2/', 'backup': str(backup), 'previousRelease': str(previous),
                  'homepageHashBefore': before_home, 'homepageHashAfter': digest(homepage), 'vhostSha256': digest(vhost), 'health': health}
        write_json(base / 'deployment.json', report)
        activated = True
        return report
    finally:
        if not activated:
            errors = []
            def rollback(label, operation):
                try:
                    operation()
                except Exception as error:
                    errors.append(f'{label}: {error}')
            rollback('restore vhost', lambda: shutil.copy2(backup / 'vhost.conf', vhost))
            for destination_path in [unit, location]:
                saved = backup / destination_path.name
                rollback(f'restore {destination_path.name}', lambda saved=saved, target=destination_path: shutil.copy2(saved, target) if saved.exists() else target.unlink(missing_ok=True))
            rollback('restore current', lambda: switch(previous_target))
            rollback('stop failed service', lambda: run('systemctl', 'stop', 'dust2-web.service'))
            rollback('reload units', lambda: run('systemctl', 'daemon-reload'))
            if previous_enabled == 'enabled-runtime':
                rollback('remove persistent enable', lambda: run('systemctl', 'disable', 'dust2-web.service'))
                rollback('restore runtime enable', lambda: run('systemctl', 'enable', '--runtime', 'dust2-web.service'))
            elif previous_enabled != 'enabled':
                rollback('restore disabled state', lambda: run('systemctl', 'disable', 'dust2-web.service'))
            if previous_active:
                rollback('restart previous release', lambda: run('systemctl', 'start', 'dust2-web.service'))
                def verify_previous_health():
                    for attempt in range(30):
                        try:
                            with urllib.request.urlopen('http://127.0.0.1:3005/health', timeout=2) as response:
                                previous_health = json.load(response)
                            if previous_health.get('ok') and previous_health.get('service') == 'dust2-web' and previous_health.get('release') == previous.name:
                                run('systemctl', 'is-active', '--quiet', 'dust2-web.service')
                                if int(run('systemctl', 'show', '--property=MainPID', '--value', 'dust2-web.service')) > 0:
                                    return
                        except Exception:
                            pass
                        time.sleep(.5)
                    raise RuntimeError('Previous release failed its rollback health check.')
                rollback('verify previous release health', verify_previous_health)
            rollback('validate rollback nginx', lambda: run('nginx', '-t'))
            rollback('reload rollback nginx', lambda: run('nginx', '-s', 'reload'))
            print(json.dumps({'rolledBack': not errors, 'errors': errors, 'homepageUnchanged': digest(homepage) == before_home, 'backup': str(backup)}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    inventory = commands.add_parser('manifest', help='Inventory an existing release without activating anything')
    inventory.add_argument('--release-dir', required=True)
    inventory.add_argument('--output', required=True)
    stage = commands.add_parser('stage', help='Build and verify a new independent directory; no service/config changes')
    stage.add_argument('--archive', required=True); stage.add_argument('--sha256', required=True)
    stage.add_argument('--base-dir', required=True); stage.add_argument('--release-dir', required=True)
    live = commands.add_parser('activate', help='Activate under fixed /opt/dust2-web and dedicated /dust2 Nginx scope')
    live.add_argument('--archive', required=True); live.add_argument('--sha256', required=True)
    live.add_argument('--release', required=True); live.add_argument('--vhost-sha256', required=True)
    args = parser.parse_args()
    if args.command == 'manifest':
        result = scan_manifest(args.release_dir)
        write_json(args.output, result)
        print(json.dumps({'manifest': str(Path(args.output).resolve()), 'sha256': manifest_hash(result), 'files': len(result['files'])}))
    elif args.command == 'stage':
        print(json.dumps(stage_delta(args.archive, args.sha256, args.base_dir, args.release_dir), indent=2))
    else:
        print(json.dumps(activate(args), indent=2))


if __name__ == '__main__':
    main()
