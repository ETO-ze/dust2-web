/** Per-mode chat `/help` lines — one command per entry. Keep in sync with 模式和指令.txt */

export const UTILITY_HELP_LINES = Object.freeze([
  '【道具练习】Y 开聊天后输入 /help',
  '/set T|CT — 在脚下放置假人，死亡后仍在此点重生；头顶显示雷/火/闪反馈',
  '/remove — 移除准心对准的假人',
  '/record <名> — 保存上一次投掷（含按下→出手过程：走/蹲/跳/双键等）',
  '/remake <旧> <新> — 只改已记录点的名字',
  '/redo <名> on — 开启覆盖：之后每次投掷都更新该名',
  '/redo <名> off — 结束覆盖并写入最后一次投掷',
  '/show <名> — 回放蓄力过程后出手（旧记录无录像则直接出手）',
  '/list — 列出道具包与条数',
  '/list all — 列出全部道具点（按包着色）',
  '/list <包名> — 只列某个包',
  '/out <名> — 导出单条为 JSON',
  '/out all — 导出全部为 JSON',
  '/in — 选本地 JSON 导回（同名跳过）',
  '/in force — 导回并覆盖同名',
  '/fly — 开关飞行+穿墙',
  '/god — 开关无敌（并开启飞行穿墙）',
  '/clear all — 清除当局录制（内置包保留）',
  '/help — 显示本列表',
  '导出文件名：practice-{条数}.json 或 {包名}-{条数}.json',
  '热键：1雷 2闪 3烟 4火（无限）· 血量归零自动回满',
]);

export const DEBUG_HELP_LINES = Object.freeze([
  '【调试模式】Y 开聊天后输入 /help',
  '/fly — 开关飞行+穿墙',
  '/region — 开始画下一片区域（七色循环编号）',
  '/name <名> — 命名并结束当前涂区',
  '/end — 不改名、用编号名结束当前涂区',
  '/cancel — 取消当前笔刷（已画临时区仍保留）',
  '/rlist — 列出全部区域（临时彩色 / 本地红色）',
  '/rlist <名> delete — 删除临时区',
  '/rlist <名> remake — 重绘该临时区',
  '/rlist <名> rename <新名> — 重命名临时区',
  '/rshow temp — 只显示当局临时区',
  '/rshow all — 临时+本地全部显示',
  '/rshow local — 只显示本地区',
  '/clear all — 清空当局临时区（本地保留）',
  '/help — 显示本列表',
  '导出文件名：map-callouts.json',
  '另：F8 点位调试 · 暂停菜单可导出区域',
]);

export const DEFAULT_HELP_LINES = Object.freeze([
  '当前模式无专用指令表',
  '/help — 道具练习与调试模式可查看完整指令',
  '道具练习：录制/演示道具点 · 调试：/fly 与画区',
]);

export function helpLinesForMode(mode) {
  const id = String(mode || '');
  if (id === 'utility') return UTILITY_HELP_LINES;
  if (id === 'debug') return DEBUG_HELP_LINES;
  return DEFAULT_HELP_LINES;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Private chat reply + clientCommand payload for multi-line help. */
export function formatModeHelp(mode) {
  const lines = helpLinesForMode(mode);
  const plain = lines.join('\n');
  const html = `<div class="chat-help">${lines.map((l) => escapeHtml(l)).join('<br>')}</div>`;
  return {
    ok: true,
    private: true,
    reply: plain,
    clientCommand: 'mode_help',
    args: JSON.stringify({ html, plain }),
  };
}

/** Plain text for 模式和指令.txt */
export function modeHelpDocument() {
  return [
    '道具模式',
    '用途：录制/演示道具点；假人测雷/火/闪；无限四道具',
    '',
    ...UTILITY_HELP_LINES.filter((l) => !l.startsWith('【')),
    '',
    '调试模式',
    '用途：标点/画区、免费全装、单人调试',
    '',
    ...DEBUG_HELP_LINES.filter((l) => !l.startsWith('【')),
    '',
  ].join('\n');
}
