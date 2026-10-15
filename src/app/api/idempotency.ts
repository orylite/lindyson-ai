import { ApiError } from './client';

export function createIdempotencyKey(prefix: string) {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

/**
 * 后台写操作只在服务端已经给出明确结果时释放幂等键。
 * 网络中断、客户端超时和 5xx 都可能发生在服务端提交之后，必须保留原键重试。
 */
export class IdempotencyKeyRegistry {
  private readonly entries = new Map<string, {
    key: string;
    activeRequests: number;
    uncertainResult: boolean;
  }>();

  begin(intent: string, prefix: string) {
    let entry = this.entries.get(intent);
    if (!entry) {
      entry = {
        key: createIdempotencyKey(prefix),
        activeRequests: 0,
        uncertainResult: false,
      };
      this.entries.set(intent, entry);
    } else if (entry.activeRequests === 0) {
      // 这是上一次不确定结果后的显式重试；本轮结果重新决定是否继续保留。
      entry.uncertainResult = false;
    }
    entry.activeRequests += 1;
    return entry.key;
  }

  finish(intent: string, key: string, uncertainResult: boolean) {
    const entry = this.entries.get(intent);
    if (!entry || entry.key !== key) return;
    entry.activeRequests = Math.max(0, entry.activeRequests - 1);
    entry.uncertainResult ||= uncertainResult;
    if (entry.activeRequests === 0 && !entry.uncertainResult) this.entries.delete(intent);
  }

  clear() {
    this.entries.clear();
  }
}

export async function runIdempotentMutation<Result>(
  registry: IdempotencyKeyRegistry,
  intent: string,
  prefix: string,
  execute: (idempotencyKey: string) => Promise<Result>,
) {
  const idempotencyKey = registry.begin(intent, prefix);
  try {
    const result = await execute(idempotencyKey);
    registry.finish(intent, idempotencyKey, false);
    return result;
  } catch (error) {
    registry.finish(intent, idempotencyKey, !isExplicitClientError(error));
    throw error;
  }
}

function isExplicitClientError(error: unknown) {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}
