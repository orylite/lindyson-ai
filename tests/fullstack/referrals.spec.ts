import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
const project = process.env.FULLSTACK_COMPOSE_PROJECT ?? 'lindyson-integration';
test('邀约奖励：真实注册、并发首付、退款追回、冻结释放及分页闭环', () => {
  const migration = readFileSync(new URL('../../apps/api/migrations/087_uppercase_referral_codes.sql', import.meta.url), 'utf8');
  const sql = (input: string) => execFileSync('docker', ['compose', '-p', project, 'exec', '--no-TTY', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'lindyson', '-d', 'lindyson'], { input, encoding: 'utf8', env: process.env });
  sql(`BEGIN;
    ALTER TABLE referral_codes DROP CONSTRAINT referral_codes_code_check;
    INSERT INTO users(id,email,password_hash,user_name) VALUES ('00000000-0000-4000-8000-000000008600','legacy-referral@lindyson.test','fixture','历史邀请测试');
    INSERT INTO referral_codes(user_id,code,legacy_code) VALUES ('00000000-0000-4000-8000-000000008600','_NSW82ah','legacy-referral-code-2026');
    INSERT INTO users(id,email,password_hash,user_name) VALUES ('00000000-0000-4000-8000-000000008700','uppercase-referral@lindyson.test','fixture','大写邀请测试');
    INSERT INTO referral_codes(user_id,code) VALUES ('00000000-0000-4000-8000-000000008700','AB12CD34');
    ${migration}
    ${migration}
    COMMIT;`);
  const script = readFileSync(new URL('./referrals.runtime.mjs', import.meta.url), 'utf8');
  const output = execFileSync('docker', ['compose', '-p', project, 'exec', '--no-TTY', 'api', 'node', '--input-type=module'], { input: script, encoding: 'utf8', env: process.env, timeout: 80000 });
  expect(output).toContain('REFERRAL_FULLSTACK_OK');
  sql(`BEGIN;\n${migration}\nCOMMIT;`);
});
