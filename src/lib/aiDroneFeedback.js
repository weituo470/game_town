export const AI_DRONE_FEEDBACK_STEPS = Object.freeze(['连接身份', 'AI 编排', '准备舞台']);

const STAGES = Object.freeze({
  identity: { title: '正在连接游客身份', button: '正在连接身份…', description: '先确认游客身份，再提交这一次创作请求。', stepIndex: 0 },
  generating: { title: 'AI 正在编排这场演出', button: '正在编排演出…', description: '正在等待 DeepSeek 返回章节、灯光与变阵方案。', stepIndex: 1 },
  validating: { title: '正在准备演出舞台', button: '正在准备舞台…', description: '已收到节目，正在校验编排并准备可播放的预览。', stepIndex: 2 },
  loading: { title: '正在载入本机节目', button: '正在载入节目…', description: '只读取已保存的节目，不会调用模型。', stepIndex: -1 },
});

export function aiDroneElapsedSeconds(startedAt, now) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function aiDroneStageFeedback(stage, elapsedSeconds = 0, { accessRequired = false } = {}) {
  const current = STAGES[stage];
  if (!current) return null;
  const access = stage === 'generating' && accessRequired ? {
    title: '正在验证权限并编排演出', button: '正在验证并生成…',
    description: '服务会先验证测试密码，通过后才调用 AI 编排。此处不会提前确认验证成功。',
  } : null;
  let waiting = '';
  if (stage === 'identity' || stage === 'generating') {
    waiting = elapsedSeconds >= 30
      ? '这次等待稍久，仍在等服务响应。整次生成最多等待 60 秒；超时会明确提示，不会自动重试。'
      : elapsedSeconds >= 15
        ? '编排通常需要数十秒，不用重复点击。你可以随时取消等待，不会自动重试。'
        : '请求只会提交一次。节目准备好后会出现「立即观看」，不会自动开始播放。';
  }
  return { ...current, ...access, waiting };
}

export function aiDroneUnlimited(usage, service) {
  if (service?.unlimited === true) return true;
  if (service?.unlimited === false && Number.isInteger(service.limit) && service.limit > 0) return false;
  return usage?.unlimited === true;
}

function finiteQuota(usage, service) {
  if (!usage) return null;
  const limit = service?.unlimited === false && Number.isInteger(service.limit) && service.limit > 0 ? service.limit : usage.limit;
  if (!Number.isInteger(limit) || limit < 1) return null;
  return { limit, remaining: Number.isSafeInteger(usage.used) ? Math.max(0, limit - usage.used) : usage.remaining };
}

export function aiDroneQuotaExhausted(usage, service) {
  return !aiDroneUnlimited(usage, service) && finiteQuota(usage, service)?.remaining === 0;
}

export function aiDroneQuotaFeedback(usage, stage, service) {
  if (aiDroneUnlimited(usage, service)) return '不限制生成次数 · 请勿连续快速点击';
  const quota = finiteQuota(usage, service);
  if (quota) return `今日剩余 ${quota.remaining} / ${quota.limit} 次 · 北京时间 00:00 重置`;
  return stage && stage !== 'loading' ? '本次完成后更新服务状态' : '尚未提交生成请求时，不调用模型';
}

const canceledPreparation = () => Object.assign(new Error('已取消节目预览准备。'), { name: 'AbortError' });

// Imports cannot be aborted, but their late result must never create a runtime or
// keep the UI locked. The callback checks this signal after its import resolves.
export async function runAiDronePreparation(prepare, { signal, timeoutMs = 10000 } = {}) {
  if (signal?.aborted) throw canceledPreparation();
  const operation = new AbortController();
  let rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const abort = () => { operation.abort(); rejectStopped(canceledPreparation()); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    operation.abort();
    rejectStopped(Object.assign(new Error('节目预览准备超时。没有再次调用 AI；如有上一份节目仍可观看。'), { name: 'AiDronePreparationError', code: 'PREPARATION_TIMEOUT' }));
  }, Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : 10000));
  try {
    return await Promise.race([Promise.resolve().then(() => prepare(operation.signal)), stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
