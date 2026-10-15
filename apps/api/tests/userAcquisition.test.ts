import { describe, expect, it } from 'vitest';
import { resolveRegistrationAcquisition } from '../src/domain/userAcquisition.js';

describe('注册来源归类', () => {
  it('识别推广参数别名，并保留原始值', () => {
    expect(resolveRegistrationAcquisition({ source: 'xhs', medium: 'post' }, false)).toMatchObject({
      source: 'xiaohongshu', rawSource: 'xhs', medium: 'post',
    });
    expect(resolveRegistrationAcquisition({ source: 'xiaohongshu' }, false)).toMatchObject({ source: 'xiaohongshu', rawSource: null });
  });

  it('白名单外的来源归 other 并保留原值', () => {
    expect(resolveRegistrationAcquisition({ source: 'some-forum' }, false)).toMatchObject({ source: 'other', rawSource: 'some-forum' });
  });

  it('没有推广参数时按邀约码决定 referral 或 direct', () => {
    expect(resolveRegistrationAcquisition(undefined, true)).toMatchObject({ source: 'referral', rawSource: null });
    expect(resolveRegistrationAcquisition(undefined, false)).toMatchObject({ source: 'direct' });
    expect(resolveRegistrationAcquisition({ source: 'direct', landingPath: '/' }, true)).toMatchObject({ source: 'referral', landingPath: '/' });
  });

  it('推广参数与邀约码同时存在时以推广参数为准', () => {
    expect(resolveRegistrationAcquisition({ source: 'douyin' }, true)).toMatchObject({ source: 'douyin' });
  });
});
