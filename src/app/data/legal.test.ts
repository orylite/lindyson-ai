import { describe, expect, it } from 'vitest';
import { PUBLIC_COMPLIANCE } from './publicCompliance';
import { legalDocuments } from './legal';

describe('真人肖像与敏感人脸法律披露', () => {
  const privacySection = legalDocuments.policy.sections.find(
    section => section.title === '3. 真人肖像和敏感人脸信息',
  );
  const privacyText = privacySection?.paragraphs.join('\n') ?? '';
  const termsText = legalDocuments.terms.sections.flatMap(
    section => [...section.paragraphs, ...(section.bullets ?? [])],
  ).join('\n');

  it('隐私政策单独说明信息类型、目的、受托处理和单独同意', () => {
    expect(privacySection).toBeDefined();
    expect(privacyText).toContain('人脸识别相关信息属于敏感个人信息');
    expect(privacyText).toContain('Lindyson 不采集身份证、活体帧或人脸模板');
    expect(privacyText).toContain('敏感人脸信息单独同意');
    expect(privacyText).toContain('受托处理方的法人全称以该次授权页展示并保存的法律披露快照为准');
  });

  it('隐私政策覆盖商业渠道、必要编辑与禁止用途', () => {
    expect(privacyText).toContain('品牌官网、电商平台、TikTok、抖音、小红书、微信视频号');
    expect(privacyText).toContain('数字广告平台及线下展示渠道');
    expect(privacyText).toContain('剪辑、裁切、字幕、配音、画幅和版式调整');
    expect(privacyText).toContain('不得出售、转授权真人肖像');
    expect(privacyText).toContain('不得用于模型训练、身份冒用、虚假代言或其他违法违规用途');
  });

  it('明确区分 90 天到期和本人撤回后的历史视频规则', () => {
    expect(privacyText).toContain('授权自本人同意之日起最长 90 天');
    expect(privacyText).toContain('当前套餐的历史素材保留天数保存');
    expect(privacyText).toContain('系统内相关历史视频不再展示、下载或复用');
    expect(privacyText).toContain('不适用创建者的套餐保留期');
    expect(privacyText).toContain('撤回前已经合法发布到第三方渠道的内容不会自动召回');
    expect(privacyText).toContain('不得新增投放、转载、编辑或再次发布');
    expect(privacyText).toContain('合理投诉和下架请求提供协助');
  });

  it('服务条款同步约束创建者，不允许代同意或在撤回后继续使用', () => {
    expect(termsText).toContain('不得代替本人勾选同意');
    expect(termsText).toContain('您只能在本人授权的用途、渠道、编辑范围和期限内使用');
    expect(termsText).toContain('系统内相关历史视频将停止展示、下载和复用');
    expect(termsText).toContain('撤回生效后您不得新增投放、转载、编辑或再次发布');
  });

  it('公开法律文案仅写入已确认的隐私邮箱且不公开手机号', () => {
    const allText = `${privacyText}\n${termsText}`;
    expect(allText).not.toMatch(/1[3-9]\d{9}/);
    expect(allText).toContain(PUBLIC_COMPLIANCE.legal.privacyContactEmail);
  });
});
