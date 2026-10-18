// React effects (including cleanup), blur and navigation can send a stop before
// the first R3F frame reconciles a recovered player. Allocate sequence numbers
// from the latest matching authoritative snapshot at the send boundary itself.
export function sequencedInput(input, previousSequence, snapshot, selfId) {
  if (typeof selfId !== 'string' || !selfId || snapshot?.selfId !== selfId || !Array.isArray(snapshot.players)) return null;
  const self = snapshot.players.find(player => player.id === selfId);
  if (!self || self.connected === false || !Number.isSafeInteger(self.seq) || self.seq < -1) return null;
  if (!Number.isFinite(input?.x) || !Number.isFinite(input?.z) || Math.abs(input.x) > 1 || Math.abs(input.z) > 1) return null;
  const localSequence = Number.isSafeInteger(previousSequence) ? previousSequence : 0;
  const seq = Math.max(0, localSequence, self.seq) + 1;
  if ((input.jump !== undefined && typeof input.jump !== 'boolean') || (input.stop !== undefined && typeof input.stop !== 'boolean')) return null;
  if (input.thrust !== undefined && typeof input.thrust !== 'boolean') return null;
  if (input.hover !== undefined && typeof input.hover !== 'boolean') return null;
  if (input.jump && input.thrust) return null;
  if (input.hover && (input.jump || input.thrust)) return null;
  if (input.stop && (input.x !== 0 || input.z !== 0 || input.jump || input.thrust || input.hover)) return null;
  return Number.isSafeInteger(seq) ? { x: input.x, z: input.z, seq,
    ...(typeof input.thrust === 'boolean' ? { thrust: input.thrust } : {}),
    ...(typeof input.hover === 'boolean' ? { hover: input.hover } : {}),
    ...(input.jump === true ? { jump: true } : {}), ...(input.stop === true ? { stop: true } : {}) } : null;
}
