-- 状态机强约束与账本后置校验。
-- 旧兼容列仍需双读观察 7 天，本迁移只禁止新旧路径继续制造不一致；物理删列须在观察期后单独发布。

-- 历史 credit_ledger 允许没有业务事件键；迁移后新增流水必须提供稳定事件键。
CREATE OR REPLACE FUNCTION require_credit_ledger_business_event_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_event_key IS NULL OR btrim(NEW.business_event_key) = '' THEN
    RAISE EXCEPTION '新增积分流水必须提供 business_event_key';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.business_event_key IS NOT NULL
     AND NEW.business_event_key IS DISTINCT FROM OLD.business_event_key THEN
    RAISE EXCEPTION 'credit_ledger.business_event_key 一旦写入不可修改：ledger=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_ledger_require_business_event_key ON credit_ledger;
CREATE TRIGGER credit_ledger_require_business_event_key
BEFORE INSERT OR UPDATE OF business_event_key ON credit_ledger
FOR EACH ROW EXECUTE FUNCTION require_credit_ledger_business_event_key();

-- users 的两个可用桶必须等于 lot 可用余额汇总。使用延迟约束触发器，允许同一事务内先改 lot 再改缓存。
CREATE OR REPLACE FUNCTION assert_user_credit_lot_balance(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cached_main integer;
  cached_addon integer;
  lot_main bigint;
  lot_addon bigint;
BEGIN
  SELECT main_credits, addon_credits
  INTO cached_main, cached_addon
  FROM users
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(sum(available_amount) FILTER (WHERE bucket = 'main'), 0),
    COALESCE(sum(available_amount) FILTER (WHERE bucket = 'addon'), 0)
  INTO lot_main, lot_addon
  FROM credit_lots
  WHERE user_id = target_user_id;

  IF cached_main::bigint <> lot_main OR cached_addon::bigint <> lot_addon THEN
    RAISE EXCEPTION
      '用户积分缓存与 lot 汇总不一致：user=%, cache=(%, %), lots=(%, %)',
      target_user_id, cached_main, cached_addon, lot_main, lot_addon;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION check_user_credit_lot_balance_from_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM assert_user_credit_lot_balance(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION check_user_credit_lot_balance_from_lot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_user_credit_lot_balance(OLD.user_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM assert_user_credit_lot_balance(NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS users_credit_lot_balance_check ON users;
CREATE CONSTRAINT TRIGGER users_credit_lot_balance_check
AFTER INSERT OR UPDATE OF main_credits, addon_credits ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_user_credit_lot_balance_from_user();

DROP TRIGGER IF EXISTS credit_lots_user_balance_check ON credit_lots;
CREATE CONSTRAINT TRIGGER credit_lots_user_balance_check
AFTER INSERT OR UPDATE OR DELETE ON credit_lots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_user_credit_lot_balance_from_lot();

-- lot 的 held/consumed/reversed 必须能由 allocation 重放；周期过期可以没有 allocation，故只校验其下界。
CREATE OR REPLACE FUNCTION assert_credit_lot_allocations(target_lot_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  lot_user_id uuid;
  lot_held integer;
  lot_consumed integer;
  lot_expired integer;
  lot_reversed integer;
  allocation_held bigint;
  allocation_consumed bigint;
  allocation_expired bigint;
  allocation_reversed bigint;
BEGIN
  SELECT user_id, held_amount, consumed_amount, expired_amount, reversed_amount
  INTO lot_user_id, lot_held, lot_consumed, lot_expired, lot_reversed
  FROM credit_lots
  WHERE id = target_lot_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM credit_allocations
    WHERE lot_id = target_lot_id AND user_id <> lot_user_id
  ) THEN
    RAISE EXCEPTION 'allocation 用户与 lot 用户不一致：lot=%', target_lot_id;
  END IF;

  SELECT
    COALESCE(sum(amount) FILTER (WHERE status = 'held'), 0),
    COALESCE(sum(amount) FILTER (WHERE status = 'settled'), 0),
    COALESCE(sum(amount) FILTER (WHERE status = 'expired'), 0),
    COALESCE(sum(amount) FILTER (WHERE status = 'reversed'), 0)
  INTO allocation_held, allocation_consumed, allocation_expired, allocation_reversed
  FROM credit_allocations
  WHERE lot_id = target_lot_id;

  IF lot_held::bigint <> allocation_held
     OR lot_consumed::bigint <> allocation_consumed
     OR lot_reversed::bigint <> allocation_reversed
     OR lot_expired::bigint < allocation_expired THEN
    RAISE EXCEPTION
      'lot 与 allocation 不一致：lot=%, held=%/%, consumed=%/%, expired=%/%, reversed=%/%',
      target_lot_id,
      lot_held, allocation_held,
      lot_consumed, allocation_consumed,
      lot_expired, allocation_expired,
      lot_reversed, allocation_reversed;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION check_credit_lot_allocations_from_lot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_credit_lot_allocations(OLD.id);
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.id IS DISTINCT FROM OLD.id) THEN
    PERFORM assert_credit_lot_allocations(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION check_credit_lot_allocations_from_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_credit_lot_allocations(OLD.lot_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.lot_id IS DISTINCT FROM OLD.lot_id) THEN
    PERFORM assert_credit_lot_allocations(NEW.lot_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS credit_lots_allocation_check ON credit_lots;
CREATE CONSTRAINT TRIGGER credit_lots_allocation_check
AFTER INSERT OR UPDATE OR DELETE ON credit_lots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_credit_lot_allocations_from_lot();

DROP TRIGGER IF EXISTS credit_allocations_lot_check ON credit_allocations;
CREATE CONSTRAINT TRIGGER credit_allocations_lot_check
AFTER INSERT OR UPDATE OR DELETE ON credit_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_credit_lot_allocations_from_allocation();

ALTER TABLE payment_attempts
  DROP CONSTRAINT IF EXISTS payment_attempts_lease_state_check,
  DROP CONSTRAINT IF EXISTS payment_attempts_launch_state_check,
  DROP CONSTRAINT IF EXISTS payment_attempts_terminal_state_check,
  DROP CONSTRAINT IF EXISTS payment_attempts_channel_revision_check;
ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_lease_state_check CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_until IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT payment_attempts_launch_state_check CHECK (
    status <> 'ready' OR
    (launch_ciphertext IS NOT NULL AND launch_iv IS NOT NULL AND launch_tag IS NOT NULL AND ready_at IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT payment_attempts_terminal_state_check CHECK (
    status NOT IN ('paid', 'closed', 'failed', 'manual-review') OR terminal_at IS NOT NULL
  ) NOT VALID,
  ADD CONSTRAINT payment_attempts_channel_revision_check CHECK (
    status = 'manual-review' OR channel_revision_id IS NOT NULL
  ) NOT VALID;
ALTER TABLE payment_attempts VALIDATE CONSTRAINT payment_attempts_lease_state_check;
ALTER TABLE payment_attempts VALIDATE CONSTRAINT payment_attempts_launch_state_check;
ALTER TABLE payment_attempts VALIDATE CONSTRAINT payment_attempts_terminal_state_check;
ALTER TABLE payment_attempts VALIDATE CONSTRAINT payment_attempts_channel_revision_check;

ALTER TABLE order_refund_attempts
  DROP CONSTRAINT IF EXISTS order_refund_attempts_lease_state_check,
  DROP CONSTRAINT IF EXISTS order_refund_attempts_retry_state_check,
  DROP CONSTRAINT IF EXISTS order_refund_attempts_terminal_state_check,
  DROP CONSTRAINT IF EXISTS order_refund_attempts_channel_revision_check;
ALTER TABLE order_refund_attempts
  ADD CONSTRAINT order_refund_attempts_lease_state_check CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_until IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT order_refund_attempts_retry_state_check CHECK (
    status NOT IN ('queued', 'submitted', 'uncertain') OR next_at IS NOT NULL
  ) NOT VALID,
  ADD CONSTRAINT order_refund_attempts_terminal_state_check CHECK (
    status NOT IN ('succeeded', 'failed', 'manual-review') OR terminal_at IS NOT NULL
  ) NOT VALID,
  ADD CONSTRAINT order_refund_attempts_channel_revision_check CHECK (
    status = 'manual-review' OR channel_revision_id IS NOT NULL
  ) NOT VALID;
ALTER TABLE order_refund_attempts VALIDATE CONSTRAINT order_refund_attempts_lease_state_check;
ALTER TABLE order_refund_attempts VALIDATE CONSTRAINT order_refund_attempts_retry_state_check;
ALTER TABLE order_refund_attempts VALIDATE CONSTRAINT order_refund_attempts_terminal_state_check;
ALTER TABLE order_refund_attempts VALIDATE CONSTRAINT order_refund_attempts_channel_revision_check;

ALTER TABLE generation_provider_runs
  DROP CONSTRAINT IF EXISTS generation_provider_runs_lease_pair_check,
  DROP CONSTRAINT IF EXISTS generation_provider_runs_terminal_check;
ALTER TABLE generation_provider_runs
  ADD CONSTRAINT generation_provider_runs_lease_pair_check CHECK (
    (lease_token IS NULL) = (lease_expires_at IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT generation_provider_runs_terminal_check CHECK (
    status NOT IN ('settled', 'refunded') OR completed_at IS NOT NULL
  ) NOT VALID;
ALTER TABLE generation_provider_runs VALIDATE CONSTRAINT generation_provider_runs_lease_pair_check;
ALTER TABLE generation_provider_runs VALIDATE CONSTRAINT generation_provider_runs_terminal_check;

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_lease_state_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_completed_state_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_retention_state_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_status_stage_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_retryable_state_check,
  DROP CONSTRAINT IF EXISTS upload_sessions_sealed_state_check;
ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_lease_state_check CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT upload_sessions_completed_state_check CHECK (
    status <> 'completed' OR
    (asset_id IS NOT NULL AND final_object_key IS NOT NULL AND sealed_at IS NOT NULL
      AND actual_size_bytes IS NOT NULL AND completed_at IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT upload_sessions_retention_state_check CHECK (
    status NOT IN ('failed', 'canceled', 'expired') OR retention_until IS NOT NULL
  ) NOT VALID,
  ADD CONSTRAINT upload_sessions_status_stage_check CHECK (
    (status = 'pending' AND processing_stage IN ('waiting-upload', 'queued'))
    OR (status = 'processing' AND processing_stage IN (
      'sealing', 'validating', 'probing', 'thumbnailing', 'persisting'
    ))
    OR (status = 'completed' AND processing_stage = 'completed')
    OR (status = 'failed' AND processing_stage = 'failed')
    OR (status = 'canceled' AND processing_stage = 'canceled')
    OR (status = 'expired' AND processing_stage = 'expired')
  ) NOT VALID,
  ADD CONSTRAINT upload_sessions_retryable_state_check CHECK (
    status = 'failed' OR retryable = false
  ) NOT VALID,
  ADD CONSTRAINT upload_sessions_sealed_state_check CHECK (
    (sealed_at IS NULL AND sealed_size_bytes IS NULL)
    OR (sealed_at IS NOT NULL AND sealed_size_bytes IS NOT NULL AND final_object_key IS NOT NULL)
  ) NOT VALID;
ALTER TABLE upload_sessions VALIDATE CONSTRAINT upload_sessions_lease_state_check;
ALTER TABLE upload_sessions VALIDATE CONSTRAINT upload_sessions_completed_state_check;
ALTER TABLE upload_sessions VALIDATE CONSTRAINT upload_sessions_retention_state_check;
ALTER TABLE upload_sessions VALIDATE CONSTRAINT upload_sessions_status_stage_check;
ALTER TABLE upload_sessions VALIDATE CONSTRAINT upload_sessions_retryable_state_check;
ALTER TABLE upload_sessions VALIDATE CONSTRAINT upload_sessions_sealed_state_check;

ALTER TABLE object_deletion_outbox
  DROP CONSTRAINT IF EXISTS object_deletion_outbox_lease_state_check,
  DROP CONSTRAINT IF EXISTS object_deletion_outbox_terminal_state_check;
ALTER TABLE object_deletion_outbox
  ADD CONSTRAINT object_deletion_outbox_lease_state_check CHECK (
    (status = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT object_deletion_outbox_terminal_state_check CHECK (
    status NOT IN ('completed', 'skipped') OR completed_at IS NOT NULL
  ) NOT VALID;
ALTER TABLE object_deletion_outbox VALIDATE CONSTRAINT object_deletion_outbox_lease_state_check;
ALTER TABLE object_deletion_outbox VALIDATE CONSTRAINT object_deletion_outbox_terminal_state_check;

ALTER TABLE payment_notification_outbox
  DROP CONSTRAINT IF EXISTS payment_notification_outbox_lease_state_check,
  DROP CONSTRAINT IF EXISTS payment_notification_outbox_completed_state_check;
ALTER TABLE payment_notification_outbox
  ADD CONSTRAINT payment_notification_outbox_lease_state_check CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_until IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT payment_notification_outbox_completed_state_check CHECK (
    status <> 'completed' OR completed_at IS NOT NULL
  ) NOT VALID;
ALTER TABLE payment_notification_outbox VALIDATE CONSTRAINT payment_notification_outbox_lease_state_check;
ALTER TABLE payment_notification_outbox VALIDATE CONSTRAINT payment_notification_outbox_completed_state_check;

ALTER TABLE provider_events
  DROP CONSTRAINT IF EXISTS provider_events_processed_state_check;
ALTER TABLE provider_events
  ADD CONSTRAINT provider_events_processed_state_check CHECK (
    status <> 'processed' OR processed_at IS NOT NULL
  ) NOT VALID;
ALTER TABLE provider_events VALIDATE CONSTRAINT provider_events_processed_state_check;

-- lot/allocation 的来源身份不可变；只有金额状态和 allocation 状态可以按领域服务推进。
CREATE OR REPLACE FUNCTION preserve_credit_lot_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.user_id, NEW.bucket, NEW.source_type, NEW.source_order_id,
    NEW.source_event_key, NEW.original_amount, NEW.expires_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.user_id, OLD.bucket, OLD.source_type, OLD.source_order_id,
    OLD.source_event_key, OLD.original_amount, OLD.expires_at, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'credit_lots 来源身份不可修改：lot=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_lots_preserve_identity ON credit_lots;
CREATE TRIGGER credit_lots_preserve_identity
BEFORE UPDATE ON credit_lots
FOR EACH ROW EXECUTE FUNCTION preserve_credit_lot_identity();

CREATE OR REPLACE FUNCTION preserve_credit_allocation_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.user_id, NEW.lot_id, NEW.business_event_key, NEW.purpose,
    NEW.amount, NEW.related_order_id, NEW.related_job_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.user_id, OLD.lot_id, OLD.business_event_key, OLD.purpose,
    OLD.amount, OLD.related_order_id, OLD.related_job_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'credit_allocations 业务身份不可修改：allocation=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_allocations_preserve_identity ON credit_allocations;
CREATE TRIGGER credit_allocations_preserve_identity
BEFORE UPDATE ON credit_allocations
FOR EACH ROW EXECUTE FUNCTION preserve_credit_allocation_identity();

-- attempt、通道 revision、供应商事件和 provider run 的业务身份不可变；worker 只能推进状态和补齐供应商结果。
CREATE OR REPLACE FUNCTION preserve_payment_attempt_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.order_id, NEW.attempt, NEW.idempotency_key, NEW.request_hash,
    NEW.merchant_order_no, NEW.channel_revision_id, NEW.amount, NEW.currency,
    NEW.surface, NEW.way_code
  ) IS DISTINCT FROM ROW(
    OLD.order_id, OLD.attempt, OLD.idempotency_key, OLD.request_hash,
    OLD.merchant_order_no, OLD.channel_revision_id, OLD.amount, OLD.currency,
    OLD.surface, OLD.way_code
  ) THEN
    RAISE EXCEPTION 'payment_attempts 业务身份不可修改：attempt=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_attempts_preserve_identity ON payment_attempts;
CREATE TRIGGER payment_attempts_preserve_identity
BEFORE UPDATE ON payment_attempts
FOR EACH ROW EXECUTE FUNCTION preserve_payment_attempt_identity();

CREATE OR REPLACE FUNCTION preserve_refund_attempt_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.order_id, NEW.attempt, NEW.request_hash, NEW.merchant_refund_no,
    NEW.merchant_order_no, NEW.channel_revision_id, NEW.amount, NEW.currency,
    NEW.client_ip
  ) IS DISTINCT FROM ROW(
    OLD.order_id, OLD.attempt, OLD.request_hash, OLD.merchant_refund_no,
    OLD.merchant_order_no, OLD.channel_revision_id, OLD.amount, OLD.currency,
    OLD.client_ip
  ) THEN
    RAISE EXCEPTION 'order_refund_attempts 业务身份不可修改：attempt=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_refund_attempts_preserve_identity ON order_refund_attempts;
CREATE TRIGGER order_refund_attempts_preserve_identity
BEFORE UPDATE ON order_refund_attempts
FOR EACH ROW EXECUTE FUNCTION preserve_refund_attempt_identity();

CREATE OR REPLACE FUNCTION reject_payment_channel_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payment_channel_revisions 是不可变快照，只能新增 revision';
END;
$$;

DROP TRIGGER IF EXISTS payment_channel_revisions_immutable ON payment_channel_revisions;
CREATE TRIGGER payment_channel_revisions_immutable
BEFORE UPDATE OR DELETE ON payment_channel_revisions
FOR EACH ROW EXECUTE FUNCTION reject_payment_channel_revision_mutation();

CREATE OR REPLACE FUNCTION preserve_provider_event_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.provider, NEW.event_type, NEW.event_key, NEW.payload_hash, NEW.payload,
    NEW.order_id, NEW.payment_attempt_id, NEW.refund_attempt_id, NEW.received_at
  ) IS DISTINCT FROM ROW(
    OLD.provider, OLD.event_type, OLD.event_key, OLD.payload_hash, OLD.payload,
    OLD.order_id, OLD.payment_attempt_id, OLD.refund_attempt_id, OLD.received_at
  ) THEN
    RAISE EXCEPTION 'provider_events 原始事件不可修改：event=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_events_preserve_identity ON provider_events;
CREATE TRIGGER provider_events_preserve_identity
BEFORE UPDATE ON provider_events
FOR EACH ROW EXECUTE FUNCTION preserve_provider_event_identity();

CREATE OR REPLACE FUNCTION preserve_payment_notification_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(NEW.event_key, NEW.order_id, NEW.payload, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.event_key, OLD.order_id, OLD.payload, OLD.created_at) THEN
    RAISE EXCEPTION 'payment_notification_outbox 事件身份不可修改：outbox=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_notification_outbox_preserve_identity ON payment_notification_outbox;
CREATE TRIGGER payment_notification_outbox_preserve_identity
BEFORE UPDATE ON payment_notification_outbox
FOR EACH ROW EXECUTE FUNCTION preserve_payment_notification_identity();

CREATE OR REPLACE FUNCTION preserve_generation_provider_run_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.task_id, NEW.task_attempt, NEW.provider, NEW.request_hash,
    NEW.submission_key, NEW.callback_token, NEW.output_object_key,
    NEW.thumbnail_object_key, NEW.staging_object_key
  ) IS DISTINCT FROM ROW(
    OLD.task_id, OLD.task_attempt, OLD.provider, OLD.request_hash,
    OLD.submission_key, OLD.callback_token, OLD.output_object_key,
    OLD.thumbnail_object_key, OLD.staging_object_key
  ) THEN
    RAISE EXCEPTION 'generation_provider_runs 业务身份或对象路径不可修改：run=%', OLD.id;
  END IF;
  IF OLD.provider_task_id IS NOT NULL
     AND NEW.provider_task_id IS DISTINCT FROM OLD.provider_task_id THEN
    RAISE EXCEPTION 'generation_provider_runs.provider_task_id 不可替换：run=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generation_provider_runs_preserve_identity ON generation_provider_runs;
CREATE TRIGGER generation_provider_runs_preserve_identity
BEFORE UPDATE ON generation_provider_runs
FOR EACH ROW EXECUTE FUNCTION preserve_generation_provider_run_identity();

CREATE OR REPLACE FUNCTION preserve_upload_session_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.user_id, NEW.object_key, NEW.filename, NEW.content_type,
    NEW.max_size_bytes, NEW.idempotency_key, NEW.request_hash, NEW.source,
    NEW.asset_type, NEW.asset_name, NEW.folder_id, NEW.final_object_key
  ) IS DISTINCT FROM ROW(
    OLD.user_id, OLD.object_key, OLD.filename, OLD.content_type,
    OLD.max_size_bytes, OLD.idempotency_key, OLD.request_hash, OLD.source,
    OLD.asset_type, OLD.asset_name, OLD.folder_id, OLD.final_object_key
  ) THEN
    RAISE EXCEPTION 'upload_sessions 请求身份或对象路径不可修改：session=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS upload_sessions_preserve_identity ON upload_sessions;
CREATE TRIGGER upload_sessions_preserve_identity
BEFORE UPDATE ON upload_sessions
FOR EACH ROW EXECUTE FUNCTION preserve_upload_session_identity();

CREATE OR REPLACE FUNCTION reject_state_machine_history_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% 是不可变历史记录，禁止 DELETE：id=%', TG_TABLE_NAME, OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS payment_attempts_reject_delete ON payment_attempts;
CREATE TRIGGER payment_attempts_reject_delete
BEFORE DELETE ON payment_attempts
FOR EACH ROW EXECUTE FUNCTION reject_state_machine_history_delete();

DROP TRIGGER IF EXISTS credit_lots_reject_delete ON credit_lots;
CREATE TRIGGER credit_lots_reject_delete
BEFORE DELETE ON credit_lots
FOR EACH ROW EXECUTE FUNCTION reject_state_machine_history_delete();

DROP TRIGGER IF EXISTS credit_allocations_reject_delete ON credit_allocations;
CREATE TRIGGER credit_allocations_reject_delete
BEFORE DELETE ON credit_allocations
FOR EACH ROW EXECUTE FUNCTION reject_state_machine_history_delete();

DROP TRIGGER IF EXISTS order_refund_attempts_reject_delete ON order_refund_attempts;
CREATE TRIGGER order_refund_attempts_reject_delete
BEFORE DELETE ON order_refund_attempts
FOR EACH ROW EXECUTE FUNCTION reject_state_machine_history_delete();

DROP TRIGGER IF EXISTS provider_events_reject_delete ON provider_events;
CREATE TRIGGER provider_events_reject_delete
BEFORE DELETE ON provider_events
FOR EACH ROW EXECUTE FUNCTION reject_state_machine_history_delete();

DROP TRIGGER IF EXISTS generation_provider_runs_reject_delete ON generation_provider_runs;
CREATE TRIGGER generation_provider_runs_reject_delete
BEFORE DELETE ON generation_provider_runs
FOR EACH ROW EXECUTE FUNCTION reject_state_machine_history_delete();

-- 当前指针必须始终指向同一业务实体；这些跨表规则无法用普通 CHECK 表达。
CREATE OR REPLACE FUNCTION check_order_attempt_pointers()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_payment_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM payment_attempts
    WHERE id = NEW.current_payment_attempt_id AND order_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'orders.current_payment_attempt_id 存在跨订单引用：order=%', NEW.id;
  END IF;
  IF NEW.current_refund_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM order_refund_attempts
    WHERE id = NEW.current_refund_attempt_id AND order_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'orders.current_refund_attempt_id 存在跨订单引用：order=%', NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS orders_attempt_pointer_check ON orders;
CREATE CONSTRAINT TRIGGER orders_attempt_pointer_check
AFTER INSERT OR UPDATE OF current_payment_attempt_id, current_refund_attempt_id ON orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_order_attempt_pointers();

CREATE OR REPLACE FUNCTION check_generation_run_pointer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.active_provider_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM generation_provider_runs
    WHERE id = NEW.active_provider_run_id
      AND task_id = NEW.id
      AND task_attempt = NEW.attempt
  ) THEN
    RAISE EXCEPTION 'generation_tasks.active_provider_run_id 与当前 attempt 不一致：task=%', NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS generation_tasks_run_pointer_check ON generation_tasks;
CREATE CONSTRAINT TRIGGER generation_tasks_run_pointer_check
AFTER INSERT OR UPDATE OF active_provider_run_id, attempt ON generation_tasks
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_generation_run_pointer();

CREATE OR REPLACE FUNCTION check_completed_upload_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed' AND NOT EXISTS (
    SELECT 1 FROM assets
    WHERE id = NEW.asset_id
      AND user_id = NEW.user_id
      AND object_key = NEW.final_object_key
  ) THEN
    RAISE EXCEPTION 'completed upload session 与最终资产不一致：session=%', NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS upload_sessions_asset_pointer_check ON upload_sessions;
CREATE CONSTRAINT TRIGGER upload_sessions_asset_pointer_check
AFTER INSERT OR UPDATE OF status, asset_id, final_object_key ON upload_sessions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_completed_upload_asset();

-- 迁移时再次扫描已有数据，避免只对未来写入生效。
DO $$
DECLARE
  target_user_id uuid;
  target_lot_id uuid;
BEGIN
  -- 创建约束触发器不会扫描旧行；发布前必须主动验证所有缓存、lot 与 allocation。
  FOR target_user_id IN SELECT id FROM users LOOP
    PERFORM assert_user_credit_lot_balance(target_user_id);
  END LOOP;

  FOR target_lot_id IN SELECT id FROM credit_lots LOOP
    PERFORM assert_credit_lot_allocations(target_lot_id);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM orders item
    JOIN payment_attempts attempt ON attempt.id = item.current_payment_attempt_id
    WHERE attempt.order_id <> item.id
  ) THEN
    RAISE EXCEPTION 'orders.current_payment_attempt_id 存在跨订单引用';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM orders item
    JOIN order_refund_attempts attempt ON attempt.id = item.current_refund_attempt_id
    WHERE attempt.order_id <> item.id
  ) THEN
    RAISE EXCEPTION 'orders.current_refund_attempt_id 存在跨订单引用';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM generation_tasks task
    JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
    WHERE run.task_id <> task.id OR run.task_attempt <> task.attempt
  ) THEN
    RAISE EXCEPTION 'generation_tasks.active_provider_run_id 与当前 attempt 不一致';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM upload_sessions session
    JOIN assets asset ON asset.id = session.asset_id
    WHERE session.status = 'completed'
      AND (asset.user_id <> session.user_id OR asset.object_key <> session.final_object_key)
  ) THEN
    RAISE EXCEPTION 'completed upload session 与最终资产不一致';
  END IF;
END
$$;

COMMENT ON COLUMN orders.payment_create_claimed_at IS
  '已弃用：支付创建认领改由 payment_attempts.lease_token 围栏；观察期后物理删除。';
COMMENT ON COLUMN orders.refund_dispatch_status IS
  '兼容双读字段：权威退款状态位于 order_refund_attempts；观察期后物理删除。';
COMMENT ON COLUMN orders.refund_dispatch_lease_until IS
  '兼容双读字段：权威租约位于 order_refund_attempts；观察期后物理删除。';
COMMENT ON COLUMN generation_tasks.provider_result IS
  '兼容双读字段：权威供应商结果位于 generation_provider_runs；观察期后物理删除。';
COMMENT ON COLUMN generation_tasks.lease_expires_at IS
  '兼容双读字段：权威 worker 租约使用 claim_token 与 generation_provider_runs.lease_token。';
