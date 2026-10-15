ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_cycle_started_at date;

UPDATE users
SET plan_cycle_started_at = COALESCE(
  plan_reset_at - 30,
  (registered_at AT TIME ZONE 'Asia/Shanghai')::date
)
WHERE plan_cycle_started_at IS NULL;

ALTER TABLE users
  ALTER COLUMN plan_cycle_started_at SET DEFAULT ((now() AT TIME ZONE 'Asia/Shanghai')::date),
  ALTER COLUMN plan_cycle_started_at SET NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS previous_plan_cycle_started_at date;
