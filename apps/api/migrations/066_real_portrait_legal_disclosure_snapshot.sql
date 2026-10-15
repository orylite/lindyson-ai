ALTER TABLE real_portrait_authorizations
  ADD COLUMN IF NOT EXISTS controller_name text NOT NULL CHECK (btrim(controller_name) <> ''),
  ADD COLUMN IF NOT EXISTS processor_name text NOT NULL CHECK (btrim(processor_name) <> ''),
  ADD COLUMN IF NOT EXISTS privacy_contact text NOT NULL CHECK (btrim(privacy_contact) <> ''),
  ADD COLUMN IF NOT EXISTS privacy_policy_url text NOT NULL CHECK (privacy_policy_url ~ '^https://'),
  ADD COLUMN IF NOT EXISTS processing_scope text NOT NULL CHECK (btrim(processing_scope) <> ''),
  ADD COLUMN IF NOT EXISTS retention_rule text NOT NULL CHECK (btrim(retention_rule) <> '');

COMMENT ON COLUMN real_portrait_authorizations.controller_name IS
  '本人同意时看到的个人信息处理者法律主体快照，禁止由账号昵称推断';
COMMENT ON COLUMN real_portrait_authorizations.processor_name IS
  '本人同意时看到的受托处理方快照';
COMMENT ON COLUMN real_portrait_authorizations.privacy_contact IS
  '本人同意时看到的隐私权利联系入口快照';
COMMENT ON COLUMN real_portrait_authorizations.privacy_policy_url IS
  '本人同意时看到的 HTTPS 隐私政策地址快照';
COMMENT ON COLUMN real_portrait_authorizations.processing_scope IS
  '本人同意时看到的肖像及敏感人脸信息处理范围快照';
COMMENT ON COLUMN real_portrait_authorizations.retention_rule IS
  '本人同意时看到的保留与删除规则快照';
