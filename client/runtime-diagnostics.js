const KEY = 'dust2.runtime-diagnostics.v1';
/** Bounded, local-only evidence survives a reload; no player names or room codes. */
export class RuntimeDiagnostics {
  constructor(storage = null) {
    this.storage = storage; this.events = []; this.samples = []; this.previous = null;
    try { this.previous = JSON.parse(storage?.getItem(KEY) || 'null'); } catch {}
    this.startedAt = new Date().toISOString();
  }
  event(type, detail = {}) {
    this.events.push({ at: new Date().toISOString(), type, ...detail });
    if (this.events.length > 40) this.events.shift();
    this.save();
  }
  sample(metrics) {
    this.samples.push({ at: new Date().toISOString(), ...metrics });
    if (this.samples.length > 60) this.samples.shift();
    this.save();
  }
  current() { return { version: 1, startedAt: this.startedAt, events: this.events, samples: this.samples }; }
  save() { try { this.storage?.setItem(KEY, JSON.stringify(this.current())); } catch {} }
  report() { return { ...this.current(), previous: this.previous }; }
  download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.report(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'dust2-runtime-diagnostics.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function disconnectMessage(code, reason) {
  if (reason === 'Client too slow') return '游戏连接因接收积压中断。可降低画质后重新加入；运行诊断已保存在本机。';
  if (reason === 'Rate limit') return '游戏连接因请求过于频繁中断。请重新加入，或导出运行诊断。';
  if (code === 1012 || code === 1013) return '服务器正在重启或繁忙，请稍后重新加入。';
  return `游戏连接已断开（${code}）。点击加入房间重新连接；可导出运行诊断。`;
}
