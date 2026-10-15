INSERT INTO consumption_settings (
  kind, model, model_label, duration_seconds, resolution, credits, available
)
VALUES
  ('video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 5, '480p', 19, true),
  ('video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 5, '720p', 24, true),
  ('video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 5, '1080p', 36, false),
  ('video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 10, '480p', 34, true),
  ('video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 10, '720p', 42, true),
  ('video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 10, '1080p', 63, false),
  ('video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 15, '480p', 34, true),
  ('video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 15, '720p', 48, true),
  ('video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 15, '1080p', 72, false),
  ('video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 5, '480p', 10, true),
  ('video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 5, '720p', 12, true),
  ('video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 5, '1080p', 18, false),
  ('video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 10, '480p', 17, true),
  ('video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 10, '720p', 21, true),
  ('video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 10, '1080p', 32, false),
  ('video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 15, '480p', 17, true),
  ('video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 15, '720p', 24, true),
  ('video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 15, '1080p', 36, false)
ON CONFLICT (kind, model, duration_seconds, resolution) DO UPDATE
SET credits = EXCLUDED.credits,
    available = EXCLUDED.available,
    updated_at = now();
