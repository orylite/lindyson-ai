-- 生成任务供应商执行与业务重试解耦。
-- generation_tasks.attempt 只表示用户/管理员触发的业务重试次数；worker 接管通过
-- claim_token / claim_epoch 和 generation_provider_runs.lease_token 进行围栏。

ALTER TABLE generation_tasks
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_epoch integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancel_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS active_provider_run_id uuid;

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_claim_epoch_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_claim_epoch_check CHECK (claim_epoch >= 0);

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_cancel_state_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_cancel_state_check
  CHECK (cancel_state IN ('none', 'requested', 'pending-provider', 'canceled', 'settled'));

CREATE TABLE IF NOT EXISTS generation_provider_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
  task_attempt integer NOT NULL CHECK (task_attempt >= 0),
  provider text NOT NULL DEFAULT 'volcengine-ark',
  request_hash text NOT NULL,
  submission_key text NOT NULL UNIQUE,
  callback_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'submitting', 'submitted', 'submission-unknown',
    'provider-running', 'provider-succeeded', 'provider-failed',
    'archiving', 'settlement-pending', 'settled', 'refunded',
    'delivery-failed', 'manual-review'
  )),
  provider_task_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  output_object_key text NOT NULL,
  thumbnail_object_key text,
  staging_object_key text NOT NULL,
  provider_result jsonb,
  recovery_token uuid,
  last_error text,
  submitted_at timestamptz,
  provider_terminal_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, task_attempt)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_provider_runs_provider_task
  ON generation_provider_runs(provider, provider_task_id)
  WHERE provider_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_provider_runs_reconcile
  ON generation_provider_runs(status, lease_expires_at, created_at)
  WHERE status IN (
    'prepared', 'submitting', 'submitted', 'provider-running',
    'provider-succeeded', 'archiving', 'settlement-pending', 'delivery-failed'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM generation_tasks task
    LEFT JOIN assets asset ON asset.id = task.asset_id
    WHERE task.status = 'completed'
      AND (asset.id IS NULL OR asset.object_key IS NULL OR asset.deletion_status <> 'active')
  ) THEN
    RAISE EXCEPTION '发现 completed 生成任务缺少活动成片资产';
  END IF;
END
$$;

-- 历史任务按已有事实回填；processing 且没有 provider_task_id 的任务无法证明 POST
-- 是否已经被供应商接受，必须进入 submission-unknown，禁止自动重发和退款。
INSERT INTO generation_provider_runs (
  task_id, task_attempt, provider, request_hash, submission_key, status,
  provider_task_id, output_object_key, thumbnail_object_key, staging_object_key,
  provider_result, submitted_at, provider_terminal_at, completed_at
)
SELECT
  task.id,
  task.attempt,
  CASE
    WHEN task.provider_task_id LIKE 'fake-%' THEN 'fake-provider'
    ELSE 'volcengine-ark'
  END,
  encode(digest(
    task.kind || E'\n' || task.model || E'\n' || task.prompt || E'\n' || task.config::text,
    'sha256'
  ), 'hex'),
  task.id::text || ':' || task.attempt::text,
  CASE
    WHEN task.status = 'queued' THEN 'prepared'
    WHEN task.status = 'processing' AND task.provider_task_id IS NULL THEN 'submission-unknown'
    WHEN task.status = 'processing' AND task.provider_result IS NOT NULL THEN 'settlement-pending'
    WHEN task.status = 'processing' THEN 'provider-running'
    WHEN task.status = 'completed' THEN 'settled'
    WHEN task.status = 'failed' AND task.credit_status = 'refunded' THEN 'refunded'
    WHEN task.status = 'failed' THEN 'provider-failed'
    WHEN task.status = 'canceled' AND task.credit_status = 'refunded' THEN 'refunded'
    ELSE 'provider-failed'
  END,
  task.provider_task_id,
  CASE WHEN task.status = 'completed' THEN asset.object_key ELSE
    'generated/' || task.kind || '/' || task.user_id::text || '/' || task.id::text ||
      '/attempt-' || task.attempt::text || CASE WHEN task.kind = 'video' THEN '/output.mp4' ELSE '/output.png' END
  END,
  CASE WHEN task.status = 'completed' THEN asset.thumbnail_key ELSE
    'generated/' || task.kind || '/' || task.user_id::text || '/' || task.id::text ||
      '/attempt-' || task.attempt::text || '/thumbnail.jpg'
  END,
  'generated-staging/' || task.kind || '/' || task.user_id::text || '/' || task.id::text ||
    '/attempt-' || task.attempt::text,
  task.provider_result,
  CASE WHEN task.provider_task_id IS NOT NULL THEN task.started_at ELSE NULL END,
  task.completed_at,
  CASE
    WHEN task.status IN ('completed', 'failed', 'canceled')
      THEN COALESCE(task.completed_at, task.updated_at, task.created_at)
    ELSE NULL
  END
FROM generation_tasks task
LEFT JOIN assets asset ON asset.id = task.asset_id
ON CONFLICT (task_id, task_attempt) DO NOTHING;

-- 修复已经直接演练过早期 045 的影子库：旧 CASE 曾把“有 provider_result 但没有
-- provider_task_id”的 processing 任务误判为可结算。结果内容不能替代可验证任务号，
-- 因此清除租约并降为 submission-unknown，绝不自动重发或退款。
UPDATE generation_provider_runs run
SET status = 'submission-unknown',
    lease_token = NULL,
    lease_expires_at = NULL,
    last_error = COALESCE(last_error, '历史生成任务缺少供应商任务号，提交结果未知'),
    updated_at = now()
