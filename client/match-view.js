/** Death stays inside the match. Only a player's explicit menu action unlocks the mouse. */
export class MatchView {
  constructor() { this.reset(); }
  reset() { this.wasAlive = null; this.diedAt = 0; this.targetId = null; }
  update(player, snapshot, now) {
    const died = !!player && !player.alive && this.wasAlive === true;
    const respawned = !!player?.alive && this.wasAlive === false;
    if (died || (player && !player.alive && this.wasAlive === null)) this.diedAt = now;
    if (player?.alive) this.targetId = null;
    this.wasAlive = player?.alive ?? null;
    const candidates = this.candidates(player, snapshot);
    if (!candidates.some(p => p.id === this.targetId)) this.targetId = candidates[0]?.id ?? null;
    return { died, respawned, spectating: this.spectating(player, snapshot, now) };
  }
  candidates(player, snapshot) {
    if (!player || player.alive || snapshot?.mode !== 'defuse') return [];
    return snapshot.players.filter(p => p.id !== player.id && p.team === player.team && p.alive);
  }
  spectating(player, snapshot, now) {
    if (now - this.diedAt < 1500) return null;
    return this.candidates(player, snapshot).find(p => p.id === this.targetId) ?? null;
  }
  cycle(player, snapshot, direction = 1) {
    const candidates = this.candidates(player, snapshot);
    if (!candidates.length) return;
    const index = Math.max(0, candidates.findIndex(p => p.id === this.targetId));
    this.targetId = candidates[(index + direction + candidates.length) % candidates.length].id;
  }
}
