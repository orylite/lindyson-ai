import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/domain/realPortraitService.ts'), 'utf8');

describe('真人授权法律披露快照', () => {
  it('处理范围包含获准渠道、必要编辑和明确禁止用途', () => {
    expect(source).toContain('REAL_PORTRAIT_PROCESSING_SCOPE');
    expect(source).toContain('品牌官网、电商平台、TikTok、抖音、小红书、微信视频号');
    expect(source).toContain('数字广告平台及线下展示渠道');
    expect(source).toContain('剪辑、裁切、字幕、配音、画幅和版式调整');
    expect(source).toContain('不得出售、转授权真人肖像');
    expect(source).toContain('不得用于模型训练、身份冒用、虚假代言或其他违法违规用途');
  });

  it('保留规则严格区分授权到期和本人撤回', () => {
    expect(source).toContain('授权自本人同意之日起最长 90 天');
    expect(source).toContain('当前套餐的历史素材保留天数保存');
    expect(source).toContain('系统内相关历史视频不再展示、下载或复用，不适用套餐保留期');
    expect(source).toContain('撤回前已经合法发布到第三方渠道的内容不会自动召回');
    expect(source).toContain('撤回生效后不得新增投放、转载、编辑或再次发布');
    expect(source).toContain('合理的投诉和下架请求提供协助');
  });

  it('法律主体与联系人只从环境配置写入每次授权快照', () => {
    expect(source).toContain('env.REAL_PORTRAIT_CONTROLLER_NAME');
    expect(source).toContain('env.REAL_PORTRAIT_PROCESSOR_NAME');
    expect(source).toContain('env.REAL_PORTRAIT_PRIVACY_CONTACT');
    // 任何具体公司名都不能写死在源码里，只能来自环境配置。
    expect(source).not.toMatch(/[\u4e00-\u9fa5]{2,}(?:科技|贸易)?有限公司/u);
  });
});
