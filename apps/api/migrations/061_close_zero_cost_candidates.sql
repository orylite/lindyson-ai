-- 为 2026-07 已核实的十二条“供应商未创建任务”失败记录建立零成本候选。
-- 本迁移只新增案件、唯一 usage 链接和系统审计；不修改原始 Token、成本、任务、积分。
DO $$
DECLARE
  target record;
  task_record generation_tasks%ROWTYPE;
  usage_record provider_usage_records%ROWTYPE;
  reconciliation_case provider_reconciliation_cases%ROWTYPE;
  target_task_count integer;
  target_usage_count integer;
  existing_link_count integer;
  manual_audit_count integer;
  request_id text;
  expected_evidence jsonb;
  expected_evidence_hash text;
  audit_detail text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE id = '060_admin_direct_provider_usage.sql'
  ) THEN
    RAISE EXCEPTION '061 拒绝建立零成本候选：060_admin_direct_provider_usage.sql 尚未登记';
  END IF;

  SELECT count(*) INTO target_task_count
  FROM generation_tasks
  WHERE id IN (
    '69c708fd-d1ec-44ff-905b-f34b1195d342'::uuid,
    '43af558a-7cc8-4801-90ab-c949b1ea4c24'::uuid,
    '6dbac28a-0d18-4eec-a6fc-84a90f3382e0'::uuid,
    'b46a846d-43f0-40c7-9afa-31c2987ca352'::uuid,
    'a96a3c11-6dc4-4b77-a9b8-0b2e367b28e4'::uuid,
    '4f251149-d565-440e-ab5c-7c20b1b7c778'::uuid,
    '585dbfa8-30cb-4395-a462-27618cc9406b'::uuid,
    '0d312c97-5e14-45ea-b218-c71c688e43ee'::uuid,
    '4e587fb5-2108-4e1b-a2bc-e6365a03c703'::uuid,
    '67ce6251-298d-4ed5-8d1d-90eb42e87482'::uuid,
    'd87b78a4-a83a-4e99-9322-c5c31a1341ba'::uuid,
    '937acb17-c72c-4eeb-b22d-458dc9ee5431'::uuid
  );

  SELECT count(*) INTO target_usage_count
  FROM provider_usage_records
  WHERE id IN (
    'e3dc941d-b727-4a08-a26b-9e274fb8d0a7'::uuid,
    '13befdd0-5878-4961-a05d-288db5c9673f'::uuid,
    '385ff543-4cd7-406f-af85-8d170605798f'::uuid,
    '727f2267-360a-41b3-a97d-9227469b0e1b'::uuid,
    'bbd555a8-6dc8-4f73-ba16-e18e46011bb8'::uuid,
    '1a04e085-d278-41e3-ba45-9dae11bec227'::uuid,
    'bb12e7d1-c23d-45aa-8dcc-7af8dfa12048'::uuid,
    'a782e0c4-b518-41b9-93d4-9f823d5478a5'::uuid,
    'cd65ef3c-7bc6-4a64-a4f7-ef79915ee2f5'::uuid,
    '47c3ecde-024a-4119-9726-3df52b0c6d71'::uuid,
    'ac7cafcd-b637-4c01-a97c-8471e93e4ca1'::uuid,
    '2bfe169a-e6d1-4caa-b941-ffb6c05fdd83'::uuid
  );

  -- 新装、测试空库安全跳过；任何部分匹配都整体失败。
  IF target_task_count = 0 AND target_usage_count = 0 THEN
    RETURN;
  END IF;
  IF target_task_count <> 12 OR target_usage_count <> 12 THEN
    RAISE EXCEPTION
      '061 拒绝建立零成本候选：目标证据不完整（% / 12 tasks，% / 12 usage）',
      target_task_count,
      target_usage_count;
  END IF;

  FOR target IN
    SELECT *
    FROM (VALUES
      ('69c708fd-d1ec-44ff-905b-f34b1195d342'::uuid, 'e3dc941d-b727-4a08-a26b-9e274fb8d0a7'::uuid, 'Seedance 2.0'::text, 'with-video'::text, 28.000000::numeric, '2026-07-23'::date, 'InputVideoSensitiveContentDetected.PrivacyInformation'::text, 'http-400'::text),
      ('43af558a-7cc8-4801-90ab-c949b1ea4c24'::uuid, '13befdd0-5878-4961-a05d-288db5c9673f'::uuid, 'Seedance 2.0'::text, 'with-video'::text, 28.000000::numeric, '2026-07-23'::date, 'InputVideoSensitiveContentDetected.PrivacyInformation'::text, 'http-400'::text),
      ('6dbac28a-0d18-4eec-a6fc-84a90f3382e0'::uuid, '385ff543-4cd7-406f-af85-8d170605798f'::uuid, 'Seedance 2.0'::text, 'with-video'::text, 28.000000::numeric, '2026-07-23'::date, 'InputImageSensitiveContentDetected.PrivacyInformation'::text, 'http-400'::text),
      ('b46a846d-43f0-40c7-9afa-31c2987ca352'::uuid, '727f2267-360a-41b3-a97d-9227469b0e1b'::uuid, 'Seedance 2.0'::text, 'with-video'::text, 28.000000::numeric, '2026-07-22'::date, 'InputImageSensitiveContentDetected.PrivacyInformation'::text, 'http-400'::text),
      ('a96a3c11-6dc4-4b77-a9b8-0b2e367b28e4'::uuid, 'bbd555a8-6dc8-4f73-ba16-e18e46011bb8'::uuid, 'Seedance 2.0'::text, 'with-video'::text, 28.000000::numeric, '2026-07-22'::date, 'InputImageSensitiveContentDetected.PrivacyInformation'::text, 'http-400'::text),
      ('4f251149-d565-440e-ab5c-7c20b1b7c778'::uuid, '1a04e085-d278-41e3-ba45-9dae11bec227'::uuid, 'Seedance 2.0 Mini'::text, 'without-video'::text, 23.000000::numeric, '2026-07-19'::date, 'InputTextSensitiveContentDetected'::text, 'http-400'::text),
      ('585dbfa8-30cb-4395-a462-27618cc9406b'::uuid, 'bb12e7d1-c23d-45aa-8dcc-7af8dfa12048'::uuid, 'Seedance 2.0'::text, 'without-video'::text, 46.000000::numeric, '2026-07-19'::date, 'InputTextSensitiveContentDetected'::text, 'http-400'::text),
      ('0d312c97-5e14-45ea-b218-c71c688e43ee'::uuid, 'a782e0c4-b518-41b9-93d4-9f823d5478a5'::uuid, 'Seedance 2.0'::text, 'without-video'::text, 46.000000::numeric, '2026-07-19'::date, 'InputTextSensitiveContentDetected'::text, 'http-400'::text),
      ('4e587fb5-2108-4e1b-a2bc-e6365a03c703'::uuid, 'cd65ef3c-7bc6-4a64-a4f7-ef79915ee2f5'::uuid, 'Seedance 2.0'::text, 'without-video'::text, 46.000000::numeric, '2026-07-19'::date, 'InputTextSensitiveContentDetected'::text, 'http-400'::text),
      ('67ce6251-298d-4ed5-8d1d-90eb42e87482'::uuid, '47c3ecde-024a-4119-9726-3df52b0c6d71'::uuid, 'Seedance 2.0'::text, 'without-video'::text, 46.000000::numeric, '2026-07-19'::date, 'InputTextSensitiveContentDetected'::text, 'http-400'::text),
      ('d87b78a4-a83a-4e99-9322-c5c31a1341ba'::uuid, 'ac7cafcd-b637-4c01-a97c-8471e93e4ca1'::uuid, 'Seedance 2.0'::text, 'without-video'::text, 46.000000::numeric, '2026-07-19'::date, NULL::text, 'manual-audit'::text),
      ('937acb17-c72c-4eeb-b22d-458dc9ee5431'::uuid, '2bfe169a-e6d1-4caa-b941-ffb6c05fdd83'::uuid, 'Seedance 2.0'::text, 'without-video'::text, 46.000000::numeric, '2026-07-19'::date, NULL::text, 'manual-audit'::text)
    ) AS targets(
      task_id, usage_record_id, model, pricing_input_class,
      unit_price_per_million, accounting_date, error_code, evidence_type
    )
    ORDER BY task_id
  LOOP
    SELECT * INTO STRICT task_record
    FROM generation_tasks
    WHERE id = target.task_id
    FOR UPDATE;

    SELECT * INTO STRICT usage_record
    FROM provider_usage_records
    WHERE id = target.usage_record_id
    FOR UPDATE;

    IF task_record.kind IS DISTINCT FROM 'video'
      OR task_record.model IS DISTINCT FROM target.model
      OR task_record.status NOT IN ('failed', 'canceled')
      OR task_record.provider_task_id IS NOT NULL
      OR task_record.settled_credits IS DISTINCT FROM 0
      OR task_record.refunded_credits <= 0
      OR task_record.credit_status IS DISTINCT FROM 'refunded'
      OR usage_record.task_id IS DISTINCT FROM target.task_id
      OR usage_record.provider IS DISTINCT FROM 'volcengine-ark'
      OR usage_record.model IS DISTINCT FROM target.model
      OR usage_record.status IS DISTINCT FROM 'failed'
      OR usage_record.attempt IS DISTINCT FROM 0
      OR usage_record.provider_task_id IS NOT NULL
      OR usage_record.raw_units IS NOT NULL
      OR usage_record.deducted_units IS NOT NULL
      OR usage_record.completion_tokens IS NOT NULL
      OR usage_record.total_tokens IS NOT NULL
      OR usage_record.billable_tokens IS NOT NULL
      OR usage_record.estimated_cost IS NOT NULL
      OR usage_record.currency IS DISTINCT FROM 'CNY'
      OR usage_record.usage_evidence_origin IS DISTINCT FROM 'unavailable'
      OR usage_record.pricing_input_class IS DISTINCT FROM target.pricing_input_class
      OR usage_record.pricing_resolution_band IS DISTINCT FROM '480p-720p'
      OR usage_record.local_accounting_date IS DISTINCT FROM target.accounting_date
      OR (
        target.evidence_type = 'http-400'
        AND usage_record.error IS DISTINCT FROM task_record.failure_reason
      )
      OR (
        target.task_id = 'd87b78a4-a83a-4e99-9322-c5c31a1341ba'::uuid
        AND task_record.failure_reason IS DISTINCT FROM
          '经方舟官方任务列表核对，供应商未创建任务；历史提交结果未知任务已确认失败并退回积分。'
      )
      OR (
        target.task_id = '937acb17-c72c-4eeb-b22d-458dc9ee5431'::uuid
        AND task_record.failure_reason IS DISTINCT FROM
          '用户已请求取消；外部任务可能已提交，继续轮询终态并保留供应商成本。'
      )
    THEN
      RAISE EXCEPTION '061 拒绝建立零成本候选：任务或 usage % 与确定性清单冲突', target.task_id;
    END IF;

    request_id := NULL;
    IF target.evidence_type = 'http-400' THEN
      request_id := substring(usage_record.error from 'requestId=([A-Za-z0-9_-]+)');
      IF position('HTTP 400' IN usage_record.error) = 0
        OR position('code=' || target.error_code IN usage_record.error) = 0
        OR request_id IS NULL
        OR length(request_id) < 16
      THEN
        RAISE EXCEPTION '061 拒绝建立零成本候选：usage % 的 HTTP、错误码或请求 ID 不一致', target.usage_record_id;
      END IF;
    ELSE
      IF usage_record.error IS DISTINCT FROM '经方舟官方任务列表核对，供应商未创建任务；历史提交结果未知任务已确认失败并退回积分。' THEN
        RAISE EXCEPTION '061 拒绝建立零成本候选：usage % 的人工核对回执不一致', target.usage_record_id;
      END IF;
      SELECT count(*) INTO manual_audit_count
      FROM audit_logs existing_manual_audit
      WHERE existing_manual_audit.module = '生成任务'
        AND existing_manual_audit.target = target.task_id::text
        AND existing_manual_audit.risk = 'high'
        AND (
          (
            target.task_id = 'd87b78a4-a83a-4e99-9322-c5c31a1341ba'::uuid
            AND existing_manual_audit.action = '历史待核对收口'
            AND existing_manual_audit.detail =
              '方舟官方任务列表确认未创建外部任务；将历史提交结果未知任务收口为失败并退回冻结积分。'
          )
          OR (
            target.task_id = '937acb17-c72c-4eeb-b22d-458dc9ee5431'::uuid
            AND existing_manual_audit.action = '人工退回积分'
            AND existing_manual_audit.detail =
              '方舟官方任务列表确认未创建外部任务；将历史取消待核对任务收口并退回冻结积分。'
          )
        );
      IF manual_audit_count < 1 THEN
        RAISE EXCEPTION '061 拒绝建立零成本候选：任务 % 缺少管理员高风险审计', target.task_id;
      END IF;
    END IF;

    expected_evidence := jsonb_build_object(
      'resolutionKind', 'zero-cost',
      'resolutionVersion', '2026-07-26-v1',
      'evidenceType', target.evidence_type,
      'taskId', target.task_id,
      'usageRecordId', target.usage_record_id,
      'requestId', request_id,
      'providerTaskId', NULL,
      'providerHttpStatus', CASE WHEN target.evidence_type = 'http-400' THEN 400 ELSE NULL END,
      'providerErrorCode', target.error_code,
      'submissionDisposition', 'not-created',
      'billingDisposition', 'unbilled',
      'failureReason', usage_record.error,
      'billPeriod', '2026-07',
      'expenseDate', target.accounting_date,
      'localAccountingDate', target.accounting_date,
      'model', target.model,
      'pricingResolutionBand', '480p-720p',
      'pricingInputClass', target.pricing_input_class,
      'unitPricePerMillion', to_char(target.unit_price_per_million, 'FM999999990.000000'),
      'providerLookup', jsonb_build_object(
        'attempted', target.evidence_type = 'manual-audit',
        'outcome', 'provider-task-not-created',
        'note', CASE
          WHEN target.evidence_type = 'manual-audit'
            THEN '管理员已通过方舟官方任务列表确认未创建外部任务'
          ELSE '供应商在创建阶段以 HTTP 400 确定性拒绝，未生成供应商任务 ID'
        END
      ),
      'review', jsonb_build_object(
        'status', 'pending-final-bill',
        'reason', '2026-07 官方账单尚未形成稳定 final 快照',
        'reconciliationRunId', NULL,
        'billState', 'provisional',
        'coverageState', 'partial',
        'residualTokens', '0',
        'residualCostCny', '0.000000',
        'reviewedAt', NULL
      ),
      'note', '账户账单桶级零成本候选；不代表供应商返回了逐任务零 Token 回执'
    );
    expected_evidence_hash := encode(digest((expected_evidence - 'review')::text, 'sha256'), 'hex');

    SELECT * INTO reconciliation_case
    FROM provider_reconciliation_cases
    WHERE provider = 'volcengine-ark'
      AND case_key = 'zero-cost:' || target.usage_record_id::text
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO provider_reconciliation_cases (
        provider, case_key, bill_period, case_type, status, root_cause,
        confidence, token_adjustment, cost_adjustment_cny,
        official_expense_date, local_accounting_date, evidence, evidence_hash
      ) VALUES (
        'volcengine-ark', 'zero-cost:' || target.usage_record_id::text,
        '2026-07', 'missing-local-usage', 'open',
        'provider-rejected-before-billing', 'high', 0, 0,
        target.accounting_date, target.accounting_date,
        expected_evidence, expected_evidence_hash
      )
      RETURNING * INTO reconciliation_case;
    END IF;

    IF reconciliation_case.bill_period IS DISTINCT FROM '2026-07'
      OR reconciliation_case.case_type IS DISTINCT FROM 'missing-local-usage'
      OR reconciliation_case.status NOT IN ('open', 'approved', 'superseded')
      OR reconciliation_case.root_cause IS DISTINCT FROM 'provider-rejected-before-billing'
      OR reconciliation_case.confidence IS DISTINCT FROM 'high'
      OR reconciliation_case.token_adjustment IS DISTINCT FROM 0
      OR reconciliation_case.cost_adjustment_cny IS DISTINCT FROM 0
      OR reconciliation_case.official_expense_date IS DISTINCT FROM target.accounting_date
      OR reconciliation_case.local_accounting_date IS DISTINCT FROM target.accounting_date
      OR reconciliation_case.evidence_hash IS DISTINCT FROM expected_evidence_hash
      OR (reconciliation_case.evidence - 'review') IS DISTINCT FROM (expected_evidence - 'review')
    THEN
      RAISE EXCEPTION '061 拒绝建立零成本候选：案件 % 与确定性证据冲突', reconciliation_case.case_key;
    END IF;

    SELECT count(*) INTO existing_link_count
    FROM provider_reconciliation_case_links
    WHERE case_id = reconciliation_case.id;
    IF existing_link_count = 0 THEN
      INSERT INTO provider_reconciliation_case_links (
        case_id, usage_record_id, bill_detail_id, bill_detail_revision_id,
        allocated_tokens, allocated_cost_cny
      ) VALUES (reconciliation_case.id, target.usage_record_id, NULL, NULL, 0, 0);
    ELSIF existing_link_count <> 1 OR NOT EXISTS (
      SELECT 1 FROM provider_reconciliation_case_links
      WHERE case_id = reconciliation_case.id
        AND usage_record_id = target.usage_record_id
        AND bill_detail_id IS NULL
        AND bill_detail_revision_id IS NULL
        AND allocated_tokens = 0
        AND allocated_cost_cny = 0
    ) THEN
      RAISE EXCEPTION '061 拒绝建立零成本候选：案件 % 的 usage 链接不唯一', reconciliation_case.case_key;
    END IF;

    audit_detail := jsonb_build_object(
      'migration', '061_close_zero_cost_candidates.sql',
      'version', '2026-07-26-v1',
      'caseId', reconciliation_case.id,
      'caseKey', reconciliation_case.case_key,
      'taskId', target.task_id,
      'usageRecordId', target.usage_record_id,
      'requestId', request_id,
      'providerErrorCode', target.error_code,
      'evidenceType', target.evidence_type,
      'initialStatus', 'open',
      'reason', '等待 2026-07 稳定 final 账单及唯一计价桶零残差后确认零成本',
      'protectedFields', jsonb_build_array(
        'completion_tokens', 'total_tokens', 'billable_tokens',
        'estimated_cost', 'task_status', 'credit_status'
      )
    )::text;
    INSERT INTO audit_logs (
      admin_user_id, admin_email, module, action, target, risk, detail
    )
    SELECT NULL, 'system@lindyson.local', 'API成本与用量',
           '建立历史零成本候选', reconciliation_case.case_key, 'high', audit_detail
    WHERE NOT EXISTS (
      SELECT 1 FROM audit_logs AS existing_audit
      WHERE existing_audit.module = 'API成本与用量'
        AND existing_audit.action = '建立历史零成本候选'
        AND existing_audit.target = reconciliation_case.case_key
        AND existing_audit.risk = 'high'
        AND existing_audit.detail = audit_detail
    );
  END LOOP;
END
$$;
