import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration082Url = new URL('../migrations/082_tk_prompt_engine.sql', import.meta.url);
const migration083Url = new URL(
  '../migrations/083_tk_prompt_seedance_presenter.sql',
  import.meta.url,
);

describe('083 TK Prompt Seedance 虚构主持人迁移', () => {
  it('保持已执行 082 原文，只通过新增 083 重建方案内容约束', async () => {
    const [migration082, migration083] = await Promise.all([
      readFile(migration082Url, 'utf8'),
      readFile(migration083Url, 'utf8'),
    ]);
    expect(migration082).toContain("strategy_blueprint ->> 'authorizedActorAssetId'");
    expect(migration083).toContain(
      'DROP CONSTRAINT IF EXISTS tk_prompt_options_content_shape_check',
    );
    expect(migration083).toContain(
      'ADD CONSTRAINT tk_prompt_options_content_shape_check CHECK',
    );
    expect(migration083).not.toContain("~* '^[0-9a-f]{8}");
    expect(migration083).toContain("'product_closeup', 'scene_demo', 'live_presenter'");
    expect(migration083).toContain("'presenter_delivery'");
  });

  it('live_presenter 不要求演员 ID，并在三类持久化 JSON 中拒绝旧字段', async () => {
    const sql = await readFile(migration083Url, 'utf8');
    expect(sql).toContain("NOT (strategy_blueprint ? 'authorizedActorAssetId')");
    expect(sql).toContain("NOT coalesce(confirmed_fact_pack ? 'actorSnapshot', false)");
    expect(sql).toContain("(creative_input #> '{appearance}') ? 'authorizedActorAssetId'");
    expect(sql).toContain("'$[*].authorizedActorAssetId'");
    expect(sql).toContain("coalesce(strategy_blueprint ->> 'slot' = slot, false)");
    expect(sql).toContain('jsonb_path_exists');
  });

  it('重复执行会先安全删除同名约束再恢复相同终态', async () => {
    const sql = await readFile(migration083Url, 'utf8');
    expect(sql.match(/DROP CONSTRAINT IF EXISTS/g)).toHaveLength(2);
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS tk_prompt_generations_seedance_presenter_shape_check',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT tk_prompt_generations_seedance_presenter_shape_check CHECK',
    );
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/u);
  });
});
