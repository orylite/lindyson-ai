-- 生成任务会由管理员在原记录上推进 attempt；积分流水必须保存发生该笔账务事件时的
-- attempt 与规格，不能在用户查看旧流水时再读取 generation_tasks 的最新可变状态。
ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS generation_snapshot jsonb;

CREATE OR REPLACE FUNCTION sync_credit_ledger_generation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  task_record generation_tasks%ROWTYPE;
  previous_snapshot jsonb;
  snapshot_attempt integer;
  reserved_credits integer;
  duration_seconds integer;
  resolution text;
  has_reference_video boolean;
  task_status text;
  settled_credits integer;
  refunded_credits integer;
BEGIN
  IF NEW.related_job_id IS NULL THEN
    NEW.generation_snapshot := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.related_job_id IS DISTINCT FROM OLD.related_job_id
      OR NEW.business_event_key IS DISTINCT FROM OLD.business_event_key
      OR NEW.amount IS DISTINCT FROM OLD.amount THEN
      RAISE EXCEPTION '生成积分流水的任务、事件键和金额不允许修改：ledger=%', OLD.id;
    END IF;
    IF OLD.generation_snapshot IS NOT NULL
      AND ROW(NEW.type, NEW.settlement_status) IS DISTINCT FROM ROW(OLD.type, OLD.settlement_status)
      AND NOT (
        OLD.type = 'hold'
        AND OLD.settlement_status = 'held'
        AND (
          (NEW.type = 'spend' AND NEW.settlement_status = 'settled')
          OR (NEW.type = 'hold' AND NEW.settlement_status = 'refunded')
        )
      ) THEN
      RAISE EXCEPTION '生成积分流水只允许从预扣收口为实扣或退回：ledger=%', OLD.id;
    END IF;
  END IF;

  SELECT *
  INTO task_record
  FROM generation_tasks
  WHERE id = NEW.related_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '生成积分流水关联任务不存在：ledger=% task=%', NEW.id, NEW.related_job_id;
  END IF;

  previous_snapshot := CASE
    WHEN TG_OP = 'UPDATE' THEN OLD.generation_snapshot
    ELSE NULL
  END;

  snapshot_attempt := CASE
    WHEN previous_snapshot IS NOT NULL
      AND jsonb_typeof(previous_snapshot) = 'object'
      AND previous_snapshot->>'attempt' ~ '^[0-9]+$'
      THEN (previous_snapshot->>'attempt')::integer
    WHEN NEW.business_event_key ~ ':[0-9]+$'
      THEN substring(NEW.business_event_key FROM ':([0-9]+)$')::integer
    ELSE task_record.attempt
  END;

  duration_seconds := CASE
    WHEN previous_snapshot IS NOT NULL
      AND previous_snapshot->>'durationSeconds' ~ '^[0-9]+$'
      THEN (previous_snapshot->>'durationSeconds')::integer
    WHEN task_record.config->>'durationSeconds' ~ '^[0-9]+$'
      THEN (task_record.config->>'durationSeconds')::integer
    WHEN task_record.config->>'duration' ~ '^[0-9]+$'
      THEN (task_record.config->>'duration')::integer
    ELSE NULL
  END;

  resolution := CASE
    WHEN previous_snapshot IS NOT NULL AND previous_snapshot ? 'resolution'
      THEN NULLIF(previous_snapshot->>'resolution', '')
    ELSE NULLIF(task_record.config->>'resolution', '')
  END;

  has_reference_video := CASE
    WHEN previous_snapshot IS NOT NULL
      AND jsonb_typeof(previous_snapshot->'hasReferenceVideo') = 'boolean'
      THEN (previous_snapshot->>'hasReferenceVideo')::boolean
    ELSE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(task_record.config->'referenceAssets') = 'array'
            THEN task_record.config->'referenceAssets'
          ELSE '[]'::jsonb
        END
      ) AS reference
      WHERE reference->>'type' = 'video'
         OR reference->>'role' = 'reference_video'
    )
  END;

  IF NEW.type IN ('hold', 'spend') THEN
    reserved_credits := abs(NEW.amount);
  ELSE
    SELECT abs(hold.amount)
    INTO reserved_credits
    FROM credit_ledger hold
    WHERE hold.related_job_id = NEW.related_job_id
      AND hold.business_event_key = concat(
        'generation-hold:', NEW.related_job_id::text, ':', snapshot_attempt::text
      )
    LIMIT 1;
    reserved_credits := COALESCE(
      reserved_credits,
      CASE
        WHEN previous_snapshot->>'reservedCredits' ~ '^[0-9]+$'
          THEN (previous_snapshot->>'reservedCredits')::integer
        ELSE NULL
      END,
      task_record.reserved_credits,
      abs(NEW.amount)
    );
  END IF;

  settled_credits := CASE WHEN NEW.type = 'spend' THEN abs(NEW.amount) ELSE 0 END;
  refunded_credits := CASE WHEN NEW.type = 'refund' THEN greatest(NEW.amount, 0) ELSE 0 END;
  task_status := CASE
    WHEN NEW.type = 'spend' THEN 'completed'
    WHEN NEW.type = 'refund' AND NEW.business_event_key LIKE '%cancel%' THEN 'canceled'
    WHEN NEW.type = 'refund' THEN 'failed'
    WHEN NEW.type = 'hold' AND NEW.settlement_status = 'refunded'
      AND (NEW.source LIKE '%取消%' OR NEW.note LIKE '%取消%') THEN 'canceled'
    WHEN NEW.type = 'hold' AND NEW.settlement_status = 'refunded' THEN 'failed'
    ELSE task_record.status
  END;

  NEW.generation_snapshot := jsonb_build_object(
    'attempt', snapshot_attempt,
    'model', COALESCE(previous_snapshot->>'model', task_record.model),
    'durationSeconds', duration_seconds,
    'resolution', resolution,
    'hasReferenceVideo', has_reference_video,
    'reservedCredits', reserved_credits,
    'settledCredits', settled_credits,
    'refundedCredits', refunded_credits,
    'taskStatus', task_status,
    'creditStatus', NEW.settlement_status
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_ledger_sync_generation_snapshot ON credit_ledger;
CREATE TRIGGER credit_ledger_sync_generation_snapshot
BEFORE INSERT OR UPDATE OF type, settlement_status, amount, related_job_id, business_event_key
ON credit_ledger
FOR EACH ROW EXECUTE FUNCTION sync_credit_ledger_generation_snapshot();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM credit_ledger ledger
    LEFT JOIN generation_tasks task ON task.id = ledger.related_job_id
    WHERE ledger.related_job_id IS NOT NULL AND task.id IS NULL
  ) THEN
    RAISE EXCEPTION '074 无法回填：credit_ledger 存在关联任务缺失的孤儿流水';
  END IF;
