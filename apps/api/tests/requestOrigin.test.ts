import { describe, expect, it } from 'vitest';
import { resolveTrustedAppOrigin } from '../src/config/requestOrigin.js';

const configuration = {
  CORS_ORIGIN: [
    'https://lindyson.com',
    'https://www.lindyson.com',
    'https://lindyson.cn',
    'https://www.lindyson.cn',
  ].join(','),
  APP_BASE_URL: 'https://www.lindyson.com',
};

describe('可信请求应用来源', () => {
  it.each([
    'https://lindyson.com',
    'https://www.lindyson.com',
    'https://lindyson.cn',
    'https://www.lindyson.cn',
  ])('只要来源在 CORS 白名单内就原样使用：%s', origin => {
    expect(resolveTrustedAppOrigin(origin, configuration)).toBe(origin);
  });

  it.each([
    undefined,
    'null',
    'https://www.lindyson.cn.evil.example',
    'https://www.lindyson.cn/path',
    'not-an-origin',
  ])('缺失或不可信来源回退 APP_BASE_URL：%s', origin => {
    expect(resolveTrustedAppOrigin(origin, configuration)).toBe('https://www.lindyson.com');
  });

  it('CORS 通配符不把任意 Origin 提升为密码或支付返回来源', () => {
    expect(resolveTrustedAppOrigin('https://evil.example', {
      CORS_ORIGIN: '*',
      APP_BASE_URL: 'https://www.lindyson.com/app',
    })).toBe('https://www.lindyson.com');
  });
});
