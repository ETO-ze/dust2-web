#!/usr/bin/env python3
"""One-file old-host redirect, only after public QA and an empty old game.

Default invocation prints the candidate and performs no I/O. Run on the OLD
host with --activate --new-public-verified only after the new game is tested.
This script never stops a service and never edits the root vhost or homepage.
"""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import time
import urllib.request

LOCATION = pathlib.Path('/www/server/nginx/conf/dust2-web.location.conf')
VHOST = pathlib.Path('/www/server/panel/vhost/nginx/freqtrade-openclaw-api.conf')
HOMEPAGE = pathlib.Path('/www/wwwroot/duskrain.cn/landing/index.html')
BACKUPS = pathlib.Path('/opt/dust2-web/migration-backups')
NGINX = '/www/server/nginx/sbin/nginx'
EXPECTED = {
    LOCATION: '55eaf812bf2c4bf2c54d34bbb3ede06246fe1302e3eb03847e55e95c446c7eaf',
    VHOST: 'e00e10ca5872ea85c39fcebf8061faf49a8172e340ad29d9116befea002187b7',
    HOMEPAGE: 'f132d21de9f17ef3e70f01411a5cae48d4a0eba7bac2125ed3d3268420fe57b6',
}
CANDIDATE = b'''# Scoped game migration; other duskrain.cn locations remain unchanged.
location = /dust2 {
    return 302 https://cs2.duskrain.cn/$is_args$args;
}
# Browsers must load the new site before making a new WebSocket connection.
# Activated only after the old game reports zero humans AND zero rooms.
location = /dust2/ws {
    return 410;
}
location ^~ /dust2/ {
    # Match the raw request URI to retain percent encoding and the query.
    if ($request_uri ~ "^/dust2(/.*)$") {
        return 302 https://cs2.duskrain.cn$1;
    }
    return 404;
}
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def guards(include_location=True):
    for path, expected in EXPECTED.items():
        if path == LOCATION and not include_location:
            continue
        if digest(path.read_bytes()) != expected:
            raise RuntimeError(f'Hash changed; inspect before proceeding: {path}')


def health(url):
    with urllib.request.urlopen(url, timeout=8) as response:
        result = json.load(response)
    if result.get('ok') is not True or result.get('service') != 'dust2-web':
        raise RuntimeError(f'Game health invalid at {url}')
    return result


def empty_old_game():
    result = health('http://127.0.0.1:3005/health')
    if result.get('humans') != 0 or result.get('rooms') != 0:
        raise RuntimeError(f'Old game is active; no changes: humans={result.get("humans")}, rooms={result.get("rooms")}')
    return result


def nginx(*args):
    result = subprocess.run([NGINX, *args], text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)


def replace_atomic(path, content):
    metadata = path.stat()
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.migration-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as target:
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        os.chmod(temporary, metadata.st_mode & 0o7777)
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(content, previous):
    replace_atomic(LOCATION, content)
    try:
        guards(include_location=False)
        nginx('-t')
        nginx('-s', 'reload')
        guards(include_location=False)
    except BaseException:
        replace_atomic(LOCATION, previous)
        nginx('-t')
        nginx('-s', 'reload')
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--activate', action='store_true')
    parser.add_argument('--new-public-verified', action='store_true')
    parser.add_argument('--rollback', type=pathlib.Path)
    args = parser.parse_args()
    if args.activate and args.rollback:
        parser.error('Choose activate or rollback.')
    if args.rollback:
        folder = args.rollback.resolve()
        if folder.parent != BACKUPS.resolve():
            raise RuntimeError('Rollback must name one direct migration backup directory.')
        guards(include_location=False)
        current = LOCATION.read_bytes()
        original = (folder / 'dust2-web.location.conf').read_bytes()
        if digest(current) != digest(CANDIDATE) or digest(original) != EXPECTED[LOCATION]:
            raise RuntimeError('Rollback hashes do not match this migration.')
        install(original, current)
        print(json.dumps({'rolledBack': True, 'locationSha256': digest(original)}))
        return
    if not args.activate:
        print(CANDIDATE.decode(), end='')
        print('# Candidate SHA-256:', digest(CANDIDATE))
        return
    if not args.new_public_verified:
        raise RuntimeError('The new public game must pass browser/WebSocket QA before activation.')
    guards()
    empty_old_game()
    target = health('https://cs2.duskrain.cn/health')
    nginx('-t')
    original = LOCATION.read_bytes()
    backup = BACKUPS / time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    backup.mkdir(parents=True, exist_ok=False)
    (backup / 'dust2-web.location.conf').write_bytes(original)
    (backup / 'guard-hashes.json').write_text(json.dumps({str(p): h for p, h in EXPECTED.items()}, indent=2) + '\n')
    # Recheck immediately before changing the only scoped include.
    guards()
    empty_old_game()
    install(CANDIDATE, original)
    print(json.dumps({'redirected': True, 'backup': str(backup), 'locationSha256': digest(CANDIDATE),
                      'newRelease': target.get('release'), 'oldServiceStopped': False}))


if __name__ == '__main__':
    main()
