-- 为三条供应商拒绝但缺少 Token 回执的历史失败任务建立零成本候选案件。
-- 本迁移只保存审计证据；不得补写 Token、成本、任务状态或积分结算。
DO $$
DECLARE
  target record;
  task_record generation_tasks%ROWTYPE;
  usage_record provider_usage_records%ROWTYPE;
  reconciliation_case provider_reconciliation_cases%ROWTYPE;
  target_task_count integer;
  target_usage_count integer;
  link_count integer;
  expected_evidence jsonb;
  expected_evidence_hash text;
  audit_detail text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE id = '038_correct_cross_date_attribution.sql'
  ) THEN
    RAISE EXCEPTION '039 拒绝建立零成本候选：038_correct_cross_date_attribution.sql 尚未登记';
  END IF;

  SELECT count(*) INTO target_task_count
  FROM generation_tasks
  WHERE id IN (
    '880deb21-3ce2-4a3a-8a0d-01af2a94e7ea'::uuid,
    '24f63ad0-e06b-4304-b3c6-c555417337c1'::uuid,
    'c34327fc-301a-47a2-8352-769d5a525a1a'::uuid
  );

  SELECT count(*) INTO target_usage_count
  FROM provider_usage_records
  WHERE id IN (
    '796060ae-f80e-47c2-93e9-af0eebc8100b'::uuid,
    '27273444-826e-49a4-9728-3ad3e6b1d077'::uuid,
    'ca1a2da6-522d-4d68-bc98-f604428e5b1b'::uuid
  );

  -- 测试、开发及新装空库没有这批线上历史数据时安全跳过；只出现部分证据时
  -- 必须整体失败，禁止建立不完整案件。
  IF target_task_count = 0 AND target_usage_count = 0 THEN
    RETURN;
  END IF;
  IF target_task_count <> 3 OR target_usage_count <> 3 THEN
    RAISE EXCEPTION
      '039 拒绝建立零成本候选：目标任务或 usage 证据不完整（% / 3 tasks，% / 3 usage）',
      target_task_count,
      target_usage_count;
  END IF;

  FOR target IN
    SELECT *
    FROM (VALUES
      (
        '880deb21-3ce2-4a3a-8a0d-01af2a94e7ea'::uuid,
        '796060ae-f80e-47c2-93e9-af0eebc8100b'::uuid,
        'Seedance 2.0 Fast'::text,
        '720p'::text,
        false,
        'without-video'::text,
        37.000000::numeric,
        '2026-07-02'::date,
        '2026-07-02 05:53:22.359456+00'::timestamptz,
        '2026-07-02 05:56:49.879283+00'::timestamptz,
        '2026-07-02 06:00:34.956064+00'::timestamptz,
        'cgt-20260702135650-sgrb6'::text,
        0::integer,
        48::integer,
        'provider-terminal-usage-unavailable'::text,
        'The request failed because the output video may be related to copyright restrictions. Request id: 02178297181202800000000000000000000ffffac14d0d93ecd52'::text,
        '02178297181202800000000000000000000ffffac14d0d93ecd52'::text,
        true,
        'resource-not-found'::text,
        1350238::bigint,
        49.958806::numeric
      ),
      (
        '24f63ad0-e06b-4304-b3c6-c555417337c1'::uuid,
        '27273444-826e-49a4-9728-3ad3e6b1d077'::uuid,
        'Seedance 2.0'::text,
        '720p'::text,
        true,
        'with-video'::text,
        28.000000::numeric,
        '2026-07-04'::date,
        '2026-07-04 07:38:43.894472+00'::timestamptz,
        '2026-07-04 07:39:53.504370+00'::timestamptz,
        '2026-07-04 07:40:08.054311+00'::timestamptz,
        NULL::text,
        NULL::integer,
        80::integer,
        'provider-rejected-before-billing'::text,
        'The request failed because the input audio may contain sensitive information. Request id: 0217831507937071773480a8a8832a2fb78799cf0b42733fd09e9'::text,
        '0217831507937071773480a8a8832a2fb78799cf0b42733fd09e9'::text,
        false,
        'provider-task-not-created'::text,
        605700::bigint,
        16.959600::numeric
      ),
      (
        'c34327fc-301a-47a2-8352-769d5a525a1a'::uuid,
        'ca1a2da6-522d-4d68-bc98-f604428e5b1b'::uuid,
        'Seedance 2.0'::text,
        '720p'::text,
        true,
        'with-video'::text,
        28.000000::numeric,
        '2026-07-04'::date,
        '2026-07-04 07:40:18.810087+00'::timestamptz,
        '2026-07-04 07:40:18.850325+00'::timestamptz,
        '2026-07-04 07:40:32.669147+00'::timestamptz,
        NULL::text,
        NULL::integer,
        80::integer,
        'provider-rejected-before-billing'::text,
        'The request failed because the input image may contain real person. Request id: 021783150818996111fb6a4d6acc002d9c575cdd1b4a762177b41'::text,
        '021783150818996111fb6a4d6acc002d9c575cdd1b4a762177b41'::text,
        false,
        'provider-task-not-created'::text,
        605700::bigint,
        16.959600::numeric
      )
    ) AS targets(
      task_id, usage_record_id, model, resolution, has_video_input,
      pricing_input_class, unit_price_per_million, accounting_date,
      task_created_at, task_started_at, task_completed_at, provider_task_id,
      provider_task_attempt, refunded_credits, root_cause, failure_reason,
      request_id, provider_lookup_attempted, provider_lookup_outcome,
      initial_bucket_tokens, initial_bucket_cost_cny
    )
    ORDER BY task_id
  LOOP
    SELECT * INTO STRICT task_record
    FROM generation_tasks
    WHERE id = target.task_id
    FOR UPDATE;

    IF task_record.kind IS DISTINCT FROM 'video'
      OR task_record.model IS DISTINCT FROM target.model
      OR task_record.status IS DISTINCT FROM 'failed'
      OR task_record.processing_stage IS DISTINCT FROM 'failed'
      OR task_record.failure_category IS DISTINCT FROM 'provider-failed'
      OR task_record.failure_reason IS DISTINCT FROM target.failure_reason
      OR task_record.provider_task_id IS DISTINCT FROM target.provider_task_id
      OR task_record.provider_task_attempt IS DISTINCT FROM target.provider_task_attempt
      OR task_record.credits IS DISTINCT FROM target.refunded_credits
      OR task_record.reserved_credits IS DISTINCT FROM target.refunded_credits
      OR task_record.settled_credits IS DISTINCT FROM 0
      OR task_record.refunded_credits IS DISTINCT FROM target.refunded_credits
      OR task_record.credit_status IS DISTINCT FROM 'refunded'
      OR task_record.created_at IS DISTINCT FROM target.task_created_at
      OR task_record.started_at IS DISTINCT FROM target.task_started_at
      OR task_record.completed_at IS DISTINCT FROM target.task_completed_at
    THEN
      RAISE EXCEPTION '039 拒绝建立零成本候选：任务 % 与确定性清单冲突', target.task_id;
    END IF;

    SELECT * INTO STRICT usage_record
    FROM provider_usage_records
    WHERE id = target.usage_record_id
    FOR UPDATE;

    IF usage_record.task_id IS DISTINCT FROM target.task_id
      OR usage_record.provider IS DISTINCT FROM 'volcengine-ark'
      OR usage_record.model IS DISTINCT FROM target.model
      OR usage_record.status IS DISTINCT FROM 'failed'
      OR usage_record.attempt IS DISTINCT FROM -1
      OR usage_record.provider_task_id IS DISTINCT FROM target.provider_task_id
      OR usage_record.raw_units IS NOT NULL
      OR usage_record.deducted_units IS NOT NULL
      OR usage_record.completion_tokens IS NOT NULL
      OR usage_record.total_tokens IS NOT NULL
      OR usage_record.billable_tokens IS NOT NULL
      OR usage_record.billable_basis IS NOT NULL
      OR usage_record.resolution IS DISTINCT FROM target.resolution
      OR usage_record.has_video_input IS DISTINCT FROM target.has_video_input
      OR usage_record.price_version IS NOT NULL
      OR usage_record.unit_price_per_million IS NOT NULL
      OR usage_record.estimated_cost IS NOT NULL
      OR usage_record.currency IS DISTINCT FROM 'CNY'
      OR usage_record.pricing_status IS DISTINCT FROM 'legacy-inferred'
      OR usage_record.usage_evidence_origin IS DISTINCT FROM 'unavailable'
      OR usage_record.pricing_rule_status IS DISTINCT FROM 'rule-missing'
      OR usage_record.pricing_input_class IS DISTINCT FROM target.pricing_input_class
      OR usage_record.pricing_resolution_band IS DISTINCT FROM '480p-720p'
      OR usage_record.attribution_confidence IS DISTINCT FROM 'unallocated'
      OR usage_record.provider_terminal_at IS NOT NULL
      OR usage_record.usage_observed_at IS DISTINCT FROM target.task_completed_at
      OR usage_record.local_accounting_date IS DISTINCT FROM target.accounting_date
      OR usage_record.accounting_date_origin IS DISTINCT FROM 'legacy-completed'
      OR usage_record.created_at IS DISTINCT FROM target.task_completed_at
      OR usage_record.completed_at IS DISTINCT FROM target.task_completed_at
      OR usage_record.error IS DISTINCT FROM target.failure_reason
    THEN
      RAISE EXCEPTION '039 拒绝建立零成本候选：usage % 与确定性清单冲突', target.usage_record_id;
    END IF;

    expected_evidence := jsonb_build_object(
      'resolutionKind', 'zero-cost',
      'resolutionVersion', '2026-07-15-v1',
      'taskId', target.task_id,
      'usageRecordId', target.usage_record_id,
      'requestId', target.request_id,
      'providerTaskId', target.provider_task_id,
      'failureReason', target.failure_reason,
      'billPeriod', '2026-07',
      'expenseDate', target.accounting_date,
      'localAccountingDate', target.accounting_date,
      'model', target.model,
      'pricingResolutionBand', '480p-720p',
      'pricingInputClass', target.pricing_input_class,
      'unitPricePerMillion', to_char(target.unit_price_per_million, 'FM999999990.000000'),
      'providerLookup', jsonb_build_object(
        'attempted', target.provider_lookup_attempted,
        'outcome', target.provider_lookup_outcome,
        'note', CASE
          WHEN target.provider_lookup_attempted
            THEN '历史终态回执已过供应商查询期'
          ELSE '供应商在创建阶段拒绝输入，未生成供应商任务 ID'
        END
      ),
      'initialReconciliation', jsonb_build_object(
        'bucketAdjustedTokens', target.initial_bucket_tokens,
        'bucketOfficialTokens', target.initial_bucket_tokens,
        'bucketResidualTokens', 0,
        'bucketAdjustedCostCny', to_char(target.initial_bucket_cost_cny, 'FM999999990.000000'),
        'bucketOfficialCostCny', to_char(target.initial_bucket_cost_cny, 'FM999999990.000000'),
        'bucketResidualCostCny', '0.000000',
        'observedAt', '2026-07-15'
      ),
      'review', jsonb_build_object(
        'status', 'pending-final-bill',
        'reason', '2026-07 官方账单尚未最终确认',
        'reconciliationRunId', NULL,
        'billState', 'provisional',
        'coverageState', 'complete',
        'residualTokens', '0',
        'residualCostCny', '0.000000',
        'reviewedAt', NULL
      ),
      'note', '仅建立零成本候选；不修改供应商原始 Token、成本、任务状态或积分'
    );
    expected_evidence_hash := encode(digest(concat_ws(
      '|',
      '2026-07-15-v1',
      target.task_id::text,
      target.usage_record_id::text,
      target.request_id,
      coalesce(target.provider_task_id, ''),
      target.failure_reason,
      target.accounting_date::text,
      target.model,
      '480p-720p',
      target.pricing_input_class,
      to_char(target.unit_price_per_million, 'FM999999990.000000')
    ), 'sha256'), 'hex');

    SELECT * INTO reconciliation_case
    FROM provider_reconciliation_cases
    WHERE provider = 'volcengine-ark'
      AND case_key = 'zero-cost:' || target.task_id::text
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO provider_reconciliation_cases (
        provider, case_key, bill_period, case_type, status, root_cause,
        confidence, token_adjustment, cost_adjustment_cny,
        official_expense_date, local_accounting_date, evidence, evidence_hash
      ) VALUES (
        'volcengine-ark',
        'zero-cost:' || target.task_id::text,
        '2026-07',
        'missing-local-usage',
        'open',
        target.root_cause,
        'high',
        0,
        0.000000,
        target.accounting_date,
        target.accounting_date,
        expected_evidence,
        expected_evidence_hash
      )
      RETURNING * INTO reconciliation_case;
    END IF;

    -- review 子对象会由 worker 随终账状态更新；其余字段和原始证据哈希必须
    -- 永远与本迁移的受审清单一致。
    IF reconciliation_case.bill_period IS DISTINCT FROM '2026-07'
      OR reconciliation_case.case_type IS DISTINCT FROM 'missing-local-usage'
      OR reconciliation_case.status NOT IN ('open', 'approved', 'superseded')
      OR reconciliation_case.root_cause IS DISTINCT FROM target.root_cause
      OR reconciliation_case.confidence IS DISTINCT FROM 'high'
      OR reconciliation_case.token_adjustment IS DISTINCT FROM 0
      OR reconciliation_case.cost_adjustment_cny IS DISTINCT FROM 0.000000
      OR reconciliation_case.official_expense_date IS DISTINCT FROM target.accounting_date
      OR reconciliation_case.local_accounting_date IS DISTINCT FROM target.accounting_date
      OR reconciliation_case.evidence_hash IS DISTINCT FROM expected_evidence_hash
      OR (reconciliation_case.evidence - 'review') IS DISTINCT FROM (expected_evidence - 'review')
    THEN
      RAISE EXCEPTION '039 拒绝建立零成本候选：案件 % 与确定性清单冲突', reconciliation_case.case_key;
    END IF;

    SELECT count(*) INTO link_count
    FROM provider_reconciliation_case_links
    WHERE case_id = reconciliation_case.id;

    IF link_count = 0 THEN
      INSERT INTO provider_reconciliation_case_links (
        case_id, usage_record_id, bill_detail_id, bill_detail_revision_id,
        allocated_tokens, allocated_cost_cny
      ) VALUES (
        reconciliation_case.id,
        target.usage_record_id,
        NULL,
        NULL,
        0,
        0.000000
      );
    ELSIF link_count <> 1 OR NOT EXISTS (
      SELECT 1
      FROM provider_reconciliation_case_links links
      WHERE links.case_id = reconciliation_case.id
        AND links.usage_record_id = target.usage_record_id
        AND links.bill_detail_id IS NULL
        AND links.bill_detail_revision_id IS NULL
        AND links.allocated_tokens = 0
        AND links.allocated_cost_cny = 0.000000
    ) THEN
      RAISE EXCEPTION '039 拒绝建立零成本候选：案件 % 的证据链接不唯一或冲突', reconciliation_case.case_key;
    END IF;

    audit_detail := jsonb_build_object(
      'migration', '039_seed_zero_cost_reconciliation_cases.sql',
      'version', '2026-07-15-v1',
      'caseId', reconciliation_case.id,
      'caseKey', reconciliation_case.case_key,
      'taskId', target.task_id,
      'usageRecordId', target.usage_record_id,
      'requestId', target.request_id,
      'providerTaskId', target.provider_task_id,
      'initialStatus', 'open',
      'reason', '等待 2026-07 最终账单及相关计价桶零残差后确认零成本',
      'protectedFields', jsonb_build_array(
        'completion_tokens', 'total_tokens', 'billable_tokens',
        'estimated_cost', 'task_status', 'credit_status'
      )
    )::text;

    INSERT INTO audit_logs (
      admin_user_id, admin_email, module, action, target, risk, detail
    )
    SELECT
      NULL,
      'system@lindyson.local',
      'API成本与用量',
      '建立历史零成本候选',
      reconciliation_case.case_key,
      'high',
      audit_detail
    WHERE NOT EXISTS (
      SELECT 1
      FROM audit_logs AS existing_audit
      WHERE existing_audit.module = 'API成本与用量'
        AND existing_audit.action = '建立历史零成本候选'
        AND existing_audit.target = reconciliation_case.case_key
        AND existing_audit.risk = 'high'
        AND existing_audit.detail = audit_detail
    );
  END LOOP;
END
$$;
