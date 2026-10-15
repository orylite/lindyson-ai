ALTER TABLE payment_channels
  DROP CONSTRAINT IF EXISTS payment_channels_desktop_way_code_check;

ALTER TABLE payment_channels
  ALTER COLUMN desktop_way_code SET DEFAULT 'ALI_QR';

UPDATE payment_channels
SET desktop_way_code = 'ALI_QR'
WHERE desktop_way_code = 'ALI_PC';

ALTER TABLE payment_channels
  ADD CONSTRAINT payment_channels_desktop_way_code_check
  CHECK (desktop_way_code = 'ALI_QR');
