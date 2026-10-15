-- 036 将 7 月 1 日至 2 日的 50,638 Token 跨日偏移错误关联到 594a9f42。
-- 037 已保留并废止错误案件；本迁移依据供应商任务时间和官方计费时间建立正确映射。
DO $$
DECLARE
  usage_exists integer;
  detail_exists integer;
  usage_record provider_usage_records%ROWTYPE;
  task_record generation_tasks%ROWTYPE;
  bill_detail provider_bill_details%ROWTYPE;
  wrong_case provider_reconciliation_cases%ROWTYPE;
  correct_case provider_reconciliation_cases%ROWTYPE;
  link_count integer;
  unresolved_date_count integer;
  month_timing_tokens bigint;
  month_timing_cost numeric(20,6);
  expected_evidence jsonb;
  expected_evidence_hash text;
  audit_detail text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE id = '037_correct_seeded_cross_date_case.sql'
  ) THEN
    RAISE EXCEPTION '038 拒绝归因：037_correct_seeded_cross_date_case.sql 尚未登记';
  END IF;

  SELECT count(*) INTO usage_exists
  FROM provider_usage_records
  WHERE id = '77820a78-0b2b-4138-a355-af741bcb7066'::uuid;

  SELECT count(*) INTO detail_exists
  FROM provider_bill_details
  WHERE provider = 'volcengine-ark'
    AND source_detail_key = 'Detail7657579033744036111';

  -- 没有该批历史数据的新环境无需建立数据专属案件。
  IF usage_exists = 0 AND detail_exists = 0 THEN
    RETURN;
  END IF;

  IF usage_exists <> 1 OR detail_exists <> 1 THEN
    RAISE EXCEPTION '038 拒绝归因：正确跨日映射的本地或官方证据不完整';
  END IF;

  SELECT * INTO STRICT usage_record
  FROM provider_usage_records
  WHERE id = '77820a78-0b2b-4138-a355-af741bcb7066'::uuid
  FOR UPDATE;

  IF usage_record.provider IS DISTINCT FROM 'volcengine-ark'
    OR usage_record.model IS DISTINCT FROM 'Seedance 2.0 Mini'
    OR usage_record.task_id IS DISTINCT FROM '2d2e4519-b756-42ae-b826-7e6470a7661a'::uuid
    OR usage_record.status IS DISTINCT FROM 'success'
    OR usage_record.attempt IS DISTINCT FROM -1
    OR usage_record.provider_task_id IS DISTINCT FROM 'cgt-20260701231431-ssx7t'
    OR usage_record.billable_tokens IS DISTINCT FROM 50638
    OR usage_record.resolution IS DISTINCT FROM '480p'
    OR usage_record.has_video_input IS DISTINCT FROM false
    OR usage_record.price_version IS DISTINCT FROM 'volcengine-seedance-2026-07-10'
    OR usage_record.unit_price_per_million IS DISTINCT FROM 23.000000
    OR usage_record.estimated_cost IS DISTINCT FROM 1.164674
    OR usage_record.currency IS DISTINCT FROM 'CNY'
    OR usage_record.usage_evidence_origin IS DISTINCT FROM 'legacy-raw'
    OR usage_record.pricing_rule_status IS DISTINCT FROM 'priced'
    OR usage_record.pricing_input_class IS DISTINCT FROM 'without-video'
    OR usage_record.pricing_resolution_band IS DISTINCT FROM '480p-720p'
    OR usage_record.local_accounting_date IS DISTINCT FROM '2026-07-02'::date
    OR usage_record.accounting_date_origin IS DISTINCT FROM 'legacy-completed'
    OR usage_record.created_at IS DISTINCT FROM '2026-07-01 15:16:59.351365+00'::timestamptz
    OR usage_record.completed_at IS DISTINCT FROM '2026-07-01 18:42:34.1485+00'::timestamptz
  THEN
    RAISE EXCEPTION '038 拒绝归因：本地 usage 与受审证据清单不一致';
  END IF;

  SELECT * INTO STRICT task_record
  FROM generation_tasks
  WHERE id = '2d2e4519-b756-42ae-b826-7e6470a7661a'::uuid
  FOR UPDATE;

  IF task_record.model IS DISTINCT FROM 'Seedance 2.0 Mini'
    OR task_record.status IS DISTINCT FROM 'completed'
    OR task_record.provider_task_id IS DISTINCT FROM 'cgt-20260701231431-ssx7t'
    OR task_record.created_at IS DISTINCT FROM '2026-07-01 15:14:30.577512+00'::timestamptz
    OR task_record.started_at IS DISTINCT FROM '2026-07-01 15:14:30.646558+00'::timestamptz
    OR task_record.completed_at IS DISTINCT FROM '2026-07-01 18:42:34.1485+00'::timestamptz
  THEN
    RAISE EXCEPTION '038 拒绝归因：生成任务与北京时间 2026-07-01 23:14:30 提交证据不一致';
  END IF;

  SELECT * INTO STRICT bill_detail
  FROM provider_bill_details
  WHERE provider = 'volcengine-ark'
    AND source_detail_key = 'Detail7657579033744036111'
  FOR UPDATE;

  IF bill_detail.bill_period IS DISTINCT FROM '2026-07'
    OR bill_detail.expense_date IS DISTINCT FROM '2026-07-01'::date
    OR bill_detail.product IS DISTINCT FROM 'ark_bd'
    OR bill_detail.bill_line_type IS DISTINCT FROM 'usage'
    OR bill_detail.recognized_model IS DISTINCT FROM 'Seedance 2.0 Mini'
    OR bill_detail.pricing_resolution IS DISTINCT FROM '480p/720p'
    OR bill_detail.pricing_input_has_video IS DISTINCT FROM false
    OR bill_detail.billable_tokens IS DISTINCT FROM 50638
    OR bill_detail.list_equivalent_cost_cny IS DISTINCT FROM 1.164674
    OR bill_detail.normalized_unit_price_per_million IS DISTINCT FROM 23.000000
    OR bill_detail.currency IS DISTINCT FROM 'CNY'
    OR bill_detail.active IS DISTINCT FROM true
    OR bill_detail.raw_payload->>'ExpenseBeginTime' IS DISTINCT FROM '2026-07-01 23:17:00'
    OR bill_detail.raw_payload->>'ExpenseEndTime' IS DISTINCT FROM '2026-07-01 23:17:30'
    OR bill_detail.raw_payload->>'TradeTime' IS DISTINCT FROM '2026-07-01 23:18:17'
  THEN
    RAISE EXCEPTION '038 拒绝归因：官方账单明细与受审证据清单不一致';
  END IF;

  IF bill_detail.current_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM provider_bill_detail_revisions revisions
    WHERE revisions.id = bill_detail.current_revision_id
      AND revisions.provider = bill_detail.provider
      AND revisions.source_detail_key = bill_detail.source_detail_key
      AND revisions.normalized_payload->>'expenseDate' = bill_detail.expense_date::text
      AND revisions.normalized_payload->>'billableTokens' = bill_detail.billable_tokens::text
      AND revisions.normalized_payload->>'listEquivalentCostCny' = bill_detail.list_equivalent_cost_cny::text
      AND revisions.normalized_payload->>'normalizedUnitPricePerMillion' = '23'
      AND revisions.normalized_payload->>'pricingResolution' = '480p/720p'
      AND revisions.normalized_payload->>'pricingInputHasVideo' = 'false'
  ) THEN
    RAISE EXCEPTION '038 拒绝归因：当前官方账单 revision 与投影不一致';
  END IF;

  SELECT * INTO wrong_case
  FROM provider_reconciliation_cases
  WHERE provider = 'volcengine-ark'
    AND case_key = 'cross-date:594a9f42-aca0-4b8c-aa6d-e892a9753721';

  IF NOT FOUND OR wrong_case.status IS DISTINCT FROM 'superseded'
    OR wrong_case.case_type IS DISTINCT FROM 'cross-date'
    OR wrong_case.bill_period IS DISTINCT FROM '2026-07'
    OR wrong_case.root_cause IS DISTINCT FROM 'provider-accounting-cutoff'
    OR wrong_case.confidence IS DISTINCT FROM 'high'
    OR wrong_case.token_adjustment IS DISTINCT FROM 50638
    OR wrong_case.cost_adjustment_cny IS DISTINCT FROM 1.164674
    OR wrong_case.official_expense_date IS DISTINCT FROM '2026-07-01'::date
    OR wrong_case.local_accounting_date IS DISTINCT FROM '2026-07-10'::date
  THEN
    RAISE EXCEPTION '038 拒绝归因：037 废止的错误跨日案件不存在或状态异常';
  END IF;

  expected_evidence := jsonb_build_object(
    'version', '2026-07-14-v1',
    'taskId', usage_record.task_id,
    'usageRecordId', usage_record.id,
    'providerTaskId', usage_record.provider_task_id,
    'officialDetailKey', bill_detail.source_detail_key,
    'officialExpenseDate', bill_detail.expense_date,
    'localAccountingDate', usage_record.local_accounting_date,
    'taskCreatedAt', task_record.created_at,
    'taskCreatedAtBeijing', to_char(
      task_record.created_at AT TIME ZONE 'Asia/Shanghai',
      'YYYY-MM-DD HH24:MI:SS.US'
    ),
    'officialExpenseBeginTime', bill_detail.raw_payload->>'ExpenseBeginTime',
    'officialExpenseEndTime', bill_detail.raw_payload->>'ExpenseEndTime',
    'billableTokens', usage_record.billable_tokens,
    'estimatedCostCny', usage_record.estimated_cost,
    'priceVersion', usage_record.price_version,
    'inference', '官方账单不含内部任务 ID；依据唯一供应商任务与计费时间窗作高置信推断',
    'note', '仅移动对账日期，不修改任务完成时间、Token、成本或积分结算'
  );
  expected_evidence_hash := encode(digest(concat_ws(
    '|',
    '2026-07-14-v1',
    usage_record.task_id::text,
    usage_record.id::text,
    usage_record.provider_task_id,
    bill_detail.source_detail_key,
    bill_detail.expense_date::text,
    usage_record.local_accounting_date::text,
    usage_record.billable_tokens::text,
    usage_record.estimated_cost::text,
    usage_record.price_version
  ), 'sha256'), 'hex');

  SELECT * INTO correct_case
  FROM provider_reconciliation_cases
  WHERE provider = 'volcengine-ark'
    AND case_key = 'cross-date:2d2e4519-b756-42ae-b826-7e6470a7661a';

  IF NOT FOUND THEN
    INSERT INTO provider_reconciliation_cases (
      provider, case_key, bill_period, case_type, status, root_cause, confidence,
      token_adjustment, cost_adjustment_cny, official_expense_date,
      local_accounting_date, evidence, evidence_hash, supersedes_case_id
    )
    VALUES (
      'volcengine-ark',
      'cross-date:2d2e4519-b756-42ae-b826-7e6470a7661a',
      '2026-07',
      'cross-date',
      'approved',
      'provider-accounting-cutoff',
      'high',
      50638,
      1.164674,
      bill_detail.expense_date,
      usage_record.local_accounting_date,
      expected_evidence,
      expected_evidence_hash,
      wrong_case.id
    )
    RETURNING * INTO correct_case;
  END IF;

  IF correct_case.bill_period IS DISTINCT FROM '2026-07'
    OR correct_case.case_type IS DISTINCT FROM 'cross-date'
    OR correct_case.status IS DISTINCT FROM 'approved'
    OR correct_case.root_cause IS DISTINCT FROM 'provider-accounting-cutoff'
    OR correct_case.confidence IS DISTINCT FROM 'high'
    OR correct_case.token_adjustment IS DISTINCT FROM 50638
    OR correct_case.cost_adjustment_cny IS DISTINCT FROM 1.164674
    OR correct_case.official_expense_date IS DISTINCT FROM bill_detail.expense_date
    OR correct_case.local_accounting_date IS DISTINCT FROM usage_record.local_accounting_date
    OR correct_case.supersedes_case_id IS DISTINCT FROM wrong_case.id
    OR correct_case.evidence IS DISTINCT FROM expected_evidence
    OR correct_case.evidence_hash IS DISTINCT FROM expected_evidence_hash
  THEN
    RAISE EXCEPTION '038 拒绝归因：正确跨日案件与确定性清单冲突';
  END IF;

  SELECT count(*) INTO link_count
  FROM provider_reconciliation_case_links
  WHERE case_id = correct_case.id;

  IF link_count = 0 THEN
    INSERT INTO provider_reconciliation_case_links (
      case_id, usage_record_id, bill_detail_id, bill_detail_revision_id,
      allocated_tokens, allocated_cost_cny
    ) VALUES (
      correct_case.id,
      usage_record.id,
      bill_detail.id,
      bill_detail.current_revision_id,
      50638,
      1.164674
    );
  ELSIF link_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM provider_reconciliation_case_links links
    WHERE links.case_id = correct_case.id
      AND links.usage_record_id = usage_record.id
      AND links.bill_detail_id = bill_detail.id
      AND links.bill_detail_revision_id IS NOT DISTINCT FROM bill_detail.current_revision_id
      AND links.allocated_tokens = 50638
      AND links.allocated_cost_cny = 1.164674
  ) THEN
    RAISE EXCEPTION '038 拒绝归因：正确跨日案件链接不唯一或发生冲突';
  END IF;

  -- 使用页面相同的方向定义验证 7 月 1 日和 2 日的 Mini/¥23 桶均已归零。
  WITH selected_dates(expense_date) AS (
    VALUES ('2026-07-01'::date), ('2026-07-02'::date)
  ), local_usage AS (
    SELECT local_accounting_date AS expense_date,
           sum(billable_tokens)::bigint AS tokens,
           sum(estimated_cost)::numeric(20,6) AS cost
    FROM provider_usage_records
    WHERE provider = 'volcengine-ark'
      AND model = 'Seedance 2.0 Mini'
      AND pricing_resolution_band = '480p-720p'
      AND pricing_input_class = 'without-video'
      AND unit_price_per_million = 23.000000
      AND pricing_rule_status = 'priced'
      AND local_accounting_date IN ('2026-07-01'::date, '2026-07-02'::date)
    GROUP BY local_accounting_date
  ), official_usage AS (
    SELECT expense_date,
           sum(billable_tokens)::bigint AS tokens,
           sum(list_equivalent_cost_cny)::numeric(20,6) AS cost
    FROM provider_bill_details
    WHERE provider = 'volcengine-ark'
      AND active = true
      AND product = 'ark_bd'
      AND bill_line_type = 'usage'
      AND recognized_model = 'Seedance 2.0 Mini'
      AND pricing_resolution IN ('480p', '720p', '480p/720p', '480p-720p')
      AND pricing_input_has_video = false
      AND normalized_unit_price_per_million = 23.000000
      AND expense_date IN ('2026-07-01'::date, '2026-07-02'::date)
    GROUP BY expense_date
  ), timing AS (
    SELECT shifted.expense_date,
           sum(links.allocated_tokens * shifted.direction)::bigint AS tokens,
           sum(links.allocated_cost_cny * shifted.direction)::numeric(20,6) AS cost
    FROM provider_reconciliation_cases cases
    JOIN provider_reconciliation_case_links links ON links.case_id = cases.id
    JOIN provider_usage_records usage ON usage.id = links.usage_record_id
    CROSS JOIN LATERAL (VALUES
      (cases.official_expense_date, 1::bigint),
      (cases.local_accounting_date, -1::bigint)
    ) shifted(expense_date, direction)
    WHERE cases.provider = 'volcengine-ark'
      AND cases.case_type = 'cross-date'
      AND cases.status = 'approved'
      AND usage.model = 'Seedance 2.0 Mini'
      AND usage.pricing_resolution_band = '480p-720p'
      AND usage.pricing_input_class = 'without-video'
      AND usage.unit_price_per_million = 23.000000
      AND shifted.expense_date IN ('2026-07-01'::date, '2026-07-02'::date)
    GROUP BY shifted.expense_date
  ), residuals AS (
    SELECT dates.expense_date,
           coalesce(official_usage.tokens, 0)
             - coalesce(local_usage.tokens, 0)
             - coalesce(timing.tokens, 0) AS residual_tokens,
           (coalesce(official_usage.cost, 0)
             - coalesce(local_usage.cost, 0)
             - coalesce(timing.cost, 0))::numeric(20,6) AS residual_cost
    FROM selected_dates dates
    LEFT JOIN local_usage USING (expense_date)
    LEFT JOIN official_usage USING (expense_date)
    LEFT JOIN timing USING (expense_date)
  )
  SELECT count(*) INTO unresolved_date_count
  FROM residuals
  WHERE residual_tokens <> 0
    OR residual_cost <> 0
    OR (
      expense_date = '2026-07-01'::date
      AND (
        coalesce((SELECT tokens FROM timing WHERE timing.expense_date = residuals.expense_date), 0) <> 50638
        OR coalesce((SELECT cost FROM timing WHERE timing.expense_date = residuals.expense_date), 0) <> 1.164674
      )
    )
    OR (
      expense_date = '2026-07-02'::date
      AND (
        coalesce((SELECT tokens FROM timing WHERE timing.expense_date = residuals.expense_date), 0) <> -50638
        OR coalesce((SELECT cost FROM timing WHERE timing.expense_date = residuals.expense_date), 0) <> -1.164674
      )
    );

  IF unresolved_date_count <> 0 THEN
    RAISE EXCEPTION '038 拒绝归因：跨日修正后 7 月 1 日或 2 日残差仍不为零';
  END IF;

  SELECT
    coalesce(sum(links.allocated_tokens * shifted.direction), 0)::bigint,
    coalesce(sum(links.allocated_cost_cny * shifted.direction), 0)::numeric(20,6)
  INTO month_timing_tokens, month_timing_cost
  FROM provider_reconciliation_cases cases
  JOIN provider_reconciliation_case_links links ON links.case_id = cases.id
  CROSS JOIN LATERAL (VALUES
    (cases.official_expense_date, 1::bigint),
    (cases.local_accounting_date, -1::bigint)
  ) shifted(expense_date, direction)
  WHERE cases.provider = 'volcengine-ark'
    AND cases.bill_period = '2026-07'
    AND cases.case_type = 'cross-date'
    AND cases.status = 'approved'
    AND shifted.expense_date >= '2026-07-01'::date
    AND shifted.expense_date < '2026-08-01'::date;

  IF month_timing_tokens <> 0 OR month_timing_cost <> 0 THEN
    RAISE EXCEPTION '038 拒绝归因：2026-07 跨日调整净额不为零（% Token / % 元）',
      month_timing_tokens, month_timing_cost;
  END IF;

  audit_detail := jsonb_build_object(
    'migration', '038_correct_cross_date_attribution.sql',
    'version', '2026-07-14-v1',
    'supersededCaseId', wrong_case.id,
    'correctCaseId', correct_case.id,
    'taskId', usage_record.task_id,
    'usageRecordId', usage_record.id,
    'providerTaskId', usage_record.provider_task_id,
    'officialDetailKey', bill_detail.source_detail_key,
    'officialExpenseDate', bill_detail.expense_date,
    'localAccountingDate', usage_record.local_accounting_date,
    'taskCreatedAtBeijing', to_char(
      task_record.created_at AT TIME ZONE 'Asia/Shanghai',
      'YYYY-MM-DD HH24:MI:SS.US'
    ),
    'officialExpenseBeginTime', bill_detail.raw_payload->>'ExpenseBeginTime',
    'officialExpenseEndTime', bill_detail.raw_payload->>'ExpenseEndTime',
    'billableTokens', 50638,
    'estimatedCostCny', '1.164674',
    'beforeDailyResiduals', jsonb_build_object(
      '2026-07-01', jsonb_build_object('tokens', 50638, 'costCny', '1.164674'),
      '2026-07-02', jsonb_build_object('tokens', -50638, 'costCny', '-1.164674')
    ),
    'afterDailyResiduals', jsonb_build_object(
      '2026-07-01', jsonb_build_object('tokens', 0, 'costCny', '0.000000'),
      '2026-07-02', jsonb_build_object('tokens', 0, 'costCny', '0.000000')
    ),
    'monthlyNetImpact', jsonb_build_object('tokens', month_timing_tokens, 'costCny', month_timing_cost)
  )::text;

  INSERT INTO audit_logs (
    admin_user_id, admin_email, module, action, target, risk, detail
  )
  SELECT
    NULL,
    'system@lindyson.local',
    'API成本与用量',
    '纠正跨日案件映射',
    correct_case.case_key,
    'high',
    audit_detail
  WHERE NOT EXISTS (
    SELECT 1
    FROM audit_logs
    WHERE module = 'API成本与用量'
      AND action = '纠正跨日案件映射'
      AND target = correct_case.case_key
      AND risk = 'high'
      AND detail = audit_detail
  );
END
$$;
