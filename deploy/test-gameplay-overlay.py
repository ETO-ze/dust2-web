"""Offline boundary and gzip regressions; no SSH, HTTP or server changes."""
from pathlib import Path
import gzip
import hashlib
import importlib.util
import io
import json
import os
import tarfile
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timezone

DEPLOY=Path(__file__).resolve().parent
ARTIFACTS=DEPLOY.parent/'artifacts/deploy'
ARTIFACTS.mkdir(parents=True,exist_ok=True)

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,DEPLOY/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

wrapper=load('test_gameplay_receiver','gameplay-overlay.py')
receiver=wrapper.module
packager=load('test_gameplay_packager','package-gameplay-delta.py')
original=load('test_original_receiver','overlay-release.py')
sha=lambda content:hashlib.sha256(content).hexdigest()
source_symlink_test_method='native filesystem symlink'

def archive(rows):
    result=io.BytesIO()
    with tarfile.open(fileobj=result,mode='w:gz') as tar:
        for row in rows:
            name,content=row[:2];kind=row[2] if len(row)>2 else 'file'
            info=tarfile.TarInfo(name);info.mode=0o777;info.uid=1234
            if kind=='symlink':info.type=tarfile.SYMTYPE;info.linkname='../../outside'
            elif kind=='hardlink':info.type=tarfile.LNKTYPE;info.linkname='dist/index.html'
            elif kind=='fifo':info.type=tarfile.FIFOTYPE
            elif kind=='directory':info.type=tarfile.DIRTYPE
            else:info.size=len(content)
            tar.addfile(info,io.BytesIO(content) if info.isfile() else None)
    return result.getvalue()

BASE_ROWS=[('dist/index.html',b'old index'),('server/index.js',b'old server'),
           ('public/assets/map/collision.json',b'{}'),('dist/assets/app.js',b'old JS'),
           ('dist/assets/app.js.gz',gzip.compress(b'old JS',mtime=0)),
           ('dist/assets/unchanged.png',b'unchanged image')]

