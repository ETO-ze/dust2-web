# 资源准备与来源

这个仓库保存游戏代码、资源索引和项目截图。地图模型、纹理、武器、动作和声音等大文件由资源下载器恢复到 `public/assets/`，避免把数百 MB 二进制文件写进 Git 历史。

## 从干净的 clone 开始

需要 Node.js 22.12 或更新的受支持版本。在项目根目录运行：

```sh
npm ci
node scripts/fetch-assets.mjs
npm run build
npm start
```

随后打开 `http://localhost:3000`。`npm run dev` 只启动 Vite 开发前端；联机房间和机器人还需要运行游戏服务器。

当前锁清单为 [`config/assets-lock.json`](../config/assets-lock.json)：**619 个文件，248,412,901 字节，约 236.9 MiB**，版本 `d78b688ceaa4eb61`。它包含：

| 内容 | 用途 |
| --- | --- |
| 590 个基础资源 | Dust II 地图、碰撞几何、角色、默认六把武器、手臂和动作、声音 |
| 12 款额外皮肤的 24 个模型与预览 | 服务器提供全部皮肤；玩家在网页中装备时才下载额外模型 |
| 服务端碰撞 JSON | 服务端移动、射线与命中判定 |
| 大厅背景、图标、雷达图与基础资源 manifest | 菜单、加载画面、地图导航与浏览器缓存 |

下载器使用 4 个并行连接；每个请求附带文件 SHA-256 版本参数。已有文件必须同时满足大小与 SHA-256，才会直接跳过。新文件先写入随机 `.part` 临时文件，完整接收并校验后才替换目标；断流、HTTP 错误或校验失败均会删除该临时文件，保留原文件。再次运行即可补齐缺失项。

仅检查本地文件，不下载、不改动文件：

```sh
node scripts/fetch-assets.mjs --check
```

默认镜像是本项目部署站点 `https://duskrain.cn/dust2/`。可以替换成保持相同 `assets/` 路径和文件内容的镜像：

```sh
node scripts/fetch-assets.mjs --base-url https://your-host.example/dust2/
```

镜像不是永久归档。若镜像不可用或远端内容与锁清单不符，命令会失败并指出文件；它不会默默接受另一个版本。维护镜像时应保留锁清单所指向的字节内容。资源路径被限制在 `public/assets/` 内，路径穿越、Windows 设备名称、符号链接及目录联接均被拒绝。

## 项目下载与玩家缓存是两件事

上述命令用于准备本地开发或部署服务器。网页中的“保存基础游戏资源”使用浏览器缓存；安装桌面应用后仍然由浏览器管理存储。额外皮肤不会加入基础预下载，已经下载的资源可复用。浏览器清理站点数据、存储空间不足或文件版本变化，仍可能触发重新下载。多人对战始终需要连到房间服务器。

## 来源和归属

这是独立实现玩法与网络逻辑的非官方网页项目，未使用 Valve 游戏引擎，也未获 Valve 官方背书。**代码仓库的许可证不覆盖 Valve 和其他原作者的游戏素材；下载器与公开可访问的链接也不构成重新授权。**

| 资源 | 来源与归属 | 本项目处理 |
| --- | --- | --- |
| Dust II 渲染地图、原始纹理 | 本地合法安装的 Counter-Strike 2；Valve | 使用 [Source 2 Viewer](https://s2v.app/) 导出原几何和 UV，转换为浏览器 glTF、Meshopt 与 WebP |
| 地图碰撞与导航资料 | [Awpy 固定版本 2000905](https://github.com/pnxenopoulos/awpy-data/releases/tag/2000905)；源游戏内容属于 Valve | 转换为共享导航和客户端/服务端碰撞数据 |
| 武器、皮肤图案、手臂、骨骼动作和原始枪声 | 本地安装的 CS2；Valve 及原 Workshop 创作者 | 按原模型 UV 烘焙网页 PBR 材质，打包 GLB，音频转为浏览器 MP3 |
| 地图背景、图标与雷达图 | [MurkyYT/cs2-map-icons 固定提交](https://github.com/MurkyYT/cs2-map-icons/tree/ca2012aec9983cf4b1fd7886ffc1808763a787c3)；原图属于 Valve | 使用地图图库中的对应 Dust II 文件 |
| SWAT 与 Hoodie 角色、动作 | [Quaternius Ultimate Modular Characters](https://quaternius.com/packs/ultimatemodularcharacters.html)，CC0 | glTF 重打包为内嵌纹理的 GLB，保留骨骼动作 |
| 脚步与部分环境撞击声 | [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds)，CC0 | 筛选运行时片段；与 Valve 原始枪声分别记录 |

保留的来源记录：[Quaternius](assets-sources/quaternius.txt)、[Kenney](assets-sources/kenney-impact-sounds.txt)、[CS2 默认皮肤导出与材质说明](assets-sources/cs2-skins.md)。皮肤记录包含原始制作工作区的历史路径和验证记录，这些完整导出中间件与历史产物不在代码仓库中。

视觉参考：[Valve 的 Dust II 设计对照](https://www.counter-strike.net/dust2/)、[Valve Workshop Finishes](https://www.counter-strike.net/workshop/workshopfinishes)、[Source 2 Viewer / ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)。网页 PBR 对金属、珠光、光照和磨损进行近似；它不等同于 Source 2 的完整材质与渲染系统。

## 下载器验证

```sh
node --test tests/asset-bootstrap.mjs
```

测试使用本机临时 HTTP 服务，覆盖完整下载、相同文件复用、错误哈希、超长响应、断流清理、只读校验、路径逃逸、符号链接与四连接并发。测试不从公网下载游戏大文件。
