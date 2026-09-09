"""Optional original agents and first-party inventory previews, loaded on demand."""
import hashlib,json,pathlib
from PIL import Image
from pack import ROOT,STAGE,DEST,packed_model
specs=json.loads((STAGE/'optional-source-index.json').read_text())['agents'];rows=[]
for spec in specs:packed_model(spec['team'],spec['id'],'optional/'+spec['id']+'.glb')
for id in ['ct-sas','t-phoenix','ct-ava','t-miami']:
 optional=id in ['ct-ava','t-miami'];file=('optional/' if optional else '')+id+'.glb';model=DEST/file
 preview=DEST/'previews'/(id+'.webp');preview.parent.mkdir(parents=True,exist_ok=True)
 image=Image.open(STAGE/'previews'/(id+'.png')).convert('RGBA');image.thumbnail((512,512),Image.Resampling.LANCZOS);image.save(preview,'WEBP',quality=94)
 rows.append({'id':id,'model':'assets/characters-cs2/'+file,'bytes':model.stat().st_size,'sha256':hashlib.sha256(model.read_bytes()).hexdigest(),'preview':{'file':'assets/characters-cs2/previews/'+id+'.webp','bytes':preview.stat().st_size,'sha256':hashlib.sha256(preview.read_bytes()).hexdigest()}})
(DEST/'optional-manifest.json').write_text(json.dumps({'source':'Original Valve CS2 models and inventory images; same shared world animation bundle','agents':rows},indent=2)+'\n',encoding='utf8')
print(json.dumps({'agents':len(rows),'optional':2,'previews':4}))
