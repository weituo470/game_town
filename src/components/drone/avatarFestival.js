import { createDroneFleet, updateDroneFleet } from '../../../shared/droneShow.js';
import { FESTIVAL_GLYPHS } from './avatarFestivalGlyphs.js';

export const AVATAR_FESTIVAL = Object.freeze({
  opening: 'moonstone 黑客松', closing: '1024 程序员节快乐',
  openingTime: 31000, closingTime: 136000, duration: 150000,
});
const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const seconds = ms => Number.isFinite(ms) ? ((ms % 180000) + 180000) % 180000 / 1000 : 0;
function lettering(indices) {
  const points = [];
  indices.forEach((glyphIndex, row) => {
    const g = FESTIVAL_GLYPHS[glyphIndex];
    for (const [x, y] of g.points) points.push([(x - g.width / 2) * .78, (row ? 63 : 88) - y * .78, -8, row]);
  });
  return points;
}
const OPEN = lettering([0, 1]), CLOSE = lettering([2, 3]);

/** Reuse the same aircraft, GPU buffers and identities; no extra light fleet.
 * The authored 40-second stunt and UFO laser climax remain untouched.
 * All transitions are pure functions of time, so seeking/export/night replay agree.
 */
export function createAvatarFestival(fleet) {
  const reference = createDroneFleet(fleet.count);
  updateDroneFleet(reference, 108000);
  const farewellOrigin = reference.positions.slice();
  const make = letters => {
    const positions = new Float32Array(fleet.count * 3), colors = new Float32Array(fleet.count * 3), sizes = new Float32Array(fleet.count);
    for (let i = 0; i < fleet.count; i++) {
      const k = i * 3, text = letters[i];
      if (text) {
        positions.set(text.slice(0, 3), k);
        colors.set(text[3] ? [2.1, 1.45, .55] : [.65, 1.8, 2.15], k);
        sizes[i] = .30;
      } else {
        // Sparse framing stars, never connected rings or glowing light tubes.
        const n = i - letters.length, a = n * 2.399963229728653;
        const radius = 1 + Math.floor(n / 96) * .035;
        positions.set([Math.cos(a) * 69 * radius, 68 + Math.sin(a) * 40 * radius, -12 - n % 11], k);
        colors.set([.36, .66, .85], k);
        sizes[i] = n < 192 ? .13 : 0;
      }
    }
    return { positions, colors, sizes, letterCount: letters.length };
  };
  const opening = make(OPEN), closing = make(CLOSE);
  return {
    opening, closing,
    update(ms) {
      const s = seconds(ms);
      const openingBlend = smooth((s - 24) / 5) * (1 - smooth((s - 36) / 8));
      const farewell = s >= 108 && s < 150;
      if (!openingBlend && !farewell) return false;
      const form = farewell ? closing : opening;
      const blend = farewell ? smooth((s - 108) / 7) : openingBlend;
      const landing = farewell ? smooth((s - 140) / 10) : 0;
      for (let i = 0; i < fleet.count; i++) {
        const k = i * 3;
        for (let a = 0; a < 3; a++) {
          const from = farewell ? farewellOrigin[k + a] : fleet.positions[k + a];
          const to = mix(form.positions[k + a], fleet.bases[k + a], landing);
          fleet.positions[k + a] = mix(from, to, blend);
          fleet.colors[k + a] = mix(fleet.colors[k + a], form.colors[k + a] * (1 - smooth((s - 148) / 2)), blend);
        }
        fleet.sizes[i] = mix(fleet.sizes[i], form.sizes[i], blend);
      }
      return true;
    },
  };
}

/** Front-on type, with a slow, continuous approach rather than a hard camera cut.
 * UFO retains its dedicated camera until the splash. Then the greeting takes over.
 */
export function avatarFestivalCamera(base, ms, aspect = 16 / 9, reducedMotion = false) {
  if (!base || reducedMotion) return base;
  const s = seconds(ms), a = Number.isFinite(aspect) ? Math.max(.25, aspect) : 16 / 9;
  const opening = smooth((s - 24) / 5) * (1 - smooth((s - 36) / 8));
  const closing = smooth((s - 129) / 5) * (1 - smooth((s - 140) / 10));
  const blend = Math.max(opening, closing);
  if (!blend) return base;
  const distance = Math.max(117, 160 / (2 * Math.tan(25 * Math.PI / 180) * a));
  const target = [a > 1 ? -13 : 0, 67, -8], position = [target[0], 67, distance - 8];
  return { ...base, position: base.position.map((v, i) => mix(v, position[i], blend)), target: base.target.map((v, i) => mix(v, target[i], blend)), far: Math.max(1800, base.far) };
}
