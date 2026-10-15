-- 部署、API 冒烟和供应商诊断会真实触达供应商并产生费用，但它们不是站内生成任务。
-- 本迁移为这些运营调用建立独立、不可变的事实账本；不得借此伪造生成任务、资产或积分流水。

CREATE TABLE IF NOT EXISTS provider_operational_usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_version text NOT NULL,
  manifest_id text NOT NULL,
  manifest_sha256 char(64) NOT NULL,
  provider text NOT NULL,
  service_type text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL,
  cost_owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose text NOT NULL,
  initiator_type text NOT NULL,
  initiated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  source_run_id text NOT NULL,
  source_item_key text NOT NULL,
  provider_task_id text,
  provider_operation_id text,
  provider_request_id text,
  status text NOT NULL,
  provider_reached boolean NOT NULL,
  occurred_at timestamptz NOT NULL,
  local_accounting_date date NOT NULL,
  usage_evidence jsonb NOT NULL,
  evidence_path text NOT NULL,
  evidence_sha256 char(64) NOT NULL,
  evidence_status text NOT NULL,
  evidence_attestation jsonb,
  historical_call_fingerprint_sha256 char(64),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, source_run_id, source_item_key),
  CHECK (manifest_version = 'lindyson.provider-operational-usage/v1'),
  CHECK (manifest_id = btrim(manifest_id) AND manifest_id <> ''),
  CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (provider = btrim(provider) AND provider <> ''),
  CHECK (service_type IN ('video', 'image', 'multimodal')),
  CHECK (model = btrim(model) AND model <> ''),
  CHECK (operation = btrim(operation) AND operation <> ''),
  CHECK (purpose IN ('deployment-canary', 'api-smoke-test', 'provider-diagnostic', 'admin-direct')),
  CHECK (initiator_type IN ('admin-user', 'release-automation', 'maintenance-script')),
  CHECK (initiator_type <> 'admin-user' OR initiated_by_user_id IS NOT NULL),
  CHECK (source_run_id = btrim(source_run_id) AND source_run_id <> ''),
  CHECK (source_item_key = btrim(source_item_key) AND source_item_key <> ''),
  -- 外部 ID 列只存真实 Provider ID。只有指纹而没有原值时必须留空，并把
  -- 指纹明确放入 usage_evidence，不能用哈希值冒充可对账的外部 ID。
  CHECK (provider_task_id IS NULL OR (
    provider_task_id = btrim(provider_task_id) AND provider_task_id <> ''
    AND provider_task_id !~ '^sha256:[0-9a-f]{16,64}$'
  )),
  CHECK (provider_operation_id IS NULL OR (
    provider_operation_id = btrim(provider_operation_id) AND provider_operation_id <> ''
    AND provider_operation_id !~ '^sha256:[0-9a-f]{16,64}$'
  )),
  CHECK (provider_request_id IS NULL OR (
    provider_request_id = btrim(provider_request_id) AND provider_request_id <> ''
    AND provider_request_id !~ '^sha256:[0-9a-f]{16,64}$'
  )),
  CHECK (status IN ('success', 'failed', 'unknown')),
  CHECK (provider_reached),
  CHECK (status <> 'success' OR provider_reached),
  CHECK (
    provider_reached
    OR (
      provider_task_id IS NULL
      AND provider_operation_id IS NULL
      AND provider_request_id IS NULL
    )
  ),
  CHECK (local_accounting_date = (occurred_at AT TIME ZONE 'Asia/Shanghai')::date),
  CHECK (recorded_at >= occurred_at),
  CHECK (jsonb_typeof(usage_evidence) = 'object'),
  CHECK (evidence_path = btrim(evidence_path) AND evidence_path <> ''),
  CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$')
);

-- 旧版 076 已经只能在逐字验证原文件后导入，因此重放新增列时可安全把既有行
-- 标记为 verified。缺文件历史事实必须由导入器写入独立管理员审批快照。
ALTER TABLE provider_operational_usage_records
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS evidence_attestation jsonb,
  ADD COLUMN IF NOT EXISTS historical_call_fingerprint_sha256 char(64);

-- DEFAULT 只用于旧版 076 重放时回填既有行；所有后续写入必须显式声明证据状态。
ALTER TABLE provider_operational_usage_records
  ALTER COLUMN evidence_status DROP DEFAULT;

