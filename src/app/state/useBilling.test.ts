import { QueryClient } from '@tanstack/react-query';
import { describe,expect,it } from 'vitest';
import { privateQueryKey } from '../api/queryClient';
import { cancelOrderHistoryQueries,invalidateCreditLedgerQueries } from './useBilling';

describe('订单历史请求取消', () => {
  it('切换筛选前会中止旧订单 Query 的网络信号', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let aborted = false;
    const pending = client.fetchQuery({
      queryKey: privateQueryKey(7, 'billing', 'orders', 'all', { position: 'first', limit: 20 }),
      queryFn: ({ signal }) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      }),
    }).catch(error => error);

    await Promise.resolve();
    await cancelOrderHistoryQueries(client, 7);
    await pending;

    expect(aborted).toBe(true);
  });
});

describe('积分流水惰性失效', () => {
  it('写操作只标记流水缓存过期，不立即请求未打开的列表', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = privateQueryKey(9, 'billing', 'ledger', 'all', { position: 'first', limit: 20 });
    let requests = 0;
    await client.fetchQuery({
      queryKey,
      queryFn: async () => {
        requests += 1;
        return { items: [], pagination: { limit: 20, hasPrevious: false, hasNext: false, previousCursor: null, nextCursor: null } };
      },
      staleTime: 60_000,
    });

    await invalidateCreditLedgerQueries(client, 9);

    expect(requests).toBe(1);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });
});
