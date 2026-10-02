# 在线版 1.2.0：手机瞄准与内核测试

网页版和 Android 在线包加入陀螺仪、轻度辅助瞄准。正式包继续使用系统 WebView；独立 GeckoView 包只用于对比测试。两者使用相同客户端、基础素材和正式 WSS，手机不运行在线房间逻辑。离线版和 Windows 1.1 包未改动。

## 如何使用

在「设置 → 触屏」调整陀螺仪和辅助瞄准；「本地资源」可以导出、恢复这些设置。

- 陀螺仪默认对局中开启，也可选仅开镜或关闭。水平、垂直灵敏度默认 1：手机转动 1°，基础视角转动 1°；提供开镜倍率、轴向反转和校准。
- 安卓优先读取原生游戏旋转向量，缺少该传感器时积分陀螺仪角速度。目标采样 100 Hz，桥接最多每 17 ms 一条；浏览器使用运动或方向事件，需要授权时从进入游戏的点击请求。
- 切后台、打开菜单、阵亡观战、失去焦点或横竖屏变化会停止或重建基准。触屏滑动与陀螺仪叠加，鼠标操作立即停用手机辅助。
- 辅助默认「标准」，另有「低」「关闭」。所有房间适用，不区分敌方真人或人机。玩家需要先接近敌人并正在瞄准或开火。
- 基础获取范围 2.5°、保留范围 3.5°、上限 5°/秒，随视野缩小；狙击枪仅开镜时启用，强度减半。只靠近可见躯干，手动拉开立即解除。
- 墙体、烟雾、致盲、队友、死亡、出生保护或超过 250 ms 的快照都会阻止辅助。采用画面插值位置。开火和后坐力恢复期间仅水平跟随，不代替压枪、不自动开火或锁头。

所有视角修正都在移动预测、射击和网络发送之前汇合，不发送目标 ID，不增加强制命中接口，不修改伤害、散布或服务端射击校验。

## 安装与内核

正式包 `DustII-Android-1.2.0.apk`：包名 `cn.duskrain.dustii`，版本号 3，沿用原签名和 HTTPS 存储域，可覆盖在线 1.1。请勿卸载旧包后再安装，否则 Android 会删除旧设置。基础素材继续由 WebViewAssetLoader 读取。

测试包 `DustII-Gecko-Test-1.2.0.apk`：包名 `cn.duskrain.dustii.gecko`，Android 8+、ARM64（含 P60），可与正式包并存。固定 GeckoView `157.0.20260924084938`。通过设置备份导入配置，不读取或修改正式包的数据。包体较大是因为内置独立浏览器内核。

GeckoView 的本地素材服务只监听 `127.0.0.1:27186`，只读安装清单中的文件。可选素材仅向固定 HTTPS 游戏素材域转发读取，不接受任意代理地址。内置扩展只允许游戏顶层页面连接传感器与备份接口。两个包的额外皮肤、刀型与音乐仍按需下载。

设置中显示实际内核版本；运行诊断记录 WebGL 能力、渲染尺寸、帧时间、内存估计、传感器状态和上次渲染进程退出类型。系统杀进程与渲染崩溃分别记录；这些记录不能单独证明根因。

## 构建

Node 22.12+、JDK 21、Gradle 9.3.1、Android Gradle Plugin 9.1.1。正式包编译 SDK 35，GeckoView 编译 SDK 37.0；两者 targetSdk 35、minSdk 26。安装 SDK Build Tools 36.0.0。

```powershell
$env:DUSTII_BUILD_ROOT='D:/CodexBuilds/dust2-online-1.2.0'
$env:DUSTII_WEB_DIST="$env:DUSTII_BUILD_ROOT/web-dist"
$env:DUSTII_INSTALLED_CLIENT="$env:DUSTII_BUILD_ROOT/installed-client"
$env:DUSTII_ANDROID_SDK="$env:DUSTII_BUILD_ROOT/sdk"
$env:DUSTII_GRADLE="$env:DUSTII_BUILD_ROOT/tools/gradle-9.3.1/bin/gradle.bat"
npm.cmd ci
npm.cmd run assets:fetch
npm.cmd run build -- --outDir $env:DUSTII_WEB_DIST
node scripts/prepare-installed.mjs
./scripts/build-android.ps1
./scripts/build-android.ps1 -Gecko
node --test --test-concurrency=2 tests/*.mjs
```

保留 `android/signing` 中的既有签名文件，不重新生成正式密钥。调试 APK 可通过 `DUSTII_DEBUG_SUFFIX` 使用独立测试包名；不影响正式包。

## P60 验收门槛

真机尚未连接，**未完成 P60 验收，不把 GeckoView 替换为正式内核**。模拟器结果只证明相应功能可运行。

两包导入同一设置：相同分辨率、最低画质、60 FPS、相同素材。先对同一场景、路线和视角序列采样，再各进行 15 分钟联机；每轮前恢复相同电量区间和机身温度。记录帧时间 P95、超过 50 ms 的卡顿、输入延迟、内存、温度、崩溃及原生传感器是否停止。设置中导出运行诊断；输入延迟需通过拍摄手指／手机运动与画面响应测量，不能用 ping 代替。

只有 GeckoView 的帧时间 P95 改善至少 15%，且输入延迟、内存、稳定性和功能兼容无明显退步，才进入正式替换与设置迁移验证。结果相近或没有真机证据时保留 WebView。更换内核不承诺降低网络延迟。

参考：[Android 位置传感器](https://developer.android.com/develop/sensors-and-location/sensors/sensors_position)、[浏览器传感器授权](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission)、[WebView 管理接口](https://developer.android.com/develop/ui/views/layout/webapps/managing-webview)、[GeckoView 内置扩展通信](https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html)。
