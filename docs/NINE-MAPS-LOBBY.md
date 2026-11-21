# 九图联机大厅运行说明

发行标签 `online-v1.4.0-perf.6` 对应客户端 `1.4.0-perf.6`。[下载程序、九图、素材包与校验文件](https://github.com/ETO-ze/dust2-web/releases/tag/online-v1.4.0-perf.6)

## 安装

准备 Node.js 22.12 或更新版本、npm 和 tar。将 `game.tgz`、`maps-v1.tgz`、`media.tgz` 和 `SHA256SUMS.txt` 放在同一目录。Blender 工程单独提供，可用对应的 .sha256 文件校验。在 Linux、macOS 的兼容工具环境或 WSL 中执行以下命令。

```sh
sha256sum -c SHA256SUMS.txt
mkdir -p game/public maps-v1
tar -xzf game.tgz -C game
tar -xzf maps-v1.tgz -C maps-v1
tar -xzf media.tgz -C game/public
cd game
npm ci --omit=dev
export PERF_MAP_ROOT="$(cd ../maps-v1 && pwd)"
export PERF_GAME_DIST="$PWD/dist"
PORT=3240 node server/performance-maps.js
```

启动后打开 [本机地图池](http://127.0.0.1:3240/perf/)。Windows 可用 `Get-FileHash -Algorithm SHA256` 校验，PowerShell 使用 `$env:变量名 = '值'` 设置环境变量。网关监听本机地址，对外提供服务时须在反向代理中转发整个 `/perf/` 路径及 WebSocket 升级请求。

## 房间和素材

九张高帧率地图随包提供。角色、武器与地图按进入的房间加载。`media.tgz` 供房间运营者安装，内含基础资源及可选武器、探员和音乐。浏览器只请求本局所需内容。可通过 `PERF_PUBLIC_DIR` 指定现有素材目录。

高画质模式需要同版本的原版素材库。可通过 `PERF_QUALITY_MAP_LIBRARY` 和 `PERF_QUALITY_TRANSPORT` 指定原版导出及相应的传输包。网关会校验导出、模型、纹理与玩法数据的版本，页面按实际可用素材开放画质选项。两种画质使用同一个房间进程。

进入地图选择页即可查看有真人的公开房间。进房后可选择阵营，由房主配置人机。大厅标出仍能加入的真人数，人机可为进入的玩家让位。

## 从源码构建

在本版标签的源码目录执行。将下方路径替换为本地发行附件的实际位置。

```sh
npm ci
tar -xzf /path/to/media.tgz -C public
mkdir -p artifacts/performance-maps/maps-v1
tar -xzf /path/to/maps-v1.tgz -C artifacts/performance-maps/maps-v1
npm run build
PERF_GAME_DIST="$PWD/dist" npm run start:perf
```

## 地图与装备验收

在对战准备页打开「探员仓库」选择两个阵营的探员，打开「音乐盒」试听或装备，再从「装备」的皮肤库选择武器。已验证下载六位新增探员、切换武器皮肤、试听《内华达》MVP 片段，以及用所选探员和皮肤进入荒漠迷城。

九图高帧率底模共有 3,633,871 个三角面。新版按地图分别调整六种建筑用色，保留 A、B 标记，并使用对应地图的天空。美术工程已在 Blender 5.0.1 逐张重新打开。[九图实拍](screenshots/nine-map-paint.webp) · [Blender 工程与材质说明](FLAT-SURFACES.md)

[返回项目首页](../README.md) · [地图、外观及第三方素材来源](ASSETS.md)
