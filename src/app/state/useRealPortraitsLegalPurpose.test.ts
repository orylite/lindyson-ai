import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/state/useRealPortraits.ts'), 'utf8');

describe('真人演员商业用途授权快照', () => {
  it('新邀请使用完整且受限的商业用途，并升级两份告知版本', () => {
    expect(source).toContain("real-portrait-portrait-notice-v2");
    expect(source).toContain("real-portrait-sensitive-face-notice-v2");
    expect(source).toContain('商品宣传、品牌营销、广告投放和商业展示');
    expect(source).toContain('品牌官网、电商平台、TikTok、抖音、小红书、微信视频号');
    expect(source).toContain('数字广告平台及线下展示渠道');
    expect(source).toContain('剪辑、裁切、字幕、配音、画幅和版式调整');
    expect(source).toContain('不得出售、转授权真人肖像');
    expect(source).toContain('不得用于模型训练、身份冒用、虚假代言或其他违法违规用途');
    expect(source).toContain('purpose: REAL_PORTRAIT_COMMERCIAL_PURPOSE');
  });
});
