import { describe,expect,it,vi } from 'vitest';
import { claimBootstrapStart } from './bootstrapGate';

describe('受保护页面身份冷启动', () => {
  it('effect 重放或依赖变化时仍只调用一次 /me', async () => {
    const gate = { current: false };
    const getMe = vi.fn(async () => ({ email: 'user@example.com' }));
    const pending: Array<Promise<unknown>> = [];

    for (let index = 0; index < 3; index += 1) {
      if (claimBootstrapStart(gate)) pending.push(getMe());
    }
    await Promise.all(pending);

    expect(getMe).toHaveBeenCalledOnce();
  });
});
