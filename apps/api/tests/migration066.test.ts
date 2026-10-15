import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('066 真人授权法务披露快照迁移', () => {
  it('把本人实际看到的六项披露作为不可为空的授权版本字段保存', async () => {
    const sql = await readFile(
      new URL('../migrations/066_real_portrait_legal_disclosure_snapshot.sql', import.meta.url),
      'utf8',
    );
    for (const column of [
      'controller_name',
      'processor_name',
      'privacy_contact',
      'privacy_policy_url',
      'processing_scope',
      'retention_rule',
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(sql).toContain("privacy_policy_url ~ '^https://'");
    expect(sql).not.toContain('DEFAULT');
  });
});
