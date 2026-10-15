/** 用户积分流水统一文案。内部错误原因继续保存在任务、订单、用量和审计记录中。 */
export const creditLedgerNotes = {
  generationHeld: '任务已提交，本次所需积分已暂时冻结。',
  generationRetryHeld: '任务已重新提交，本次所需积分已暂时冻结。',
  generationSucceeded: '视频生成成功，本次生成积分已扣除。',
  generationCanceledHoldReleased: '任务已取消，本次预扣已解除。',
  generationCanceledRefunded: '任务已取消，本次预扣积分已退回账户。',
  generationCanceledHoldReleasedWithExpiry: '任务已取消，本次预扣已解除；原批次中已过期的积分未恢复。',
  generationCanceledRefundedWithExpiry: '任务已取消，未过期的预扣积分已退回；已过期积分未重新计入账户。',
  generationFailedHoldReleased: '视频生成失败，本次预扣已解除。',
  generationFailedRefunded: '视频生成失败，本次预扣积分已退回账户。',
  generationFailedHoldReleasedWithExpiry: '视频生成失败，本次预扣已解除；原批次中已过期的积分未恢复。',
  generationFailedRefundedWithExpiry: '视频生成失败，未过期的预扣积分已退回；已过期积分未重新计入账户。',
  generationRecovered: '视频已恢复并保存至数字资产，本次生成积分已扣除。',
  orderRefundPending: '退款正在处理中，对应积分已暂时冻结。',
  orderRefundSucceeded: '订单退款成功，对应积分已扣回。',
  orderRefundFailedHoldReleased: '订单退款未成功，本次积分冻结已解除。',
  orderRefundFailedCreditsReturned: '订单退款未成功，对应积分已退回账户。',
  subscriptionExpired: '付费套餐已到期，账户已切换为免费版。',
  adminBootstrap: '账户初始化完成，套餐积分已到账。',
} as const;

export function orderPaymentCreditNote(planName: string) {
  return `购买“${planName}”成功，套餐积分已到账。`;
}

export function subscriptionResetCreditNote(planName: string) {
  return `新订阅周期已开始，“${planName}”套餐积分已重置。`;
}

export function adminCreditAdjustmentNote(amount: number) {
  return amount > 0 ? '账户积分已补发。' : '账户积分已由管理员调整。';
}

export function adminSubscriptionCreditAdjustmentNote(planName: string | null) {
  return planName
    ? `套餐已调整为“${planName}”，主套餐积分已同步。`
    : '账户已切换为免费版，主套餐积分已清零。';
}
