-- 修正 036 中仅针对历史任务 594a9f42 的跨日案件硬编码。
-- 案件是否成立必须由链接后的官方费用日与本地记账日决定，不能由计划中的日期推断。
DO $$
DECLARE
  seeded_case provider_reconciliation_cases%ROWTYPE;
  total_link_count integer;
  matched_link_count integer;
  actual_official_date date;
  actual_local_date date;
  updated_count integer;
BEGIN
  SELECT *
  INTO seeded_case
  FROM provider_reconciliation_cases
  WHERE provider = 'volcengine-ark'
    AND case_key = 'cross-date:594a9f42-aca0-4b8c-aa6d-e892a9753721'
  FOR UPDATE;

  -- 没有对应历史数据的新环境无需修正；重复执行保持幂等。
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF seeded_case.bill_period <> '2026-07'
    OR seeded_case.case_type <> 'cross-date'
    OR seeded_case.status NOT IN ('approved', 'superseded')
    OR seeded_case.root_cause <> 'provider-accounting-cutoff'
    OR seeded_case.confidence <> 'high'
    OR seeded_case.token_adjustment <> 50638
    OR seeded_case.cost_adjustment_cny <> 1.164674
    OR seeded_case.evidence->>'taskId' <> '594a9f42-aca0-4b8c-aa6d-e892a9753721'
    OR seeded_case.evidence->>'officialDetailKey' <> 'Detail7660684150990934307'
    OR seeded_case.evidence_hash <> encode(
      digest('cross-date:594a9f42-aca0-4b8c-aa6d-e892a9753721:2026-07-01', 'sha256'),
      'hex'
    )
  THEN
    RAISE EXCEPTION '037 拒绝修正：跨日案件元数据与 036 的确定性清单不一致';
  END IF;

  SELECT count(*)
  INTO total_link_count
  FROM provider_reconciliation_case_links
  WHERE case_id = seeded_case.id;

  SELECT
    count(*),
    min(details.expense_date),
    min(usage.local_accounting_date)
  INTO matched_link_count, actual_official_date, actual_local_date
  FROM provider_reconciliation_case_links links
  JOIN provider_usage_records usage
    ON usage.id = links.usage_record_id
  JOIN provider_bill_details details
    ON details.id = links.bill_detail_id
  LEFT JOIN provider_bill_detail_revisions revisions
    ON revisions.id = links.bill_detail_revision_id
  WHERE links.case_id = seeded_case.id
    AND usage.provider = 'volcengine-ark'
    AND usage.task_id = '594a9f42-aca0-4b8c-aa6d-e892a9753721'::uuid
    AND usage.billable_tokens = 50638
    AND usage.estimated_cost = 1.164674
    AND details.provider = 'volcengine-ark'
    AND details.source_detail_key = 'Detail7660684150990934307'
    AND details.billable_tokens = 50638
    AND details.list_equivalent_cost_cny = 1.164674
    AND details.active = true
    AND links.allocated_tokens = 50638
    AND links.allocated_cost_cny = 1.164674
    AND (
      links.bill_detail_revision_id IS NULL
      OR (
        revisions.provider = details.provider
        AND revisions.source_detail_key = details.source_detail_key
        AND revisions.normalized_payload->>'expenseDate' = details.expense_date::text
      )
    );

  IF total_link_count <> 1
    OR matched_link_count <> 1
    OR actual_official_date IS NULL
    OR actual_local_date IS NULL
  THEN
    RAISE EXCEPTION '037 拒绝修正：跨日案件证据链接不唯一或不完整';
  END IF;

  -- 两端实际记账日相同，案件属于 036 的错误硬编码；保留案件和链接作为审计证据。
  IF actual_official_date = actual_local_date THEN
    UPDATE provider_reconciliation_cases
    SET status = 'superseded'
    WHERE id = seeded_case.id
      AND status = 'approved';

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    IF updated_count = 1 THEN
      INSERT INTO audit_logs (
        admin_user_id, admin_email, module, action, target, risk, detail
      )
      VALUES (
        NULL,
        'system@lindyson.local',
        'API成本与用量',
        '纠正错误跨日案件',
        seeded_case.case_key,
        'high',
        jsonb_build_object(
          'migration', '037_correct_seeded_cross_date_case.sql',
          'caseId', seeded_case.id,
          'taskId', '594a9f42-aca0-4b8c-aa6d-e892a9753721',
          'officialDetailKey', 'Detail7660684150990934307',
          'reason', '036 硬编码了错误官方日期；实际官方费用日与本地记账日相同',
          'actualOfficialDate', actual_official_date,
          'actualLocalDate', actual_local_date,
          'previousStatus', 'approved',
          'newStatus', 'superseded'
        )::text
      );
    ELSIF seeded_case.status <> 'superseded' THEN
      RAISE EXCEPTION '037 拒绝修正：错误跨日案件状态无法安全更新';
    END IF;

    RETURN;
  END IF;

  -- 若确实跨日，仅在案件日期与两端原始证据一致时保留。
  IF seeded_case.status = 'approved'
    AND seeded_case.official_expense_date = actual_official_date
    AND seeded_case.local_accounting_date = actual_local_date
  THEN
    RETURN;
  END IF;

  RAISE EXCEPTION
    '037 拒绝修正：案件日期（% / %）与原始证据（% / %）不一致',
    seeded_case.official_expense_date,
    seeded_case.local_accounting_date,
    actual_official_date,
    actual_local_date;
END
$$;
