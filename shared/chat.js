export const CHAT_MAX_LENGTH = 120;
export const CHAT_HISTORY = 48;

export function sanitizeChatText(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}

export function parseChatCommand(text) {
  const cleaned = sanitizeChatText(text);
  if (!cleaned.startsWith('/')) return null;
  const body = cleaned.slice(1).trim();
  if (!body) return { name: '', args: '', raw: cleaned };
  const space = body.search(/\s/);
  const name = (space < 0 ? body : body.slice(0, space)).toLowerCase();
  const args = (space < 0 ? '' : body.slice(space + 1)).trim();
  return { name, args, raw: cleaned };
}

/** CS2-like display: *DEAD* prefix + team/all coloring handled by client. */
export function formatChatLine({ name, text, scope, dead, team }) {
  const prefix = dead ? '*阵亡* ' : '';
  const channel = scope === 'team' ? '(队友) ' : '';
  return `${prefix}${channel}${name}: ${text}`;
}
