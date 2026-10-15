import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/components/PortraitConsentPages.tsx'), 'utf8');

describe('真人授权公开页的逐项同意门槛', () => {
  it('把成年人、肖像、敏感人脸处理和商业用途拆成四个不可预选的独立确认项', () => {
    expect(source).toContain("useState({ adult: false, portrait: false, sensitive: false, commercial: false })");
    expect(source.match(/<ConsentCheck /g)).toHaveLength(4);
    expect(source).toContain('我已年满 18 周岁，并且正在为本人操作。');
    expect(source).toContain('处理并使用本人的肖像。');
    expect(source).toContain('处理敏感人脸信息。');
    expect(source).toContain('同意本次商业用途授权。');
  });

  it('全部勾选前不能提交同意，提交时只传递邀请 token 与同意结果', () => {
    expect(source).toContain('const allChecked = Object.values(checks).every(Boolean);');
    expect(source).toContain('disabled={!allChecked}');
    expect(source).toContain('onRespond(token, true)');
    expect(source).not.toMatch(/onRespond\([^)]*(BytedToken|groupId|asset:\/\/)/);
  });

  it('同意后必须把本人撤回入口明确交付给本人，而不是只静默写入会话存储', () => {
    expect(source).toContain('请立即保存你的授权管理链接');
    expect(source).toContain('复制撤回链接');
    expect(source).toContain('打开授权管理页');
    expect(source).toContain('setManageUrl(result.manageUrl)');
    expect(source).toContain("window.open(manageUrl, '_blank', 'noopener,noreferrer')");
  });

  it('H5 回跳使用不含凭证的完成页，并提示本人返回原授权页', () => {
    expect(source).toContain('export function PortraitVerificationCompletePage()');
    expect(source).toContain('官方 H5 已返回');
    expect(source).toContain('系统已通过火山方舟官方接口确认认证结果');
    expect(source).toContain('window.close()');
    expect(source).not.toMatch(/PortraitVerificationCompletePage[\s\S]*bytedToken/);
  });

  it('在同意前披露真实处理者、受托方、联系入口、处理范围和保留删除规则', () => {
    expect(source).toContain('invite.controllerName');
    expect(source).toContain('invite.processorName');
    expect(source).toContain('invite.privacyContact');
    expect(source).toContain('invite.processingScope');
    expect(source).toContain('invite.retentionRule');
    expect(source).toContain('href={invite.privacyPolicyUrl}');
  });

  it('同意前展示相对期限，避免把邀请创建时的临时日期误认为最终截止日', () => {
    expect(source).toContain("invite.status === 'pending' ? '授权期限' : '授权截止'");
    expect(source).toContain("invite.status === 'pending' ? '本人同意之日起 90 天'");
  });

  it('完整披露商业渠道、允许编辑与禁止用途', () => {
    expect(source).toContain('商业传播范围与限制');
    expect(source).toContain('品牌官网、电商平台、TikTok、抖音、小红书、微信视频号');
    expect(source).toContain('数字广告平台及线下展示渠道');
    expect(source).toContain('剪辑、裁切、字幕、配音、画幅和版式调整');
    expect(source).toContain('不得出售、转授权真人肖像');
    expect(source).toContain('不得用于模型训练、身份冒用、虚假代言或其他违法违规用途');
  });

  it('在管理页明确区分授权到期保留与本人撤回后的停止使用', () => {
    expect(source).toContain('系统内相关历史视频不再展示、下载或复用，不能继续使用套餐保留期');
    expect(source).toContain('撤回前已经合法发布到第三方渠道的内容不会自动召回');
    expect(source).toContain('撤回生效后不得新增投放、转载、编辑或再次发布');
    expect(source).toContain('平台将对合理的投诉和下架请求提供协助');
  });

  it('本人撤回使用站内警示对话框，失败时不静默关闭', () => {
    expect(source).not.toContain('window.confirm');
    expect(source).toContain('role="alertdialog"');
    expect(source).toContain('portrait-authorization-revoke-title');
    expect(source).toContain("setRevokeError(message)");
    expect(source).toContain("toast.error(message)");
  });
});
