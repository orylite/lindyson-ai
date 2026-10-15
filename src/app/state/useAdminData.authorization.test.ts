import { describe, expect, it } from 'vitest';
import { isAdminDataEnabled } from './useAdminData';

describe('useAdminData 权限加载门', () => {
  it('只有已登录管理员位于后台路由时才允许查询后台数据', () => {
    expect(isAdminDataEnabled('/admin', 'admin@example.com', 'admin')).toBe(true);
    expect(isAdminDataEnabled('/admin/orders', 'admin@example.com', 'admin')).toBe(true);
    expect(isAdminDataEnabled('/admin', 'user@example.com', 'user')).toBe(false);
    expect(isAdminDataEnabled('/admin/orders', 'user@example.com', 'user')).toBe(false);
    expect(isAdminDataEnabled('/app', 'admin@example.com', 'admin')).toBe(false);
    expect(isAdminDataEnabled('/admin', '', 'admin')).toBe(false);
  });
});
