# Windows 本机与便携版构建

当前推荐使用[在线最新版](https://cs2.duskrain.cn/)。旧的预打包 Windows ZIP 已从项目介绍撤下，不再标记为「当前包」；旧离线包不会自动更新本地客户端和人机服务器。

## 从当前源码运行

安装 Node.js 22.12 或更新版本，在项目目录执行：

```sh
npm ci
npm run assets:fetch
npm run build
npm start
```

打开 [localhost:3000](http://localhost:3000/)。也可在依赖与资源齐全后使用 `Start-Game.cmd`；启动、停止与联机见 [ONLINE.md](../ONLINE.md)。

## 自行生成便携包

```sh
npm run build
node scripts/build-asset-lock.mjs
python deploy/package-portable.py
```

输出到 `artifacts/portable/`，按允许列表包含客户端、服务器、生产依赖、资源、Node.js Windows x64 运行程序、许可与逐文件校验清单。运行程序来自构建器指定的官方版本并校验 SHA-256。

| 文件 | 用途 |
| --- | --- |
| 开始游戏-在线联机.cmd | 从本机读取资源，连接当前公网游戏服务器 |
| 开始游戏-离线机器人.cmd | 在本机运行机器人服务器，完整资源齐全后可断网游玩 |
| 校验文件.cmd | 核对包内文件大小与 SHA-256 |

朋友收到后解压整个目录，游戏期间保留启动窗口。在线模式用相同房间码加入；离线房间只存在于当前电脑。

本页提供当前源码的构建方法，没有新的预打包 ZIP 下载。自行分发前应校验 ZIP、解压后的文件清单，并验证在线和离线启动。素材归属见 [ASSETS.md](ASSETS.md)。
