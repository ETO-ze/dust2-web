import gzip, hashlib, importlib.util, io, json, tarfile, tempfile, unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('client_hotfix',Path(__file__).with_name('client-hotfix.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ClientPatchTests(unittest.TestCase):
    def archive(self,changes=None,extra=None):
        source='a'*40;apk=b'PK'+b'Android fixture'
        entries={'index.html':b'<script src="./assets/index-new.js"></script><link href="./assets/index-new.css">','assets/index-new.js':b'export const client=1;','assets/index-new.css':b'body{color:white}','downloads/DustII-Android-1.0.0.apk':apk,'downloads/android-latest.json':module.encode({'url':'./DustII-Android-1.0.0.apk','sha256':module.sha(apk),'bytes':len(apk),'sourceCommit':source})}
        entries['assets/index-new.js.gz']=gzip.compress(entries['assets/index-new.js'],mtime=0)
        if changes:changes(entries)
        metadata={'schema':1,'sourceCommit':source,'files':{n:{'sha256':module.sha(d),'bytes':len(d)} for n,d in entries.items()}}
        entries={'client.json':module.encode(metadata),**entries}
        if extra:entries.update(extra)
        raw=io.BytesIO()
        with tarfile.open(fileobj=raw,mode='w:gz') as tar:
            for name,data in entries.items():
                member=tarfile.TarInfo(name);member.size=len(data);tar.addfile(member,io.BytesIO(data))
        return raw.getvalue()
    def read(self,data,expected=None):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'patch.tar.gz';path.write_bytes(data)
            return module.read_patch(path,expected or module.sha(data))
    def test_verified_client_and_apk(self):self.assertEqual(self.read(self.archive())[0]['schema'],1)
    def test_hash_rejection(self):
        with self.assertRaises(ValueError):self.read(self.archive(),'0'*64)
    def test_server_and_escape_rejection(self):
        for name in ['../index.html','server/game.js','android/signing/release.json','downloads/evil.apk']:
            with self.subTest(name=name),self.assertRaises(ValueError):self.read(self.archive(extra={name:b'bad'}))
    def test_mismatched_gzip_rejection(self):
        with self.assertRaises(ValueError):self.read(self.archive(lambda e:e.update({'assets/index-new.js.gz':gzip.compress(b'old')})))
    def test_wrong_apk_metadata_rejection(self):
        with self.assertRaises(ValueError):self.read(self.archive(lambda e:e.update({'downloads/DustII-Android-1.0.0.apk':b'PKwrong'})))
    def test_missing_bundle_rejection(self):
        with self.assertRaises(ValueError):self.read(self.archive(lambda e:e.pop('assets/index-new.css')))
    def test_safe_atomic_replacement(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);target=module.regular(root,'index.html');target.write_bytes(b'old');module.atomic(target,b'new');self.assertEqual(target.read_bytes(),b'new')
            with self.assertRaises(ValueError):module.regular(root,'../index.html')

if __name__=='__main__':unittest.main()
