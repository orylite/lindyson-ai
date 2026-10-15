import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('048 分页与缩略图迁移', () => {
  it('建立缩略图不变量、键集索引和模糊搜索索引', async () => {
    const sql = await readFile(
      new URL('../migrations/048_paged_loading_and_asset_thumbnails.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(sql).toContain('assets_ready_thumbnail_check');
    expect(sql).toContain("thumbnail_status IN ('pending', 'ready', 'failed', 'not-required')");
    expect(sql).toContain('idx_assets_user_cursor');
    expect(sql).toMatch(/idx_assets_ai_video_thumbnail_recovery[\s\S]*thumbnail_updated_at ASC NULLS FIRST[\s\S]*source = 'ai-video'[\s\S]*thumbnail_status = 'pending'/);
    expect(sql).toMatch(/idx_orders_user_status_cursor[\s\S]*orders\(user_id, status, created_at DESC, id DESC\)/);
    expect(sql).toMatch(/idx_generation_tasks_user_status_cursor[\s\S]*generation_tasks\(user_id, status, created_at DESC, id DESC\)/);
    expect(sql).toMatch(/idx_invoice_requests_user_status_cursor[\s\S]*invoice_requests\(user_id, status, requested_at DESC, id DESC\)/);
    expect(sql).toMatch(/idx_tickets_status_priority_cursor[\s\S]*tickets\(status, priority, updated_at DESC, id DESC\)/);
    expect(sql).toMatch(/idx_tickets_status_cursor[\s\S]*tickets\(status, updated_at DESC, id DESC\)/);
    expect(sql).toMatch(/idx_audit_logs_risk_module_cursor[\s\S]*audit_logs\(risk, module, created_at DESC, id DESC\)/);
    expect(sql).toMatch(/idx_audit_logs_risk_cursor[\s\S]*audit_logs\(risk, created_at DESC, id DESC\)/);
    expect(sql).toMatch(/idx_assets_user_source_cursor[\s\S]*assets\(user_id, source, created_at DESC, id DESC\)/);
    expect(sql).toMatch(/idx_announcements_published_cursor[\s\S]*announcements\(published_at DESC, id DESC\)/);

    expect(sql).toContain('idx_users_admin_search_trgm');
    expect(sql).toContain('idx_orders_admin_search_trgm');
    expect(sql).toContain('(id::text) gin_trgm_ops');
    expect(sql).toContain('provider_trade_id gin_trgm_ops');
    expect(sql).toContain('idx_invoice_requests_admin_search_trgm');
    expect(sql).toContain('idx_generation_tasks_admin_search_trgm');
    expect(sql).toContain('idx_credit_ledger_admin_search_trgm');
    expect(sql).toContain('idx_audit_logs_admin_search_trgm');
    expect(sql).toContain('idx_announcements_admin_search_trgm');
    expect(sql).not.toContain('idx_generation_tasks_user_kind_status_cursor');
    expect(sql).not.toMatch(/\bOFFSET\b/i);
  });

  it('重复执行不会把已失败或已完成的图片缩略图重置为待处理', async () => {
    const sql = await readFile(
      new URL('../migrations/048_paged_loading_and_asset_thumbnails.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain("WHEN thumbnail_status = 'failed'");
    expect(sql).toContain('COALESCE(thumbnail_updated_at, updated_at, created_at)');
    expect(sql).toContain("WHEN thumbnail_key IS NOT NULL AND thumbnail_key <> object_key THEN 'ready'");
  });
});
