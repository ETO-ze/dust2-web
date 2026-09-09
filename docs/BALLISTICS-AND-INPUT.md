# 枪口、穿透与浏览器输入

本次实现使用本机安装的 CS2 `scripts/weapons.vdata_c` 中的穿透能力和曳光频率，提取脚本为 `scripts/extract-ballistics.mjs`。AK 每三发、AWP 每发；带消音器的 M4A1-S / USP-S 使用原始数据的消音状态索引（不绘制曳光）。命中由服务器射线决定，客户端从实际第一人称枪口绘制经过服务器落点的短暂弹迹。参考 Valve 历史说明：[第一人称曳光起点](https://blog.counter-strike.net/2018/02/20179/)；该说明属于 CS:GO，当前数值来自本机 CS2 数据。

原碰撞网格没有保留 Source 2 物性。`build-penetration-materials.mjs` 将原版地图 VMAT 的木材、金属名称对应到附近碰撞面，未知表面保守视为混凝土。射线必须找到进入面与反向出口，依据实际厚度、材质和武器能力扣减伤害，最多穿透四层。厚墙、没有出口或类型不一致的面停止射线。这是网页适配算法，不是声称复制 Valve 未公开的 Source 2 伤害求解器。`penetration-map-qa.mjs` 保留了真实地图探针和坐标。

曳光和撞击共用有上限的几何池；地面掉枪只为附近的有限数量实例请求皮肤，不会预下载整个仓库。掉枪保留弹匣、备用弹药与皮肤，服务器验证拾取距离、朝向、视线及槽位交换。默认 G 丢枪，E 拾取；炸弹交互优先。

Tab 的问题来自 OS 自动重复：旧代码提前跳过 `repeat`，漏掉 `preventDefault()`，因此长按会让浏览器移动焦点。现在对局中每次重复都取消默认行为，战绩只打开一次；松开、失焦关闭。菜单保留正常 Tab 导航，Esc 始终用于退出游戏鼠标控制。参考：[MDN KeyboardEvent.repeat](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/repeat)、[Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API)。浏览器保留的系统快捷键不强制接管。
