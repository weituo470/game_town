import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcDailyLimiter } from '../server/npcUsageLimits.js';

test('NPC daily usage defaults to 500 and malformed values cannot disable it', () => {
  for (const configuredLimit of [undefined, '', ' ', '-1', 'false', 'Infinity', '0x0', '0.0', '1e3', 'NaN', {}, '9007199254740992']) {
    const limiter = createNpcDailyLimiter({ configuredLimit });
    for (let i = 0; i < 500; i++) assert.equal(limiter.take('npc'), true);
    assert.equal(limiter.take('npc'), false, String(configuredLimit));
    limiter.clear();
    assert.equal(limiter.take('npc'), true);
  }
});

test('NPC daily usage accepts a positive cap and resets after 24 hours', () => {
  let now = 0;
  const limiter = createNpcDailyLimiter({ configuredLimit: '2', now: () => now });
  assert.equal(limiter.take('npc'), true);
  assert.equal(limiter.take('npc'), true);
  assert.equal(limiter.take('npc'), false);
  now = 24 * 60 * 60 * 1000;
  assert.equal(limiter.take('npc'), true);
});

test('only explicit zero removes the NPC daily total cap', () => {
  for (const configuredLimit of [0, '0', ' 0 ']) {
    const limiter = createNpcDailyLimiter({ configuredLimit });
    for (let i = 0; i < 10000; i++) assert.equal(limiter.take('npc'), true);
    limiter.clear();
    assert.equal(limiter.take('npc'), true);
  }
});
