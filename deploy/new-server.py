"""Provision/activate only the dedicated cs2.duskrain.cn game host.

Credentials are deliberately not accepted or stored here. Run through authenticated
SSH as root. Provisioning leaves the game service stopped and every game URL at 503
until a verified full release archive passes its local health check.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import subprocess
import tarfile
import time
import urllib.request

BASE=Path('/opt/dust2-web')
RUNTIME=Path('/opt/dust2-runtime')
DOMAIN='cs2.duskrain.cn'
SITE=Path('/etc/nginx/sites-available')/DOMAIN
UNIT=Path('/etc/systemd/system/dust2-web.service')
NODE='node-v22.23.2-linux-x64'
NODE_SHA='d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307'

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        while chunk:=f.read(1024*1024):h.update(chunk)
    return h.hexdigest()

def run(*args):
    result=subprocess.run(args,text=True,capture_output=True)
    if result.returncode:raise RuntimeError(' '.join(args)+': '+result.stderr[-4000:])
    return result.stdout.strip()

def atomic(path,text):
    pending=path.with_name(path.name+'.dust2-pending')
    pending.write_text(text,encoding='utf-8');os.chmod(pending,0o644);os.replace(pending,path)

def backup_file(path,folder):
    if path.exists():shutil.copy2(path,folder/path.name)

def unit_text():
    return '''[Unit]
Description=Dust II Web multiplayer server
After=network.target
ConditionPathExists=/opt/dust2-web/current/server/index.js

[Service]
Type=simple
User=dust2-web
Group=dust2-web
WorkingDirectory=/opt/dust2-web/current
ExecStart=/opt/dust2-runtime/current/bin/node server/index.js
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3005
Environment=MAX_ROOMS=4
Environment=NODE_OPTIONS=--max-old-space-size=768
EnvironmentFile=-/opt/dust2-web/release.env
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
MemoryMax=1G
CPUQuota=180%
TasksMax=64
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
'''

def site_text(tls):
    challenge='location ^~ /.well-known/acme-challenge/ { root /opt/dust2-web/acme; default_type text/plain; }'
    application='''
    location = /dust2 { return 308 /; }
    location ^~ /dust2/ { rewrite ^/dust2/(.*)$ /$1 permanent; }
    location ^~ /assets/ {
        if (!-f /opt/dust2-web/ready) { return 503; }
        alias /opt/dust2-web/current/dist/assets/;
        autoindex off;
        gzip_static on;
        gzip_vary on;
        expires 1h;
        add_header X-Content-Type-Options nosniff;
    }
    location / {
        if (!-f /opt/dust2-web/ready) { return 503; }
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $dust2_connection_upgrade;
        proxy_read_timeout 70s;
        proxy_send_timeout 70s;
        proxy_buffering off;
    }
'''
    prefix='map $http_upgrade $dust2_connection_upgrade { default upgrade; "" close; }\n'
    http=f'server {{\n    listen 80;\n    listen [::]:80;\n    server_name {DOMAIN};\n    {challenge}\n'
    if not tls:return prefix+http+application+'}\n'
    return prefix+http+'    location / { return 308 https://$host$request_uri; }\n}\n'+f'''server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name {DOMAIN};
    ssl_certificate /etc/letsencrypt/live/{DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:Dust2SSL:10m;
    ssl_session_timeout 1d;
    {challenge}
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy same-origin always;
    access_log /var/log/nginx/cs2.duskrain.cn.access.log;
    error_log /var/log/nginx/cs2.duskrain.cn.error.log;
'''+application+'}\n'

def provision(expected_hostname):
    if socket.gethostname()!=expected_hostname:raise RuntimeError('Unexpected hostname; inspect this host first.')
    if not BASE.exists():BASE.mkdir(mode=0o755)
    for name in ['incoming','releases','backups','acme']: (BASE/name).mkdir(exist_ok=True)
    backup=BASE/'backups'/('provision-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime()));backup.mkdir()
    env={**os.environ,'DEBIAN_FRONTEND':'noninteractive','NEEDRESTART_MODE':'l'}
    with (backup/'apt.log').open('w') as log:
        for args in [['apt-get','update'],['apt-get','install','-y','--no-install-recommends','nginx','certbot','ca-certificates','xz-utils']]:
            subprocess.run(args,check=True,stdout=log,stderr=log,env=env)
    RUNTIME.mkdir(exist_ok=True)
    archive=RUNTIME/(NODE+'.tar.xz')
    if not (RUNTIME/NODE/'bin/node').exists():
        urllib.request.urlretrieve('https://nodejs.org/dist/v22.23.2/'+archive.name,archive)
        if digest(archive)!=NODE_SHA:raise RuntimeError('Node archive SHA256 mismatch')
        with tarfile.open(archive) as tar:tar.extractall(RUNTIME,filter='data')
    current=RUNTIME/'current'
    if current.exists() and current.resolve()!=RUNTIME/NODE:raise RuntimeError('Existing unrelated Node runtime; review before changing.')
    if not current.exists():current.symlink_to(RUNTIME/NODE,target_is_directory=True)
    if subprocess.run(['id','-u','dust2-web'],capture_output=True).returncode:
        run('useradd','--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','dust2-web')
    backup_file(UNIT,backup);backup_file(SITE,backup)
    atomic(UNIT,unit_text());atomic(SITE,site_text(False))
    enabled=Path('/etc/nginx/sites-enabled')/DOMAIN
    if enabled.exists() and (not enabled.is_symlink() or enabled.resolve()!=SITE):raise RuntimeError('Unexpected existing site link.')
    if not enabled.exists():enabled.symlink_to(SITE)
    run('nginx','-t');run('systemctl','daemon-reload');run('systemctl','enable','nginx');run('systemctl','restart','nginx')
    # The site is intentionally a 503 gate until activation. ACME alone is public.
    challenge=BASE/'acme/.well-known/acme-challenge';challenge.mkdir(parents=True,exist_ok=True)
    probe=challenge/'dust2-provision-check';probe.write_text('dust2-acme-ready\n')
    with urllib.request.urlopen('http://'+DOMAIN+'/.well-known/acme-challenge/'+probe.name,timeout=20) as response:
        if response.read()!=b'dust2-acme-ready\n':raise RuntimeError('Public HTTP challenge did not reach this host.')
    probe.unlink()
    with (backup/'certbot.log').open('w') as log:
        subprocess.run(['certbot','certonly','--webroot','-w',str(BASE/'acme'),'-d',DOMAIN,'--non-interactive','--agree-tos','--register-unsafely-without-email','--keep-until-expiring'],check=True,stdout=log,stderr=log)
    atomic(SITE,site_text(True));run('nginx','-t');run('systemctl','reload','nginx')
    hook=Path('/etc/letsencrypt/renewal-hooks/deploy/dust2-nginx-reload')
    hook.write_text('#!/bin/sh\n/usr/sbin/nginx -t && /bin/systemctl reload nginx\n');os.chmod(hook,0o755)
    run('systemctl','enable','--now','certbot.timer')
    report={'domain':DOMAIN,'hostname':socket.gethostname(),'node':run(str(current/'bin/node'),'--version'),'site':str(SITE),'siteSha256':digest(SITE),'service':str(UNIT),'serviceSha256':digest(UNIT),'gameReady':(BASE/'ready').exists(),'backup':str(backup)}
    atomic(BASE/'provisioning.json',json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2),flush=True)

def activate(archive,sha,release_name,site_sha):
    archive=Path(archive).resolve(strict=True)
    if archive.parent!=BASE/'incoming' or not re.fullmatch(r'[A-Za-z0-9]{1,80}',release_name):raise RuntimeError('Release path outside managed scope.')
    if not re.fullmatch(r'[0-9a-f]{64}',sha) or digest(archive)!=sha:raise RuntimeError('Archive SHA256 mismatch.')
    if digest(SITE)!=site_sha:raise RuntimeError('Dedicated vhost changed after inspection.')
    release=BASE/'releases'/release_name
    if release.exists():raise RuntimeError('Release already exists; no overwrite allowed.')
    current=BASE/'current';previous=os.readlink(current) if current.is_symlink() else None
    if current.exists() and not current.is_symlink():raise RuntimeError('Current is not a managed symlink.')
    backup=BASE/'backups'/('activate-'+release_name);backup.mkdir()
    envfile=BASE/'release.env';backup_file(envfile,backup)
    was_ready=(BASE/'ready').exists()
    with tarfile.open(archive) as tar:
        names=set();members=tar.getmembers();size=0
        for member in members:
            name=member.name;relative=PurePosixPath(name)
            if name in names or relative.is_absolute() or any(x in ('','..','.') for x in name.split('/')) or '\\' in name or not (member.isfile() or member.isdir()):raise RuntimeError('Unsafe release member '+name)
            if relative.parts[0] not in {'dist','server','shared','package.json','package-lock.json','node_modules','public','deploy'}:raise RuntimeError('Unexpected release root '+name)
            names.add(name);size+=member.size
        if len(names)>100000 or size>8*1024**3:raise RuntimeError('Oversized release.')
        if shutil.disk_usage(BASE).free<size+128*1024**2:raise RuntimeError('Insufficient free disk for separate release.')
        release.mkdir();tar.extractall(release,filter='data')
    for folder,dirs,files in os.walk(release):
        os.chmod(folder,0o755)
        for filename in files:os.chmod(Path(folder)/filename,0o644)
    for required in ['server/index.js','dist/index.html','public/assets/map/collision.json']:
        if not (release/required).is_file():raise RuntimeError('Incomplete app release '+required)
    def switch(target):
        pending=BASE/'current-next'
        if pending.is_symlink():pending.unlink()
        pending.symlink_to(target,target_is_directory=True);os.replace(pending,current)
    success=False
    try:
        switch(release);atomic(envfile,'DUST2_RELEASE='+release_name+'\n')
        run('systemctl','daemon-reload');run('systemctl','start','dust2-web.service')
        if previous:run('systemctl','restart','dust2-web.service')
        for attempt in range(40):
            try:
                with urllib.request.urlopen('http://127.0.0.1:3005/health',timeout=2) as response:health=json.load(response)
                if health.get('ok') and health.get('release')==release_name:break
            except Exception:pass
            time.sleep(.5)
        else:raise RuntimeError('New game server failed local health check.')
        if digest(SITE)!=site_sha:raise RuntimeError('Vhost changed during activation.')
        atomic(BASE/'ready',release_name+'\n');run('systemctl','enable','dust2-web.service')
        with urllib.request.urlopen('https://'+DOMAIN+'/health',timeout=20) as response:public_health=json.load(response)
        if public_health.get('release')!=release_name:raise RuntimeError('Public HTTPS health mismatch.')
        report={'release':release_name,'url':'https://'+DOMAIN+'/','archiveSha256':sha,'siteSha256':digest(SITE),'previousRelease':previous,'health':public_health,'backup':str(backup)}
        atomic(BASE/'deployment.json',json.dumps(report,indent=2)+'\n');success=True;print(json.dumps(report,indent=2),flush=True)
    finally:
        if not success:
            if not was_ready and (BASE/'ready').exists():(BASE/'ready').unlink()
            run('systemctl','stop','dust2-web.service')
            if previous:switch(previous)
            elif current.is_symlink():current.unlink()
            if (backup/envfile.name).exists():shutil.copy2(backup/envfile.name,envfile)
            elif envfile.exists():envfile.unlink()
            if previous and was_ready:run('systemctl','start','dust2-web.service')

if __name__=='__main__':
    if os.name!='posix' or os.geteuid()!=0:raise SystemExit('Run on the dedicated Linux host as root.')
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='action',required=True)
    setup=sub.add_parser('provision');setup.add_argument('--expected-hostname',required=True)
    launch=sub.add_parser('activate');launch.add_argument('--archive',required=True);launch.add_argument('--sha256',required=True);launch.add_argument('--release',required=True);launch.add_argument('--site-sha256',required=True)
    args=parser.parse_args()
    if args.action=='provision':provision(args.expected_hostname)
    else:activate(args.archive,args.sha256,args.release,args.site_sha256)
