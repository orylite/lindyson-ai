import { describe,expect,it } from 'vitest';
import { createRegisteredAccountUser } from '../../test/factories/account';
import {
  normalizeEmail,
  validateRegisterPassword,
  validateRegisterUserName,
} from './auth';

describe('注册认证规则', () => {
  it('校验用户名长度和允许字符，用户名允许重复', async () => {
    expect(validateRegisterUserName('李 明_01-测试')).toBeNull();
    expect(validateRegisterUserName('A')).toBe('用户名需为 2-30 个字符');
    expect(validateRegisterUserName('   ')).toBe('用户名需为 2-30 个字符');
    expect(validateRegisterUserName('测试🙂')).toBe('用户名需为 2-30 个字符');
    expect(validateRegisterUserName('测试@账号')).toBe('用户名需为 2-30 个字符');
  });

  it('标准化邮箱', () => {
    expect(normalizeEmail(' PRO.USER@LINDYSON.AI ')).toBe('pro.user@lindyson.ai');
  });

  it('校验密码长度、字母数字组合和空格限制', () => {
    expect(validateRegisterPassword('abc12345')).toBeNull();
    expect(validateRegisterPassword('abc1234')).toBe('密码需为 8-32 位，并包含字母和数字');
    expect(validateRegisterPassword('abcdefgh')).toBe('密码需为 8-32 位，并包含字母和数字');
    expect(validateRegisterPassword('12345678')).toBe('密码需为 8-32 位，并包含字母和数字');
    expect(validateRegisterPassword('abc 1234')).toBe('密码需为 8-32 位，并包含字母和数字');
  });

  it('注册成功后创建与可订阅套餐无关的零积分免费账户', () => {
    const { account, user } = createRegisteredAccountUser({
      userName: ' 新用户 ',
      email: 'NEW.USER@LINDYSON.AI',
      now: new Date('2026-06-25T08:00:00+08:00'),
    });

    expect(account).toMatchObject({
      userName: '新用户',
      email: 'new.user@lindyson.ai',
      role: 'user',
      planCode: 'free',
      planName: '免费版',
      hasActiveSubscription: false,
      mainCredits: 0,
      addonCredits: 0,
      availableCredits: 0,
      totalCredits: 0,
      resetDate: '-',
      expiresAt: '-',
    });
    expect(user).toMatchObject({
      userName: '新用户',
      email: 'new.user@lindyson.ai',
      planName: '免费版',
      mainCredits: 0,
      addonCredits: 0,
      credits: 0,
      totalCredits: 0,
      planResetAt: null,
      status: 'active',
      orderCount: 0,
      apiCalls: 0,
      ticketCount: 0,
    });
  });
});
