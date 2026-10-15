UPDATE plans
SET billing = 'one-time',
    yearly_price = 0,
    updated_at = now()
WHERE kind = 'addon'
  AND (billing <> 'one-time' OR yearly_price <> 0);
