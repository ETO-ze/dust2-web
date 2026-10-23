# R8 / Issue #3 核查记录

核查日期：2026-10-23（Asia/Shanghai）。源码基线固定为 `main` 的 `86a5ea3ded265be0a8a300db5d0f37165d0ac176`，版本号 `1.3.0`。以下行号均指该提交，工作树后续补丁可能改变行号。

Issue：[ETO-ze/dust2-web#3](https://github.com/ETO-ze/dust2-web/issues/3)。初次核查通过 GitHub 读取确认：cuihuaji 于 2026-10-05 提交“请求添加r8左轮”，正文为“已经推荐给朋友，给你star”；当时 Issue 为 open，comments=0。下文保留提交修复前的评论草稿，用于区分 main 基线与修复状态。

## 结论与证据边界

基线已有一把可通过通用装备、购买和射击链路使用的 R8，不应重复添加武器定义。模型、预览、轮廓图标、专用动画、开火音效、拔枪音效、装填音效也都有明确配置及可校验的资源。默认五把手枪没有 R8，需要在所选阵营的装备配置中，用第 2–5 个手枪位置之一换入它，再到购买菜单购买。

但不能将“已支持这把武器”描述成“已完整还原 R8 操作”。基线左键直接使用通用即时开火；未接入专有 `prepare` 蓄力动画/状态；右键输入只面向刀和投掷物，未接入 R8 快速射击；`shoot2` 动画虽已打包但没有调用路径。此外，换枪音效预热遗漏按动画事件命名的装填音效 bank，冷解码时存在错过音效播放时限的可能。

基线 `docs/ONLINE-1.3.0.md:11` 已把 R8 列为新增武器；`:23` 明确说明“R8 蓄力扳机和 FAMAS 三连发机制未在本次新增”。这与核查一致，是发布时已有的功能边界，不能把 Issue 提交时的状态与 10 月 11 日之后的 main 混为一谈。若需求仅为“加入一把可用的 R8”，代码已满足；若要求完整的特色操作体验，则尚未满足。

本记录验证了源代码、资源字节/SHA-256、GLB 内容、动画绑定名称和音效 bank 映射。未在真实浏览器内渲染、操作或试听；没有证明线上部署版本与此 `main` 一致，也没有以 HTTP 可访问性代替实际画面/声音验证。

## 完整实现链路（基线）

| 环节 | 证据 | 可确认行为与限制 |
| --- | --- | --- |
| 武器身份 | `shared/weapons.js:38,49,52` | `revolver` 名为“R8 左轮手枪”，CT/T 通用；`r8`、`r8-revolver` 归一到它；$600、8 发弹巢、16 发储备、86 基础伤害、0.5 秒射击间隔。已有定义，无需另建同名枪。 |
| 装备候选 | `shared/weapon-loadout.js:6,16-23`；`client/loadout-menu.js:16,31,36` | 候选按分类/阵营生成，R8 自然包含在 CT/T 手枪选择中；初始手枪槽不可换为 R8，其他四个手枪槽允许；保存写入偏好并提交服务器。 |
| 默认入口 | `shared/weapons.js:51`；`client/shop.js:22-25` | 两阵营默认五把手枪均不含 R8；商店只显示当前配置。未事先换入 R8 的玩家不会在默认购买面板看到它。 |
| 购买授权 | `server/game.js:403-428` | 归一别名，检查存活、购买区/时段、阵营和装备配置；竞技模式扣 $600，死斗免费；替换当前手枪并切到槽 2。 |
| 本地开火 | `client/main.js:483-506` | 检查连接、弹药、冷却、装弹、槽位；发送 shotId、预留弹药，调用 `viewWeapon.shoot` 和 `audio.shot`。R8 与通用自动武器相同，按住左键按 0.5 秒间隔预测开火。 |
| 服务器开火 | `server/game.js:670-684,722` | 通用 `fire` 接受 `input.fire`；检查生命、冷却和弹药；每发扣 1，再结算精度/弹道/伤害并广播 `shot`。没有 R8 专用预扣扳机状态。 |
| 精度/弹道 | `shared/weapon-accuracy-data.js:554`；`shared/weapon-ballistics.js:104` | 已有 R8 原始参数表；存在数据并不证明主/副攻击模式的全部参数均已被使用。 |
| 装弹与弹量 | `server/game.js:759-774`；`shared/reload-profiles.js:1119-1161` | 装弹总时长 2.266667 秒，0.867647 进度提交弹量；基线 `reserveAmmoAsClips:true` 按完整装填扣储备，部分弹巢重装会替换/丢弃未用弹，不能称为逐发保留弹药的左轮装填。 |
| 第一人称模型 | `shared/skins.js:456-475`；`client/skin-assets.js:18-29`；`client/viewmodel.js:55-97,126-145` | 默认 `revolver-reboot` 模型和专用动画一起按需加载并校验；把真实武器接到探员手臂 `wpn`；持枪、拔枪、开火、装弹和检视共用动画系统。 |
| 世界/他人持枪 | `client/models.js:59-77`；`client/dropped-weapons.js` | 从 skin catalog 请求同一款 R8 资源，沿通用武器展示路径处理。加载尚未成功时隐藏枪体；具体握持、落地姿态和碰撞效果需浏览器验证。 |
| 图标/预览 | `shared/skins.js:460-470`；`client/original-hud/icons.js:5`；`client/ui-icons.js:5`；`client/hud.js:126` | 商店/装备使用 R8 预览；HUD 优先采用随前端源码打包的真实 R8 SVG，不会因未列入旧 `icons` 集合而变成 world 图标。 |
| 开火/拔枪音效 | `client/audio.js:127-143,177-181`；`client/main.js:425,476,506` | `revolver`、`revolverFar`、`revolverDraw` bank 分别映射近处/远处枪声和拔枪；只有解码就绪才播放，未用合成枪声替代。远处 bank 未就绪时可以先播近处音色并加距离衰减。 |
| 装填音效 | `client/audio.js:167-174`；`shared/reload-profiles.js:1124-1159` | 7 个定时事件引用 5 个唯一 bank；资源清单全部覆盖，不能报告为“装填音效缺失”。预热遗漏风险见下节。 |

## 展示和音效的具体发现

### 1. R8 专用发射模式尚未接通

`scripts/weapon-assets/export.mjs:34` 明确导出 `prepare_shoot_revolver` 和 `shoot_alt1_revolver`，分别命名为 `prepare` 和 `shoot2`。但 `client/viewmodel.js:152` 的分支仅给刀/双持/瞄具步枪选择第二种射击动作；R8 永远选 `shoot`。基线 `client/main.js:248` 仅为投掷物或刀生成 `fire2`，服务器 `fire` 仅接受 `input.fire`，也没有 R8 蓄力状态。

按锁文件校验后的 `assets/viewmodel/optional/revolver.glb` 解析结果：

| clip | 时长（秒） | channels | 在 CT/T 默认手臂与 R8 模型中匹配的 channels |
| --- | ---: | ---: | ---: |
| `revolver/draw` | 1.166700 | 228 | 222 |
| `revolver/idle` | 7.500000 | 228 | 222 |
| `revolver/inspect` | 5.833300 | 228 | 222 |
| `revolver/prepare` | 0.966700 | 228 | 222 |
| `revolver/reload` | 2.266700 | 228 | 222 |
| `revolver/shoot` | 0.700000 | 228 | 222 |
| `revolver/shoot2` | 1.000000 | 228 | 222 |

CT `ct-sas`、T `t-phoenix` 两份手臂资源均与当前 lock 匹配。每个 clip 未匹配的 6 个 channels 仅对应 `econ` 和 `muzzle` 节点，运行时明确过滤不存在的节点。真实模型含 1 个 mesh、23 个 nodes、1 份 skin、4 张内嵌 JPEG 纹理；动画包有 76 个 nodes。以上证明资源与绑定名称接线存在，不代表已经观察过渲染结果。

`prepare` 的 0.9667 秒是完整动画长度，不能直接拿它当原版 R8 的真实开枪延迟。若补主/副攻击，需从可靠游戏参数或实际测量确定延迟，服务器权威地处理按下、保持、取消、切枪、装弹与死亡重置，同时把相同模式带到预测、动画、音效、弹药确认和快照中。只播放 `prepare` 或只允许右键输入不构成完整修复。

### 2. 装填素材完整，预热遗漏真实存在

已核对 manifest 中的映射：

| 用途 / bank | 文件 |
| --- | --- |
| `revolver` | `revolver-1_01.mp3` |
| `revolverFar` | `revolver-1_distant.mp3` |
| `revolverDraw` | `weapons_revolver_revolver_draw.mp3` |
| `anim_weapon_revolver_barrelroll` | `weapons_revolver_revolver_prepare.mp3` |
| `anim_weapon_revolver_siderelease` | `weapons_revolver_revolver_siderelease.mp3` |
| `anim_weapon_revolver_clipout` | `weapons_revolver_revolver_clipout.mp3` |
| `anim_weapon_revolver_clipin` | `weapons_revolver_revolver_clipin.mp3` |
| `anim_weapon_revolver_sideback` | `weapons_revolver_revolver_sideback.mp3` |

基线 `GameAudio.prepareWeapon('revolver')` 仅按 `startsWith('revolver')` 匹配，实际预热了 `revolver`、`revolverFar`、`revolverOut`、`revolverIn`、`revolverDraw` 五个 bank，遗漏上表五个 `anim_weapon_revolver_*` bank。用 stub `loadBank` 收集调用可确定复现，无需浏览器音频设备。

`GameAudio.play` 在 bank 未就绪时会懒加载，并在解码耗时超过 `max(.35, delay + .2)` 秒后放弃该次播放。R8 前两个装填事件在约 0.100 秒处，冷解码较慢时可错过时限。因此这里应描述为“冷加载存在掉音风险”，不是“每次装填都没有声音”。具体哪台设备是否听到遗漏仍需试听。

建议修复 `prepareWeapon`：除原前缀和投掷物 bank 之外，把 `reloadProfile(getWeapon(id).id, false)` 与 `reloadProfile(getWeapon(id).id, true)` 的 `sounds[].bank` 加入集合，再按 manifest 实际存在的 bank 预热。用包含不同前缀（CZ / Glock / R8）的实际装填 profile 验证，避免仅为 R8 硬编码同名判断。

### 3. 资源分发和失败回退

生成文件刻意不入 Git（`scripts/weapon-assets/README.md:3-6`），干净工作树没有 `public/assets` 不能视为产品漏做 R8。`config/assets-lock.json` 记录可获取的 release、bytes 与 SHA-256；当前 lock version 为 `75faa91f691be9f9`，baseURL 为 `https://downloads.duskrain.cn/releases/20261011-armory-02/`。

`scripts/build-asset-manifest.mjs:38-49` 说明枪械模型及专用动画按装备选择下载；初始清单包含预览和公共动画，不包含 `viewmodel/optional`。`shared/skins.js:456-475` 则为 R8 模型和动画明确提供单独 hash。`client/skin-assets.js:23-28` 两者都完成解析后才把模型记入已加载表；`client/loading.js:63-79` 校验 bytes/SHA-256 并拒绝 HTML 错误页。

`client/download-origin.js:35-72` 将本地逻辑路径按配置映射到 CDN；只有 `fallbackToGameServer` 开启时，特定可用性状态码和网络错误才回到游戏服务。`client/skin-assets.js:36-41` 的远程皮肤请求失败会保留已加载默认皮肤并约 30 秒后允许再尝试。R8 当前只配了这款默认模型，若它从未成功加载，第一人称 `client/viewmodel.js:132-133` 和世界模型 `client/models.js:62-63` 会隐藏枪体等待，不能声称存在另一把已加载的 R8 替代模型。

本次未以当前 CDN 状态作部署结论；本地资源比对只证明与基线 lock 的一致性。应在实际游戏域名确认下载配置、部署前端和服务器提交后，再验证冷缓存、CDN 故障和缓存命中路径。

## 可复核方法

1. 固定源码：`git rev-parse HEAD` 应为 `86a5ea3ded265be0a8a300db5d0f37165d0ac176`；若在补丁工作树验证，先用 `git show 86a5ea3:<path>` 对照基线。
2. 资源准备：干净克隆先运行 `npm run assets:fetch`；`npm run assets:check` 检查完整 lock。只做局部核查时逐项执行 `Get-FileHash -Algorithm SHA256` 与字节数比较，不能把别的提交下同名资源直接当当前版本。
3. 装备链路：CT/T 各在手枪第 2–5 槽换入 R8 并保存；检查购买菜单出现 R8，未配置时服务器拒绝购买；竞技模式核对扣 $600，死斗核对免费。断线重进后配置应保留。
4. 服务器/弹药：用可控制 clock 的 `GameRoom` 购买 R8，左键开火核对 8→7、冷却内不得重复扣弹、8 发后空仓、装弹提交点及储备 16→8→0；部分装填按基线弹夹式逻辑验收并明确其局限。
5. GLB：读取 GLB 的 JSON chunk（header 后第一个 chunk 位于 offset 12，JSON 数据起点 20），检查 `animations[].name` 及 sampler input accessor 的 max 时刻。模型和动画须先与 lock 比 hash。
6. 音效：从实际 manifest 核对 `reloadProfile('revolver').sounds` 中每个 bank 都存在且文件与 lock 匹配；stub `GameAudio.loadBank` 收集 `prepareWeapon('revolver')` 的预热清单，检查真实 reload bank 被包括。
7. 浏览器待验：清空缓存后 CT/T 各装备 R8，核对模型/贴图/手指绑定、拔枪/检视/装弹和枪口位置；检查近/远枪声、拔枪声和完整装填声。网络面板不得出现缺失资源或校验失败；在慢设备和 CDN 回退条件下重复。该项本次未执行。

## 资源验证明细

本次首先从已下载的本地 `public/` 资源只读取得下列 27 项，在每项 bytes 和 SHA-256 与基线 `config/assets-lock.json` 完全匹配后，才复制进独立审计工作树。无缺失、无不匹配；未改原始资产。以下的“通过”仅表示 hash/bytes 一致。

随后为构建和测试按 `build-asset-manifest.mjs` 读取规则补齐 1,611 项（含地图穿透材质元数据），共 236,488,977 bytes（225.53 MiB），每项同样匹配 lock。未复制全部武器模型、可选皮肤等无关资源；素材校验记录为本地输出，不随源码分发，公开复核请执行 `npm run assets:fetch` 和 `npm run assets:check`。

| 路径 | bytes | SHA-256 | 结果 |
| --- | ---: | --- | --- |
| `assets/audio/cs2/manifest.json` | 194502 | `13c7189ec5d7dcb20878c5ac00fc22b9d6749bc66d146eef39c3c0ad9e5827d7` | 通过 |
| `assets/audio/cs2/revolver_clipin.mp3` | 8520 | `51ef9a3f8552a08c91544fdb63c86ec4abd479dbfcbdaf1cfe7153bc7d977201` | 通过 |
| `assets/audio/cs2/revolver_clipout.mp3` | 9774 | `c44b99767b0426b589c00e48c0dfff4b272fcb355fbeea2f20daaec420282e8a` | 通过 |
| `assets/audio/cs2/revolver-1_01.mp3` | 53768 | `e030fd42e2f23912c57dadc3280b236e43d77fc634b7267f2f24fd3e60ed3557` | 通过 |
| `assets/audio/cs2/revolver-1_distant.mp3` | 21958 | `5cf07f661d49661b4704803f67a560d4f1f5b115e6291bed15a5790dcf88698a` | 通过 |
| `assets/audio/cs2/weapons_revolver_revolver_clipin.mp3` | 8520 | `51ef9a3f8552a08c91544fdb63c86ec4abd479dbfcbdaf1cfe7153bc7d977201` | 通过 |
| `assets/audio/cs2/weapons_revolver_revolver_clipout.mp3` | 9774 | `c44b99767b0426b589c00e48c0dfff4b272fcb355fbeea2f20daaec420282e8a` | 通过 |
| `assets/audio/cs2/weapons_revolver_revolver_draw.mp3` | 9119 | `557d96c5134466d84f55e9ef01af0e4cc71a93afc7b9b2ac3a09ca75f9bcac8e` | 通过 |
| `assets/audio/cs2/weapons_revolver_revolver_prepare.mp3` | 5497 | `7fb81272ff43426681127887d4ee3bdf06f390231f57fd3bcf383f296a4a7562` | 通过 |
| `assets/audio/cs2/weapons_revolver_revolver_sideback.mp3` | 8123 | `477972f33238a04fad6e936b9e9e52534be08faf12175a9c25e981f4efd6dbbd` | 通过 |
| `assets/audio/cs2/weapons_revolver_revolver_siderelease.mp3` | 5391 | `9c3d606eb848afe2150d0f68742cbcd5954e722adff4383f20ae9c34dd806c14` | 通过 |
| `assets/map/collision.json` | 17102499 | `5ad7c0072d24e4bfd971e9a03de9c33c0825b6a731de3f110998e0db6bb68553` | 通过 |
| `assets/ui-cs2/revolver.svg` | 5408 | `eec6c25dd9ac2ff82be8e741dc22db83dd76f015e63ee7955a7cfc16031547e8` | 通过 |
| `assets/viewmodel/animations.glb` | 24213300 | `85d272755ed243ed360f5f91895321e3dfcd0e0622b04537ec2f052aa59a76de` | 通过 |
| `assets/viewmodel/optional/aug.glb` | 761164 | `dda70bc54fd3271fd7b4034b00f8d63b75cdf0c50eca54f2980ed580f6797522` | 通过 |
| `assets/viewmodel/optional/cz75a.glb` | 987188 | `53f8a6b3bc96ddd3e9bf84d9460a90e9115465e9cb5f8ad1d1d3939eed16b0d1` | 通过 |
| `assets/viewmodel/optional/famas.glb` | 634092 | `747e6d07d46e85e56d7eedb6b20267ea2836407045010b68b1d00d58faf7ac24` | 通过 |
| `assets/viewmodel/optional/g3sg1.glb` | 743152 | `a9819021fb4af42adef66fc7191b2da28ca4d85d9cb284836e1d9f2bef9cbf59` | 通过 |
| `assets/viewmodel/optional/hkp2000.glb` | 910008 | `d6e5632695296d283cc24d4b45c6949cbfb8fc3abc880b5c6ecb9638a44821f7` | 通过 |
| `assets/viewmodel/optional/m249.glb` | 1588908 | `fa12544e8ff4414eeae4cad3c1ff0e4327171373ae5bdde599b4322c2ae4541c` | 通过 |
| `assets/viewmodel/optional/mp5sd.glb` | 647824 | `b265a89ee325597b692d78379ea1e85eb5d0c8a28d588d5b68a1e299b0744aa8` | 通过 |
| `assets/viewmodel/optional/negev.glb` | 1620004 | `1a3ac49e6dffe327eabec43251510e4ebf11e3b94ff8c6254b41d2859c236393` | 通过 |
| `assets/viewmodel/optional/p90.glb` | 742360 | `54fe07690ccd4395caa551e59756660d97d7d889133679d0201b12790dfcffb5` | 通过 |
| `assets/viewmodel/optional/revolver.glb` | 1082788 | `12077abaa414434abb75461b5e2943393aa8c1830fa48757a2a5cb694b69984a` | 通过 |
| `assets/viewmodel/optional/ump45.glb` | 782176 | `277b59af3a2c4e44c5111772eb752436c9244df623f589bf1c0c1e013a36b2ff` | 通过 |
| `assets/weapons/cs2-loadout/previews/revolver-reboot.webp` | 18210 | `f4fd2cc4e02db5dc8e9fd657f9ded584c73d24fd24a529b21e37ff6a65efd49f` | 通过 |
| `assets/weapons/cs2-loadout/revolver-reboot.glb` | 3439728 | `c7c95fd9428bbae541d93b2ed17a1b86a7462476b2bfd5263422bad717fc252a` | 通过 |

## 本地补丁与最终验证

修复在独立工作树准备，保留原开发目录的未提交代码。上文的缺陷描述始终针对固定 main 基线；本修复的提交或合并不等于生产环境已经部署。

具体实现：

| 代码 | 修复内容 |
| --- | --- |
| `shared/revolver.js` | 共享的可取消准备状态和主/副模式识别。左键准备 250 ms 是本项目可调整的网页近似设定，**不是测得的 CS2 延迟**。右键周期 0.4 秒来自同一份已提取武器数据。 |
| `server/game.js`、`server/bot-control.js` | 服务端记录准备截止时间；普通准备输入不会自行生成现代协议的射击；带 shotId 的命令仍受准备、射速、弹药、换弹和有效生命限制。释放、切枪、换弹、死亡、冻结、输入过期、比赛结束和控制权转换清理准备。shot 事件携带 `fireMode`。 |
| `shared/aim.js` | 用独立 `fireMode` 选择 R8 备用精度索引，避免假借 zoomLevel。静止站立主模式总精度 .00252、副模式 .08。 |
| `client/main.js` | 左键开始准备即发无 shotId 输入，准备完成后才发送带号射击、预留一发弹药并播放枪声；右键走副攻击。持续主攻击在冷却最后 250 ms 才启动下一段准备，避免下一帧覆盖开火姿态。两键同时按下优先副攻击；取消后没有预测弹药消耗。 |
| `client/viewmodel.js`、`client/touch-controls.js` | 接通 `prepare` / `shoot2`；预备姿态可取消，准备期间不插入检视；触屏按钮按 R8 显示“扳锤射击”，观战 shot 事件选择对应发射动画。 |
| `client/audio.js` | 预热实际 reloadProfile 引用的 bank，兼容不同命名前缀；准备音使用现有 `anim_weapon_revolver_barrelroll` 对应的 revolver_prepare 样本，取消时停止专用声道。 |
| `shared/online-build.js` | 规则版本升到 2；触发时序/预测契约变化要求客户端与服务器配套发布。地图资源版本保持原值。 |

参数来源复核：本机只读提取文件 `output/weapon-data-audit` 的 SHA-256 为 `fbd0d6f754c234efb24ec5c6b8c335f190e67f17ac7ec98dc2cd2ea2ddb4037e`，与 main `WEAPON_DATA_SOURCE.decompiledSha256` 一致。`weapon_revolver` 块在 12790 行，12843 行为 `m_flCycleTime = [ 0.5, 0.4 ]`。该原始素材提取文件不随源码分发。GLB `prepare` 全长约 .9667 秒不能作为准备延迟参数；250 ms 需要后续手感验收和调参。

验证结果：

- 修改前独立 R8 生命周期基线 6/6 通过：证明基础装备/购买/耗弹/换弹/伤害可用，且主击即时出弹。
- 修改后执行下列 20 文件回归：**135 项通过，0 失败、0 跳过**。覆盖 R8 的客户端实际预测函数、准备门控/取消、主副节奏、装备购买和弹药/伤害，以及现有精度、穿透、控制人机、WebSocket、装备界面、触屏和音效逻辑。客户端测试在受控 clock/transport 中执行生产函数，不等于浏览器实机操作。
- `npm run build` 通过；Vite 仍提示既有地图缩略图路径运行时解析和较大 bundle，不能将构建成功当作画面验收。
- 先前干净工作树中因外置资产尚未准备出现 ENOENT；随后仅从原本机资源中复制与 main lock 匹配的输入并校验，相关测试已通过。这些早期错误不能据此认定线上 R8 缺素材。

```powershell
npm ci --ignore-scripts
# 新克隆需先 npm run assets:fetch；本次使用逐项通过 main lock 校验的本机资产。
node --test --test-concurrency=1 tests/revolver-client.mjs tests/revolver-fire.mjs tests/revolver-lifecycle.mjs tests/revolver-presentation.mjs tests/weapon-loadout.mjs tests/complete-armory.mjs tests/equipment-grenades.mjs tests/aim-consistency.mjs tests/shot-reliability.mjs tests/weapon-inspect.mjs tests/penetration.test.mjs tests/round-combat.mjs tests/room-reload-c4.mjs tests/bot-control.mjs tests/online-sync.mjs tests/controls.test.mjs tests/touch-controls.mjs tests/audio-context-adoption.mjs tests/loadout.integration.mjs tests/input-shop.integration.mjs
npm run build
```

自动化入口及断言保存在上述测试源码中。运行日志和素材校验记录为本次本地验证输出，不随公开源码分发。

待实际验收：冷缓存首次选择/购买、CT/T 手指和枪体绑定、枪口位置、近远枪声与完整装填听感、250 ms 准备节奏、高延迟下视觉和命中同步、触屏按键，以及真实线上部署提交是否对应本次基线。旁观者可按 fireMode 播放发射动作，但尚未通过快照同步准备状态。原有整夹式换弹语义与伤害/后坐力近似保持；未声称完整复刻 CS2。规则版本检查允许不携带版本的旧兼容路径，部署时需另行明确旧包支持策略，不应混用未协商的 legacy 输入与显式 shotId。

## Issue #3 中文评论草稿

谢谢你推荐给朋友和点 Star！核查了当前 main（1.3.0）源码，R8 已加入，名称是「R8 左轮手枪」，CT/T 都能使用。它不在默认五把手枪中：请在「装备」里选择对应阵营，将手枪第 2–5 格之一换成 R8 并保存，再到 B 购买菜单购买；爆破模式价格 $600，弹量为 8+16。

源码已接通普通射击、耗弹、换弹，并配置了模型和专用音效。不过当前 main 仍使用普通即时左键射击，R8 的蓄力扳机和右键副射击还没有接入，所以还不能说完整还原了 R8。此次完成的是源码、自动化及资源核查，线上实机画面、声音和手感尚未逐项验收；这些特色操作仍需补齐后验证。
