import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { AI_DRONE_ACCESS_LIMITS, createAiDroneAccess, createAiDroneAccessHash, isAiDroneAccessHash, verifyAiDroneAccessPassword } from '../server/aiDroneAccess.js';

const password = 'local-only-test-code';
const salt = '0123456789abcdef0123456789abcdef';
const hash = `scrypt1$${salt}$${scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')}`;

test('access provisioning uses fixed ASCII-hex salt scrypt format and verifies original non-trimmed passwords', async () => {
  assert.equal(await verifyAiDroneAccessPassword(password, hash), true);
  assert.equal(await verifyAiDroneAccessPassword(password + ' ', hash), false);
  assert.equal(await verifyAiDroneAccessPassword(password.toUpperCase(), hash), false);
  const created = await createAiDroneAccessHash('  test-only 空格  ');
  assert.equal(isAiDroneAccessHash(created), true);
  assert.equal(await verifyAiDroneAccessPassword('  test-only 空格  ', created), true);
  assert.equal(await verifyAiDroneAccessPassword('test-only 空格', created), false);
  assert.notEqual(await createAiDroneAccessHash(password), hash);
  for (const invalid of [undefined, null, {}, [], 123, '', 'x'.repeat(129)]) {
    assert.equal(await verifyAiDroneAccessPassword(invalid, hash), false);
    await assert.rejects(createAiDroneAccessHash(invalid), TypeError);
  }
  const longest = 'x'.repeat(128), boundary = await createAiDroneAccessHash(longest);
  assert.equal(await verifyAiDroneAccessPassword(longest, boundary), true);
});

test('malformed or missing digests fail closed without reflected secret data', async () => {
  for (const passwordHash of [undefined, null, {}, '', password, hash + '\n', hash.toUpperCase(), hash.replace('scrypt1', 'scrypt2'), hash.slice(0, -1)]) {
    assert.equal(isAiDroneAccessHash(passwordHash), false);
    assert.equal(await verifyAiDroneAccessPassword(password, passwordHash), false);
    const access = createAiDroneAccess({ required: true, passwordHash });
    assert.equal(access.configured, false);
    await assert.rejects(access.verify({ password, ip: 'test-net' }), { status: 503, code: 'AI_DRONE_DISABLED' });
    access.close();
  }
  const optional = createAiDroneAccess();
  assert.equal(optional.required, false); assert.equal(optional.configured, true);
  await optional.verify({}); optional.close();
});

test('missing and wrong values consume only bounded verification attempts; the sliding lock expires', async () => {
  let time = 100_000;
  const access = createAiDroneAccess({ required: true, passwordHash: hash, now: () => time });
  try {
    for (const wrong of [undefined, {}, '', 'x'.repeat(129), 'wrong-test-code']) {
      await assert.rejects(access.verify({ password: wrong, ip: 'test-net' }), error => error.status === 403 && error.code === 'AI_DRONE_ACCESS_DENIED' && error.message === '开发中，请输入正确测试密码');
    }
    await assert.rejects(access.verify({ password, ip: 'test-net' }), { status: 429, code: 'AI_DRONE_ACCESS_RATE_LIMIT' });
    time += 59_999;
    await assert.rejects(access.verify({ password, ip: 'test-net' }), { code: 'AI_DRONE_ACCESS_RATE_LIMIT' });
    time++;
    await access.verify({ password, ip: 'test-net' });
    await access.verify({ password, ip: 'other-test-net' });
  } finally { access.close(); }
});

test('two asynchronous derivations maximum and in-flight attempts cannot bypass the five-attempt budget', async () => {
  const access = createAiDroneAccess({ required: true, passwordHash: hash });
  try {
    const a = access.verify({ password, ip: 'net-a' });
    const b = access.verify({ password, ip: 'net-b' });
    await assert.rejects(access.verify({ password, ip: 'net-c' }), { status: 503, code: 'AI_DRONE_ACCESS_BUSY' });
    await Promise.all([a, b]);
    await access.verify({ password, ip: 'net-c' });
    for (let i = 0; i < 4; i++) await assert.rejects(access.verify({ ip: 'locked-net' }), { code: 'AI_DRONE_ACCESS_DENIED' });
    const pending = assert.rejects(access.verify({ password: 'wrong-test-code', ip: 'locked-net' }), { code: 'AI_DRONE_ACCESS_DENIED' });
    await assert.rejects(access.verify({ password, ip: 'locked-net' }), { code: 'AI_DRONE_ACCESS_RATE_LIMIT' });
    await pending;
  } finally { access.close(); }
});

test('the TTL map has a fixed capacity, releases expired entries and close rejects late verification', async () => {
  let time = 100_000;
  const access = createAiDroneAccess({ required: true, passwordHash: hash, now: () => time });
  for (let i = 0; i < AI_DRONE_ACCESS_LIMITS.trackedIps; i++) await assert.rejects(access.verify({ ip: `test-net-${i}` }), { code: 'AI_DRONE_ACCESS_DENIED' });
  await assert.rejects(access.verify({ ip: 'overflow-net' }), { code: 'AI_DRONE_ACCESS_BUSY' });
  time += AI_DRONE_ACCESS_LIMITS.windowMs;
  await access.verify({ password, ip: 'overflow-net' });
  const pending = assert.rejects(access.verify({ password, ip: 'pending-net' }), { code: 'AI_DRONE_ACCESS_BUSY' });
  access.close(); await pending;
  await assert.rejects(access.verify({ password, ip: 'after-close-net' }), { code: 'AI_DRONE_ACCESS_BUSY' });
});
