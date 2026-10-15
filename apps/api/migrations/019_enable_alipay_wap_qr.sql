ALTER TABLE payment_channels
  DROP CONSTRAINT IF EXISTS payment_channels_desktop_way_code_check;

ALTER TABLE payment_channels
  ALTER COLUMN desktop_way_code SET DEFAULT 'ALI_WAP';

UPDATE payment_channels
SET desktop_way_code = 'ALI_WAP'
WHERE desktop_way_code = 'ALI_QR';

ALTER TABLE payment_channels
  ADD CONSTRAINT payment_channels_desktop_way_code_check
  CHECK (desktop_way_code = 'ALI_WAP');

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_surface text;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_surface_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_surface_check
  CHECK (payment_surface IS NULL OR payment_surface IN ('pc', 'mobile'));
