"""Package a Windows offline client from an explicit allowlist; verify every asset."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil, subprocess, urllib.request, zipfile
ROOT=Path(__file__).resolve().parents[1]
VERSION='0.1.0'
NODE='v22.23.2'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def copy(src,dst):
 if src.is_symlink():raise ValueError(f'Symlink: {src}')
 dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
def main():
 dist=ROOT/'dist-offline'
 lock=json.loads((ROOT/'config/assets-lock.json').read_text(encoding='utf-8'))
 for e in lock['files']:
  p=dist/e['path']
  if not p.is_file() or p.stat().st_size!=e['bytes'] or sha(p)!=e['sha256']:raise ValueError('Asset mismatch: '+e['path'])
 print(f"Verified {len(lock['files'])} locked assets",flush=True)
 cache=ROOT/'artifacts/runtime-cache';cache.mkdir(parents=True,exist_ok=True)
 name=f'node-{NODE}-win-x64';base=f'https://nodejs.org/dist/{NODE}/'
 checks=urllib.request.urlopen(base+'SHASUMS256.txt',timeout=60).read().decode()
 expected=next(line.split()[0] for line in checks.splitlines() if line.split()[-1]==name+'.zip')
 archive=cache/(name+'.zip')
 if not archive.exists() or sha(archive)!=expected:
  with urllib.request.urlopen(base+name+'.zip',timeout=90) as source,archive.open('wb') as dest:shutil.copyfileobj(source,dest)
 if sha(archive)!=expected:raise ValueError('Runtime checksum mismatch')
 out=ROOT/'artifacts/packages'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')/f'DustII-Offline-{VERSION}-Windows-x64'
 out.mkdir(parents=True,exist_ok=False)
 app=out/'app'
 for e in lock['files']:copy(dist/e['path'],app/'dist'/e['path'])
 for name2 in ['index.html'] :copy(dist/name2,app/'dist'/name2)
 for src in (dist/'assets').glob('*'):
  if src.suffix in ['.js','.css']:copy(src,app/'dist/assets'/src.name)
 for name2 in ['offline.mjs','launch.mjs','verify.mjs']:copy(ROOT/'portable'/name2,app/'portable'/name2)
 (app/'package.json').write_text('{"type":"module","private":true}',encoding='utf-8')
 with zipfile.ZipFile(archive) as z:
  for name2 in ['node.exe','LICENSE','README.md']:
   dest=out/'runtime'/name2;dest.parent.mkdir(exist_ok=True);dest.write_bytes(z.read(f'{name}/{name2}'))
 (out/'runtime/SOURCE.json').write_text(json.dumps({'url':base+name+'.zip','sha256':expected},indent=2),encoding='utf-8')
 for src in ['LICENSE.md','docs/ASSETS.md','docs/OFFLINE-V1.md']:copy(ROOT/src,out/'licenses'/Path(src).name)
 for src in (ROOT/'docs/assets-sources').glob('*'):
  if src.is_file():copy(src,out/'licenses/assets-sources'/src.name)
 for module in ['three','three-mesh-bvh']:
  copy(ROOT/'node_modules'/module/'LICENSE',out/'licenses'/f'{module}-LICENSE')
 for name2,script in [('开始游戏.cmd','offline.mjs'),('校验文件.cmd','verify.mjs')]:
  text=f'@echo off\nchcp 65001 >nul\ntitle DUST II OFFLINE\n"%~dp0runtime\\node.exe" "%~dp0app\\portable\\{script}"\nif errorlevel 1 pause\n'
  if script=='verify.mjs':text+='pause\n'
  (out/name2).write_bytes(text.replace('\n','\r\n').encode('utf-8'))
 (out/'使用说明.txt').write_text('''DUST II 离线测试版 0.1.0 · Windows 10/11 x64

1. 把整个 ZIP 完整解压；不要在压缩包内直接运行。
2. 双击「开始游戏.cmd」，浏览器会打开本机游戏。建议使用 Edge 或 Chrome。
3. 选择阵营、模式和 0–9 名机器人，然后开始对局。无需互联网、npm、Steam 或额外安装 Node。
4. 游戏期间保留启动窗口；结束后关闭浏览器页面和启动窗口。

WASD 移动，空格跳跃，鼠标射击，B 商店，E 拾取/拆包/控制人机，G 丢枪，R 换弹，1–5 切换，Tab 战绩。
打开暂停菜单或切后台会暂停。退出不会保留当前对局进度。
设置自动保存在浏览器；在「本地资源」可导出/恢复备份。请使用同一浏览器、同一启动地址。
所有可选皮肤、探员和音乐都包含在包中。首次加载是在读取、解码本机资源。
启动失败可运行「校验文件.cmd」。若未打开浏览器，将窗口中的本机地址复制到 Edge/Chrome。
这是单人离线人机版本，不能加入在线房间。电脑版仍使用浏览器负责 3D 渲染。
个人测试项目，非 Valve 官方产品；素材归属见 licenses。
''',encoding='utf-8-sig')
 manifest={'version':VERSION,'platform':'Windows x64','assetFiles':len(lock['files']),'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'files':[]}
 for src in sorted(out.rglob('*')):
  if src.is_file():manifest['files'].append({'path':src.relative_to(out).as_posix(),'bytes':src.stat().st_size,'sha256':sha(src)})
 (out/'package-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 release=ROOT/'releases';release.mkdir(exist_ok=True)
 packed=release/(out.name+'.zip')
 with zipfile.ZipFile(packed,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for src in out.rglob('*'):
   if src.is_file():z.write(src,src.relative_to(out.parent))
 print(json.dumps({'path':str(packed),'bytes':packed.stat().st_size,'sha256':sha(packed)},indent=2),flush=True)
if __name__=='__main__':main()
