import { describe,expect,it } from 'vitest';
import { ApiError } from './client';
import { IdempotencyKeyRegistry,runIdempotentMutation } from './idempotency';

describe('后台写操作幂等键生命周期', () => {
  it.each([
    new ApiError('请求超时', 0, 'REQUEST_TIMEOUT'),
    new ApiError('服务暂不可用', 503, 'SERVICE_UNAVAILABLE'),
    new TypeError('network error'),
  ])('不确定结果后重试复用原键', async error => {
    const registry = new IdempotencyKeyRegistry();
    const keys: string[] = [];

    await expect(runIdempotentMutation(registry, 'invoice:1:issued', 'admin-invoice', async key => {
      keys.push(key);
      throw error;
    })).rejects.toBe(error);

    await expect(runIdempotentMutation(registry, 'invoice:1:issued', 'admin-invoice', async key => {
      keys.push(key);
      return 'replayed';
    })).resolves.toBe('replayed');

    expect(keys[1]).toBe(keys[0]);
  });

  it('成功或明确 4xx 后为下一次用户意图签发新键', async () => {
    const registry = new IdempotencyKeyRegistry();
    const keys: string[] = [];
    const execute = async (key: string) => {
      keys.push(key);
      return true;
    };

    await runIdempotentMutation(registry, 'announcement:create', 'admin-announcement', execute);
    await runIdempotentMutation(registry, 'announcement:create', 'admin-announcement', execute);
    expect(keys[1]).not.toBe(keys[0]);

    await expect(runIdempotentMutation(registry, 'invoice:2:issued', 'admin-invoice', async key => {
      keys.push(key);
      throw new ApiError('请求冲突', 409, 'IDEMPOTENCY_CONFLICT');
    })).rejects.toMatchObject({ status: 409 });
    await runIdempotentMutation(registry, 'invoice:2:issued', 'admin-invoice', execute);
    expect(keys[3]).not.toBe(keys[2]);
  });

  it('并发提交同一意图使用同一个键，清理会话后不再复用', async () => {
    const registry = new IdempotencyKeyRegistry();
    const keys: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });

    const first = runIdempotentMutation(registry, 'ticket:1:reply', 'admin-ticket-reply', async key => {
      keys.push(key);
      await firstGate;
      return true;
    });
    const second = runIdempotentMutation(registry, 'ticket:1:reply', 'admin-ticket-reply', async key => {
      keys.push(key);
      return true;
    });

    await second;
    expect(keys[1]).toBe(keys[0]);
    registry.clear();
    releaseFirst();
    await first;

    await runIdempotentMutation(registry, 'ticket:1:reply', 'admin-ticket-reply', async key => {
      keys.push(key);
      return true;
    });
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('并发请求中存在不确定结果时保留原键', async () => {
    const registry = new IdempotencyKeyRegistry();
    const keys: string[] = [];
    let rejectFirst!: () => void;
    const firstGate = new Promise<void>((_resolve, reject) => {
      rejectFirst = () => reject(new ApiError('服务暂不可用', 503));
    });

    const first = runIdempotentMutation(registry, 'job:1:retry', 'admin-job-retry', async key => {
      keys.push(key);
      await firstGate;
      return true;
    });
    await runIdempotentMutation(registry, 'job:1:retry', 'admin-job-retry', async key => {
      keys.push(key);
      return true;
    });
    rejectFirst();
    await expect(first).rejects.toMatchObject({ status: 503 });

    await runIdempotentMutation(registry, 'job:1:retry', 'admin-job-retry', async key => {
      keys.push(key);
      return true;
    });
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
  });
});
