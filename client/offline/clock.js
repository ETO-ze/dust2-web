// Bounded fixed-step clock, independent of display refresh. Pauses never catch up.
export class MatchClock {
  constructor({tick, snapshot, startTime = Date.now(), tickRate = 30, snapshotRate = 15}) {
    Object.assign(this, {tick, snapshot, time:startTime});
    this.step = 1000 / tickRate; this.every = tickRate / snapshotRate;
    this.accumulator = 0; this.ticks = 0; this.paused = false; this.droppedMs = 0;
  }
  advance(elapsed) {
    if (this.paused || !Number.isFinite(elapsed) || elapsed <= 0) return;
    const bounded = Math.min(elapsed, this.step * 3);
    this.droppedMs += elapsed - bounded; this.accumulator += bounded;
    while (this.accumulator + 1e-6 >= this.step) {
      this.accumulator -= this.step; this.time += this.step; this.ticks++;
      this.tick(this.step / 1000);
      if (this.ticks % this.every === 0) this.snapshot();
    }
  }
  pause(value) { this.paused = !!value; this.accumulator = 0; }
}
