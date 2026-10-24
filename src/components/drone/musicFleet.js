// A separate, larger local-music fleet. Legacy 4096-aircraft artwork, identities
// and multiplayer programme counts are deliberately not changed.
export const MUSIC_FLEET_COUNTS = Object.freeze({ high: 16384, low: 12288 });
export function musicFleetCount(quality) { return quality === 'low' ? MUSIC_FLEET_COUNTS.low : MUSIC_FLEET_COUNTS.high; }
export function createMusicFleet(count = MUSIC_FLEET_COUNTS.high) {
  if (!Number.isInteger(count) || count < 1 || count > MUSIC_FLEET_COUNTS.high) throw new RangeError('Invalid music fleet count');
  const fleet = { count, positions: new Float32Array(count * 3), colors: new Float32Array(count * 3), sizes: new Float32Array(count), bases: new Float32Array(count * 3), identities: new Uint16Array(count), pads: new Uint8Array(count) };
  const perPad = Math.ceil(count / 4), columns = Math.ceil(Math.sqrt(perPad));
  const pads = [[-26, 24], [26, 24], [-26, -24], [26, -24]];
  for (let i = 0; i < count; i++) {
    const pad = Math.min(3, Math.floor(i / perPad)), local = i % perPad;
    fleet.identities[i] = i; fleet.pads[i] = pad;
    fleet.bases[i * 3] = pads[pad][0] + (local % columns - (columns - 1) / 2) * .115;
    fleet.bases[i * 3 + 1] = .65;
    fleet.bases[i * 3 + 2] = pads[pad][1] + (Math.floor(local / columns) - (columns - 1) / 2) * .115;
  }
  fleet.positions.set(fleet.bases);
  return fleet;
}
