import { describe,expect,it } from 'vitest';
import type { AdminPlan } from './admin';
import { getPlanIconGradientForPlan,isEnterprisePlan,resolvePlanIconKey } from './planIcons';

type PlanVisualInput = Pick<AdminPlan, 'kind' | 'code' | 'recommendation' | 'iconKey'> & Partial<Pick<AdminPlan, 'name' | 'nameEn'>>;

describe('套餐图标身份色', () => {
  it.each([
    [{ kind: 'main', code: 'free', recommendation: null, iconKey: 'zap' }, 'from-purple-600 to-blue-600'],
    [{ kind: 'main', code: 'basic', recommendation: null, iconKey: 'zap' }, 'from-purple-600 to-blue-600'],
    [{ kind: 'main', code: 'pro', recommendation: 'popular', iconKey: 'sparkles' }, 'from-purple-600 to-blue-600'],
    [{ kind: 'main', code: 'ultra', recommendation: null, iconKey: 'crown' }, 'from-purple-600 to-blue-600'],
    [{ kind: 'main', code: 'enterprise', recommendation: 'enterprise', iconKey: 'building-2' }, 'from-orange-500 to-red-600'],
    [{ kind: 'main', code: 'basic.ent', name: '企业基础版 Basic', recommendation: null, iconKey: 'gem' }, 'from-orange-500 to-red-600'],
    [{ kind: 'main', code: 'max.enterprise', name: '企业旗舰版 Max', recommendation: null, iconKey: 'rocket' }, 'from-orange-500 to-red-600'],
    [{ kind: 'addon', code: 'addon-30000', recommendation: null, iconKey: null }, 'from-orange-500 to-red-600'],
  ] satisfies Array<[PlanVisualInput, string]>)('为 %o 返回一致的背景色', (plan, expected) => {
    expect(getPlanIconGradientForPlan(plan)).toBe(expected);
  });

  it('非 Enterprise 主套餐即使选择楼宇图标也保持紫蓝色', () => {
    expect(getPlanIconGradientForPlan({
      kind: 'main',
      code: 'custom',
      recommendation: null,
      iconKey: 'building-2',
    })).toBe('from-purple-600 to-blue-600');
  });

  it('企业套餐优先使用后台设置的有效图标，缺失时才回退企业楼宇', () => {
    const enterprisePlan = {
      kind: 'main' as const,
      code: 'basic.ent',
      name: '企业基础版 Basic',
      nameEn: 'Enterprise Basic',
      recommendation: null,
    };

    expect(isEnterprisePlan(enterprisePlan)).toBe(true);
    expect(resolvePlanIconKey('rocket', enterprisePlan)).toBe('rocket');
    expect(resolvePlanIconKey(null, enterprisePlan)).toBe('building-2');
  });
});
