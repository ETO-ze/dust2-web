// Freeze locks combat. The short result period permits surviving players to
// fight and recover equipment; the completed match remains locked.
export const combatPhase=phase=>phase==='live'||phase==='ended';
export const equipmentPhase=phase=>combatPhase(phase)||phase==='freeze';
