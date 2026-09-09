"""Windows x64 self-contained client and optional loopback bot server.

Run npm run build first. An allowlist excludes private deployment material.
The official Node archive and every locked game asset are SHA-256 checked.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NODE = 'v22.23.2'
BASE = f'https://nodejs.org/dist/{NODE}/'
NAME = f'node-{NODE}-win-x64'

def sha(file):
    with file.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()

def fetch(url, target):
    with urllib.request.urlopen(url, timeout=120) as source, target.open('wb') as dest:
        shutil.copyfileobj(source, dest)

def copy(source, target):
    if source.is_symlink():
        raise RuntimeError(f'Symlink rejected: {source}')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)

def main():
    if not (ROOT / 'dist/index.html').is_file():
        raise SystemExit('Run npm run build first.')
    cache = ROOT / 'artifacts/portable/runtime-cache'
    cache.mkdir(parents=True, exist_ok=True)
    checksums = urllib.request.urlopen(BASE + 'SHASUMS256.txt', timeout=45).read().decode()
    expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1] == NAME + '.zip')
    archive = cache / (NAME + '.zip')
    if not archive.exists() or sha(archive) != expected:
        print('Downloading official Node Windows runtime...', flush=True)
        fetch(BASE + NAME + '.zip', archive)
    if sha(archive) != expected:
        raise RuntimeError('Node runtime SHA-256 mismatch')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    out = ROOT / 'artifacts/portable' / f'DustII-Windows-x64-{stamp}'
    out.mkdir(exist_ok=False)
    app = out / 'app'
    lock = json.loads((ROOT / 'config/assets-lock.json').read_text(encoding='utf-8'))
    print(f'Checking and copying {len(lock["files"])} locked game assets...', flush=True)
    for entry in lock['files']:
        relative = entry['path']
        if not relative.startswith('assets/') or '..' in relative.split('/') or '\\' in relative:
            raise RuntimeError(f'Invalid asset path: {relative}')
        source = ROOT / 'dist' / relative
        if not source.is_file() or source.stat().st_size != entry['bytes'] or sha(source) != entry['sha256']:
            raise RuntimeError(f'Game asset mismatch: {relative}')
        copy(source, app / 'dist' / relative)
    # Built entry points, PWA icons and compiled client chunks only.
    for source in (ROOT / 'dist').rglob('*'):
        if not source.is_file():
            continue
        relative = source.relative_to(ROOT / 'dist')
        if relative.parts[0] != 'assets' or (len(relative.parts) == 2 and source.suffix in {'.js', '.css'}):
            copy(source, app / 'dist' / relative)
    for folder in ['server', 'shared', 'portable']:
        for source in (ROOT / folder).glob('*.js'):
            copy(source, app / folder / source.name)
        for source in (ROOT / folder).glob('*.mjs'):
            copy(source, app / folder / source.name)
    for module in ['three', 'three-mesh-bvh', 'ws']:
        for source in (ROOT / 'node_modules' / module).rglob('*'):
            if source.is_file():
                copy(source, app / 'node_modules' / source.relative_to(ROOT / 'node_modules'))
    for name in ['collision.json', 'penetration-materials.u8']:
        copy(app / 'dist/assets/map' / name, app / 'public/assets/map' / name)
    # npm / toolchains / credentials / deployment scripts are not needed.
    (app / 'package.json').write_text(json.dumps({'name':'dust2-portable', 'private':True, 'type':'module'}), encoding='utf-8')
    with zipfile.ZipFile(archive) as bundle:
        for name in ['node.exe', 'LICENSE', 'README.md']:
            target = out / 'runtime' / name
            target.parent.mkdir(exist_ok=True)
            target.write_bytes(bundle.read(f'{NAME}/{name}'))
    runtime_version = subprocess.check_output([str(out / 'runtime/node.exe'), '--version'], text=True).strip()
    if runtime_version != NODE:
        raise RuntimeError('Unexpected bundled runtime version')
    copy(ROOT / 'LICENSE.md', out / 'licenses/PROJECT-RIGHTS.md')
    sources = (ROOT / 'docs/ASSETS.md').read_text(encoding='utf-8').split('## 来源和归属', 1)[1].split('## 下载器验证', 1)[0]
    (out / 'licenses/ASSET-SOURCES.md').write_text('# 资源来源和归属\n' + sources, encoding='utf-8')
    for source in (ROOT / 'docs/assets-sources').glob('*'):
        if source.is_file():
            copy(source, out / 'licenses/assets-sources' / source.name)
    for source in (ROOT / 'public/assets').rglob('*'):
        if source.is_file() and source.name.lower().startswith(('license', 'notice', 'credit')):
            copy(source, out / 'licenses/assets' / source.relative_to(ROOT / 'public/assets'))
    launchers = {'开始游戏-在线联机.cmd':'portable/launch.mjs --online', '开始游戏-离线机器人.cmd':'portable/launch.mjs --offline', '校验文件.cmd':'portable/verify.mjs'}
    for name, command in launchers.items():
        script, *args = command.split(' ')
        target = script.replace('/', '\\')
        body = f'@echo off\nchcp 65001 >nul\ntitle DUST II\n"%~dp0runtime\\node.exe" "%~dp0app\\{target}" {" ".join(args)}\nif errorlevel 1 (\n  echo.\n  echo 启动或校验失败，请确认已经完整解压整个文件夹。\n  pause\n)\n'
        if name == '校验文件.cmd':
            body += 'pause\n'
        (out / name).write_bytes(body.replace('\n', '\r\n').encode('utf-8'))
    instructions = '''DUST II · Windows 便携版

先把整个 ZIP 完整解压到任意文件夹，再启动；不要直接在压缩包里运行。
适用于 Windows 10/11 64 位，使用已有的 Edge 或 Chrome 浏览器。
已包含地图、枪械、探员、皮肤、声音、音乐盒及 Node 运行环境，无需 npm、Steam 或手动装 Node。

【与朋友在线对战】
1. 双击「开始游戏-在线联机.cmd」。浏览器自动打开本地大厅。
2. 一人创建房间，选择模式与机器人数量，把房间码发给朋友。
3. 朋友也启动在线联机，输入相同房间码，点击加入房间。
4. 双方合计 10 个席位，可选择 CT / T 席位；房主可添加或移除机器人。
对局连接 cs2.duskrain.cn，异地朋友无需开放端口。也可和网页版玩家互通。
邀请链接打开公网网页；已下载本地包的朋友使用本地入口输入房间码，可避免再次下载。

【不联网练习】
双击「开始游戏-离线机器人.cmd」，创建房间并选择机器人数量。
这是在本机运行的独立房间，不能用这个房间码邀请异地朋友。
机器人越多，电脑的 CPU 开销越高，可先选择 3–5 个。

【首次加载与设置】
加载画面仍会显示进度，这是读取、校验本机资源并创建 3D 场景。
完整包包含当前可选皮肤与音乐，进入游戏不需要从网上再下载这些资源。
默认最低画质，可在设置里调整亮度、灵敏度和准星。
设置保存在本机浏览器，同一启动入口可持续使用；不会自动同步到朋友电脑。
在线版更新后，如提示协议不兼容，请索取新版便携包。本包不会自动下载更新。

【常用操作】
WASD 移动 / 空格跳跃 / Shift 静步 / Ctrl 蹲下 / 鼠标左键射击
右键开镜或副攻击 / R 换弹 / B 商店 / G 丢枪 / E 拾取或互动
1–5 切换装备 / Tab 记分板 / Esc 房间与暂停菜单

【结束游戏与故障排查】
游戏运行时保留启动窗口，玩完关闭浏览器和启动窗口即可。
如果浏览器未自动打开，把启动窗口显示的 http://127.0.0.1 地址复制到 Edge/Chrome。
不要直接打开 app/dist/index.html；游戏需要本地 HTTP 服务。
双击「校验文件.cmd」可检查所有文件是否完整。
文件夹整体可复制、移动或发给朋友；无需管理员权限。
浏览器仍负责 3D 渲染，本包解决资源本地保存问题，不保证提升帧率。

项目：DuskRain Dust II，个人浏览器体验版，非 Valve 官方客户端，不含 Source 2 引擎。
素材及音乐权利归 Valve 和相应创作者，来源与第三方许可见 licenses 和 runtime/LICENSE。
'''
    (out / '使用说明.txt').write_text(instructions, encoding='utf-8-sig')
    (out / 'runtime/SOURCE.json').write_text(json.dumps({'version':NODE, 'source':BASE + NAME + '.zip', 'sha256':expected, 'checksums':BASE + 'SHASUMS256.txt'}, indent=2), encoding='utf-8')
    manifest = {'version':stamp, 'platform':'Windows x64', 'node':NODE, 'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(), 'sourceDirty':bool(subprocess.check_output(['git','status','--porcelain'], cwd=ROOT, text=True).strip()), 'assetVersion':lock['version'], 'assetFiles':len(lock['files']), 'files':[]}
    for source in sorted(out.rglob('*')):
        if source.is_file():
            manifest['files'].append({'path':source.relative_to(out).as_posix(), 'bytes':source.stat().st_size, 'sha256':sha(source)})
    (out / 'package-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    packed = out.with_suffix('.zip')
    print('Compressing portable ZIP...', flush=True)
    with zipfile.ZipFile(packed, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for source in sorted(out.rglob('*')):
            if source.is_file():
                bundle.write(source, arcname=f'{out.name}/{source.relative_to(out).as_posix()}')
    report = {'archive':str(packed), 'folder':str(out), 'bytes':packed.stat().st_size, 'unpackedBytes':sum(f['bytes'] for f in manifest['files']), 'files':len(manifest['files']), 'sha256':sha(packed), 'node':NODE, 'assetFiles':len(lock['files'])}
    packed.with_suffix('.sha256.txt').write_text(f'{report["sha256"]}  {packed.name}\n', encoding='utf-8')
    (out.parent / 'latest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)

if __name__ == '__main__':
    main()
