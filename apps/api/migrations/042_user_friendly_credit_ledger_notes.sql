-- 只统一用户可见的积分流水备注；金额、余额、类型、来源、状态和关联字段保持不变。

UPDATE credit_ledger
SET note = '视频生成成功，本次生成积分已扣除。'
WHERE type = 'spend'
  AND source LIKE 'Seedance % 生成消耗'
  AND note = '任务生成成功，预扣积分转为正式消耗。';

UPDATE credit_ledger
SET note = '任务已取消，本次预扣积分已退回账户。'
WHERE type = 'refund'
  AND source = '生成任务退回'
  AND note = '用户取消任务，系统自动退回预扣积分。';

-- 旧流水没有可靠字段区分“失败”与“取消”，统一使用准确的中性结果。
UPDATE credit_ledger
SET note = '任务未完成，本次预扣积分已退回。'
WHERE type = 'hold'
  AND settlement_status = 'refunded'
  AND note = '任务失败或取消，预扣积分已退回。';

UPDATE credit_ledger
SET note = '视频生成失败，本次预扣积分已退回账户。'
WHERE type = 'refund'
  AND source = '生成任务退回'
  AND note IN (
    'Unable to calculate hash for flowing readable stream',
    'The parameter `content` specified in the request is not valid: role must be specified for image contents. Request id: 0217829038681368e2cdb9dd017a07eb10b328e037543f19e6032',
    'The request failed because the input audio may contain sensitive information. Request id: 0217831507937071773480a8a8832a2fb78799cf0b42733fd09e9',
    'The request failed because the output video may be related to copyright restrictions. Request id: 02178297181202800000000000000000000ffffac14d0d93ecd52'
  );

UPDATE credit_ledger
SET note = '视频已恢复并保存至数字资产，本次生成积分已扣除。'
WHERE type = 'spend'
  AND source LIKE 'Seedance % 恢复成片补扣'
  AND note = '方舟任务已成功并恢复成片资产，补扣此前因本地归档失败退回的积分。';

UPDATE credit_ledger AS ledger
SET note = '购买“' || orders.plan_name || '”成功，套餐积分已到账。'
FROM orders
WHERE ledger.related_order_id = orders.id
  AND ledger.type = 'earn'
  AND ledger.source = '订单支付到账'
  AND ledger.note = orders.plan_name || ' 支付成功后积分到账。';

UPDATE credit_ledger
SET note = '订单退款成功，对应积分已扣回。'
WHERE type = 'void'
  AND source = '退款冲销'
  AND note = '订单退款成功，已到账积分完成冲销。';

UPDATE credit_ledger
SET note = '退款状态已更正为成功，此前临时退回的积分已撤销。'
WHERE type = 'void'
  AND source = '退款失败退回冲销'
  AND note = 'Jeepay 后续确认退款成功，已冲销此前退回的积分。';

UPDATE credit_ledger
SET note = CASE
  WHEN amount > 0 THEN '账户积分已补发。'
  ELSE '账户积分已由管理员调整。'
END
WHERE type = 'adjust'
  AND source = '后台人工调整'
  AND note = '人工补偿';

-- 新注册流程已不再发放默认积分；这里只修正唯一的历史兼容流水。
UPDATE credit_ledger
SET note = '免费版套餐积分已到账。'
WHERE type = 'earn'
  AND source = '注册默认套餐'
  AND note = '免费版 默认积分到账。';
