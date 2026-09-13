"""Graphics archive boundaries and dependency integrity, entirely offline."""
import gzip, importlib.util, io, json, tarfile, tempfile, unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('graphics',HERE/'mobile-graphics-hotfix.py')
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
TEX='assets/map-mobile/textures/'+'a'*20+'.webp'
BIN='assets/map-cs2/dust2-base.bin'

class GraphicsTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='mobile-graphics-',dir=HERE.parent/'artifacts/deploy');self.root=Path(self.temp.name)
  self.entries={'index.html':b'<script src="./assets/index-abc.js"></script><link href="./assets/index-def.css">','assets/index-abc.js':b'client','assets/index-def.css':b'css',TEX:b'webp',g.MODEL:g.core.encode({'images':[{'uri':'textures/'+'a'*20+'.webp'}],'buffers':[{'uri':'../map-cs2/dust2-base.bin'}]})}
  assets={g.MODEL:self.entries[g.MODEL],TEX:b'webp',BIN:b'geometry'}
  files=[{'path':n,'sha256':g.core.sha(d),'bytes':len(d)} for n,d in assets.items()]
  self.entries[g.MANIFEST]=g.core.encode({'files':files,'totalBytes':sum(f['bytes'] for f in files)})
  p=self.root/BIN;p.parent.mkdir(parents=True);p.write_bytes(b'geometry')
 def tearDown(self):
  self.assertTrue(self.root.resolve().is_relative_to((HERE.parent/'artifacts/deploy').resolve()));self.temp.cleanup()
 def archive(self,entries=None,extra=None):
  entries=self.entries if entries is None else entries
  meta={'schema':'mobile-graphics-v1','sourceCommit':'a'*40,'files':{n:{'sha256':g.core.sha(d),'bytes':len(d)} for n,d in entries.items()}}
  p=self.root/'test.tar.gz'
  with tarfile.open(p,'w:gz') as tar:
   for n,d in {'graphics.json':g.core.encode(meta),**entries}.items():
    i=tarfile.TarInfo(n);i.size=len(d);tar.addfile(i,io.BytesIO(d))
   if extra:tar.addfile(extra)
  return p,g.core.sha(p.read_bytes())
 def test_valid_and_existing_dependencies(self):
  _,entries=g.read_patch(*self.archive());g.preflight(self.root,{},entries)
 def test_archive_hash(self):
  p,_=self.archive()
  with self.assertRaisesRegex(ValueError,'archive hash'):g.read_patch(p,'0'*64)
 def test_no_server_apk_or_escape_members(self):
  for name in ['server/index.js','downloads/android-latest.json','../../index.html','assets/map-mobile/textures/../../evil.webp']:
   with self.subTest(name=name),self.assertRaises(ValueError):g.read_patch(*self.archive({**self.entries,name:b'x'}))
 def test_symlink_rejected(self):
  i=tarfile.TarInfo('assets/index-link.js');i.type=tarfile.SYMTYPE;i.linkname='/etc/passwd'
  with self.assertRaises(ValueError):g.read_patch(*self.archive(extra=i))
 def test_missing_texture(self):
  with self.assertRaisesRegex(ValueError,'Missing mobile dependency'):g.read_patch(*self.archive({n:d for n,d in self.entries.items() if n!=TEX}))
 def test_modified_texture(self):
  with self.assertRaisesRegex(ValueError,'Asset integrity'):g.read_patch(*self.archive({**self.entries,TEX:b'modified'}))
 def test_stale_gzip(self):
  with self.assertRaisesRegex(ValueError,'Stale graphics gzip'):g.read_patch(*self.archive({**self.entries,'index.html.gz':gzip.compress(b'old HTML')}))
 def test_changed_base_dependency(self):
  (self.root/BIN).write_bytes(b'old geometry')
  with self.assertRaisesRegex(ValueError,'Existing dependency differs'):g.preflight(self.root,{},self.entries)
 def test_manifest_escape(self):
  m=json.loads(self.entries[g.MANIFEST]);m['files'][0]['path']='assets/../outside';entries={**self.entries,g.MANIFEST:g.core.encode(m)}
  with self.assertRaisesRegex(ValueError,'Invalid asset path'):g.read_patch(*self.archive(entries))

if __name__=='__main__':unittest.main()