ALTER TABLE provider_operational_usage_records
  DROP CONSTRAINT IF EXISTS provider_operational_usage_evidence_status_check;
ALTER TABLE provider_operational_usage_records
  ADD CONSTRAINT provider_operational_usage_evidence_status_check CHECK (
    (
      evidence_status = 'verified'
      AND evidence_attestation IS NULL
      AND historical_call_fingerprint_sha256 IS NULL
    )
    OR (
      evidence_status = 'admin-confirmed-missing-original'
      AND provider_task_id IS NULL
      AND provider_operation_id IS NULL
      AND provider_request_id IS NULL
      AND evidence_attestation IS NOT NULL
      AND jsonb_typeof(evidence_attestation) = 'object'
      AND historical_call_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      AND (evidence_attestation->>'manifestSha256') IS NOT DISTINCT FROM
        manifest_sha256::text
      AND (evidence_attestation->>'callFingerprintSha256') IS NOT DISTINCT FROM
        historical_call_fingerprint_sha256::text
      AND coalesce(evidence_attestation->>'approvalId' = btrim(evidence_attestation->>'approvalId'), false)
      AND coalesce(evidence_attestation->>'approvalId' <> '', false)
      AND coalesce(evidence_attestation->>'approvedAt'
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$', false)
      AND coalesce(evidence_attestation->>'manifestGeneratedAt'
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$', false)
      AND recorded_at >= (evidence_attestation->>'approvedAt')::timestamptz
      AND (evidence_attestation->>'approvedAt')::timestamptz
        <= '2026-08-12T02:32:09.000Z'::timestamptz
      AND (evidence_attestation->>'manifestGeneratedAt')::timestamptz
        <= '2026-08-12T02:32:09.000Z'::timestamptz
      AND occurred_at <= '2026-08-12T02:32:09.000Z'::timestamptz
      AND (evidence_attestation->>'approvalVersion') IS NOT DISTINCT FROM
        'lindyson.provider-operational-usage-missing-evidence-approval/v1'
      AND coalesce(evidence_attestation->>'approvalSha256' ~ '^[0-9a-f]{64}$', false)
      AND (evidence_attestation->>'approvedByUserId') IS NOT DISTINCT FROM cost_owner_user_id::text
      AND (evidence_attestation->>'reason') IS NOT DISTINCT FROM
        'historical-original-evidence-unavailable'
      AND (evidence_attestation#>>'{decision,countAsAdminOperationalCost}')
        IS NOT DISTINCT FROM 'true'
      AND (evidence_attestation#>>'{decision,allowProviderExternalIdClaims}')
        IS NOT DISTINCT FROM 'false'
      AND (evidence_attestation#>>'{decision,allowOfficialBillAttribution}')
        IS NOT DISTINCT FROM 'false'
    )
  );

CREATE INDEX IF NOT EXISTS idx_provider_operational_usage_owner_period
  ON provider_operational_usage_records(cost_owner_user_id, local_accounting_date, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_provider_operational_usage_service_period
  ON provider_operational_usage_records(service_type, local_accounting_date, model, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_provider_operational_usage_purpose_period
  ON provider_operational_usage_records(purpose, local_accounting_date, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_provider_operational_usage_manifest
  ON provider_operational_usage_records(manifest_sha256, manifest_id);

CREATE INDEX IF NOT EXISTS idx_provider_operational_usage_evidence_status
  ON provider_operational_usage_records(evidence_status, local_accounting_date, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_operational_usage_provider_task
  ON provider_operational_usage_records(provider, provider_task_id)
  WHERE provider_task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_operational_usage_provider_operation
  ON provider_operational_usage_records(provider, provider_operation_id)
  WHERE provider_operation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_operational_usage_provider_request
  ON provider_operational_usage_records(provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_operational_usage_historical_fingerprint
  ON provider_operational_usage_records(provider, historical_call_fingerprint_sha256)
  WHERE historical_call_fingerprint_sha256 IS NOT NULL;

-- 同一 Provider 外部 ID 不得因被放入 task/operation/request 不同字段而重复计费。
-- 三个分栏索引只能防住“同栏重复”；独立技术注册表把三个字段归一为一个唯一键，
-- 由 PostgreSQL 唯一约束处理并发竞争。它不是第四类业务事实，也不保存费用或用量。
CREATE TABLE IF NOT EXISTS provider_operational_usage_external_id_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_id text NOT NULL,
  identifier_kind text NOT NULL,
  operational_usage_record_id uuid NOT NULL
    REFERENCES provider_operational_usage_records(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id),
  UNIQUE (operational_usage_record_id, identifier_kind),
  CHECK (provider = btrim(provider) AND provider <> ''),
  CHECK (external_id = btrim(external_id) AND external_id <> ''),
  CHECK (identifier_kind IN ('task', 'operation', 'request'))
);

-- 迁移重放时也拒绝接受旧版本曾留下的跨字段重复，随后把既有三列回填到技术注册表。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT provider, provider_task_id AS external_id
      FROM provider_operational_usage_records
      WHERE provider_task_id IS NOT NULL
      UNION ALL
      SELECT provider, provider_operation_id
      FROM provider_operational_usage_records
      WHERE provider_operation_id IS NOT NULL
      UNION ALL
      SELECT provider, provider_request_id
      FROM provider_operational_usage_records
      WHERE provider_request_id IS NOT NULL
    ) identifiers
    GROUP BY provider, external_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'provider_operational_usage_records 存在跨标识字段重复的 Provider 外部 ID';
  END IF;
END;
$$;

INSERT INTO provider_operational_usage_external_id_registry (
  provider, external_id, identifier_kind, operational_usage_record_id
)
SELECT provider, external_id, identifier_kind, operational_usage_record_id
FROM (
  SELECT provider, provider_task_id AS external_id, 'task' AS identifier_kind, id AS operational_usage_record_id
  FROM provider_operational_usage_records
  WHERE provider_task_id IS NOT NULL
  UNION ALL
  SELECT provider, provider_operation_id, 'operation', id
  FROM provider_operational_usage_records
  WHERE provider_operation_id IS NOT NULL
  UNION ALL
  SELECT provider, provider_request_id, 'request', id
  FROM provider_operational_usage_records
  WHERE provider_request_id IS NOT NULL
) identifiers
ON CONFLICT (provider, external_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM provider_operational_usage_records usage
    CROSS JOIN LATERAL (
      VALUES
        ('task', usage.provider_task_id),
        ('operation', usage.provider_operation_id),
        ('request', usage.provider_request_id)
    ) expected(identifier_kind, external_id)
    LEFT JOIN provider_operational_usage_external_id_registry registry
      ON registry.provider = usage.provider
     AND registry.external_id = expected.external_id
     AND registry.identifier_kind = expected.identifier_kind
     AND registry.operational_usage_record_id = usage.id
    WHERE expected.external_id IS NOT NULL
      AND registry.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Provider 外部 ID 技术注册表与运营调用事实不一致';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION register_provider_operational_external_ids_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO provider_operational_usage_external_id_registry (
    provider, external_id, identifier_kind, operational_usage_record_id
  )
  SELECT NEW.provider, external_id, identifier_kind, NEW.id
  FROM (
    VALUES
      ('task', NEW.provider_task_id),
      ('operation', NEW.provider_operation_id),
      ('request', NEW.provider_request_id)
  ) identifiers(identifier_kind, external_id)
  WHERE external_id IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_operational_usage_external_ids_guard
  ON provider_operational_usage_records;
CREATE TRIGGER provider_operational_usage_external_ids_guard
AFTER INSERT ON provider_operational_usage_records
FOR EACH ROW EXECUTE FUNCTION register_provider_operational_external_ids_insert();

-- 估值是价格证据快照，不是官方应付金额。价格证据修订必须插入后继记录，禁止原地覆盖。
CREATE TABLE IF NOT EXISTS provider_operational_usage_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_usage_record_id uuid NOT NULL
    REFERENCES provider_operational_usage_records(id) ON DELETE RESTRICT,
  pricing_status text NOT NULL,
  price_version text,
  pricing_source_url text,
  unit_price_snapshot jsonb,
  estimated_cost_cny numeric(20, 6),
  currency char(3) NOT NULL DEFAULT 'CNY',
  evidence_sha256 char(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  supersedes_valuation_id uuid
    REFERENCES provider_operational_usage_valuations(id) ON DELETE RESTRICT,
  CHECK (pricing_status IN ('priced', 'unpriced', 'missing-evidence')),
  CHECK (currency = 'CNY'),
  CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (price_version IS NULL OR (price_version = btrim(price_version) AND price_version <> '')),
  CHECK (pricing_source_url IS NULL OR (pricing_source_url = btrim(pricing_source_url) AND pricing_source_url <> '')),
  CHECK (unit_price_snapshot IS NULL OR jsonb_typeof(unit_price_snapshot) = 'object'),
  CHECK (
    (
      pricing_status = 'priced'
      AND price_version IS NOT NULL
      AND pricing_source_url IS NOT NULL
      AND unit_price_snapshot IS NOT NULL
      AND estimated_cost_cny IS NOT NULL
      AND estimated_cost_cny >= 0
    )
    OR (
      pricing_status IN ('unpriced', 'missing-evidence')
      AND estimated_cost_cny IS NULL
    )
  ),
  CHECK (supersedes_valuation_id IS NULL OR supersedes_valuation_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_operational_valuation_root
  ON provider_operational_usage_valuations(operational_usage_record_id)
  WHERE supersedes_valuation_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_operational_valuation_successor
  ON provider_operational_usage_valuations(supersedes_valuation_id)
  WHERE supersedes_valuation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_operational_valuation_recorded
  ON provider_operational_usage_valuations(operational_usage_record_id, recorded_at DESC, id DESC);

-- 官方账单只能在取得不可变 bill revision 后追加归属。link/supersede/void 都是独立事件，
-- 当前有效归属必须按“无后继且非 void”的叶子事件折叠，禁止原地覆盖或删除。
-- 只有 direct/high 的唯一匹配才允许成为归属事实；medium/low 候选只能留在审计证据中，
-- 不能让官方账单行从 unattributed 被推断成 admin-operational。
CREATE TABLE IF NOT EXISTS provider_bill_attribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribution_key text NOT NULL,
  event_type text NOT NULL,
  operational_usage_record_id uuid NOT NULL
    REFERENCES provider_operational_usage_records(id) ON DELETE RESTRICT,
  provider_bill_detail_id uuid NOT NULL
    REFERENCES provider_bill_details(id) ON DELETE RESTRICT,
  provider_bill_detail_revision_id uuid NOT NULL
    REFERENCES provider_bill_detail_revisions(id) ON DELETE RESTRICT,
  allocated_billable_tokens bigint,
  allocated_usage_count numeric(30, 6),
  allocated_cost_cny numeric(20, 6) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'CNY',
  confidence text NOT NULL,
  evidence jsonb NOT NULL,
  evidence_sha256 char(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  supersedes_event_id uuid
    REFERENCES provider_bill_attribution_events(id) ON DELETE RESTRICT,
  CHECK (attribution_key = btrim(attribution_key) AND attribution_key <> ''),
  CHECK (event_type IN ('link', 'supersede', 'void')),
  CHECK (
    (event_type = 'link' AND supersedes_event_id IS NULL)
    OR (event_type IN ('supersede', 'void') AND supersedes_event_id IS NOT NULL)
  ),
  CHECK (allocated_billable_tokens IS NULL OR allocated_billable_tokens >= 0),
  CHECK (allocated_usage_count IS NULL OR allocated_usage_count >= 0),
  CHECK (allocated_cost_cny >= 0),
  CHECK (currency = 'CNY'),
  CHECK (confidence IN ('direct', 'high')),
  CHECK (jsonb_typeof(evidence) = 'object'),
  CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_bill_attribution_event_root
  ON provider_bill_attribution_events(attribution_key)
  WHERE event_type = 'link';

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_bill_attribution_event_successor
  ON provider_bill_attribution_events(supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_bill_attribution_event_usage
  ON provider_bill_attribution_events(operational_usage_record_id, recorded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_provider_bill_attribution_event_bill
  ON provider_bill_attribution_events(provider_bill_detail_id, recorded_at DESC, id DESC);

-- 每个 manifest SHA 只允许一条高风险导入审计。导入器还会逐字段校验已存在记录，
-- 因此相同事实可幂等重放，任何同 target 的异构审计都会 fail closed。
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_provider_operational_usage_manifest
  ON audit_logs(target)
  WHERE module = 'API成本与用量'
    AND action = '导入供应商运营调用证据'
    AND risk = 'high';

CREATE OR REPLACE FUNCTION validate_provider_operational_valuation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  usage_provider_reached boolean;
  usage_recorded_at timestamptz;
  previous provider_operational_usage_valuations%ROWTYPE;
BEGIN
  SELECT provider_reached, recorded_at
  INTO usage_provider_reached, usage_recorded_at
  FROM provider_operational_usage_records
  WHERE id = NEW.operational_usage_record_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '运营用量记录不存在：record=%', NEW.operational_usage_record_id;
  END IF;

  IF NEW.recorded_at < usage_recorded_at THEN
    RAISE EXCEPTION '估值记录时间不得早于运营用量事实：record=%', NEW.operational_usage_record_id;
  END IF;

  IF NEW.pricing_status = 'priced' AND NOT usage_provider_reached THEN
    RAISE EXCEPTION '未触达供应商的运营调用不得写入估算成本：record=%', NEW.operational_usage_record_id;
  END IF;

  IF NEW.supersedes_valuation_id IS NOT NULL THEN
    SELECT * INTO previous
    FROM provider_operational_usage_valuations
    WHERE id = NEW.supersedes_valuation_id
    FOR KEY SHARE;

    IF NOT FOUND OR previous.operational_usage_record_id <> NEW.operational_usage_record_id THEN
      RAISE EXCEPTION '估值后继必须属于同一运营用量记录：record=%', NEW.operational_usage_record_id;
    END IF;
    IF NEW.recorded_at < previous.recorded_at THEN
      RAISE EXCEPTION '估值后继时间不得早于前一版本：record=%', NEW.operational_usage_record_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_operational_valuation_insert_guard
  ON provider_operational_usage_valuations;
CREATE TRIGGER provider_operational_valuation_insert_guard
BEFORE INSERT ON provider_operational_usage_valuations
FOR EACH ROW EXECUTE FUNCTION validate_provider_operational_valuation_insert();

CREATE OR REPLACE FUNCTION validate_provider_bill_attribution_event_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  usage_provider text;
  usage_provider_reached boolean;
  usage_evidence_status text;
  bill_provider text;
  bill_source_detail_key text;
  revision_provider text;
  revision_source_detail_key text;
  usage_recorded_at timestamptz;
  revision_observed_at timestamptz;
  previous provider_bill_attribution_events%ROWTYPE;
BEGIN
  SELECT provider, provider_reached, evidence_status, recorded_at
  INTO usage_provider, usage_provider_reached, usage_evidence_status, usage_recorded_at
  FROM provider_operational_usage_records
  WHERE id = NEW.operational_usage_record_id
  FOR KEY SHARE;

  SELECT provider, source_detail_key INTO bill_provider, bill_source_detail_key
  FROM provider_bill_details
  WHERE id = NEW.provider_bill_detail_id
  FOR KEY SHARE;

  SELECT provider, source_detail_key, observed_at
  INTO revision_provider, revision_source_detail_key, revision_observed_at
  FROM provider_bill_detail_revisions
  WHERE id = NEW.provider_bill_detail_revision_id
  FOR KEY SHARE;

  IF usage_provider IS NULL
     OR bill_provider IS NULL
     OR revision_provider IS NULL
     OR usage_provider <> bill_provider
     OR bill_provider <> revision_provider
     OR bill_source_detail_key <> revision_source_detail_key THEN
    RAISE EXCEPTION '运营用量、官方账单及不可变 revision 必须属于同一供应商账单明细';
  END IF;

  IF NOT usage_provider_reached THEN
    RAISE EXCEPTION '未触达供应商的运营调用不得归属官方账单：record=%', NEW.operational_usage_record_id;
  END IF;

  IF usage_evidence_status = 'admin-confirmed-missing-original' THEN
    RAISE EXCEPTION '管理员确认的缺文件历史运营调用只能计入列表价成本，不得归属官方账单：record=%',
      NEW.operational_usage_record_id;
  END IF;

  IF NEW.recorded_at < usage_recorded_at OR NEW.recorded_at < revision_observed_at THEN
    RAISE EXCEPTION '账单归属事件时间不得早于运营事实或官方账单 revision：key=%', NEW.attribution_key;
  END IF;

  IF NEW.supersedes_event_id IS NOT NULL THEN
    SELECT * INTO previous
    FROM provider_bill_attribution_events
    WHERE id = NEW.supersedes_event_id
    FOR KEY SHARE;

    IF NOT FOUND
       OR previous.attribution_key <> NEW.attribution_key
       OR previous.operational_usage_record_id <> NEW.operational_usage_record_id THEN
      RAISE EXCEPTION '账单归属后继必须属于同一归属键和运营用量记录：key=%', NEW.attribution_key;
    END IF;
    IF previous.event_type = 'void' THEN
      RAISE EXCEPTION 'void 归属事件为终结事件，不得再追加后继：key=%', NEW.attribution_key;
    END IF;
    IF NEW.recorded_at < previous.recorded_at THEN
      RAISE EXCEPTION '账单归属后继时间不得早于前一版本：key=%', NEW.attribution_key;
    END IF;
    IF NEW.event_type = 'void' AND (
      NEW.provider_bill_detail_id <> previous.provider_bill_detail_id
      OR NEW.provider_bill_detail_revision_id <> previous.provider_bill_detail_revision_id
      OR NEW.allocated_billable_tokens IS DISTINCT FROM previous.allocated_billable_tokens
      OR NEW.allocated_usage_count IS DISTINCT FROM previous.allocated_usage_count
      OR NEW.allocated_cost_cny IS DISTINCT FROM previous.allocated_cost_cny
      OR NEW.currency <> previous.currency
    ) THEN
      RAISE EXCEPTION 'void 事件只能作废前件，不得改写账单或分配金额：key=%', NEW.attribution_key;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_bill_attribution_event_insert_guard
  ON provider_bill_attribution_events;
CREATE TRIGGER provider_bill_attribution_event_insert_guard
BEFORE INSERT ON provider_bill_attribution_events
FOR EACH ROW EXECUTE FUNCTION validate_provider_bill_attribution_event_insert();

CREATE OR REPLACE FUNCTION reject_provider_operational_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '运营调用、估值和账单归属均为不可变事实，禁止 %：table=% id=%',
    TG_OP, TG_TABLE_NAME, OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS provider_operational_usage_records_immutable
  ON provider_operational_usage_records;
CREATE TRIGGER provider_operational_usage_records_immutable
BEFORE UPDATE OR DELETE ON provider_operational_usage_records
FOR EACH ROW EXECUTE FUNCTION reject_provider_operational_ledger_mutation();

DROP TRIGGER IF EXISTS provider_operational_usage_external_id_registry_immutable
  ON provider_operational_usage_external_id_registry;
CREATE TRIGGER provider_operational_usage_external_id_registry_immutable
BEFORE UPDATE OR DELETE ON provider_operational_usage_external_id_registry
FOR EACH ROW EXECUTE FUNCTION reject_provider_operational_ledger_mutation();

DROP TRIGGER IF EXISTS provider_operational_usage_valuations_immutable
  ON provider_operational_usage_valuations;
CREATE TRIGGER provider_operational_usage_valuations_immutable
BEFORE UPDATE OR DELETE ON provider_operational_usage_valuations
FOR EACH ROW EXECUTE FUNCTION reject_provider_operational_ledger_mutation();

DROP TRIGGER IF EXISTS provider_bill_attribution_events_immutable
  ON provider_bill_attribution_events;
CREATE TRIGGER provider_bill_attribution_events_immutable
BEFORE UPDATE OR DELETE ON provider_bill_attribution_events
FOR EACH ROW EXECUTE FUNCTION reject_provider_operational_ledger_mutation();

-- 归属事件引用的官方 revision 本身也必须不可变；否则账本事件虽然追加式，
-- 其指向的官方金额和原始 payload 仍可能被原地改写。
DROP TRIGGER IF EXISTS provider_bill_detail_revisions_immutable
  ON provider_bill_detail_revisions;
CREATE TRIGGER provider_bill_detail_revisions_immutable
BEFORE UPDATE OR DELETE ON provider_bill_detail_revisions
FOR EACH ROW EXECUTE FUNCTION reject_provider_operational_ledger_mutation();