class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='gameplay-overlay-test-',dir=ARTIFACTS)
        self.root=Path(self.temp.name).resolve()
        self.assertTrue(self.root.is_relative_to(ARTIFACTS.resolve()))
    def tearDown(self):
        self.assertTrue(self.root.resolve().is_relative_to(ARTIFACTS.resolve()))
        self.temp.cleanup()
    def member(self,name,**fields):
        info=tarfile.TarInfo(name);info.size=1
        for key,value in fields.items():setattr(info,key,value)
        return receiver.checked_member(info,{},set(),overlay=True)
    def combine(self,rows,base_rows=BASE_ROWS):
        base=self.root/'base.tar.gz';overlay=self.root/'patch.tar.gz';output=self.root/'output.tar.gz'
        base.write_bytes(archive(base_rows));overlay.write_bytes(archive(rows))
        before=base.read_bytes(),overlay.read_bytes()
        try:return receiver.combine(base,sha(before[0]),overlay,sha(before[1]),output,incoming=self.root),output
        finally:
            self.assertEqual(base.read_bytes(),before[0]);self.assertEqual(overlay.read_bytes(),before[1])

    def test_explicit_supported_paths(self):
        for name in ['dist/index.html','dist/index.html.gz','dist/sw.js','dist/manifest.webmanifest',
                     'dist/icons/icon-192.png','dist/assets/index-new.js','dist/assets/index-new.css.gz',
                     'dist/assets/ui-cs2/headshot.svg','dist/assets/optional/ct-ava.glb',
                     'dist/assets/audio/cs2/ak47.ogg','dist/assets/source/Preview (Variation A).png',
                     'server/game.js','server/bot-aim.js','shared/match-rules.js',
                     'public/assets/map/penetration-materials.json','public/assets/map/penetration-materials.u8']:
            with self.subTest(name=name):self.member(name)

    def test_reject_out_of_scope_and_secret_names(self):
        for name in ['dist/.env','dist/config.toml','dist/private.key','dist/extra.html',
                     'dist/assets/.env','dist/assets/.private/data.json','dist/assets/helper.py',
                     'dist/assets/read.log','dist/icons/readme.txt','server/PROTOCOL.md',
                     'shared/secrets.env','node_modules/ws/index.js','deploy/dust2-web.service',
                     'package.json','public/assets/map/collision.json','public/assets/map/penetration-materials.exe']:
            with self.subTest(name=name),self.assertRaises(ValueError):self.member(name)

    def test_reject_traversal_absolute_control_and_encoded_paths(self):
        for name in ['../dist/index.html','/dist/index.html','dist/assets/../app.js',
                     'dist//index.html','dist/./index.html','C:/dist/index.html',
                     'dist\\index.html','dist/assets/x\n.js','dist/assets/x\0.js',
                     'dist/assets/%2e%2e/app.js','dist/assets/a%2fb.js']:
            with self.subTest(name=name),self.assertRaises(ValueError):self.member(name)

    def test_reject_tar_links_devices_and_directories(self):
        for kind in ['symlink','hardlink','fifo','directory']:
            data=archive([('dist/index.html',b'index'),('dist/assets/app.js',b'x',kind)])
            with self.subTest(kind=kind),self.assertRaises(ValueError):receiver.read_overlay(io.BytesIO(data))

    def test_reject_duplicate_members(self):
        data=archive([('dist/index.html',b'index'),('dist/assets/app.js',b'one'),('dist/assets/app.js',b'two')])
        with self.assertRaisesRegex(ValueError,'Duplicate'):receiver.read_overlay(io.BytesIO(data))

    def test_reject_file_parent_collisions(self):
        seen,parents={},set()
        first=tarfile.TarInfo('dist/assets/folder.js');first.size=1
        receiver.checked_member(first,seen,parents,True)
        child=tarfile.TarInfo('dist/assets/folder.js/x.js');child.size=1
        with self.assertRaisesRegex(ValueError,'parent'):receiver.checked_member(child,seen,parents,True)

    def test_reject_sparse_and_large_member_without_allocating_it(self):
        with self.assertRaises(ValueError):self.member('dist/assets/app.js',size=receiver.MAX_OVERLAY_FILE+1)
        with self.assertRaises(ValueError):self.member('dist/assets/app.js',sparse=[])
        with self.assertRaises(ValueError):self.member('dist/assets/app.js',pax_headers={'GNU.sparse.map':'0,1'})

    def test_gzip_pair_validated(self):
        rows=[('dist/index.html',b'index'),('dist/assets/app.js',b'new JS'),('dist/assets/app.js.gz',gzip.compress(b'new JS',mtime=0))]
        result=receiver.read_overlay(io.BytesIO(archive(rows)))
        self.assertEqual(result['dist/assets/app.js'][1],b'new JS')

    def test_reject_stale_or_orphan_or_corrupt_gzip(self):
        bad=[ [('dist/assets/app.js',b'new JS'),('dist/assets/app.js.gz',gzip.compress(b'old JS'))],
              [('dist/assets/app.js.gz',gzip.compress(b'old JS'))],
              [('dist/assets/app.js',b'new JS'),('dist/assets/app.js.gz',b'not gzip')] ]
        for rows in bad:
            with self.subTest(rows=[r[0] for r in rows]),self.assertRaises(ValueError):
                receiver.read_overlay(io.BytesIO(archive([('dist/index.html',b'index')]+rows)))

    def test_missing_base_gzip_replacement_rejected_and_output_removed(self):
        with self.assertRaisesRegex(ValueError,'stale base gzip'):
            self.combine([('dist/index.html',b'new index'),('dist/assets/app.js',b'new JS')])
        self.assertFalse((self.root/'output.tar.gz').exists())

    def test_valid_combination_preserves_unrelated_bytes_and_sanitizes_modes(self):
        rows=[('dist/index.html',b'new index'),('server/index.js',b'new server'),
              ('dist/assets/app.js',b'new JS'),('dist/assets/app.js.gz',gzip.compress(b'new JS',mtime=0)),
              ('dist/icons/icon-192.png',b'new icon')]
        report,output=self.combine(rows)
        with tarfile.open(output) as tar:
            self.assertEqual(tar.extractfile('dist/assets/app.js').read(),b'new JS')
            self.assertEqual(gzip.decompress(tar.extractfile('dist/assets/app.js.gz').read()),b'new JS')
            self.assertEqual(tar.extractfile('dist/assets/unchanged.png').read(),b'unchanged image')
            self.assertTrue(all(info.mode==0o644 and info.uid==0 for info in tar.getmembers()))
        self.assertEqual(report['sha256'],sha(output.read_bytes()))

    def test_unchanged_base_gzip_does_not_require_overlay_copy(self):
        _,output=self.combine([('dist/index.html',b'new index')])
        with tarfile.open(output) as tar:self.assertEqual(gzip.decompress(tar.extractfile('dist/assets/app.js.gz').read()),b'old JS')

    def test_original_small_overlay_policy_unchanged(self):
        info=tarfile.TarInfo('server/game.js');info.size=1
        with self.assertRaises(ValueError):original.checked_member(info,{},set(),True)
        info.name='dist/assets/headshot.svg'
        with self.assertRaises(ValueError):original.checked_member(info,{},set(),True)
        info.name='dist/assets/index-new.js';original.checked_member(info,{},set(),True)

    def test_wrong_hash_and_existing_output_are_rejected(self):
        base=self.root/'base.tar.gz';patch=self.root/'patch.tar.gz';output=self.root/'output.tar.gz'
        base.write_bytes(archive(BASE_ROWS));patch.write_bytes(archive([('dist/index.html',b'new')]))
        with self.assertRaises(ValueError):receiver.combine(base,'0'*64,patch,sha(patch.read_bytes()),output,incoming=self.root)
        self.assertFalse(output.exists());output.write_bytes(b'keep me')
        with self.assertRaises(FileExistsError):receiver.combine(base,sha(base.read_bytes()),patch,sha(patch.read_bytes()),output,incoming=self.root)
        self.assertEqual(output.read_bytes(),b'keep me')

    def project(self):
        project=self.root/'project';project.mkdir()
        for folder in ['dist/assets','dist/icons','server','shared','public/assets/map']:(project/folder).mkdir(parents=True)
        for name,content in [('dist/index.html',b'new index'),('dist/assets/app.js',b'new JS'),
                             ('dist/assets/app.js.gz',gzip.compress(b'stale local sidecar')),
                             ('dist/index.html.gz',gzip.compress(b'stale index')),
                             ('dist/icons/icon-192.png',b'icon'),('server/index.js',b'new server'),
                             ('shared/new.js',b'export{}'),('public/assets/map/penetration-materials.u8',b'\0\1')]:
            (project/name).write_bytes(content)
        base=self.root/'base.tar.gz';base.write_bytes(archive(BASE_ROWS));return project,base

    def test_packager_ignores_stale_local_sidecars_and_emits_no_duplicates(self):
        project,base=self.project();output=self.root/'delta.tar.gz'
        report=packager.build_overlay(project,base,sha(base.read_bytes()),output,'test-release')
        names=[r['path'] for r in report['files']];self.assertEqual(len(names),len(set(names)))
        with tarfile.open(output) as tar:
            for raw in ['dist/index.html','dist/assets/app.js']:
                self.assertEqual(gzip.decompress(tar.extractfile(raw+'.gz').read()),tar.extractfile(raw).read())
        receiver.combine(base,sha(base.read_bytes()),output,sha(output.read_bytes()),self.root/'combined.tar.gz',incoming=self.root)

    def test_packager_rejects_unauthorized_changed_file_and_removes_partial(self):
        project,base=self.project();(project/'dist/.env').write_text('not a real secret')
        output=self.root/'delta.tar.gz'
        with self.assertRaises(ValueError):packager.build_overlay(project,base,sha(base.read_bytes()),output,'test-release')
        self.assertFalse(output.exists())

    def test_packager_rejects_source_symlink(self):
        global source_symlink_test_method
        project,base=self.project();target=self.root/'outside.txt';target.write_text('outside')
        link=project/'dist/assets/link.txt'
        try:os.symlink(target,link)
        except OSError as error:
            # Windows may deny symlink creation without Developer Mode. Exercise
            # the source metadata boundary without following any external path;
            # the archive symlink/hardlink tests above remain real tar entries.
            source_symlink_test_method=f'mocked Path.is_symlink metadata; native creation unavailable ({error.winerror if hasattr(error,"winerror") else error.errno})'
            link.write_text('placeholder')
            real_is_symlink=Path.is_symlink
            with mock.patch.object(Path,'is_symlink',lambda path: path==link or real_is_symlink(path)):
                with self.assertRaisesRegex(ValueError,'Symlink'):packager.build_overlay(project,base,sha(base.read_bytes()),self.root/'delta.tar.gz','test-release')
        else:
            with self.assertRaisesRegex(ValueError,'Symlink'):packager.build_overlay(project,base,sha(base.read_bytes()),self.root/'delta.tar.gz','test-release')


if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(ReceiverTests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    report={'at':datetime.now(timezone.utc).isoformat(),'offlineOnly':True,'testsRun':result.testsRun,
            'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
            'sourceSymlinkTestMethod':source_symlink_test_method,
            'ok':result.wasSuccessful(),'details':[{'test':str(t),'trace':s} for t,s in result.failures+result.errors]}
    (ARTIFACTS/'gameplay-overlay-tests.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    raise SystemExit(0 if result.wasSuccessful() else 1)
