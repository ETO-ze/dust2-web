"""Validate and seal a built performance map pool, with compressed HTTP variants."""
import argparse
import gzip
import hashlib
import json
import pathlib
import shutil

def read(path):
    return json.loads(path.read_bytes())

def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()

def write(path,value):
    tmp=path.with_name(path.name+'.part')
    tmp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    tmp.replace(path)

def validate_model(model, file):
    """Validate all streamed triangle batches, including the quantized post-lighting format."""
    data=memoryview(file.read_bytes())
    assert len(data)==model['buffers'][0]['byteLength']
    for view in model['bufferViews']:
        assert view.get('buffer',0)==0
        assert 0<=view.get('byteOffset',0)<=len(data)-view['byteLength']
    for mesh in model['meshes']:
        for p in mesh['primitives']:
            if p.get('mode',4)!=4:continue
            pos=model['accessors'][p['attributes']['POSITION']]
            color=model['accessors'][p['attributes']['COLOR_0']]
            ix=model['accessors'][p['indices']]
            assert pos['count']==color['count'] and ix['count']>0 and ix['count']%3==0
            v=model['bufferViews'][ix['bufferView']]
            width,fmt={5123:(2,'H'),5125:(4,'I')}[ix['componentType']]
            start=v.get('byteOffset',0)+ix.get('byteOffset',0)
            length=width*ix['count']
            assert ix.get('byteOffset',0)+length<=v['byteLength'] and not v.get('byteStride')
            assert max(data[start:start+length].cast(fmt))<pos['count']

def main():
    p=argparse.ArgumentParser()
    p.add_argument('root',type=pathlib.Path)
    args=p.parse_args()
    root=args.root
    maps=[]
    for key in ('dust2','mirage','inferno','nuke','ancient','anubis','cache','train','vertigo'):
        folder=root/('de_'+key)
        cp=folder/'compiled'
        mapdata=read(cp/'map.json')
        policy=read(folder/'entity-collision-policy.json')
        audit=read(folder/'navigation-audit.json')
        model=read(folder/'render/map.gltf')
        assert not model.get('images') and not model.get('textures')
        validate_model(model,folder/'render/map.bin')
        assert all(r['passed'] for r in audit['routes']) and len(audit['routes'])==4
        for keyhash,f in [('sourceSha256',None),('physicsSha256','physics.f32'),('maskSha256','physics-mask.u8')]:
            expected=sha(cp/f) if f else mapdata[keyhash]
            assert audit[keyhash]==policy[keyhash]==expected
        assert audit['navigationSha256']==sha(cp/'nav.json') and audit['policySha256']==sha(folder/'entity-collision-policy.json')
        assert policy['groupsSha256']==sha(cp/'physics-groups.json')
        files=[{'path':f,'sha256':sha(folder/'render'/f),'bytes':(folder/'render'/f).stat().st_size} for f in ('map.gltf','map.bin')]
        write(folder/'render-manifest.json',{'schemaVersion':1,'id':mapdata['id'],'sourceSha256':mapdata['sourceSha256'],'files':files})
        if (folder/'flat-breakables.json').is_file():
            vis=read(folder/'flat-breakables.json')
            for name,index in vis['nodesById'].items(): assert model['nodes'][index]['name']==name
            vis['renderSha256']=files[0]['sha256'];write(folder/'flat-breakables.json',vis)
        paths=[*cp.glob('*'),folder/'entity-collision-policy.json',folder/'render/map.bin',folder/'render/map.gltf']
        size=0;compressed=0
        for file in paths:
            if file.suffix=='.gz' or not file.is_file():continue
            size+=file.stat().st_size
            zipped=file.with_name(file.name+'.gz'); tmp=zipped.with_name(zipped.name+'.part')
            with tmp.open('wb') as out,file.open('rb') as src,gzip.GzipFile(fileobj=out,filename='',mode='wb',compresslevel=3,mtime=0) as z:shutil.copyfileobj(src,z)
            tmp.replace(zipped);compressed+=zipped.stat().st_size
        item={k:mapdata[k] for k in ('id','name','nameZh')}
        extras=model.get('extras',{})
        triangle_count=sum((model['accessors'][primitive['indices']]['count']//3)
                           if 'indices' in primitive else model['accessors'][primitive['attributes']['POSITION']]['count']//3
                           for mesh in model['meshes'] for primitive in mesh['primitives'] if primitive.get('mode',4)==4)
        item['gameplayHashes'] = {
            'map.json':sha(cp/'map.json'), 'nav.json':audit['navigationSha256'],
            'physics.f32':audit['physicsSha256'], 'physics-mask.u8':audit['maskSha256'],
            'physics-groups.json':sha(cp/'physics-groups.json'), 'entity-collision-policy.json':audit['policySha256']
        }
        item.update(source=extras.get('source', 'awpy-visibility' if key in ('train','vertigo') else 'cs2-collision'),
                    gameplaySource=mapdata.get('geometrySource','CS2 VPK physics, NAV and spawn/bombsite entities'),
                    sourceBuild=mapdata['sourceBuild'],gameplaySha256=mapdata['sourceSha256'],renderSha256=files[0]['sha256'],
                    triangles=triangle_count, drawBatches=sum(len(m['primitives']) for m in model['meshes']),
                    sourceVisibleTriangles=extras.get('visibleTriangles'), sampledBaseColorImages=extras.get('baseColorImages',0),
                    renderBytes=sum(f['bytes'] for f in files),rawBytes=size,gzipBytes=compressed)
        maps.append(item);write(folder/'READY.json',item)
        print(mapdata['id'],compressed,flush=True)
    write(root/'catalog.json',{'schemaVersion':1,'maps':maps})

if __name__=='__main__':main()
