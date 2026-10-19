import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_DRONE_FEEDBACK_STEPS, aiDroneElapsedSeconds, aiDroneQuotaExhausted, aiDroneQuotaFeedback, aiDroneStageFeedback, aiDroneUnlimited, runAiDronePreparation } from '../src/lib/aiDroneFeedback.js';
import { createAiDroneClient, createAiDroneRequest } from '../src/lib/aiDroneClient.js';

test('elapsed feedback is real floored duration, never negative or non-finite', () => {
  assert.equal(aiDroneElapsedSeconds(100, 100), 0);
  assert.equal(aiDroneElapsedSeconds(100, 1099), 0);
  assert.equal(aiDroneElapsedSeconds(100, 1100), 1);
  assert.equal(aiDroneElapsedSeconds(100, 30123), 30);
  assert.equal(aiDroneElapsedSeconds(200, 100), 0);
  assert.equal(aiDroneElapsedSeconds(NaN, 100), 0);
  assert.equal(aiDroneElapsedSeconds(0, Infinity), 0);
});

test('steps follow received client stages rather than elapsed-time guesswork', () => {
  assert.equal(AI_DRONE_FEEDBACK_STEPS.length, 3);
  for (const [stage, stepIndex] of [['identity', 0], ['generating', 1], ['validating', 2], ['loading', -1]]) {
    const initial = aiDroneStageFeedback(stage, 0);
    const slow = aiDroneStageFeedback(stage, 55);
    assert.equal(initial.stepIndex, stepIndex);
    assert.equal(slow.stepIndex, stepIndex);
    assert.ok(initial.button.endsWith('…'));
    assert.ok(initial.title);
    assert.doesNotMatch(JSON.stringify(slow), /百分|\d+%/);
  }
  assert.equal(aiDroneStageFeedback(''), null);
  assert.equal(aiDroneStageFeedback('invented'), null);
});

test('waiting copy changes at 15/30 seconds without promising a made-up completion time', () => {
  assert.match(aiDroneStageFeedback('generating', 14).waiting, /只会提交一次/);
  assert.match(aiDroneStageFeedback('generating', 15).waiting, /不用重复点击/);
  assert.match(aiDroneStageFeedback('generating', 29).waiting, /取消等待/);
  assert.match(aiDroneStageFeedback('generating', 30).waiting, /最多等待 60 秒/);
  assert.match(aiDroneStageFeedback('generating', 55).waiting, /不会自动重试/);
  assert.match(aiDroneStageFeedback('identity', 31).waiting, /服务响应/);
  assert.equal(aiDroneStageFeedback('validating', 31).waiting, '');
  assert.match(aiDroneStageFeedback('loading', 31).description, /不会调用模型/);
});

test('unknown quota never says no model request during generation', () => {
  for (const stage of ['identity', 'generating', 'validating']) {
    assert.equal(aiDroneQuotaFeedback(null, stage), '本次完成后更新服务状态');
    assert.doesNotMatch(aiDroneQuotaFeedback(null, stage), /不调用模型/);
  }
  assert.match(aiDroneQuotaFeedback(null, ''), /尚未提交生成请求时/);
  assert.match(aiDroneQuotaFeedback({ remaining: 3, limit: 5 }, 'generating'), /今日剩余 3 \/ 5 次/);
});

test('unlimited service immediately replaces old exhausted quota and never shows a daily reset', () => {
  const stale = { limit: 5, used: 5, remaining: 0 };
  const service = { unlimited: true, limit: null };
  const fresh = { unlimited: true, limit: null, used: 108, remaining: null };
  for (const usage of [null, stale, fresh]) {
    assert.equal(aiDroneUnlimited(usage, service), true);
    assert.equal(aiDroneQuotaExhausted(usage, service), false);
    const message = aiDroneQuotaFeedback(usage, 'generating', service);
    assert.match(message, /不限制生成次数/);
    assert.doesNotMatch(message, /剩余|重置|00:00|null|108|扣次|额度/);
  }
  assert.equal(aiDroneUnlimited(fresh, null), true);
  assert.equal(aiDroneQuotaExhausted(fresh, null), false);
  assert.equal(aiDroneQuotaExhausted(stale, { unlimited: false, limit: 5 }), true);
  assert.equal(aiDroneQuotaExhausted({ ...stale, used: 4, remaining: 1 }, null), false);
});