FROM generation_tasks task
WHERE run.task_id = task.id
  AND run.task_attempt = task.attempt
  AND task.status = 'processing'
  AND task.provider_task_id IS NULL
  AND run.provider_task_id IS NULL
  AND run.status NOT IN ('settled', 'refunded', 'manual-review');

UPDATE generation_tasks task
SET active_provider_run_id = run.id,
    claim_token = NULL,
    lease_expires_at = CASE
      WHEN run.status = 'submission-unknown' THEN NULL
      ELSE task.lease_expires_at
    END,
    processing_stage = CASE
      WHEN run.status = 'submission-unknown' THEN 'submission-unknown'
      ELSE task.processing_stage
    END,
    cancel_state = CASE
      WHEN task.status = 'canceled' THEN 'canceled'
      WHEN task.cancel_requested_at IS NOT NULL THEN 'pending-provider'
      ELSE 'none'
    END
FROM generation_provider_runs run
WHERE run.task_id = task.id
  AND run.task_attempt = task.attempt;

-- 044 只能把“当前可用余额”回填为 legacy lot；迁移时仍为 held 的生成任务已经
-- 从 users 可用桶扣除，必须单独建立 held lot 和 allocation，保证后续结算/释放不会
-- 绕过 lot 账本直接修改 users。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM generation_tasks
    WHERE credit_status = 'held'
      AND main_credits_used + addon_credits_used <> reserved_credits
  ) THEN
    RAISE EXCEPTION '发现 held 生成任务的积分桶与 reserved_credits 不一致';
  END IF;
END
$$;

INSERT INTO credit_lots (
  user_id, bucket, source_type, source_event_key,
  original_amount, available_amount, held_amount, expires_at, created_at, updated_at
)
SELECT task.user_id, 'main', 'legacy',
       'legacy-generation-held-main:' || task.id::text || ':' || task.attempt::text,
       task.main_credits_used, 0, task.main_credits_used,
       user_account.plan_reset_at::timestamptz, task.created_at, now()
FROM generation_tasks task
JOIN users user_account ON user_account.id = task.user_id
WHERE task.credit_status = 'held' AND task.main_credits_used > 0
ON CONFLICT (source_event_key) DO NOTHING;

INSERT INTO credit_lots (
  user_id, bucket, source_type, source_event_key,
  original_amount, available_amount, held_amount, created_at, updated_at
)
SELECT task.user_id, 'addon', 'legacy',
       'legacy-generation-held-addon:' || task.id::text || ':' || task.attempt::text,
       task.addon_credits_used, 0, task.addon_credits_used, task.created_at, now()
FROM generation_tasks task
WHERE task.credit_status = 'held' AND task.addon_credits_used > 0
ON CONFLICT (source_event_key) DO NOTHING;

INSERT INTO credit_allocations (
  user_id, lot_id, business_event_key, purpose, status, amount, related_job_id,
  created_at, updated_at
)
SELECT task.user_id, lot.id,
       'generation-hold:' || task.id::text || ':' || task.attempt::text,
       'generation', 'held', lot.held_amount, task.id, task.created_at, now()
FROM generation_tasks task
JOIN credit_lots lot
  ON lot.source_event_key IN (
    'legacy-generation-held-main:' || task.id::text || ':' || task.attempt::text,
    'legacy-generation-held-addon:' || task.id::text || ':' || task.attempt::text
  )
WHERE task.credit_status = 'held'
ON CONFLICT (business_event_key, lot_id) DO NOTHING;

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_active_provider_run_id_fkey;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_active_provider_run_id_fkey
  FOREIGN KEY (active_provider_run_id) REFERENCES generation_provider_runs(id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_processing_stage_check;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_processing_stage_check
  CHECK (processing_stage IN (
    'queued', 'prepared', 'submitting', 'submitted', 'submission-unknown',
    'provider-running', 'provider-succeeded', 'archiving',
    'settlement-pending', 'cancel-requested', 'canceled',
    'completed', 'failed', 'delivery-failed', 'manual-review'
  ));

CREATE INDEX IF NOT EXISTS idx_generation_tasks_claimable
  ON generation_tasks(status, lease_expires_at, created_at)
  WHERE status IN ('queued', 'processing')
    AND processing_stage <> 'submission-unknown';

-- 后置不变量：迁移不能制造没有 run 的任务，也不能接受相同供应商任务对应多个 run。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM generation_tasks task
    LEFT JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
    WHERE run.id IS NULL OR run.task_id <> task.id OR run.task_attempt <> task.attempt
  ) THEN
    RAISE EXCEPTION 'generation_provider_runs 回填不完整';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM generation_provider_runs
    WHERE provider_task_id IS NOT NULL
    GROUP BY provider, provider_task_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '发现重复 provider_task_id，需人工核对后再迁移';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM generation_tasks task
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(allocation.amount), 0)::integer AS allocated
      FROM credit_allocations allocation
      WHERE allocation.related_job_id = task.id
        AND allocation.business_event_key =
          'generation-hold:' || task.id::text || ':' || task.attempt::text
        AND allocation.status = 'held'
    ) totals ON true
    WHERE task.credit_status = 'held'
      AND totals.allocated <> task.reserved_credits
  ) THEN
    RAISE EXCEPTION 'held 生成任务的 lot allocation 回填不完整';
  END IF;
END
$$;
