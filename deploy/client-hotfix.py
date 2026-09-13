"""Publish only the built client/APK without restarting existing game rooms.

package: local dist -> bounded, hashed tar; apply: verified active release only.
Keeps old hashed bundles for open tabs and backs up every replaced file.
"""
import argparse, gzip, hashlib, io, json, os, re, subprocess, tarfile
from pathlib import Path
from datetime import datetime, timezone

ALLOWED=re.compile(r'(?:index\.html|sw\.js|manifest\.webmanifest|assets/[A-Za-z0-9_-]+\.(?:js|css)|downloads/(?:DustII-Android-\d+\.\d+\.\d+\.apk|android-latest\.json))(?:\.gz)?')
def sha(data): return hashlib.sha256(data).hexdigest()
def encode(value): return json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2).encode('utf8')
def regular(root,name,allowed=ALLOWED):
    if not allowed.fullmatch(name):raise ValueError('Unexpected client path: '+name)
    target=root/name
    if not target.resolve().is_relative_to(root.resolve()):raise ValueError('Client path escapes dist')
    for path in [target,*target.parents]:
        if path==root.parent:break
        if path.is_symlink():raise ValueError('Symlink in client path')
    if target.exists() and not target.is_file():raise ValueError('Client target is not a file')
    return target

def package(root,output):
    dist=root/'dist';html=(dist/'index.html').read_text('utf8')
    names={'index.html','sw.js','manifest.webmanifest','downloads/android-latest.json'}
    names.update(re.findall(r'(?:src|href)=["\']\./(assets/[^"\']+\.(?:js|css))["\']',html))
    info=json.loads((dist/'downloads/android-latest.json').read_text('utf-8-sig'))
    names.add('downloads/'+Path(info['url']).name)
    if len(names)<6:raise ValueError('Missing built JS/CSS references')
    entries={}
    for name in sorted(names):
        data=regular(dist,name).read_bytes();entries[name]=data
        if not name.endswith('.apk'):entries[name+'.gz']=gzip.compress(data,mtime=0)
    metadata={'schema':1,'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'files':{n:{'sha256':sha(d),'bytes':len(d)} for n,d in entries.items()}}
    with tarfile.open(output,'x:gz') as tar:
        for name,data in {'client.json':encode(metadata),**entries}.items():
            item=tarfile.TarInfo(name);item.size=len(data);item.mode=0o644;tar.addfile(item,io.BytesIO(data))
    print(encode({'archive':str(output),'sha256':sha(output.read_bytes()),'bytes':output.stat().st_size,'files':len(entries)}).decode())

def read_patch(path,expected):
    raw=path.read_bytes()
    if len(raw)>24*1024**2 or sha(raw)!=expected:raise ValueError('Client archive size/hash mismatch')
    entries={};total=0
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as tar:
        for item in tar:
            if not item.isfile() or item.name in entries or len(entries)>=40 or item.size>16*1024**2:raise ValueError('Invalid client member')
            if item.name!='client.json' and not ALLOWED.fullmatch(item.name):raise ValueError('Unexpected client member')
            total+=item.size
            if total>32*1024**2:raise ValueError('Client payload too large')
            entries[item.name]=tar.extractfile(item).read()
    metadata=json.loads(entries.pop('client.json'))
    if metadata.get('schema')!=1 or set(metadata['files'])!=set(entries):raise ValueError('Invalid client manifest')
    for name,data in entries.items():
        if metadata['files'][name]!={'sha256':sha(data),'bytes':len(data)}:raise ValueError('Client member hash mismatch')
        if name.endswith('.gz'):
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:decoded=gz.read(16*1024**2+1)
            if decoded!=entries.get(name[:-3]):raise ValueError('Stale gzip sidecar')
    info=json.loads(entries['downloads/android-latest.json'].decode('utf-8-sig'))
    apk=entries['downloads/'+Path(info['url']).name]
    if not apk.startswith(b'PK') or sha(apk)!=info['sha256'] or len(apk)!=info['bytes']:raise ValueError('APK metadata mismatch')
    if info['sourceCommit']!=metadata['sourceCommit']:raise ValueError('APK and client source commits differ')
    for name in re.findall(r'(?:src|href)=["\']\./(assets/[^"\']+\.(?:js|css))["\']',entries['index.html'].decode()):
        if name not in entries:raise ValueError('Missing referenced bundle')
    return metadata,entries

def atomic(path,data):
    pending=path.with_name('.'+path.name+'.client-pending')
    with pending.open('xb') as out:out.write(data);out.flush();os.fsync(out.fileno())
    os.chmod(pending,0o644);os.replace(pending,path)

def apply(archive,expected,release,stamp,*,reader=read_patch,allowed=ALLOWED,preflight=None):
    if not re.fullmatch(r'\d{8}T\d{6}Z',release) or not re.fullmatch(r'\d{8}T\d{6}Z',stamp):raise ValueError('Invalid release/stamp')
    metadata,entries=reader(archive,expected)
    base=Path('/opt/dust2-web');active=(base/'current').resolve(strict=True)
    if active!=(base/'releases'/release):raise ValueError('Active release changed')
    dist=active/'dist'
    if preflight:preflight(dist,metadata,entries)
    def pid():return subprocess.check_output(['systemctl','show','dust2-web.service','-p','MainPID','--value'],text=True).strip()
    initial_pid=pid()
    backup=base/'backups'/('client-'+stamp);backup.mkdir(parents=True,exist_ok=False)
    before={};changed=[]
    for name in entries:
        target=regular(dist,name,allowed);before[name]=target.read_bytes() if target.exists() else None
        if before[name] is not None:
            saved=backup/name;saved.parent.mkdir(parents=True,exist_ok=True);saved.write_bytes(before[name])
    try:
        # Existing tabs keep using their old content-addressed bundles. HTML
        # commits last, after every file it references is available.
        for name in sorted(entries,key=lambda n:(2 if n.startswith('index.html') else 1 if n.startswith('assets/asset-manifest-mobile.json') else 0,not n.endswith('.gz'),n)):
            if (base/'current').resolve()!=active or pid()!=initial_pid:raise ValueError('Active server changed during client update')
            target=regular(dist,name,allowed);target.parent.mkdir(parents=True,exist_ok=True)
            if before[name]==entries[name]:continue
            atomic(target,entries[name]);changed.append(name)
        for name,data in entries.items():
            if regular(dist,name,allowed).read_bytes()!=data:raise ValueError('Deployed client verification failed')
    except BaseException:
        for name in reversed(changed):
            target=regular(dist,name,allowed)
            if before[name] is None:target.unlink()
            else:atomic(target,before[name])
        raise
    receipt={**metadata,'stamp':stamp,'serverRelease':release,'serverPID':initial_pid,'serverRestarted':pid()!=initial_pid,'backup':str(backup),'changed':changed,'createdAt':datetime.now(timezone.utc).isoformat()}
    (backup/'receipt.json').write_bytes(encode(receipt));print(encode(receipt).decode())

if __name__=='__main__':
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('package');p.add_argument('--root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p=sub.add_parser('apply');p.add_argument('--archive',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--release',required=True);p.add_argument('--stamp',required=True)
    args=parser.parse_args()
    if args.command=='package':package(args.root.resolve(),args.output)
    else:apply(args.archive,args.sha256,args.release,args.stamp)
