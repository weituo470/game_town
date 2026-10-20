export class ArchitectError extends Error {
  constructor(status, code, message) { super(message); this.name = 'ArchitectError'; this.status = status; this.code = code; }
}
export const architectError = (status, code, message) => new ArchitectError(status, code, message);
export const ARCHITECT_FAILURES = Object.freeze({
  ARCHITECT_UPSTREAM: { status: 502, message: '建筑师暂未完成设计，本次不会自动重试。' },
  ARCHITECT_TIMEOUT: { status: 504, message: '建筑师设计超过时限，本次不会自动重试。' },
  ARCHITECT_INVALID_PLAN: { status: 502, message: '建筑方案未通过安全校验，未进行建设；本次不会自动重试。' },
  ARCHITECT_INTERRUPTED: { status: 503, message: '本次工程因服务中断而停止，不会重复调用模型。' },
  ARCHITECT_STORAGE: { status: 503, message: '工程记录暂时不可用，未进行建设。' },
});
