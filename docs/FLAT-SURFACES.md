# 九图建筑材质与包点标识

本次美术更新面向高帧率模式。建筑涂层首先按地图、表面类型和原网格面面积分析烘焙颜色的亮度分布。墙面、地坪、金属等表面各有独立的暗部与亮部范围。着色器先压低原贴图中凸面高光和浅坑阴影的局部起伏，再叠上地图底色与低反差板缝。窗洞、掩体和大尺度遮蔽仍能呈现层次。

A、B 使用粗笔画字母和明暗轮廓，字形与底色提供两种识别依据。核子危机与殒命大厦复用原位置的墙牌。其余七图保留地面标记，并将入口可见的字印在有连续支撑面的实体墙上。墙印复用现有网格批次和地面标识的图集。替换旧漆前会核对地图源、渲染描述及二进制几何的指纹。

![从入口观察包点 A 和 B](screenshots/flat-site-markers.webp)

## 在 Blender 中审阅

[材质库](../scripts/maps/materials/architectural-planes.blend)内有六种独立可编辑的表面。包含建筑和包点的完整工程可从[九图美术资源发行页](https://github.com/ETO-ze/dust2-web/releases/tag/map-art-flat-signs-20261121)下载。工程随包保存纹理，使用 Blender 5.0.1 制作，加载后可切换到材质预览。项目原创代码采用 MIT，原游戏地图和图像的权利归属见[第三方说明](../THIRD-PARTY-NOTICES.md)。

## 网页运行

当前源码可读取[九图游戏发行版](https://github.com/ETO-ze/dust2-web/releases/tag/online-v1.4.0-perf.5)中的 `maps-v1.tgz`。九张地图的 glTF 已标注 `surfaceMaterialVersion: 1`。按[源码构建步骤](NINE-MAPS-LOBBY.md#从源码构建)安装依赖并构建当前提交，使用 `PERF_GAME_DIST` 指向新构建的 `dist`。随后进入高帧率模式即可看到新材质。旧游戏附件内预编译的客户端保留原发行版画面。

## 编辑与重烘焙

在仓库根目录运行以下命令。先在 Blender 中编辑原创材质库的节点组，将修改保存为 `My-Finishes.blend`，再运行烘焙。脚本同时输出网页使用的 512 × 512 单通道纹理数组和可编辑库。

```sh
blender -b -t 4 --python-exit-code 1 -P scripts/maps/bake-arena-finishes.py -- artifacts/planes/Surface-Library.blend --source-blend My-Finishes.blend
npm run build
```

也可以使用已有游戏发行包的几何从头建立校准输入。下列命令将九个场景写入 `artifacts/arena/scenes`。生成的中间纹理写入 `client/map-finishes` 供 Blender 使用。网页只加载新版共用图集。请把地图包路径替换为实际位置。

```sh
blender -b -t 4 --python-exit-code 1 -P scripts/maps/bake-map-finishes.py -- --studio artifacts/crisp/Map-Finishes.blend
blender -b -t 4 --python-exit-code 1 -P scripts/maps/bake-arena-finishes.py -- artifacts/arena/Surface-Library.blend
blender -b -t 4 --python-exit-code 1 -P scripts/maps/assign-arena-finishes.py -- artifacts/crisp/scenes artifacts/arena --maps-v1 /path/to/maps-v1
```

重新校准色阶时使用上一阶段的带原始顶点色和材质槽的九个建筑工程作为输入。在源码树的 `client/plane-finishes.json` 中可查看每张图各类表面的校准参数。

```sh
blender -b -t 4 --python-exit-code 1 -P scripts/maps/author-plane-finishes.py -- profile artifacts/arena/scenes artifacts/planes
blender -b -t 4 --python-exit-code 1 -P scripts/maps/author-plane-finishes.py -- scenes artifacts/arena/scenes artifacts/planes
```
