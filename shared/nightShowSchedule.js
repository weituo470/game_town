import { DAY_NIGHT_CYCLE_MS, NIGHT_START_MS, NIGHT_END_MS } from './dayNight.js';

// No provider calls, randomness or visitor-specific start times. Late arrivals
// sample the same score offset as everyone else; hidden tabs never queue shows.
export const NIGHT_SHOWS = Object.freeze([
  { id: 'avatar', title: '法天象地', start: 12_000, duration: 150_000 },
  { id: 'droplet', title: '水滴 · 末日之战', start: 170_000, duration: 150_000 },
  { id: 'carrier-battle', title: '空天母舰', start: 328_000, duration: 150_000 },
  { id: 'footsteps-of-light', title: '足迹 · 向光而行', start: 486_000, duration: 104_000 },
].map((show, index) => Object.freeze({ ...show, index, end: show.start + show.duration })));

export function sampleNightShow(value = 0) {
  const cycleTime = Number.isFinite(value) ? ((value % DAY_NIGHT_CYCLE_MS) + DAY_NIGHT_CYCLE_MS) % DAY_NIGHT_CYCLE_MS : 0;
  const nightTime = cycleTime - NIGHT_START_MS;
  const night = cycleTime >= NIGHT_START_MS && cycleTime < NIGHT_END_MS;
  const show = night ? NIGHT_SHOWS.find(item => nightTime >= item.start && nightTime < item.end) : null;
  const next = night ? NIGHT_SHOWS.find(item => item.start > nightTime) || NIGHT_SHOWS[0] : NIGHT_SHOWS[0];
  const nextStart = NIGHT_START_MS + next.start;
  const nextIn = (nextStart - cycleTime + DAY_NIGHT_CYCLE_MS) % DAY_NIGHT_CYCLE_MS;
  return { night, active: Boolean(show), show, next, nextIn, nightTime,
    elapsedMs: show ? nightTime - show.start : 0,
    remainingMs: show ? show.end - nightTime : 0,
    phase: show ? 'playing' : night ? nightTime < NIGHT_SHOWS.at(-1).end ? 'interval' : 'curtain' : 'day',
  };
}

export function createNightShowTimeRef(worldTimeRef, expectedShow) {
  return Object.freeze({ get current() {
    const state = sampleNightShow(worldTimeRef?.current);
    if (!expectedShow || state.show?.id === expectedShow.id) return state.elapsedMs;
    // A React boundary refresh may lag one frame: hold the old score at its
    // endpoint instead of briefly replaying its opening using the next clock.
    return state.nightTime >= expectedShow.end ? expectedShow.duration : 0;
  } });
}
