"""Bounded graphics-only patch. Keeps APKs, server code, rooms and old map assets intact."""
import argparse, gzip, hashlib, importlib.util, io, json, re, subprocess, tarfile
from pathlib import Path, PurePosixPath

spec=importlib.util.spec_from_file_location('client_hotfix',Path(__file__).with_name('client-hotfix.py'))
core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
MANIFEST='assets/asset-manifest-mobile.json'
MODEL='assets/map-mobile/dust2-clear.gltf'
ALLOWED=re.compile(r'(?:index\.html|sw\.js|manifest\.webmanifest|assets/[A-Za-z0-9_-]+\.(?:js|css)|assets/asset-manifest-mobile\.json|assets/map-mobile/dust2-clear\.gltf)(?:\.gz)?|assets/map-mobile/textures/[a-f0-9]{20}\.webp')
EXISTING=re.compile(r'assets/[A-Za-z0-9_./-]+')
BUNDLES=re.compile(r'(?:src|href)=["\']\./(assets/[^"\']+\.(?:js|css))["\']')

def manifest_files(entries):
    manifest=json.loads(entries[MANIFEST]);files=manifest['files']
    if not isinstance(files,list) or not 1<=len(files)<=1500:raise ValueError('Invalid asset count')
    seen=set()
    for item in files:
        name=item['path']
        if not EXISTING.fullmatch(name) or '..' in PurePosixPath(name).parts or name in seen:raise ValueError('Invalid asset path')
        if not re.fullmatch('[a-f0-9]{64}',item['sha256']) or not isinstance(item['bytes'],int) or not 0<item['bytes']<=64*1024**2:raise ValueError('Invalid asset metadata')
        seen.add(name)
    if sum(item['bytes'] for item in files)!=manifest['totalBytes']:raise ValueError('Invalid asset total')
    return files

def validate(entries):
    for name in ['index.html',MANIFEST,MODEL]:
        if name not in entries:raise ValueError('Missing graphics entry '+name)
    bundles=BUNDLES.findall(entries['index.html'].decode())
    if not any(n.endswith('.js') for n in bundles) or not any(n.endswith('.css') for n in bundles):raise ValueError('Missing bundle references')
    for name in bundles:
        if name not in entries:raise ValueError('Missing bundle')
    files={item['path']:item for item in manifest_files(entries)}
    model=json.loads(entries[MODEL])
    required={MODEL}
    for image in model['images']:
        if not re.fullmatch(r'textures/[a-f0-9]{20}\.webp',image['uri']):raise ValueError('Unexpected texture URI')
        required.add('assets/map-mobile/'+image['uri'])
    for buffer in model['buffers']:
        if 'uri' not in buffer:continue
        if not re.fullmatch(r'\.\./map-cs2/[A-Za-z0-9_-]+\.bin',buffer['uri']):raise ValueError('Unexpected geometry URI')
        if 'assets/map-cs2/'+PurePosixPath(buffer['uri']).name not in files:raise ValueError('Geometry absent from manifest')
    for name in required:
        if name not in entries or name not in files:raise ValueError('Missing mobile dependency')
    for name,data in entries.items():
        if name in files and (core.sha(data)!=files[name]['sha256'] or len(data)!=files[name]['bytes']):raise ValueError('Asset integrity mismatch')

def package(root,output):
    dist=root/'dist';manifest=(dist/MANIFEST).read_bytes();model=(dist/MODEL).read_bytes()
    names={'index.html','sw.js','manifest.webmanifest',MANIFEST,MODEL}
    names.update(BUNDLES.findall((dist/'index.html').read_text('utf8')))
    names.update('assets/map-mobile/'+item['uri'] for item in json.loads(model)['images'])
    entries={}
    for name in sorted(names):
        data=core.regular(dist,name,ALLOWED).read_bytes();entries[name]=data
        if not name.endswith('.webp'):entries[name+'.gz']=gzip.compress(data,mtime=0)
    validate(entries)
    # Local base files are checked too: don't package an impossible asset manifest.
    preflight(dist,{},entries)
    metadata={'schema':'mobile-graphics-v1','sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'files':{n:{'sha256':core.sha(d),'bytes':len(d)} for n,d in entries.items()}}
    with tarfile.open(output,'x:gz') as tar:
        for name,data in {'graphics.json':core.encode(metadata),**entries}.items():
            item=tarfile.TarInfo(name);item.size=len(data);item.mode=0o644;tar.addfile(item,io.BytesIO(data))
    result={'archive':str(output),'sha256':core.sha(output.read_bytes()),'bytes':output.stat().st_size,'files':len(entries)}
    read_patch(output,result['sha256']);print(core.encode(result).decode())

def read_patch(path,expected):
    if path.stat().st_size>64*1024**2:raise ValueError('Graphics archive too large')
    raw=path.read_bytes()
    if core.sha(raw)!=expected:raise ValueError('Graphics archive hash mismatch')
    entries={};total=0
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as tar:
        for item in tar:
            if not item.isfile() or item.name in entries or len(entries)>=600 or item.size>16*1024**2:raise ValueError('Invalid graphics member')
            if item.name!='graphics.json' and not ALLOWED.fullmatch(item.name):raise ValueError('Unexpected graphics member')
            total+=item.size
            if total>96*1024**2:raise ValueError('Graphics payload too large')
            entries[item.name]=tar.extractfile(item).read()
    metadata=json.loads(entries.pop('graphics.json'))
    if metadata.get('schema')!='mobile-graphics-v1' or not re.fullmatch('[a-f0-9]{40}',metadata.get('sourceCommit','')) or set(metadata['files'])!=set(entries):raise ValueError('Invalid graphics manifest')
    for name,data in entries.items():
        if metadata['files'][name]!={'sha256':core.sha(data),'bytes':len(data)}:raise ValueError('Graphics member hash mismatch')
        if name.endswith('.gz'):
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:decoded=gz.read(16*1024**2+1)
            if decoded!=entries.get(name[:-3]):raise ValueError('Stale graphics gzip')
    validate(entries)
    return metadata,entries

def preflight(dist,metadata,entries):
    for item in manifest_files(entries):
        name=item['path']
        data=entries[name] if name in entries else core.regular(dist,name,EXISTING).read_bytes()
        if len(data)!=item['bytes'] or core.sha(data)!=item['sha256']:raise ValueError('Existing dependency differs: '+name)

if __name__=='__main__':
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('package');p.add_argument('--root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p=sub.add_parser('apply');p.add_argument('--archive',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--release',required=True);p.add_argument('--stamp',required=True)
    args=parser.parse_args()
    if args.command=='package':package(args.root.resolve(),args.output)
    else:core.apply(args.archive,args.sha256,args.release,args.stamp,reader=read_patch,allowed=ALLOWED,preflight=preflight)