test('confirmed finite service overrides old unlimited usage while unknown status falls back safely', () => {
  const oldUnlimited = { unlimited: true, limit: null, used: 108, remaining: null };
  const finite = { unlimited: false, limit: 5 };
  assert.equal(aiDroneUnlimited(oldUnlimited, finite), false);
  assert.equal(aiDroneQuotaExhausted(oldUnlimited, finite), true);
  assert.match(aiDroneQuotaFeedback(oldUnlimited, '', finite), /今日剩余 0 \/ 5 次/);
  assert.doesNotMatch(aiDroneQuotaFeedback(oldUnlimited, '', finite), /不限制|null/);
  assert.equal(aiDroneQuotaExhausted({ ...oldUnlimited, used: 2 }, finite), false);
  assert.match(aiDroneQuotaFeedback({ ...oldUnlimited, used: 2 }, '', finite), /今日剩余 3 \/ 5 次/);
  for (const unknown of [null, {}, { unlimited: false, limit: null }]) {
    assert.equal(aiDroneUnlimited(oldUnlimited, unknown), true);
    assert.match(aiDroneQuotaFeedback(oldUnlimited, '', unknown), /不限制生成次数/);
  }
  const oldFinite = { limit: 5, used: 5, remaining: 0 };
  assert.equal(aiDroneQuotaExhausted(oldFinite, { unlimited: true, limit: null }), false);
  assert.equal(aiDroneQuotaExhausted(oldFinite, { unlimited: false, limit: 10 }), false);
  assert.match(aiDroneQuotaFeedback(oldFinite, '', { unlimited: false, limit: 10 }), /今日剩余 5 \/ 10 次/);
});

test('wait and load feedback has no obsolete charge or quota language', () => {
  for (const stage of ['identity', 'generating', 'validating', 'loading']) {
    for (const elapsed of [0, 15, 30]) assert.doesNotMatch(JSON.stringify(aiDroneStageFeedback(stage, elapsed)), /额度|扣次|计入/);
  }
});

test('password-protected generation does not claim access validation completed before the response', () => {
  const waiting = aiDroneStageFeedback('generating', 15, { accessRequired: true });
  assert.match(waiting.title, /验证权限并编排/);
  assert.match(waiting.button, /验证并生成/);
  assert.match(waiting.description, /先验证测试密码，通过后才调用 AI/);
  assert.doesNotMatch(waiting.description, /已通过|已验证/);
  assert.match(aiDroneStageFeedback('generating', 15).description, /等待 DeepSeek/);
  assert.equal(aiDroneStageFeedback('loading', 0, { accessRequired: true }).stepIndex, -1);
});

test('mock transport keeps the visible step at AI compilation until an actual response arrives', async () => {
  const stored = new Map();
  const storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const updates = [];
  let releaseResponse;
  let notifyDispatched;
  const dispatched = new Promise(resolve => { notifyDispatched = resolve; });
  let paidCalls = 0;
  const client = createAiDroneClient({ storage, fetchImpl: async url => {
    if (url === '/api/guest') return Response.json({ token: 'mock-guest-token', expiresAt: Date.now() + 100000 });
    paidCalls++;
    notifyDispatched();
    return new Promise(resolve => { releaseResponse = resolve; });
  } });
  const request = createAiDroneRequest({ mode: 'prompt', prompt: '未来小镇' }, () => '00000000-0000-4000-8000-000000000001');
  const pending = client.generate(request, { onStage: stage => updates.push({ stage, ...aiDroneStageFeedback(stage, 0) }) });
  assert.equal(updates[0].stepIndex, 0);
  await dispatched;
  assert.equal(updates.at(-1).stepIndex, 1);
  assert.match(updates.at(-1).button, /正在编排/);
  assert.equal(aiDroneStageFeedback(updates.at(-1).stage, 50).stepIndex, 1);
  assert.equal(paidCalls, 1);
  releaseResponse(Response.json({
    show: { id: 'mock-show', mode: 'prompt', prompt: '未来小镇', provider: 'mock', model: 'mock', createdAt: Date.now(), score: { version: 1 } },
    usage: { limit: 5, used: 1, remaining: 4, resetAt: Date.now() + 100000 }, replayed: false,
  }));
  await pending;
  assert.deepEqual(updates.map(value => value.stepIndex), [0, 1, 2]);
  assert.equal(paidCalls, 1);
});

test('preview preparation resolves once and clears its deadline', async () => {
  let preparationSignal;
  assert.equal(await runAiDronePreparation(signal => { preparationSignal = signal; return 'ready'; }, { timeoutMs: 5 }), 'ready');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(preparationSignal.aborted, false);
});

test('cancel and timeout unlock a stalled import and prevent late runtime allocation', async () => {
  for (const reason of ['cancel', 'timeout']) {
    const controller = new AbortController();
    let finishImport;
    let runtimeCreated = false;
    const pending = runAiDronePreparation(async signal => {
      await new Promise(resolve => { finishImport = resolve; });
      if (!signal.aborted) runtimeCreated = true;
      return 'late';
    }, { signal: controller.signal, timeoutMs: reason === 'cancel' ? 10000 : 5 });
    await Promise.resolve();
    if (reason === 'cancel') controller.abort();
    await assert.rejects(pending, reason === 'cancel' ? { name: 'AbortError' } : { code: 'PREPARATION_TIMEOUT' });
    finishImport();
    await Promise.resolve();
    assert.equal(runtimeCreated, false);
  }
});

test('already-canceled preview never begins preparation', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(runAiDronePreparation(() => { called = true; }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(called, false);
});
