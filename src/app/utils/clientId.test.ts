import { describe,expect,it } from 'vitest';
import { createClientId } from './clientId';

describe('客户端临时 ID', () => {
  it('保留业务前缀并生成不同标识', () => {
    const first = createClientId('plan');
    const second = createClientId('plan');
    expect(first).toMatch(/^plan-/);
    expect(second).toMatch(/^plan-/);
    expect(second).not.toBe(first);
  });
});
