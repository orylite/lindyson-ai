import { describe,expect,it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobDetail } from '../components/AdminPageShared';
import { generationJobDisplayStatus } from '../../data/generationJobState';
import type { AdminGenerationJob } from '../../data/admin';
import { canManuallyRefundGenerationJob,getGenerationRefundConfirmation,isUncertainGenerationSubmission } from './JobsPage';

describe('后台生成任务人工退回入口', () => {
  it('保留失败或取消且积分冻结的既有入口', () => {
    expect(canManuallyRefundGenerationJob(job({ status: 'failed', creditStatus: 'held', assetId: 'asset-existing' }))).toBe(true);
    expect(canManuallyRefundGenerationJob(job({ status: 'canceled', creditStatus: 'held' }))).toBe(true);
    expect(canManuallyRefundGenerationJob(job({ status: 'failed', creditStatus: 'refunded' }))).toBe(false);
  });

  it.each(['submission-unknown', 'manual-review'])('允许 %s 阶段的无结果冻结任务人工退回', processingStage => {
    const candidate = job({ status: 'processing', processingStage, creditStatus: 'held' });
    expect(isUncertainGenerationSubmission(candidate)).toBe(true);
    expect(canManuallyRefundGenerationJob(candidate)).toBe(true);
  });

  it('存在资产、供应商结果或不满足冻结条件时禁用高风险退回', () => {
    expect(canManuallyRefundGenerationJob(job({
      status: 'processing',
      processingStage: 'submission-unknown',
      creditStatus: 'held',
      assetId: 'asset-result',
    }))).toBe(false);
    expect(canManuallyRefundGenerationJob({
      ...job({ status: 'processing', processingStage: 'manual-review', creditStatus: 'held' }),
      providerResultAvailable: true,
    } as AdminGenerationJob & { providerResultAvailable: boolean })).toBe(false);
    expect(canManuallyRefundGenerationJob(job({
      status: 'processing',
      processingStage: 'submission-unknown',
      creditStatus: 'settled',
    }))).toBe(false);
    expect(canManuallyRefundGenerationJob(job({
      status: 'processing',
      processingStage: 'provider-running',
      creditStatus: 'held',
    }))).toBe(false);
  });
});

describe('后台高风险退回确认', () => {
  it('明确要求先核验供应商账单，并区分站内积分与上游计费', () => {
    const confirmation = getGenerationRefundConfirmation(job({
      status: 'processing',
      processingStage: 'submission-unknown',
      creditStatus: 'held',
    }));

    expect(confirmation.title).toContain('高风险');
    expect(confirmation.description).toContain('供应商可能已经计费');
    expect(confirmation.description).toContain('人工核验供应商账单');
    expect(confirmation.description).toContain('只退回站内积分');
    expect(confirmation.description).toContain('不代表上游未计费');
  });

  it('终态冻结任务继续使用既有确认说明', () => {
    const confirmation = getGenerationRefundConfirmation(job({ status: 'failed', creditStatus: 'held' }));
    expect(confirmation.title).toBe('确认退回积分？');
    expect(confirmation.description).toContain('任务已失败或取消且积分仍冻结');
  });
});

function job(patch: Partial<AdminGenerationJob>): AdminGenerationJob {
  return {
    id: 'job-1',
    time: '2026-07-27 15:00',
    userName: '测试用户',
    email: 'test@example.com',
    kind: 'image',
    model: 'Seedream 5.0 Pro',
    status: 'processing',
    duration: '-',
    credits: 28,
    reservedCredits: 28,
    settledCredits: 0,
    refundedCredits: 0,
    creditStatus: 'held',
    mainCreditsUsed: 28,
    addonCreditsUsed: 0,
    prompt: '',
    config: '',
    retryCount: 0,
    ...patch,
  };
}


describe('后台生成任务异常状态', () => {
  it.each(['submission-unknown', 'manual-review'])('详情明确展示 %s 并保留诊断信息', processingStage => {
    const candidate = job({ processingStage, settlementError: 'fetch failed' });
    expect(generationJobDisplayStatus(candidate)).toBe(processingStage);
    const html = renderToStaticMarkup(createElement(JobDetail, { job: candidate }));
    expect(html).toContain('核验');
    expect(html).toContain('处理异常');
    expect(html).toContain('fetch failed');
    expect(html).not.toContain('生成中');
  });

  it.each(['completed', 'failed', 'canceled'] as const)('终态 %s 不被残留处理阶段覆盖', status => {
    expect(generationJobDisplayStatus(job({ status, processingStage: 'submission-unknown' }))).toBe(status);
  });

  it('正常供应商执行仍显示生成中', () => {
    expect(generationJobDisplayStatus(job({ processingStage: 'provider-running' }))).toBe('processing');
  });
});
