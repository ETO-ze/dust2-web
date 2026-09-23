# DUST II 离线测试版 0.2.0

安卓 APK 与 Windows x64 便携 ZIP 分开下载。两版都包含地图、武器、皮肤、探员和音乐，第一次运行不需要联网下载。单人对局支持最多 9 名人机、轻松/普通/困难难度、爆破与团队死斗。

人机更新见 [0.2.0 更新说明](OFFLINE-0.2.md)。新增出生分散、守点轮换、按情报分人回防与携包者辅助投掷；普通/困难保持原有枪法及连败增强规则。

## 本版改造

- 参考 [henhaogame/dust2-offline](https://github.com/henhaogame/dust2-offline) 的完整离线资源与触屏布局思路，重新实现为独立源码模块。
- 使用原项目 `GameRoom`、经济、人机、命中与道具逻辑。独立 Web Worker 以 30 Hz 模拟、15 Hz 同步；显示刷新率不会增加重复快照。没有复制参考版的全局后坐力缩放、降低人机水平和修改燃烧弹范围等改动。
- 暂停菜单、换到后台会暂停对局；继续时不追赶后台经过的时间。退出应用或重新加载会结束当前对局，不提供局内存档。
- 触控按钮和摇杆可拖动，逐键调大小/透明度；支持布局代码和设置备份。设置 → 触屏 → 自定义按键布局。
- 默认最低画质与 60 FPS 上限，可选 30/60/90/120 FPS；保留清晰度、亮度、16:9/4:3。不会因为短时掉帧永久降低清晰度。
- 安装资源直接读取，不在 CacheStorage 再保存一套地图。皮肤、探员、音乐按需解码。

## 使用

安卓：安装 APK 后从「尘雨 Dust II 离线」图标启动。独立包名 `cn.duskrain.dustii.offline`，可与原在线版共存。Android 8+、支持 WebGL 2 的设备，系统 WebView 需 110+。横屏沉浸显示，支持刘海安全区域。手机实际帧率取决于 GPU、温度和机器人数量。

Windows：完整解压 ZIP，双击「开始游戏.cmd」。随包提供 Node 运行时，仅监听 `127.0.0.1`，现有 Edge/Chrome 负责显示。可把整个文件夹复制给朋友。开始游戏后保留启动窗口，结束时关闭页面和启动窗口；无需安装开发环境。

设置自动保存在当前应用/浏览器。在「本地资源」导出 JSON 备份可跨设备恢复。卸载安卓应用或清除浏览器站点数据前请先导出。桌面端更换浏览器、启动端口会切换存储位置。

## 构建

```powershell
npm.cmd ci
npm.cmd run assets:fetch
npm.cmd test
npm.cmd run build:offline
python scripts/package-offline.py
```

Android 工程的资源源目录指向 `dist-offline`。使用 Java 17+、Android SDK 35、Gradle 8.11.1，运行 `gradle -p android :app:assembleRelease :app:lintRelease`。签名配置在忽略目录 `android/signing`；沿用固定密钥，不要每次生成新密钥。需要自行配置 `release.json` 的 password 与 `dustii-release.p12`（alias `dustii`），私钥不上传。

安卓以 [WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) 提供包内 HTTPS 资源，不依赖在线游戏网站。Windows 打包脚本验证全部资源 SHA-256，以及 Node 官方分发包 SHA-256。完整下载包大小约数百 MB，以 Release 实际文件为准。

## 范围与归属

这是供测试的单人离线版本，不支持多人房间互联，不是 CS2/Source 2 官方移植。原网站和在线版本保持独立。素材来源和许可见 [ASSETS.md](ASSETS.md) 与 [LICENSE.md](../LICENSE.md)；Valve 和音乐创作者的权利不因打包而改变。