END;
$$;

-- 业务事件键尾部保存 generation attempt；历史退款通过同 attempt 的 hold 金额恢复预扣事实。
-- SET type = type 只用于触发一次安全回填，不改变原流水类型、金额、余额或关联关系。
UPDATE credit_ledger
SET type = type
WHERE related_job_id IS NOT NULL
  AND generation_snapshot IS NULL;

CREATE OR REPLACE FUNCTION preserve_credit_ledger_generation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.generation_snapshot IS DISTINCT FROM OLD.generation_snapshot THEN
    RAISE EXCEPTION 'credit_ledger.generation_snapshot 不允许直接修改：ledger=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_ledger_preserve_generation_snapshot ON credit_ledger;
CREATE TRIGGER credit_ledger_preserve_generation_snapshot
BEFORE UPDATE OF generation_snapshot ON credit_ledger
FOR EACH ROW EXECUTE FUNCTION preserve_credit_ledger_generation_snapshot();

ALTER TABLE credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_generation_snapshot_check;
ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_generation_snapshot_check CHECK (
    (related_job_id IS NULL AND generation_snapshot IS NULL)
    OR (
      related_job_id IS NOT NULL
      AND generation_snapshot IS NOT NULL
      AND jsonb_typeof(generation_snapshot) = 'object'
      AND (generation_snapshot->>'attempt') ~ '^[0-9]+$'
      AND COALESCE((generation_snapshot->>'reservedCredits') ~ '^[0-9]+$', false)
      AND COALESCE((generation_snapshot->>'settledCredits') ~ '^[0-9]+$', false)
      AND COALESCE((generation_snapshot->>'refundedCredits') ~ '^[0-9]+$', false)
    )
  ) NOT VALID;
ALTER TABLE credit_ledger VALIDATE CONSTRAINT credit_ledger_generation_snapshot_check;

COMMENT ON COLUMN credit_ledger.generation_snapshot IS
  '生成积分流水的 attempt、模型、规格、参考视频与账务终态快照；同一 generation_tasks 原地重试不会改写旧流水事实。';
