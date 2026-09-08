"""Run on the supplied host as root after uploading a verified release archive.

No credentials are stored here. Existing site content is never a write target.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

archive = Path(sys.argv[1]).resolve()
expected_archive = sys.argv[2]
release_name = sys.argv[3]
expected_vhost = sys.argv[4]
base = Path('/opt/dust2-web')
release = base / 'releases' / release_name
if archive.parent != base / 'incoming' or not release_name.isalnum():
    raise SystemExit('Release paths outside this application are rejected.')
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
if digest(archive) != expected_archive:
    raise SystemExit('Release archive hash mismatch.')
vhost = Path('/www/server/panel/vhost/nginx/freqtrade-openclaw-api.conf')
homepage = Path('/www/wwwroot/duskrain.cn/landing/index.html')
location = Path('/www/server/nginx/conf/dust2-web.location.conf')
unit = Path('/etc/systemd/system/dust2-web.service')
before_home = digest(homepage)
if digest(vhost) != expected_vhost:
    raise SystemExit('Vhost changed since inspection. Review it before activating.')
original = vhost.read_bytes()
anchor = b'    server_name duskrain.cn;\n'
inclusion = b'    include /www/server/nginx/conf/dust2-web.location.conf;\n'
if original.count(anchor) != 1:
    raise SystemExit('Cannot uniquely locate the intended HTTPS virtual host.')
backup = base / 'backups' / release_name
backup.mkdir(parents=True, exist_ok=False)
shutil.copy2(vhost, backup / 'vhost.conf')
for source in [location, unit]:
    if source.exists():
        shutil.copy2(source, backup / source.name)
current = base / 'current'
previous_target = os.readlink(current) if current.is_symlink() else None
previous_active = subprocess.run(['systemctl', 'is-active', '--quiet', 'dust2-web.service'], capture_output=True).returncode == 0
previous_enabled = subprocess.run(['systemctl', 'is-enabled', 'dust2-web.service'], capture_output=True, text=True).stdout.strip()
if current.exists() and not current.is_symlink():
    raise SystemExit('Current is not a managed application symlink.')

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()

runtime = Path('/opt/dust2-runtime')
node_version = 'node-v22.23.2-linux-x64'
node_path = runtime / node_version
runtime.mkdir(parents=True, exist_ok=True)
if not (node_path / 'bin/node').exists():
    node_tar = runtime / (node_version + '.tar.xz')
    urllib.request.urlretrieve('https://nodejs.org/dist/v22.23.2/' + node_tar.name, node_tar)
    if digest(node_tar) != 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307':
        raise SystemExit('Node archive hash mismatch.')
    with tarfile.open(node_tar) as tar:
        tar.extractall(runtime, filter='data')
runtime_current = runtime / 'current'
if not runtime_current.exists():
    runtime_current.symlink_to(node_path, target_is_directory=True)
print('Runtime:', run(str(runtime_current / 'bin/node'), '--version'), flush=True)
release.mkdir(parents=True, exist_ok=False)
with tarfile.open(archive) as tar:
    tar.extractall(release, filter='data')
if subprocess.run(['id', '-u', 'dust2-web'], capture_output=True).returncode:
    run('useradd', '--system', '--user-group', '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', 'dust2-web')
for folder, dirs, files in os.walk(release):
    os.chmod(folder, 0o755)
    for filename in files:
        path = Path(folder) / filename
        if not path.is_symlink():
            os.chmod(path, 0o644)

def switch(target):
    temp = base / 'current-next'
    if temp.is_symlink():
        temp.unlink()
    temp.symlink_to(target, target_is_directory=True)
    os.replace(temp, current)

activated = False
try:
    switch(release)
    unit_source = (release / 'deploy/dust2-web.service').read_text()
    unit.write_text(unit_source.replace('Environment=NODE_ENV=production',
                    'Environment=NODE_ENV=production\nEnvironment=DUST2_RELEASE=' + release_name))
    os.chmod(unit, 0o644)
    shutil.copy2(release / 'deploy/dust2-web.location.conf', location)
    changed = original if inclusion in original else original.replace(anchor, anchor + inclusion, 1)
    temp_config = vhost.with_suffix('.dust2.tmp')
    temp_config.write_bytes(changed)
    os.replace(temp_config, vhost)
    run('nginx', '-t')
    run('systemctl', 'daemon-reload')
    run('systemctl', 'enable', 'dust2-web.service')
    run('systemctl', 'restart', 'dust2-web.service')
    for attempt in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3005/health', timeout=2) as res:
                health = json.load(res)
            if health.get('ok') and health.get('service') == 'dust2-web' and health.get('release') == release_name:
                run('systemctl', 'is-active', '--quiet', 'dust2-web.service')
                if int(run('systemctl', 'show', '--property=MainPID', '--value', 'dust2-web.service')) <= 0:
                    raise RuntimeError('No running process for this release.')
                break
        except Exception:
            time.sleep(.5)
    else:
        raise RuntimeError('Game health check failed.')
    if digest(homepage) != before_home:
        raise RuntimeError('Existing homepage changed during deployment.')
    run('nginx', '-s', 'reload')
    activated = True
    report = {'release': release_name, 'url': 'https://duskrain.cn/dust2/',
              'homepageHashBefore': before_home, 'homepageHashAfter': digest(homepage),
              'backup': str(backup), 'archiveSha256': expected_archive,
              'vhostSha256': digest(vhost), 'health': health}
    (base / 'deployment.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2), flush=True)
finally:
    if not activated:
        vhost.write_bytes(original)
        for destination in [unit, location]:
            saved = backup / destination.name
            if saved.exists():
                shutil.copy2(saved, destination)
            elif destination.exists():
                destination.unlink()
        if previous_target:
            switch(previous_target)
        elif current.is_symlink():
            current.unlink()
        subprocess.run(['systemctl', 'stop', 'dust2-web.service'], capture_output=True)
        if previous_enabled not in {'enabled', 'enabled-runtime'}:
            subprocess.run(['systemctl', 'disable', 'dust2-web.service'], capture_output=True)
        subprocess.run(['systemctl', 'daemon-reload'], capture_output=True)
        if previous_enabled == 'enabled-runtime':
            subprocess.run(['systemctl', 'disable', 'dust2-web.service'], capture_output=True)
            subprocess.run(['systemctl', 'enable', '--runtime', 'dust2-web.service'], capture_output=True)
        if previous_target and previous_active:
            subprocess.run(['systemctl', 'start', 'dust2-web.service'], capture_output=True)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['nginx', '-s', 'reload'], check=True)
        print('Activation rolled back; existing homepage untouched.', flush=True)
