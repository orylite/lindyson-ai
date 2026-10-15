import { describe,expect,it } from 'vitest';
import type { AdminGenerationJob,UserCreditLedgerEntry } from '../data/admin';
import { ACCOUNT_ORDER_PAGE_SIZE,getGenerationBillingSnapshot,getLedgerGenerationBillingSnapshot,hasGenerationTaskDetail,shouldLoadCurrentGenerationTask,shouldReplaceOrderHistoryWithLoading } from './AccountCenter';

describe('账户中心订单分页', () => {
  it('每页固定加载 20 条订单', () => {
    expect(ACCOUNT_ORDER_PAGE_SIZE).toBe(20);
  });

  it('翻页和刷新时保留已有订单，只有首次空数据加载才替换为 loading', () => {
    expect(shouldReplaceOrderHistoryWithLoading(true, 0)).toBe(true);
    expect(shouldReplaceOrderHistoryWithLoading(true, 20)).toBe(false);
    expect(shouldReplaceOrderHistoryWithLoading(false, 0)).toBe(false);
  });
});

describe('账户中心生成任务账单详情', () => {
  it('从当前用户任务详情汇总模型、规格、参考视频与积分结算', () => {
    const job = {
      model: 'Seedance 2.5',
      status: 'completed',
      creditStatus: 'settled',
      reservedCredits: 160,
      settledCredits: 150,
      refundedCredits: 10,
      configData: {
        durationSeconds: 30,
        resolution: '720p',
        referenceAssets: [{ type: 'video', role: 'reference_video' }],
      },
    } as unknown as AdminGenerationJob;

    expect(getGenerationBillingSnapshot(job)).toEqual({
      model: 'Seedance 2.5',
      duration: '30s',
      resolution: '720p',
      hasReferenceVideo: true,
      reservedCredits: 160,
      settledCredits: 150,
      refundedCredits: 10,
      status: '已完成',
      creditStatus: '已结算',
    });
  });

  it('只把 relatedJobId 当作生成任务详情入口，不混入订单退款', () => {
    const base = { id: 'ledger', time: '', type: 'refund', bucket: 'main', amount: 10, balance: 10, source: '', note: '' } as UserCreditLedgerEntry;
    expect(hasGenerationTaskDetail({ ...base, relatedOrderId: 'order-refund' })).toBe(false);
    expect(hasGenerationTaskDetail({ ...base, relatedJobId: 'generation-job' })).toBe(true);
  });

  it('旧退款流水只展示自身 attempt 快照，不受同 task 后续管理员重试影响', () => {
    const transaction = {
      id: 'ledger-refund-attempt-0',
      time: '2026-08-12 10:00',
      type: 'refund',
      bucket: 'main',
      amount: 122,
      balance: 500,
      source: '生成任务退回',
      note: '首次执行失败',
      relatedJobId: '11111111-1111-4111-8111-111111111111',
      generationSnapshot: {
        attempt: 0,
        model: 'Seedance 2.5',
        durationSeconds: 15,
        resolution: '720p',
        hasReferenceVideo: false,
        reservedCredits: 122,
        settledCredits: 0,
        refundedCredits: 122,
        taskStatus: 'failed',
        creditStatus: 'refunded',
      },
    } as UserCreditLedgerEntry;

    expect(getLedgerGenerationBillingSnapshot(transaction)).toEqual({
      attempt: 0,
      model: 'Seedance 2.5',
      duration: '15s',
      resolution: '720p',
      hasReferenceVideo: false,
      reservedCredits: 122,
      settledCredits: 0,
      refundedCredits: 122,
      status: '失败',
      creditStatus: '已退回',
      rawStatus: 'failed',
    });
    expect(hasGenerationTaskDetail({ ...transaction, relatedJobId: undefined })).toBe(true);
    expect(shouldLoadCurrentGenerationTask(transaction)).toBe(false);
    expect(shouldLoadCurrentGenerationTask({ ...transaction, generationSnapshot: undefined })).toBe(true);
  });
});
