// Version 8 adds the shared offshore vessel and authoritative passenger seats.
// Older loaded clients must refresh instead of using an incompatible schema.
export const PROTOCOL_VERSION = 8;
export const TOWN_ROOM_TYPE = 'town';
export const MAX_PLAYERS = 8;
export const SERVER_TICK_MS = 50;
export const STATE_PATCH_MS = 100;
export const RECONNECT_SECONDS = 15;
export const INPUT_TIMEOUT_MS = 300;
export const MESSAGE = Object.freeze({ INPUT: 'input', TRAVEL: 'travel', OFFSHORE: 'offshore', NOTICE: 'notice' });
export const PLAYER_COLORS = ['#e67d5b', '#59918d', '#9d86be', '#d4a34f', '#768abc', '#bb788c', '#9da55a', '#b78c6c'];
