/** The desktop launcher supplies this only to its loopback-served HTML. */
export function connectionTarget(href, portable) {
  const page = new URL(href), socket = new URL('ws', new URL('.', page));
  socket.protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(page.hostname);
  if (!local || !portable) return { socketURL: socket.href, inviteBase: null, offline: false };
  const remote = new URL(portable.socketURL);
  if (!['ws:', 'wss:'].includes(remote.protocol)) throw new Error('无效的本地客户端连接配置');
  const offline = portable.mode === 'offline';
  return { socketURL: remote.href, inviteBase: offline ? null : 'https://cs2.duskrain.cn/', offline };
}
