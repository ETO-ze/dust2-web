"""Validate deployable embedded GLBs, declared hashes and original animation bindings."""
import hashlib,json,struct
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
PUBLIC=ROOT/'public/assets'

def read_glb(path):
    data=path.read_bytes()
    magic,version,total=struct.unpack_from('<4sII',data)
    assert magic==b'glTF' and version==2 and total==len(data),path
    size,kind=struct.unpack_from('<I4s',data,12)
    assert kind==b'JSON',path
    document=json.loads(data[20:20+size])
    binary_size=struct.unpack_from('<I',data,20+size)[0]
    assert binary_size==len(data)-(28+size),path
    for view in document.get('bufferViews',[]):
        assert view.get('byteOffset',0)+view['byteLength']<=binary_size,(path,'view out of bounds')
    for image in document.get('images',[]):
        assert 'uri' not in image and 'bufferView' in image,(path,'unembedded image')
    for accessor in document.get('accessors',[]):
        assert 'sparse' not in accessor,(path,'unexpected sparse accessor')
        if 'bufferView' in accessor:assert accessor['bufferView']<len(document['bufferViews'])
    return document

def check_file(path,sha,size=None):
    data=path.read_bytes()
    assert hashlib.sha256(data).hexdigest()==sha,(path,'SHA256 mismatch')
    if size is not None:assert len(data)==size,(path,'byte count mismatch')

animations=read_glb(PUBLIC/'viewmodel/animations.glb')
names=[clip['name'] for clip in animations['animations']]
assert len(names)==len(set(names)),'duplicate action names'
clip_names=set(names)
specs=json.loads((ROOT/'scripts/weapon-assets/default-skins.json').read_text(encoding='utf-8'))
manifest=json.loads((PUBLIC/'weapons/cs2-loadout/manifest.json').read_text(encoding='utf-8'))
assert len(specs)==len(manifest['models'])==24
checks=[]
for model in manifest['models']:
    spec=next(spec for spec in specs if spec['id']==model['id'])
    assert spec['wearMin']<.07 and model['condition']=='Factory New'
    path=PUBLIC/'weapons/cs2-loadout'/model['file']
    check_file(path,model['sha256'],model['bytes'])
    preview=model['preview']
    check_file(path.parent/preview['file'],preview['sha256'],preview['bytes'])
    doc=read_glb(path)
    assert doc['skins'],(path,'missing original skeleton')
    assert any(node.get('name')=='normalization' for node in doc['nodes'])
    assert all(mesh['name'].endswith('.body_'+spec['body']) for mesh in doc['meshes'])
    paint_materials=[m for m in doc['materials'] if 'paintkit' in m.get('extras',{})]
    assert paint_materials and all(m['extras']['paintkit']==spec['paintkit'] and m['extras']['wear']==0 for m in paint_materials)
    for action in ['draw','idle','reload','shoot','inspect']:
        if model['id']=='knife' and action=='reload':continue
        assert model['id']+'/'+action in clip_names,(path,'missing '+action)
    checks.append({'id':model['id'],'paintkit':spec['paintkit'],'bytes':model['bytes'],'triangles':model['triangles']})

assert 'elite/shoot2' in clip_names
utility=json.loads((PUBLIC/'weapons/cs2-utility/manifest.json').read_text())
for model in utility['models']:
    path=PUBLIC/'weapons/cs2-utility'/model['file']
    check_file(path,model['sha256'],model['bytes']);doc=read_glb(path)
    assert doc['skins'] and all(action in clip_names for action in model['animations'])

audio=json.loads((PUBLIC/'audio/cs2/manifest.json').read_text())
for spec in specs:
    if spec['id']=='knife':continue
    assert audio['banks'].get('glock' if spec['id']=='pistol' else spec['id']),('missing audio',spec['id'])
for sound in audio['files']:check_file(PUBLIC/'audio/cs2'/sound['file'],sound['sha256'],sound['bytes'])
report={'models':len(checks),'utilities':len(utility['models']),'clips':len(names),'audioFiles':len(audio['files']),'validated':checks}
(ROOT/'artifacts/weapon-expansion/validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='validated'}))
