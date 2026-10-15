import { describe, expect, it } from 'vitest';
import { trustProxySetting } from '../src/config/env.js';

describe('TRUST_PROXY 解析', () => {
  it('布尔写法保持原语义', () => {
    expect(trustProxySetting.parse('false')).toBe(false);
    expect(trustProxySetting.parse('')).toBe(false);
    expect(trustProxySetting.parse('true')).toBe(true);
  });

  it('正整数表示信任最近 N 跳，1 也按跳数处理', () => {
    expect(trustProxySetting.parse('1')).toBe(1);
    expect(trustProxySetting.parse('2')).toBe(2);
  });

  it('逗号分隔的地址或 CIDR 解析为列表并去空白', () => {
    expect(trustProxySetting.parse('127.0.0.1, ::1 ,10.0.0.0/8')).toEqual(['127.0.0.1', '::1', '10.0.0.0/8']);
  });

  it('非字符串输入原样交给 schema 校验', () => {
    expect(trustProxySetting.parse(true)).toBe(true);
    expect(() => trustProxySetting.parse(0)).toThrow();
    expect(() => trustProxySetting.parse([])).toThrow();
  });
});
