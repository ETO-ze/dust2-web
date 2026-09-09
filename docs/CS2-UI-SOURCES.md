# CS2 界面素材与实现依据

核验日期：2026-09-09。界面适配浏览器窗口、中文文字与本项目实际联机协议；它不是 Valve 官方客户端，也没有运行 Panorama / Source 2 的原版界面代码。

## 可追溯的原始素材

本次从用户本机安装的 `game/csgo/pak01_dir.vpk` 读取 46 个 SVG，共 538,347 字节。原始几何、填色和描边保留，未重画为近似图形。浏览器直接使用 SVG，不需要下载模型或安装字体。

- 复现脚本：[scripts/extract-cs2-ui.mjs](../scripts/extract-cs2-ui.mjs)。通过只读 VPK 索引定位分卷，读取 Source 2 资源的 `DATA` 块，取出原始 `<svg>…</svg>` 文本。无需启动模型导出进程。
- 逐文件来源、源文件 SHA-256、输出长度和 SHA-256：[线上图标清单](https://cs2.duskrain.cn/assets/ui-cs2/manifest.json)，本地生成位置为 `public/assets/ui-cs2/manifest.json`。安装目录中的文件未修改。
- SVG 浏览器适配只去掉编译头、XML 声明与外部 DTD 包装；图形内容未修改。图标不含脚本、外部图像或外部链接。

| 用途 | Valve 原始资源目录 / 文件 |
| --- | --- |
| 23 把枪、爪子刀、手雷、闪光、烟雾、护甲、头盔、拆弹器、C4 | `panorama/images/icons/equipment/*.vsvg_c` |
| 爆头 | `panorama/images/hud/deathnotice/icon_headshot.vsvg_c` |
| 穿透 | `panorama/images/hud/deathnotice/penetrate.vsvg_c` |
| 穿烟 | `panorama/images/hud/deathnotice/smoke_kill.vsvg_c` |
| 致盲中击杀 | `panorama/images/hud/deathnotice/blind_kill.vsvg_c` |
| 未开镜 / 空中击杀 | `panorama/images/hud/deathnotice/noscope.vsvg_c`、`inairkill.vsvg_c` |
| 闪光助攻 | `panorama/images/icons/equipment/flashbang_assist.vsvg_c` |
| 阵营标志 | `panorama/images/icons/ui/ct_logo_1c.vsvg_c`、`t_logo_1c.vsvg_c` |
| 生命、阵亡与击杀提示 | `panorama/images/hud/health_cross.vsvg_c`、`hud/teamcounter/killtype_default.vsvg_c`、`hud/kill_pip_default.vsvg_c` |

枪械 ID 与 Valve 资源名存在差异，例如项目的 `m4a4` 对应 Valve `m4a1`，项目的 `m4a1` 对应 Valve `m4a1_silencer`。映射已明确写在提取脚本中。大厅和胜利队列中的探员图片复用本项目已核验的 Valve 原始库存预览，不生成虚构探员图。

## 官方设计资料与本地 Panorama 参考

Valve 在 2023 年 6 月 6 日更新中将购买轮盘改为网格，并按阵营设置起始手枪、其他手枪、中级武器与步枪栏。本项目保留用户指定的每方 15 把枪，在购买菜单一屏展示五列：装备、手枪、中级、步枪、投掷物。原客户端的退款、队友代购等功能未因此自动实现，界面只提供当前服务器支持的操作。[Valve 官方更新与 Goodbye Wheel](https://store.steampowered.com/news/posts/?appids=730&enddate=1686873468&feed=steam_announce/1000)

大厅背景与地图标志复用已有 Valve Dust II 图像。视觉方向采用自然光下的场景、横向导航、浅色房间设置、白色信息与蓝 / 金阵营色，参考 Valve 对地图中角色可辨识度的设计说明。[Valve Dust II 设计对照](https://www.counter-strike.net/dust2/)、[Valve CS2 介绍](https://www.counter-strike.net/cs2)

本地提取的参考 CSS 位于 `artifacts/ui-cs2/panorama/`，仅用于核对设计，不作为网页运行依赖。主要参考：

| 原始 Panorama 样式 | 使用的可核对设计信息 |
| --- | --- |
| `styles/mainmenu.vcss_c`、`mainmenu_play.vcss_c` | 顶部导航、游戏入口、地图背景中的信息分层 |
| `styles/hud/huddeathnotice.vcss_c` | CT `#6f9ce6`、T `#eabe54`，横排玩家 / 武器 / 特殊击杀图标，约 24 px 图标；普通击杀 5 秒、本地相关击杀 1.5 倍停留 |
| `styles/hud/hudteamcounter.vcss_c` | 顶部双方玩家槽位、中央比分和时间、阵亡去色与骷髅、己方血量状态 |
| `styles/scoreboard.vcss_c` | 队伍分区、真实玩家逐行统计、本人行强调 |
| `styles/hud/huddeathpanel.vcss_c` | 阵亡信息保留在游戏画面中；展示击杀者、武器与继续观战状态 |
| `styles/hud/hudwinpanel.vcss_c` | 横向获胜标题区、阵营底色、淡入和展开效果 |
| `styles/endofmatch-win.vcss_c` | 居中的获胜队标、比分横条、较大的胜败标题，以及缩放 / 透明度过渡 |
| `styles/endofmatch.vcss_c`、`teamselectmenu.vcss_c` | 比赛结束与阵营相关界面的层次组织 |

## 换边、终局与数据边界

换边与终局使用原始 CT / T 标志，过渡效果由网页 CSS 实现。它们是依据本地 Panorama 资料制作的网页重现，并非直接移植官方运行时、官方视频或 3D 胜利动作。网页不伪造官方结算奖励、段位、MVP 音乐或库存物品。

- `sides_swapped` 事件显示中场 / 加时换边、新阵营提示。正常半场在完成 12 回合后换边；加时每 3 回合换边。该组件不修改队伍、分数或角色。
- `match_end` 或终局快照显示胜利 / 失败、自己队伍与对方的真实比分、获胜队伍的实际玩家和 K/D/A，以及返回大厅按钮。
- 胜负按服务器稳定 `teamId` 判断，不能以换边后的 CT / T 名称判定原队伍是否获胜。
- 击杀栏只在服务器明确发出对应标记时显示爆头、穿透、穿烟、致盲、未开镜、空中击杀与助攻图标。已导入图标并不表示服务器已经模拟该项机制。
- 计分板使用真实击杀、死亡、助攻和资金。删除了过去客户端用 `击杀×2+助攻` 临时计算的得分。无服务器个人延迟 / 总伤害字段时不制造这些数值。
- 房主管理入口只改变正常 `setBots` 请求的目标数量；权限、人数限制和房间状态仍由服务器验证。

## 浏览器检查

通过 `artifacts/ui-cs2/fixture.html` 的轻量真实浏览器样例检查界面：未创建第二个 WebGL 地图，也未加载枪械 / 地图 GLB。样例数据用于 UI 检查，不是线上战绩截图。

覆盖 1366×768 大厅、HUD、CT / T 商店、计分板、死亡观战、换边、胜利 / 失败、房主管理，以及 390×844 窄屏。原始图标与探员预览全部成功解码；CT 显示 21 个、T 显示 20 个可用购买项，双方顶部共 10 个玩家槽位。截图位于 `output/playwright/cs2-ui/`。
