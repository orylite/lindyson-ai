import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page, type Request } from '@playwright/test';
import sharp from 'sharp';

const primaryAccount = {
  email: 'integration-admin@lindyson.test',
  password: 'IntegrationAdmin2026!',
};
const secondaryAccount = {
  email: 'integration-owner-b@lindyson.test',
  password: 'IntegrationOwnerB2026!',
};
const composeProject = process.env.FULLSTACK_COMPOSE_PROJECT ?? 'lindyson-integration';
// 由 ffmpeg 生成并经 ffprobe 验证的 1 秒 H.264/MP4（16x16，1538 bytes），不是伪造文件头。
const mp4Base64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMVbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAj90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG3bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABYm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAAg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABXoAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAAK9AAAAAQAAABRzdGNvAAAAAAAAAAEAAANFAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDIAAAAIZnJlZQAAAsVtZGF0AAACpQYF//+h3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAEGWIhAAV//73ye/Apuvb34E=';
// sharp 生成的 512x512 透明无损 WebP（52 bytes），用于满足向导只读取 ready WebP 缩略图的边界。
const promptWizardThumbnailWebpBase64 = 'UklGRiwAAABXRUJQVlA4TB8AAAAv/8F/EAcQEREQCCT7e89QRP8z/vOf//znP//5z/8BAA==';

test.describe.configure({ mode: 'serial' });

test('Migration 081 在真实 PostgreSQL 16 上忽略零行语句并保持批量写入一次递增', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/081_ignore_empty_admin_pagination_writes.sql', import.meta.url),
    'utf8',
  );
  const announcementIds = [randomUUID(), randomUUID()];
  const billingRunIds = [randomUUID(), randomUUID()];

  postgresRollbackScript(`
    ${migration}
    ${migration}

    INSERT INTO admin_pagination_versions (resource, version, updated_at)
    VALUES ('admin-announcements-v1-published-desc', 100, now())
    ON CONFLICT (resource) DO UPDATE SET version = 100, updated_at = now();
    UPDATE admin_cost_pagination_versions
    SET version = 100, updated_at = now()
    WHERE resource IN ('admin:cost-video', 'admin:provider-billing');

    DO $migration081_trackers$
    DECLARE
      source_count integer;
      tracker_count integer;
    BEGIN
      SELECT count(*) INTO source_count
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgfoid IN (
          'admin_pagination_bump_trigger()'::regprocedure,
          'bump_admin_cost_pagination_versions()'::regprocedure
        );
      SELECT count(*) INTO tracker_count
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgfoid = 'admin_pagination_capture_statement_counters()'::regprocedure;
      IF source_count <> 54 OR tracker_count <> 54 THEN
        RAISE EXCEPTION 'Migration 081 BEFORE/AFTER 配对不完整：source=%, tracker=%',
          source_count, tracker_count;
      END IF;
      IF (
        SELECT count(*) FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgfoid = 'admin_pagination_bump_users_update()'::regprocedure
      ) <> 1 THEN
        RAISE EXCEPTION 'Migration 081 用户 transition-table 更新触发器数量异常';
      END IF;
    END
    $migration081_trackers$;

    INSERT INTO announcements (id, title, content)
    SELECT '${announcementIds[0]}'::uuid, 'zero', 'zero' WHERE false;
    UPDATE announcements SET title = 'zero' WHERE id = '${announcementIds[0]}';
    DELETE FROM announcements WHERE id = '${announcementIds[0]}';

    DO $migration081_core_zero_before$
    DECLARE current_version bigint;
    BEGIN
      SELECT version INTO current_version FROM admin_pagination_versions
      WHERE resource = 'admin-announcements-v1-published-desc';
      IF current_version <> 100 THEN
        RAISE EXCEPTION 'Migration 081 核心零行 I/U/D 误递增：%', current_version;
      END IF;
    END
    $migration081_core_zero_before$;

    INSERT INTO announcements (id, title, content) VALUES
      ('${announcementIds[0]}', 'Migration 081 A', 'A'),
      ('${announcementIds[1]}', 'Migration 081 B', 'B');
    UPDATE announcements
    SET updated_at = updated_at + interval '1 microsecond'
    WHERE id IN ('${announcementIds[0]}', '${announcementIds[1]}');
    UPDATE announcements SET title = title WHERE false;
    INSERT INTO announcements (id, title, content)
    VALUES ('${announcementIds[0]}', 'conflict ignored', 'conflict ignored')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO announcements (id, title, content)
    VALUES ('${announcementIds[0]}', 'conflict filtered', 'conflict filtered')
    ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title
    WHERE false;

    DO $migration081_core_insert$
    DECLARE current_version bigint;
    BEGIN
      SELECT version INTO current_version FROM admin_pagination_versions
      WHERE resource = 'admin-announcements-v1-published-desc';
      IF current_version <> 101 THEN
        RAISE EXCEPTION 'Migration 081 核心批量 INSERT 或零行语句错误：%',
          current_version;
      END IF;
    END
    $migration081_core_insert$;

    INSERT INTO announcements (id, title, content)
    VALUES ('${announcementIds[0]}', 'upsert updated', 'upsert updated')
    ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title;

    DO $migration081_core_upsert$
    DECLARE current_version bigint;
    BEGIN
      SELECT version INTO current_version FROM admin_pagination_versions
      WHERE resource = 'admin-announcements-v1-published-desc';
      IF current_version <> 102 THEN
        RAISE EXCEPTION 'Migration 081 实际 UPSERT 的 INSERT/UPDATE 事件未合并为一次递增：%',
          current_version;
      END IF;
    END
    $migration081_core_upsert$;

    UPDATE announcements
    SET title = title || ' updated'
    WHERE id IN ('${announcementIds[0]}', '${announcementIds[1]}');
    UPDATE announcements SET title = title WHERE false;
    DELETE FROM announcements WHERE id = '00000000-0000-0000-0000-000000000000';

    DO $migration081_core_update$
    DECLARE current_version bigint;
    BEGIN
      SELECT version INTO current_version FROM admin_pagination_versions
      WHERE resource = 'admin-announcements-v1-published-desc';
      IF current_version <> 103 THEN
        RAISE EXCEPTION 'Migration 081 核心批量 UPDATE 未精确递增一次：%', current_version;
      END IF;
    END
    $migration081_core_update$;

    DELETE FROM announcements
    WHERE id IN ('${announcementIds[0]}', '${announcementIds[1]}');
    DELETE FROM announcements WHERE id = '${announcementIds[0]}';

    DO $migration081_core_delete$
    DECLARE current_version bigint;
    BEGIN
      SELECT version INTO current_version FROM admin_pagination_versions
      WHERE resource = 'admin-announcements-v1-published-desc';
      IF current_version <> 104 THEN
        RAISE EXCEPTION 'Migration 081 核心批量 DELETE 未精确递增一次：%', current_version;
      END IF;
    END
    $migration081_core_delete$;

    INSERT INTO provider_billing_sync_runs (id, provider, kind, status)
    SELECT '${billingRunIds[0]}'::uuid, 'migration-081', 'balance', 'running'
    WHERE false;
    UPDATE provider_billing_sync_runs SET status = status
    WHERE id = '${billingRunIds[0]}';
    DELETE FROM provider_billing_sync_runs WHERE id = '${billingRunIds[0]}';

    DO $migration081_cost_zero_before$
    DECLARE version_snapshot text;
    BEGIN
      SELECT string_agg(resource || ':' || version, ',' ORDER BY resource)
      INTO version_snapshot
      FROM admin_cost_pagination_versions
      WHERE resource IN ('admin:cost-video', 'admin:provider-billing');
      IF version_snapshot <> 'admin:cost-video:100,admin:provider-billing:100' THEN
        RAISE EXCEPTION 'Migration 081 成本零行 I/U/D 误递增：%', version_snapshot;
      END IF;
    END
    $migration081_cost_zero_before$;

    INSERT INTO provider_billing_sync_runs (id, provider, kind, status) VALUES
      ('${billingRunIds[0]}', 'migration-081', 'balance', 'running'),
      ('${billingRunIds[1]}', 'migration-081', 'balance', 'running');
    UPDATE provider_billing_sync_runs
    SET page_count = page_count + 1
    WHERE id IN ('${billingRunIds[0]}', '${billingRunIds[1]}');
    UPDATE provider_billing_sync_runs SET status = status WHERE false;

    DO $migration081_cost_insert$
    DECLARE version_snapshot text;
    BEGIN
      SELECT string_agg(resource || ':' || version, ',' ORDER BY resource)
      INTO version_snapshot
      FROM admin_cost_pagination_versions
      WHERE resource IN ('admin:cost-video', 'admin:provider-billing');
      IF version_snapshot <> 'admin:cost-video:101,admin:provider-billing:101' THEN
        RAISE EXCEPTION 'Migration 081 成本批量 INSERT 或无关 UPDATE 后零行 UPDATE 错误：%',
          version_snapshot;
      END IF;
    END
    $migration081_cost_insert$;

    UPDATE provider_billing_sync_runs
    SET status = 'success', completed_at = now()
    WHERE id IN ('${billingRunIds[0]}', '${billingRunIds[1]}');
    UPDATE provider_billing_sync_runs SET status = status WHERE false;
    DELETE FROM provider_billing_sync_runs
    WHERE id = '00000000-0000-0000-0000-000000000000';

    DO $migration081_cost_update$
    DECLARE version_snapshot text;
    BEGIN
      SELECT string_agg(resource || ':' || version, ',' ORDER BY resource)
      INTO version_snapshot
      FROM admin_cost_pagination_versions
      WHERE resource IN ('admin:cost-video', 'admin:provider-billing');
      IF version_snapshot <> 'admin:cost-video:102,admin:provider-billing:102' THEN
        RAISE EXCEPTION 'Migration 081 成本批量 UPDATE 未精确递增一次：%', version_snapshot;
      END IF;
    END
    $migration081_cost_update$;

    DELETE FROM provider_billing_sync_runs
    WHERE id IN ('${billingRunIds[0]}', '${billingRunIds[1]}');
    DELETE FROM provider_billing_sync_runs WHERE id = '${billingRunIds[0]}';

    DO $migration081_cost_delete$
    DECLARE version_snapshot text;
    BEGIN
      SELECT string_agg(resource || ':' || version, ',' ORDER BY resource)
      INTO version_snapshot
      FROM admin_cost_pagination_versions
      WHERE resource IN ('admin:cost-video', 'admin:provider-billing');
      IF version_snapshot <> 'admin:cost-video:103,admin:provider-billing:103' THEN
        RAISE EXCEPTION 'Migration 081 成本批量 DELETE 未精确递增一次：%', version_snapshot;
      END IF;
    END
    $migration081_cost_delete$;
  `);
});

test('Migration 062 可在真实 PostgreSQL 16 上重复执行并锁定支付返回来源', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/062_payment_attempt_return_origin.sql', import.meta.url),
    'utf8',
  );

  postgresScript(migration);
  postgresScript(migration);

  expect(postgresScalar(`
    SELECT concat_ws('|', is_nullable, column_default)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_attempts'
      AND column_name = 'return_origin';
  `)).toBe(`NO|'https://www.lindyson.com'::text`);

  const orderId = randomUUID();
  const attemptId = randomUUID();
  const suffix = randomUUID();
  postgresRollbackScript(`
    INSERT INTO orders (
      id, user_id, kind, plan_name, amount, billing, status
    )
    SELECT '${orderId}', id, 'main', 'Migration 062', 1, 'one-time', 'pending'
    FROM users WHERE email = '${primaryAccount.email}';

    INSERT INTO payment_attempts (
      id, order_id, attempt, idempotency_key, request_hash,
      merchant_order_no, amount, surface, way_code, return_origin, status, terminal_at
    ) VALUES (
      '${attemptId}', '${orderId}', 1, 'migration-062-${suffix}',
      'migration-062-${suffix}', 'M062${suffix.replaceAll('-', '')}',
      1, 'mobile', 'ALI_WAP', 'https://www.lindyson.cn', 'manual-review', now()
    );

    DO $migration062$
    DECLARE stored_origin text;
    BEGIN
      SELECT return_origin INTO stored_origin
      FROM payment_attempts WHERE id = '${attemptId}';
      IF stored_origin IS DISTINCT FROM 'https://www.lindyson.cn' THEN
        RAISE EXCEPTION 'Migration 062 未保留 return_origin：%', stored_origin;
      END IF;

      BEGIN
        UPDATE payment_attempts
        SET return_origin = 'https://www.lindyson.com'
        WHERE id = '${attemptId}';
        RAISE EXCEPTION 'Migration 062 允许篡改 return_origin';
      EXCEPTION
        WHEN raise_exception THEN
          IF SQLERRM = 'Migration 062 允许篡改 return_origin' THEN
            RAISE;
          END IF;
          IF SQLERRM NOT LIKE 'payment_attempts 业务身份不可修改：attempt=%' THEN
            RAISE;
          END IF;
      END;
    END
    $migration062$;
  `);
});

test('Migration 073 重跑时保留人工调整的 Seedance 2.5 双档积分与开放状态', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/073_seedance_25_generation.sql', import.meta.url),
    'utf8',
  );

  postgresRollbackScript(`
    DELETE FROM consumption_settings
    WHERE kind = 'video'
      AND model = 'Seedance 2.5'
      AND duration_seconds = 25
      AND resolution IN ('480p', '720p');

    ${migration}

    UPDATE consumption_settings
    SET credits = 777,
        reference_video_credits = 333,
        available = true
    WHERE kind = 'video'
      AND model = 'Seedance 2.5'
      AND duration_seconds = 5
      AND resolution = '480p';

    ${migration}
    ${migration}

    DO $migration073$
    DECLARE
      seedance_25_count integer;
      adjusted_credits integer;
      adjusted_reference_video_credits integer;
      adjusted_available boolean;
    BEGIN
      SELECT COUNT(*)
      INTO seedance_25_count
      FROM consumption_settings
      WHERE kind = 'video' AND model = 'Seedance 2.5';

      IF seedance_25_count <> 10 THEN
        RAISE EXCEPTION 'Migration 073 重跑后 Seedance 2.5 组合数不是 10：%', seedance_25_count;
      END IF;

      SELECT credits, reference_video_credits, available
      INTO adjusted_credits, adjusted_reference_video_credits, adjusted_available
      FROM consumption_settings
      WHERE kind = 'video'
        AND model = 'Seedance 2.5'
        AND duration_seconds = 5
        AND resolution = '480p';

      IF adjusted_credits <> 777
        OR adjusted_reference_video_credits <> 333
        OR adjusted_available IS DISTINCT FROM true THEN
        RAISE EXCEPTION
          'Migration 073 重跑覆盖了人工配置：credits=%, reference_video_credits=%, available=%',
          adjusted_credits, adjusted_reference_video_credits, adjusted_available;
      END IF;
    END
    $migration073$;
  `);
});

test('Migration 075 在真实 PostgreSQL 16 上动态推导 25 秒双档价格、传递全量开关并幂等审计', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/075_seedance_25_duration_25.sql', import.meta.url),
    'utf8',
  );

  postgresRollbackScript(`
    DELETE FROM consumption_settings
    WHERE kind = 'video' AND model = 'Seedance 2.5' AND duration_seconds = 25;
    DELETE FROM audit_logs
    WHERE action = '新增 Seedance 2.5 25秒档' AND target = 'Seedance 2.5:25s';

    UPDATE consumption_settings
    SET available = true
    WHERE kind = 'video' AND model = 'Seedance 2.5';
    UPDATE consumption_settings
    SET credits = CASE resolution WHEN '480p' THEN 107 WHEN '720p' THEN 229 END
    WHERE kind = 'video' AND model = 'Seedance 2.5'
      AND duration_seconds = 15 AND resolution IN ('480p', '720p');

    ${migration}
    ${migration}

    DO $migration075_open$
    DECLARE
      total_count integer;
      available_count integer;
      audit_count integer;
      price_480 integer;
      reference_price_480 integer;
      price_720 integer;
      reference_price_720 integer;
      audit_detail jsonb;
    BEGIN
      SELECT COUNT(*), COUNT(*) FILTER (WHERE available)
      INTO total_count, available_count
      FROM consumption_settings
      WHERE kind = 'video' AND model = 'Seedance 2.5';

      SELECT
        MAX(credits) FILTER (WHERE resolution = '480p'),
        MAX(reference_video_credits) FILTER (WHERE resolution = '480p'),
        MAX(credits) FILTER (WHERE resolution = '720p'),
        MAX(reference_video_credits) FILTER (WHERE resolution = '720p')
      INTO price_480, reference_price_480, price_720, reference_price_720
      FROM consumption_settings
      WHERE kind = 'video' AND model = 'Seedance 2.5' AND duration_seconds = 25;

      SELECT COUNT(*), MAX(detail)::jsonb
      INTO audit_count, audit_detail
      FROM audit_logs
      WHERE action = '新增 Seedance 2.5 25秒档' AND target = 'Seedance 2.5:25s';

      IF total_count <> 12 OR available_count <> 12
        OR price_480 <> 179 OR reference_price_480 <> 108
        OR price_720 <> 382 OR reference_price_720 <> 230
      THEN
        RAISE EXCEPTION
          'Migration 075 全开推导失败：total=%, available=%, 480=%/%, 720=%/%',
          total_count, available_count, price_480, reference_price_480,
          price_720, reference_price_720;
      END IF;

      IF audit_count <> 1
        OR audit_detail->>'migration' <> '075_seedance_25_duration_25.sql'
        OR audit_detail->>'insertedCount' <> '2'
        OR audit_detail->>'previousAvailableCount' <> '10'
        OR audit_detail->>'newAvailableCount' <> '12'
        OR audit_detail->>'preservedExistingPricesAndAvailability' <> 'true'
        OR audit_detail->'prices'->'480p'->>'credits' <> '179'
        OR audit_detail->'prices'->'480p'->>'referenceVideoCredits' <> '108'
        OR audit_detail->'prices'->'720p'->>'credits' <> '382'
        OR audit_detail->'prices'->'720p'->>'referenceVideoCredits' <> '230'
      THEN
        RAISE EXCEPTION 'Migration 075 审计快照不完整：count=%, detail=%', audit_count, audit_detail;
      END IF;
    END
    $migration075_open$;

    DELETE FROM consumption_settings
    WHERE kind = 'video' AND model = 'Seedance 2.5' AND duration_seconds = 25;
    DELETE FROM audit_logs
    WHERE action = '新增 Seedance 2.5 25秒档' AND target = 'Seedance 2.5:25s';
    UPDATE consumption_settings
    SET available = false
    WHERE kind = 'video' AND model = 'Seedance 2.5';
    UPDATE consumption_settings
    SET credits = CASE resolution WHEN '480p' THEN 86 WHEN '720p' THEN 122 END
    WHERE kind = 'video' AND model = 'Seedance 2.5'
      AND duration_seconds = 15 AND resolution IN ('480p', '720p');

    ${migration}
    ${migration}

    DO $migration075_closed$
    DECLARE
      total_count integer;
      available_count integer;
      audit_count integer;
      price_snapshot text;
    BEGIN
      SELECT COUNT(*), COUNT(*) FILTER (WHERE available)
      INTO total_count, available_count
      FROM consumption_settings
      WHERE kind = 'video' AND model = 'Seedance 2.5';
      SELECT string_agg(
        resolution || ':' || credits || '/' || reference_video_credits,
        ',' ORDER BY resolution
      )
      INTO price_snapshot
      FROM consumption_settings
      WHERE kind = 'video' AND model = 'Seedance 2.5' AND duration_seconds = 25;
      SELECT COUNT(*) INTO audit_count
      FROM audit_logs
      WHERE action = '新增 Seedance 2.5 25秒档' AND target = 'Seedance 2.5:25s';

      IF total_count <> 12 OR available_count <> 0
        OR price_snapshot <> '480p:144/87,720p:204/123'
        OR audit_count <> 1
      THEN
        RAISE EXCEPTION
          'Migration 075 全关推导或幂等审计失败：total=%, available=%, prices=%, audits=%',
          total_count, available_count, price_snapshot, audit_count;
      END IF;
    END
    $migration075_closed$;

    DELETE FROM consumption_settings
    WHERE kind = 'video' AND model = 'Seedance 2.5' AND duration_seconds = 25;
    DELETE FROM audit_logs
    WHERE action = '新增 Seedance 2.5 25秒档' AND target = 'Seedance 2.5:25s';
    INSERT INTO consumption_settings (
      kind, model, model_label, duration_seconds, resolution,
      credits, reference_video_credits, available
    ) VALUES (
      'video', 'Seedance 2.5', 'Seedance 2.5', 25, '480p', 999, 555, false
    );

    ${migration}
    ${migration}

    DO $migration075_partial_existing$
    DECLARE
      price_snapshot text;
      audit_count integer;
      inserted_count text;
    BEGIN
      SELECT string_agg(
        resolution || ':' || credits || '/' || reference_video_credits,
        ',' ORDER BY resolution
      )
      INTO price_snapshot
      FROM consumption_settings
      WHERE kind = 'video' AND model = 'Seedance 2.5' AND duration_seconds = 25;
      SELECT COUNT(*), (MAX(detail)::jsonb)->>'insertedCount'
      INTO audit_count, inserted_count
      FROM audit_logs
      WHERE action = '新增 Seedance 2.5 25秒档' AND target = 'Seedance 2.5:25s';

      IF price_snapshot <> '480p:999/555,720p:204/123'
        OR audit_count <> 1 OR inserted_count <> '1'
      THEN
        RAISE EXCEPTION
          'Migration 075 未保留已有 25 秒人工价或单行补齐审计错误：prices=%, audits=%, inserted=%',
          price_snapshot, audit_count, inserted_count;
      END IF;
    END
    $migration075_partial_existing$;
  `);

  const partialFailure = postgresRollbackScriptFailure(`
    DELETE FROM consumption_settings
    WHERE kind = 'video' AND model = 'Seedance 2.5' AND duration_seconds = 25;
    UPDATE consumption_settings
    SET available = false
    WHERE kind = 'video' AND model = 'Seedance 2.5';
    UPDATE consumption_settings
    SET available = true
    WHERE kind = 'video' AND model = 'Seedance 2.5'
      AND duration_seconds = 5 AND resolution = '480p';
    ${migration}
  `);
  expect(partialFailure).toContain('旧 10 档必须全开或全关');

  const malformedFailure = postgresRollbackScriptFailure(`
    DELETE FROM consumption_settings
    WHERE kind = 'video' AND model = 'Seedance 2.5' AND duration_seconds = 25;
    UPDATE consumption_settings
    SET available = false
    WHERE kind = 'video' AND model = 'Seedance 2.5';
    UPDATE consumption_settings
    SET credits = 0
    WHERE kind = 'video' AND model = 'Seedance 2.5'
      AND duration_seconds = 5 AND resolution = '480p';
    ${migration}
  `);
  expect(malformedFailure).toContain('积分必须全部为正整数');
});

test('Migration 074 在同一 task 原地重试后保持各 attempt 生成流水快照不可变', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/074_credit_ledger_generation_snapshots.sql', import.meta.url),
    'utf8',
  );
  postgresScript(migration);
  postgresScript(migration);
  expect(postgresScalar(
    "SELECT count(*) FROM schema_migrations WHERE id = '074_credit_ledger_generation_snapshots.sql';",
  )).toBe('1');

  const taskId = randomUUID();
  const hold0Id = randomUUID();
  const refund0Id = randomUUID();
  const spend1Id = randomUUID();
  const orderId = randomUUID();
  const orderLedgerId = randomUUID();
  const suffix = randomUUID();
  postgresRollbackScript(`
    INSERT INTO generation_tasks (
      id, user_id, kind, model, status, processing_stage, prompt, config,
      credits, reserved_credits, settled_credits, refunded_credits, credit_status,
      attempt, main_credits_used, addon_credits_used
    ) VALUES (
      '${taskId}',
      (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
      'video', 'Seedance 2.5', 'queued', 'queued', 'Migration 074 attempt 0',
      '{"durationSeconds":15,"resolution":"720p","referenceAssets":[]}'::jsonb,
      122, 122, 0, 0, 'held', 0, 122, 0
    );

    INSERT INTO credit_ledger (
      id, user_id, type, bucket, settlement_status, amount, balance,
      source, operator, note, related_job_id, business_event_key
    ) VALUES (
      '${hold0Id}',
      (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
      'hold', 'main', 'held', -122, 500,
      'Seedance 2.5 生成预扣', 'system', '首次执行预扣', '${taskId}',
      'generation-hold:${taskId}:0'
    );

    UPDATE credit_ledger
    SET settlement_status = 'refunded', note = '供应商终态失败，释放预扣'
    WHERE id = '${hold0Id}';

    INSERT INTO credit_ledger (
      id, user_id, type, bucket, settlement_status, amount, balance,
      source, operator, note, related_job_id, business_event_key
    ) VALUES (
      '${refund0Id}',
      (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
      'refund', 'main', 'refunded', 122, 622,
      '生成任务退回', 'system', '首次执行失败退款', '${taskId}',
      'generation-failure-refund:${taskId}:0'
    );

    UPDATE generation_tasks
    SET attempt = 1,
        model = 'Seedance 2.0',
        status = 'queued',
        processing_stage = 'queued',
        prompt = 'Migration 074 attempt 1',
        config = '{"durationSeconds":5,"resolution":"480p","referenceAssets":[{"type":"video","role":"reference_video"}]}'::jsonb,
        credits = 49,
        reserved_credits = 49,
        settled_credits = 0,
        refunded_credits = 0,
        credit_status = 'held',
        main_credits_used = 49,
        addon_credits_used = 0
    WHERE id = '${taskId}';

    INSERT INTO credit_ledger (
      id, user_id, type, bucket, settlement_status, amount, balance,
      source, operator, note, related_job_id, business_event_key
    ) VALUES (
      '${spend1Id}',
      (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
      'hold', 'main', 'held', -49, 573,
      'Seedance 2.0 生成预扣', 'system', '第二次执行预扣', '${taskId}',
      'generation-hold:${taskId}:1'
    );
    UPDATE credit_ledger
    SET type = 'spend', settlement_status = 'settled', note = '第二次执行成功'
    WHERE id = '${spend1Id}';

    INSERT INTO orders (
      id, user_id, kind, plan_name, amount, billing, status
    ) SELECT '${orderId}', id, 'addon', 'Migration 074 订单退款', 1, 'one-time', 'refunded'
      FROM users WHERE email = '${primaryAccount.email}';
    INSERT INTO credit_ledger (
      id, user_id, type, bucket, settlement_status, amount, balance,
      source, operator, note, related_order_id, business_event_key
    ) VALUES (
      '${orderLedgerId}',
      (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
      'refund', 'addon', 'refunded', 1, 574,
      '订单退款', 'system', '不得混入生成流水快照', '${orderId}',
      'order-refund:migration-074:${suffix}'
    );

    DO $migration074$
    DECLARE
      old_refund jsonb;
      new_spend jsonb;
      order_snapshot jsonb;
    BEGIN
      SELECT generation_snapshot INTO old_refund
      FROM credit_ledger WHERE id = '${refund0Id}';
      IF old_refund IS NULL
        OR old_refund->>'attempt' <> '0'
        OR old_refund->>'model' <> 'Seedance 2.5'
        OR old_refund->>'durationSeconds' <> '15'
        OR old_refund->>'resolution' <> '720p'
        OR old_refund->>'hasReferenceVideo' <> 'false'
        OR old_refund->>'reservedCredits' <> '122'
        OR old_refund->>'settledCredits' <> '0'
        OR old_refund->>'refundedCredits' <> '122'
        OR old_refund->>'taskStatus' <> 'failed'
        OR old_refund->>'creditStatus' <> 'refunded' THEN
        RAISE EXCEPTION 'attempt 0 退款快照被 attempt 1 当前任务污染：%', old_refund;
      END IF;

      SELECT generation_snapshot INTO new_spend
      FROM credit_ledger WHERE id = '${spend1Id}';
      IF new_spend IS NULL
        OR new_spend->>'attempt' <> '1'
        OR new_spend->>'model' <> 'Seedance 2.0'
        OR new_spend->>'durationSeconds' <> '5'
        OR new_spend->>'resolution' <> '480p'
        OR new_spend->>'hasReferenceVideo' <> 'true'
        OR new_spend->>'reservedCredits' <> '49'
        OR new_spend->>'settledCredits' <> '49'
        OR new_spend->>'refundedCredits' <> '0'
        OR new_spend->>'taskStatus' <> 'completed'
        OR new_spend->>'creditStatus' <> 'settled' THEN
        RAISE EXCEPTION 'attempt 1 实扣快照错误：%', new_spend;
      END IF;

      SELECT generation_snapshot INTO order_snapshot
      FROM credit_ledger WHERE id = '${orderLedgerId}';
      IF order_snapshot IS NOT NULL THEN
        RAISE EXCEPTION '订单退款被错误写入生成流水快照：%', order_snapshot;
      END IF;

      BEGIN
        UPDATE credit_ledger
        SET generation_snapshot = jsonb_set(generation_snapshot, '{attempt}', '9'::jsonb)
        WHERE id = '${refund0Id}';
        RAISE EXCEPTION '允许直接篡改生成流水快照';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许直接篡改生成流水快照' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE 'credit_ledger.generation_snapshot 不允许直接修改：%' THEN RAISE; END IF;
      END;

      BEGIN
        UPDATE credit_ledger
        SET type = 'spend', settlement_status = 'settled'
        WHERE id = '${refund0Id}';
        RAISE EXCEPTION '允许把退款流水改写为实扣';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许把退款流水改写为实扣' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '生成积分流水只允许从预扣收口为实扣或退回：%' THEN RAISE; END IF;
      END;
    END
    $migration074$;
  `);
});

test('Migration 063 可重跑并锁定 Seedream checkpoint、临时 URL 与逐任务价格证据', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/063_seedream_image_generation.sql', import.meta.url),
    'utf8',
  );
  postgresScript(migration);
  postgresScript(migration);

  expect(postgresScalar(`
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generation_provider_runs'
      AND column_name IN (
        'provider_request_id', 'provider_response_checkpoint', 'provider_response_url',
        'provider_response_observed_at', 'provider_response_url_expires_at'
      );
  `)).toBe('5');

  const taskId = randomUUID();
  const runId = randomUUID();
  const usageId = randomUUID();
  const operationId = `seedream-sync:${taskId}:0`;
  const requestId = `fullstack-seedream-${randomUUID()}`;
  postgresRollbackScript(`
    INSERT INTO generation_tasks (
      id, user_id, kind, model, status, prompt, config, provider_task_id,
      credits, reserved_credits, settled_credits, refunded_credits, credit_status,
      attempt, provider_task_attempt, processing_stage, created_at, started_at, updated_at
    ) VALUES (
      '${taskId}',
      (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
      'image', 'Seedream 5.0 Pro', 'processing', 'Migration 063 checkpoint',
      '{"resolution":"1K","referenceAssets":[]}'::jsonb, '${operationId}',
      14, 14, 0, 0, 'held', 0, 0, 'provider-succeeded', now(), now(), now()
    );

    INSERT INTO generation_provider_runs (
      id, task_id, task_attempt, provider, request_hash, submission_key, status,
      provider_task_id, output_object_key, thumbnail_object_key, staging_object_key,
      provider_request_id, provider_response_checkpoint, provider_response_url,
      provider_response_observed_at, provider_response_url_expires_at
    ) VALUES (
      '${runId}', '${taskId}', 0, 'volcengine-ark', repeat('a', 64),
      '${taskId}:0', 'provider-succeeded', '${operationId}',
      'generated/image/fullstack/${taskId}/output.png',
      'generated/image/fullstack/${taskId}/thumbnail.webp',
      'generated-staging/image/fullstack/${taskId}',
      '${requestId}',
      '{"version":1,"model":"doubao-seedream-5-0-pro-260628","created":null,"size":"1024x1024","usage":{"generatedImages":1,"outputTokens":12,"totalTokens":12}}'::jsonb,
      'https://temporary.example.test/output.png', now(), now() + interval '24 hours'
    );
    UPDATE generation_tasks SET active_provider_run_id = '${runId}' WHERE id = '${taskId}';

    DO $migration063_checkpoint$
    BEGIN
      BEGIN
        UPDATE generation_provider_runs
        SET provider_request_id = 'tampered-request'
        WHERE id = '${runId}';
        RAISE EXCEPTION '允许篡改 provider_request_id';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许篡改 provider_request_id' THEN RAISE; END IF;
      END;
      BEGIN
        UPDATE generation_provider_runs
        SET provider_response_checkpoint = '{"version":2}'::jsonb
        WHERE id = '${runId}';
        RAISE EXCEPTION '允许篡改 checkpoint';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许篡改 checkpoint' THEN RAISE; END IF;
      END;
    END
    $migration063_checkpoint$;

    UPDATE generation_provider_runs
    SET provider_response_url = NULL
    WHERE id = '${runId}';
    DO $migration063_url$
    BEGIN
      BEGIN
        UPDATE generation_provider_runs
        SET provider_response_url = 'https://temporary.example.test/restored.png'
        WHERE id = '${runId}';
        RAISE EXCEPTION '允许恢复已清除 URL';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许恢复已清除 URL' THEN RAISE; END IF;
      END;
    END
    $migration063_url$;

    INSERT INTO image_provider_usage_records (
      id, task_id, provider_run_id, attempt, provider, model,
      provider_operation_id, provider_request_id, status,
      request_evidence_status, evidence_status,
      reference_image_count, additional_reference_image_count,
      output_width, output_height, output_pixels, output_tier,
      reference_unit_price_cny, reference_price_cny,
      output_pixel_threshold, small_output_price_cny, large_output_price_cny,
      output_price_cny, estimated_cost_cny, currency, pricing_status,
      price_version, pricing_source_url, generated_images, output_tokens, total_tokens,
      provider_terminal_at, usage_observed_at
    ) VALUES (
      '${usageId}', '${taskId}', '${runId}', 0, 'volcengine-ark', 'Seedream 5.0 Pro',
      '${operationId}', '${requestId}', 'success', 'provider-id', 'known',
      2, 1, 1024, 1024, 1048576, 'small',
      0.020000, 0.020000, 2360000, 0.300000, 0.600000,
      0.300000, 0.320000, 'CNY', 'priced',
      'volcengine-seedream-5.0-pro-list-2026-07-27',
      'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
      1, 12, 12, now(), now()
    );

    DO $migration063_evidence$
    BEGIN
      BEGIN
        UPDATE image_provider_usage_records SET estimated_cost_cny = 9.990000
        WHERE id = '${usageId}';
        RAISE EXCEPTION '允许更新图片成本证据';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许更新图片成本证据' THEN RAISE; END IF;
      END;
      BEGIN
        DELETE FROM image_provider_usage_records WHERE id = '${usageId}';
        RAISE EXCEPTION '允许删除图片成本证据';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许删除图片成本证据' THEN RAISE; END IF;
      END;
      BEGIN
        UPDATE image_provider_pricing_rules SET small_output_price_cny = 9.990000
        WHERE provider = 'volcengine-ark' AND model = 'Seedream 5.0 Pro';
        RAISE EXCEPTION '允许更新图片价格规则';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许更新图片价格规则' THEN RAISE; END IF;
      END;
      BEGIN
        DELETE FROM image_provider_pricing_rules
        WHERE provider = 'volcengine-ark' AND model = 'Seedream 5.0 Pro';
        RAISE EXCEPTION '允许删除图片价格规则';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许删除图片价格规则' THEN RAISE; END IF;
      END;
    END
    $migration063_evidence$;
  `);

  postgresRollbackScript(`
    UPDATE consumption_settings
    SET available = true
    WHERE kind = 'image' AND model = 'Seedream 5.0 Pro' AND resolution = '1K';
    ${migration}
    DO $migration063_available$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM consumption_settings
        WHERE kind = 'image' AND model = 'Seedream 5.0 Pro'
          AND resolution = '1K' AND credits = 14 AND available = true
      ) THEN
        RAISE EXCEPTION 'Migration 063 重跑关闭了已开放的 1K 档';
      END IF;
    END
    $migration063_available$;
  `);
});

test('Migration 064/065/066 可在真实 PostgreSQL 16 上重跑并锁定真人权益、披露与审计不变量', () => {
  const portraitMigration = readFileSync(
    new URL('../../apps/api/migrations/064_real_portrait_library.sql', import.meta.url),
    'utf8',
  );
  const privacyMigration = readFileSync(
    new URL('../../apps/api/migrations/065_real_portrait_privacy_withheld.sql', import.meta.url),
    'utf8',
  );
  const legalDisclosureMigration = readFileSync(
    new URL('../../apps/api/migrations/066_real_portrait_legal_disclosure_snapshot.sql', import.meta.url),
    'utf8',
  );

  postgresScript(portraitMigration);
  postgresScript(portraitMigration);
  postgresScript(privacyMigration);
  postgresScript(privacyMigration);
  postgresScript(legalDisclosureMigration);
  postgresScript(legalDisclosureMigration);

  expect(postgresScalar(`
    SELECT string_agg(
      concat_ws(':', code, portrait_enabled::text,
        coalesce(portrait_profile_limit::text, 'unlimited'),
        portrait_active_limit::text, portrait_assets_per_actor::text),
      '|' ORDER BY code
    )
    FROM plans
    WHERE code IN ('free', 'pro', 'enterprise');
  `)).toBe('enterprise:true:unlimited:10:2|free:true:1:1:1|pro:true:5:3:2');

  expect(postgresScalar(`
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY (ARRAY[
        'real_portrait_actors', 'real_portrait_authorizations',
        'real_portrait_invites', 'real_portrait_verification_sessions',
        'real_portrait_materializations', 'real_portrait_assets',
        'real_portrait_capacity_reservations', 'real_portrait_activation_queue',
        'user_portrait_quota_states', 'portrait_entitlement_reconcile_outbox',
        'real_portrait_upload_sessions', 'real_portrait_remote_operations',
        'generation_real_portrait_references', 'real_portrait_events',
        'real_portrait_subject_access_tokens', 'ai_clean_export_audits'
      ]);
  `)).toBe('16');

  expect(postgresScalar(`
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'real_portrait_authorizations'
      AND is_nullable = 'NO'
      AND column_name = ANY (ARRAY[
        'controller_name', 'processor_name', 'privacy_contact',
        'privacy_policy_url', 'processing_scope', 'retention_rule'
      ]);
  `)).toBe('6');

  expect(postgresScalar(`
    SELECT position('privacy-withheld' IN pg_get_constraintdef(oid)) > 0
    FROM pg_constraint
    WHERE conname = 'generation_tasks_processing_stage_check';
  `)).toBe('t');

  const actorId = randomUUID();
  postgresRollbackScript(`
    UPDATE plans
    SET portrait_enabled = true,
        portrait_profile_limit = 7,
        portrait_active_limit = 4,
        portrait_assets_per_actor = 2
    WHERE code = 'pro' AND kind = 'main';

    ${portraitMigration}

    DO $portrait_replay$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM plans
        WHERE code = 'pro' AND portrait_profile_limit = 7 AND portrait_active_limit = 4
      ) THEN
        RAISE EXCEPTION 'Migration 064 重跑覆盖了管理员配置';
      END IF;

      BEGIN
        UPDATE plans
        SET portrait_enabled = true,
            portrait_profile_limit = 1,
            portrait_active_limit = 2,
            portrait_assets_per_actor = 1
        WHERE code = 'free';
        RAISE EXCEPTION '允许激活额度超过有限档案额度';
      EXCEPTION WHEN check_violation THEN
        NULL;
      END;

      IF EXISTS (SELECT 1 FROM plans WHERE kind = 'addon') THEN
        BEGIN
          UPDATE plans
          SET portrait_enabled = true,
              portrait_profile_limit = 1,
              portrait_active_limit = 1,
              portrait_assets_per_actor = 1
          WHERE id = (SELECT id FROM plans WHERE kind = 'addon' LIMIT 1);
          RAISE EXCEPTION '允许加购包获得真人权益';
        EXCEPTION WHEN check_violation THEN
          NULL;
        END;
      END IF;
    END
    $portrait_replay$;

    INSERT INTO real_portrait_actors (id, user_id, alias)
    SELECT '${actorId}', id, '全栈审计演员'
    FROM users WHERE email = '${primaryAccount.email}';

    INSERT INTO real_portrait_events (
      user_id, actor_id, event_type, initiator_type, initiator_user_id, metadata
    )
    SELECT id, '${actorId}', 'fullstack-audit', 'admin', id, '{"source":"fullstack"}'::jsonb
    FROM users WHERE email = '${primaryAccount.email}';

    DO $portrait_audit$
    BEGIN
      BEGIN
        UPDATE real_portrait_events
        SET metadata = '{"tampered":true}'::jsonb
        WHERE actor_id = '${actorId}';
        RAISE EXCEPTION '允许修改真人不可变审计';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = '允许修改真人不可变审计' THEN RAISE; END IF;
      END;
    END
    $portrait_audit$;
  `);
});

test('Migration 048 可在真实 PostgreSQL 16 上重复执行且保留缩略图与分页不变量', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/048_paged_loading_and_asset_thumbnails.sql', import.meta.url),
    'utf8',
  );

  postgresScript(migration);
  postgresScript(migration);

  expect(postgresScalar(`
    SELECT count(*)
    FROM pg_constraint
    WHERE conname IN (
      'assets_thumbnail_status_check',
      'assets_thumbnail_applicability_check',
      'assets_ready_thumbnail_check',
      'assets_thumbnail_error_check'
    );
  `)).toBe('4');
  expect(postgresScalar(`
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_assets_user_folder_cursor',
        'idx_assets_user_source_cursor',
        'idx_tickets_status_cursor',
        'idx_audit_logs_risk_cursor',
        'idx_generation_tasks_user_status_cursor',
        'idx_orders_user_status_cursor',
        'idx_invoice_requests_user_status_cursor',
        'idx_announcements_published_cursor',
        'idx_announcements_admin_search_trgm'
      );
  `)).toBe('9');
});

test('Migration 049 可重放且保留管理员修改过的套餐保留期', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/049_plan_asset_retention.sql', import.meta.url),
    'utf8',
  );

  postgres(`UPDATE plans SET asset_retention_days = 47 WHERE code = 'pro';`);
  postgresScript(migration);
  postgresScript(migration);

  expect(postgresScalar(`SELECT asset_retention_days FROM plans WHERE code = 'free';`)).toBe('7');
  expect(postgresScalar(`SELECT asset_retention_days FROM plans WHERE code = 'pro';`)).toBe('47');
  expect(postgresScalar(`SELECT asset_retention_days FROM plans WHERE code = 'enterprise';`)).toBe('90');
  expect(postgresScalar(`
    SELECT count(*) FROM pg_constraint
    WHERE conname IN (
      'plans_asset_retention_days_check',
      'plans_asset_retention_by_kind_check',
      'asset_retention_sweep_runs_state_check'
    );
  `)).toBe('3');
  expect(postgresScalar(`
    SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('idx_assets_retention_sweep', 'idx_asset_retention_sweep_runs_claimable');
  `)).toBe('2');

  postgres(`UPDATE plans SET asset_retention_days = 30 WHERE code = 'pro';`);
});

test('Migration 067 写入分级保留期、可安全重放并锁定真人套餐正整数保留期', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/067_portrait_plan_asset_retention.sql', import.meta.url),
    'utf8',
  );

  expect(postgresScalar(`SELECT asset_retention_days FROM plans WHERE code = 'free';`)).toBe('7');
  expect(postgresScalar(`SELECT asset_retention_days FROM plans WHERE code = 'pro';`)).toBe('30');
  expect(postgresScalar(`SELECT asset_retention_days FROM plans WHERE code = 'enterprise';`)).toBe('90');
  expect(postgresScalar(`
    SELECT count(*) FROM pg_constraint
    WHERE conname = 'plans_portrait_asset_retention_check';
  `)).toBe('1');

  postgresRollbackScript(`
    ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_portrait_asset_retention_check;

    INSERT INTO plans (
      code, name, kind, billing, credits, asset_retention_days,
      portrait_enabled, portrait_profile_limit, portrait_active_limit,
      portrait_assets_per_actor
    ) VALUES
      ('basic', '基础版迁移夹具', 'main', 'both', 0, 0, false, 0, 0, 0),
      ('ultra', '旗舰版迁移夹具', 'main', 'both', 0, 0, false, 0, 0, 0)
    ON CONFLICT (code) DO UPDATE
    SET kind = 'main',
        asset_retention_days = 0,
        portrait_enabled = false,
        portrait_profile_limit = 0,
        portrait_active_limit = 0,
        portrait_assets_per_actor = 0;

    ${migration}

    DO $migration067_defaults$
    BEGIN
      IF (
        SELECT string_agg(concat_ws(':', code, asset_retention_days::text), '|' ORDER BY code)
        FROM plans
        WHERE code IN ('free', 'basic', 'pro', 'ultra', 'enterprise')
      ) IS DISTINCT FROM 'basic:15|enterprise:90|free:7|pro:30|ultra:60' THEN
        RAISE EXCEPTION 'Migration 067 未写入确认的标准套餐保留期';
      END IF;
    END
    $migration067_defaults$;

    UPDATE plans SET asset_retention_days = 21 WHERE code = 'basic';
    ${migration}

    DO $migration067_replay$
    BEGIN
      IF (SELECT asset_retention_days FROM plans WHERE code = 'basic') IS DISTINCT FROM 21 THEN
        RAISE EXCEPTION 'Migration 067 重放覆盖了管理员配置';
      END IF;

      BEGIN
        UPDATE plans SET asset_retention_days = 0 WHERE code = 'pro';
        RAISE EXCEPTION 'Migration 067 允许真人库套餐永久保留';
      EXCEPTION WHEN check_violation THEN
        NULL;
      END;
    END
    $migration067_replay$;
  `);
});

test('Migration 052 可在真实 PostgreSQL 16 上重放并保留版本化阶梯价格', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/052_prompt_wizard_cost_ledger.sql', import.meta.url),
    'utf8',
  );

  postgresScript(migration);
  postgresScript(migration);

  expect(postgresScalar(`
    SELECT count(*)
    FROM prompt_wizard_model_pricing_rules
    WHERE provider = 'volcengine-ark'
      AND model = 'doubao-seed-2-0-lite-260428'
      AND service_tier = 'default'
      AND price_version = 'volcengine-list-2026-07-23';
  `)).toBe('3');
  expect(postgresScalar(`
    SELECT string_agg(
      pricing_tier || ':' || input_price_per_million_cny::text || '/'
        || cached_input_price_per_million_cny::text || '/'
        || output_price_per_million_cny::text,
      ',' ORDER BY min_input_tokens
    )
    FROM prompt_wizard_model_pricing_rules
    WHERE price_version = 'volcengine-list-2026-07-23';
  `)).toBe('0-32k:0.600000/0.120000/3.600000,32k-128k:0.900000/0.180000/5.400000,128k-256k:1.800000/0.360000/10.800000');
  expect(postgresScalar(`
    SELECT count(*) FROM pg_constraint
    WHERE conname IN (
      'prompt_wizard_provider_requests_owner_shape_check',
      'prompt_wizard_provider_requests_plan_shape_check',
      'prompt_wizard_provider_requests_terminal_shape_check',
      'prompt_wizard_provider_requests_cost_shape_check'
    );
  `)).toBe('4');
});

test('Migration 053 可重放并把价格快照来源统一到官方中文价格页', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/053_prompt_wizard_pricing_source_url.sql', import.meta.url),
    'utf8',
  );

  postgres(`
    UPDATE prompt_wizard_model_pricing_rules
    SET source_url = 'https://www.volcengine.com/docs/82379/1544106'
    WHERE price_version = 'volcengine-list-2026-07-23';
  `);
  postgresScript(migration);
  postgresScript(migration);

  expect(postgresScalar(`
    SELECT count(*)
    FROM prompt_wizard_model_pricing_rules
    WHERE price_version = 'volcengine-list-2026-07-23'
      AND source_url = 'https://docs.volcengine.com/docs/82379/1544106?lang=zh';
  `)).toBe('3');
});

test('Migration 054 可重放并允许产品档案修复写入独立成本操作', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/054_prompt_wizard_product_profile_repair.sql', import.meta.url),
    'utf8',
  );

  try {
    postgresScript(migration);
    postgresScript(migration);

  expect(postgresScalar(`
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'prompt_wizard_provider_requests'::regclass
      AND conname = 'prompt_wizard_provider_requests_operation_check'
      AND pg_get_constraintdef(oid) LIKE '%repair-product-profile%';
  `)).toBe('1');
    expect(postgresScalar(`
      SELECT count(*)
      FROM pg_constraint
      WHERE conrelid = 'prompt_wizard_provider_requests'::regclass
        AND conname = 'prompt_wizard_provider_requests_owner_shape_check'
        AND pg_get_constraintdef(oid) LIKE '%repair-product-profile%'
        AND pg_get_constraintdef(oid) LIKE '%batch_id IS NULL%';
    `)).toBe('1');
  } finally {
    restorePromptWizardV6SchemaAfterHistoricalMigrationReplay();
  }
});

test('Migration 055 可重放并将单方案格式修复绑定到批次和方案', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/055_prompt_wizard_draft_format_repair.sql', import.meta.url),
    'utf8',
  );

  try {
    postgresScript(migration);
    postgresScript(migration);

  expect(postgresScalar(`
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'prompt_wizard_provider_requests'::regclass
      AND conname = 'prompt_wizard_provider_requests_operation_check'
      AND pg_get_constraintdef(oid) LIKE '%repair-draft-format%';
  `)).toBe('1');
  expect(postgresScalar(`
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'prompt_wizard_provider_requests'::regclass
      AND conname = 'prompt_wizard_provider_requests_owner_shape_check'
      AND pg_get_constraintdef(oid) LIKE '%repair-draft-format%'
      AND pg_get_constraintdef(oid) LIKE '%batch_id IS NOT NULL%';
  `)).toBe('1');
    expect(postgresScalar(`
      SELECT count(*)
      FROM pg_constraint
      WHERE conrelid = 'prompt_wizard_provider_requests'::regclass
        AND conname = 'prompt_wizard_provider_requests_plan_shape_check'
        AND pg_get_constraintdef(oid) LIKE '%repair-draft-format%'
        AND pg_get_constraintdef(oid) LIKE '%plan_index IS NOT NULL%';
    `)).toBe('1');
  } finally {
    restorePromptWizardV6SchemaAfterHistoricalMigrationReplay();
  }
});

test('Migration 056 可重放并分别约束产品格式恢复与单方案内容修复的归属', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/056_prompt_wizard_bounded_repair_operations.sql', import.meta.url),
    'utf8',
  );

  try {
    postgresScript(migration);
    postgresScript(migration);

  const operationConstraint = postgresScalar(`
    SELECT pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'prompt_wizard_provider_requests'::regclass
      AND conname = 'prompt_wizard_provider_requests_operation_check';
  `);
  for (const operation of [
    'analyze-product',
    'repair-product-chinese',
    'repair-product-profile',
    'repair-product-format',
    'generate-drafts',
    'repair-draft-format',
    'repair-draft-content',
  ]) {
    expect(operationConstraint).toContain(operation);
  }

  const ownerConstraint = postgresScalar(`
    SELECT pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'prompt_wizard_provider_requests'::regclass
      AND conname = 'prompt_wizard_provider_requests_owner_shape_check';
  `);
  expect(ownerConstraint).toContain('repair-product-format');
  expect(ownerConstraint).toContain('repair-draft-content');
  expect(ownerConstraint).toContain('batch_id IS NULL');
  expect(ownerConstraint).toContain('batch_id IS NOT NULL');

  const planConstraint = postgresScalar(`
    SELECT pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'prompt_wizard_provider_requests'::regclass
      AND conname = 'prompt_wizard_provider_requests_plan_shape_check';
  `);
  expect(planConstraint).toContain('repair-product-format');
  expect(planConstraint).toContain('repair-draft-content');
  expect(planConstraint).toContain('plan_index IS NULL');
  expect(planConstraint).toContain('plan_index IS NOT NULL');

  const fixture = {
    userId: randomUUID(),
    runId: randomUUID(),
    batchId: randomUUID(),
    imageId: randomUUID(),
  };
  postgres(`
    INSERT INTO users (id, email, password_hash, user_name)
    VALUES (
      '${fixture.userId}', 'migration-056-${fixture.userId}@lindyson.test',
      'fullstack-only', 'Migration 056 约束测试用户'
    );

    INSERT INTO prompt_wizard_runs (
      id, user_id, status, image_asset_ids, product_profile
    ) VALUES (
      '${fixture.runId}', '${fixture.userId}', 'ready',
      ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb
    );

    INSERT INTO prompt_wizard_batches (
      id, run_id, user_id, ordinal, idempotency_key, request_hash, run_revision,
      status, is_free, credits, credit_status, image_asset_ids,
      product_profile, creative_brief, video_config, failure_reason
    ) VALUES (
      '${fixture.batchId}', '${fixture.runId}', '${fixture.userId}', 1,
      'migration-056-${fixture.batchId}', 'migration-056', 0,
      'failed', true, 0, 'none', ARRAY['${fixture.imageId}'::uuid],
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'Migration 056 约束测试'
    );

    INSERT INTO prompt_wizard_provider_requests (
      request_key, run_id, batch_id, user_id, operation,
      job_attempt, repair_round, plan_index, transport_attempt,
      provider, model, service_tier, request_status, error_code, completed_at
    ) VALUES
      (
        'migration-056-product-${fixture.runId}', '${fixture.runId}', NULL,
        '${fixture.userId}', 'repair-product-format',
        1, 1, NULL, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428', 'default',
        'failed', 'FULLSTACK_FIXTURE', now()
      ),
      (
        'migration-056-draft-${fixture.batchId}', '${fixture.runId}', '${fixture.batchId}',
        '${fixture.userId}', 'repair-draft-content',
        1, 1, 1, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428', 'default',
        'failed', 'FULLSTACK_FIXTURE', now()
      );
  `);

  expect(postgresScalar(`
    SELECT string_agg(operation || ':' || coalesce(plan_index::text, 'null'), ',' ORDER BY operation)
    FROM prompt_wizard_provider_requests
    WHERE run_id = '${fixture.runId}';
  `)).toBe('repair-draft-content:1,repair-product-format:null');

  const invalidRows = [
    {
      key: 'product-with-batch',
      operation: 'repair-product-format',
      batchId: `'${fixture.batchId}'`,
      planIndex: 'NULL',
      constraint: 'prompt_wizard_provider_requests_owner_shape_check',
    },
    {
      key: 'product-with-plan',
      operation: 'repair-product-format',
      batchId: 'NULL',
      planIndex: '0',
      constraint: 'prompt_wizard_provider_requests_plan_shape_check',
    },
    {
      key: 'draft-without-batch',
      operation: 'repair-draft-content',
      batchId: 'NULL',
      planIndex: '0',
      constraint: 'prompt_wizard_provider_requests_owner_shape_check',
    },
    {
      key: 'draft-without-plan',
      operation: 'repair-draft-content',
      batchId: `'${fixture.batchId}'`,
      planIndex: 'NULL',
      constraint: 'prompt_wizard_provider_requests_plan_shape_check',
    },
  ];
    for (const row of invalidRows) {
      postgres(`
      DO $migration056$
      DECLARE failed_constraint text;
      BEGIN
        BEGIN
          INSERT INTO prompt_wizard_provider_requests (
            request_key, run_id, batch_id, user_id, operation,
            job_attempt, repair_round, plan_index, transport_attempt,
            provider, model, service_tier
          ) VALUES (
            'migration-056-invalid-${row.key}-${fixture.runId}',
            '${fixture.runId}', ${row.batchId}, '${fixture.userId}', '${row.operation}',
            1, 1, ${row.planIndex}, 1,
            'volcengine-ark', 'doubao-seed-2-0-lite-260428', 'default'
          );
          RAISE EXCEPTION 'Migration 056 非法归属被数据库接受：${row.key}';
        EXCEPTION WHEN check_violation THEN
          GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
          IF failed_constraint <> '${row.constraint}' THEN
            RAISE EXCEPTION 'Migration 056 命中了错误约束：期望 %，实际 %',
              '${row.constraint}', failed_constraint;
          END IF;
        END;
      END
      $migration056$;
      `);
    }
  } finally {
    restorePromptWizardV6SchemaAfterHistoricalMigrationReplay();
  }
});

test('Migration 059 历史重放不会绕过 Migration 069 的 V4 独占约束', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/059_prompt_wizard_two_plan_batches.sql', import.meta.url),
    'utf8',
  );
  const fixture = {
    userId: randomUUID(),
    runId: randomUUID(),
    imageId: randomUUID(),
    legacyBatchId: randomUUID(),
  };

  try {
    postgresScript(migration);
    postgresScript(migration);
  expect(postgresScalar(`
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'prompt_wizard_batches'::regclass
      AND conname = 'prompt_wizard_batches_v3_only_completed_shape_check';
  `)).toBe('1');
  expect(postgresScalar(`
    SELECT position(
      'selected_concept_ids[1]<>selected_concept_ids[2]'
      IN replace(pg_get_constraintdef(oid), ' ', '')
    ) > 0
    FROM pg_constraint
    WHERE conrelid = 'prompt_wizard_batches'::regclass
      AND conname = 'prompt_wizard_batches_v3_only_completed_shape_check';
  `)).toBe('t');

    postgresRollbackScript(`
    INSERT INTO users (id, email, password_hash, user_name)
    VALUES (
      '${fixture.userId}', 'migration-059-${fixture.userId}@lindyson.test',
      'fullstack-only', 'Migration 059 约束测试用户'
    );

    INSERT INTO prompt_wizard_runs (
      id, user_id, status, image_asset_ids, product_profile
    ) VALUES (
      '${fixture.runId}', '${fixture.userId}', 'ready',
      ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb
    );

    DO $migration059$
    DECLARE failed_constraint text;
    BEGIN
      BEGIN
        INSERT INTO prompt_wizard_batches (
          id, run_id, user_id, ordinal, idempotency_key, request_hash, run_revision,
          status, is_free, credits, credit_status, image_asset_ids,
          product_profile, creative_brief, video_config, plans
        ) VALUES (
          '${fixture.legacyBatchId}', '${fixture.runId}', '${fixture.userId}', 1,
          'migration-059-legacy-${fixture.legacyBatchId}', 'migration-059-legacy', 0,
          'completed', true, 0, 'none', ARRAY['${fixture.imageId}'::uuid],
          '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[{}, {}]'::jsonb
        );
        RAISE EXCEPTION 'Migration 059 重放错误恢复了旧版已完成批次';
      EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
        IF failed_constraint <> 'prompt_wizard_batches_v3_only_completed_shape_check' THEN
          RAISE EXCEPTION 'Migration 059 旧批次命中了错误约束：%', failed_constraint;
        END IF;
      END;
    END
    $migration059$;
    `);
  } finally {
    restorePromptWizardV6SchemaAfterHistoricalMigrationReplay();
  }
});

test('Migration 071 在真实 PostgreSQL 上覆盖 070 升级、空库 bootstrap、失败回滚与完整重放门禁', () => {
  const migrationDirectory = new URL('../../apps/api/migrations/', import.meta.url);
  const migration071 = readFileSync(
    new URL('071_prompt_wizard_v6_three_routes.sql', migrationDirectory),
    'utf8',
  );
  const through070 = readdirSync(migrationDirectory)
    .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/u.test(file) && file < '071_')
    .sort()
    .map(file => ({
      id: file,
      sql: readFileSync(new URL(file, migrationDirectory), 'utf8'),
    }));
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const bootstrapDatabase = `m071_bootstrap_${suffix}`;
  const upgradeDatabase = `m071_upgrade_${suffix}`;

  postgres(`CREATE DATABASE ${bootstrapDatabase};`);
  try {
    postgresDatabaseMigrationSequence(bootstrapDatabase, through070);
    expect(postgresDatabaseScalar(bootstrapDatabase, `
      SELECT available::text || '|' || engine_version::text
      FROM prompt_wizard_settings;
    `)).toBe('true|3');

    postgres(`CREATE DATABASE ${upgradeDatabase} WITH TEMPLATE ${bootstrapDatabase};`);
    try {
      postgresDatabase(upgradeDatabase, `
        UPDATE prompt_wizard_settings SET available = false WHERE singleton_id = 1;
        CREATE TABLE prompt_wizard_route_sets (unexpected_partial integer);
      `);

      const rollbackFailure = postgresDatabaseScriptFailure(upgradeDatabase, migration071);
      expect(rollbackFailure).toContain('column "status" does not exist');
      expect(postgresDatabaseScalar(upgradeDatabase, `
        SELECT available::text || '|' || engine_version::text
        FROM prompt_wizard_settings;
      `)).toBe('false|3');
      expect(postgresDatabaseScalar(upgradeDatabase, `
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'prompt_wizard_route_sets'
          AND column_name = 'unexpected_partial';
      `)).toBe('1');

      postgresDatabase(upgradeDatabase, 'DROP TABLE prompt_wizard_route_sets;');
      postgresDatabaseScript(upgradeDatabase, migration071);
      expect(postgresDatabaseScalar(upgradeDatabase, `
        SELECT available::text || '|' || engine_version::text
        FROM prompt_wizard_settings;
      `)).toBe('false|4');

      postgresDatabaseScript(upgradeDatabase, migration071);
      expect(postgresDatabaseScalar(upgradeDatabase, `
        SELECT count(*) FROM prompt_wizard_route_sets;
      `)).toBe('0');
      expect(postgresDatabaseScalar(upgradeDatabase, `
        SELECT
          (SELECT count(*) FROM pg_constraint
           WHERE conrelid = 'prompt_wizard_route_sets'::regclass)::text || '|' ||
          (SELECT count(*) FROM pg_index
           WHERE indrelid = 'prompt_wizard_route_sets'::regclass)::text || '|' ||
          (SELECT count(*) FROM pg_trigger
           WHERE tgrelid = 'prompt_wizard_route_sets'::regclass
             AND NOT tgisinternal)::text;
      `)).toBe('13|5|1');

      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_route_sets
          ADD CONSTRAINT migration071_unexpected_route_set_check CHECK (false);
      `);
      const extraConstraintFailure = postgresDatabaseScriptFailure(
        upgradeDatabase,
        migration071,
      );
      expect(extraConstraintFailure).toContain('Migration 071 拒绝配置或结构漂移');
      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_route_sets
          DROP CONSTRAINT migration071_unexpected_route_set_check;
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);

      postgresDatabase(upgradeDatabase, `
        CREATE INDEX migration071_unexpected_route_set_idx
          ON prompt_wizard_route_sets(user_id);
      `);
      const extraIndexFailure = postgresDatabaseScriptFailure(
        upgradeDatabase,
        migration071,
      );
      expect(extraIndexFailure).toContain('Migration 071 拒绝配置或结构漂移');
      postgresDatabase(
        upgradeDatabase,
        'DROP INDEX migration071_unexpected_route_set_idx;',
      );
      postgresDatabaseScript(upgradeDatabase, migration071);

      postgresDatabase(upgradeDatabase, `
        CREATE TRIGGER trg_migration071_unexpected_route_set
        BEFORE INSERT ON prompt_wizard_route_sets
        FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_route_set();
      `);
      const extraTriggerFailure = postgresDatabaseScriptFailure(
        upgradeDatabase,
        migration071,
      );
      expect(extraTriggerFailure).toContain('Migration 071 拒绝配置或结构漂移');
      postgresDatabase(upgradeDatabase, `
        DROP TRIGGER trg_migration071_unexpected_route_set
          ON prompt_wizard_route_sets;
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);

      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_route_sets
          DROP CONSTRAINT prompt_wizard_route_sets_pending_shape_check;
        ALTER TABLE prompt_wizard_settings
          ADD CONSTRAINT prompt_wizard_route_sets_pending_shape_check CHECK (true);
      `);
      const misplacedConstraintFailure = postgresDatabaseScriptFailure(
        upgradeDatabase,
        migration071,
      );
      expect(misplacedConstraintFailure).toContain('Migration 071 拒绝配置或结构漂移');
      expect(postgresDatabaseScalar(upgradeDatabase, `
        SELECT
          count(*) FILTER (
            WHERE conrelid = 'prompt_wizard_settings'::regclass
          )::text || '|' ||
          count(*) FILTER (
            WHERE conrelid = 'prompt_wizard_route_sets'::regclass
          )::text
        FROM pg_constraint
        WHERE conname = 'prompt_wizard_route_sets_pending_shape_check';
      `)).toBe('1|0');
      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_settings
          DROP CONSTRAINT prompt_wizard_route_sets_pending_shape_check;
        ALTER TABLE prompt_wizard_route_sets
          ADD CONSTRAINT prompt_wizard_route_sets_pending_shape_check CHECK (
            status NOT IN ('queued', 'processing', 'failed')
            OR content_purged_at IS NOT NULL
            OR routes IS NULL
          );
        DO $signature$
        DECLARE definition_hash text;
        BEGIN
          SELECT md5(pg_get_constraintdef(oid, true)) INTO STRICT definition_hash
          FROM pg_constraint
          WHERE conname = 'prompt_wizard_route_sets_pending_shape_check'
            AND conrelid = 'prompt_wizard_route_sets'::regclass;
          EXECUTE format(
            'COMMENT ON CONSTRAINT prompt_wizard_route_sets_pending_shape_check ON prompt_wizard_route_sets IS %L',
            'migration071-definition:' || definition_hash
          );
        END
        $signature$;
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);

      const pendingConstraintSignature = postgresDatabaseScalar(upgradeDatabase, `
        SELECT obj_description(oid, 'pg_constraint')
        FROM pg_constraint
        WHERE conname = 'prompt_wizard_route_sets_pending_shape_check'
          AND conrelid = 'prompt_wizard_route_sets'::regclass;
      `);
      expect(pendingConstraintSignature).toMatch(/^migration071-definition:[0-9a-f]{32}$/u);
      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_route_sets
          DROP CONSTRAINT prompt_wizard_route_sets_pending_shape_check;
        ALTER TABLE prompt_wizard_route_sets
          ADD CONSTRAINT prompt_wizard_route_sets_pending_shape_check CHECK (true);
        COMMENT ON CONSTRAINT prompt_wizard_route_sets_pending_shape_check
          ON prompt_wizard_route_sets IS '${pendingConstraintSignature}';
      `);
      const weakenedConstraintFailure = postgresDatabaseScriptFailure(
        upgradeDatabase,
        migration071,
      );
      expect(weakenedConstraintFailure).toContain('Migration 071 拒绝配置或结构漂移');
      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_route_sets
          DROP CONSTRAINT prompt_wizard_route_sets_pending_shape_check;
        ALTER TABLE prompt_wizard_route_sets
          ADD CONSTRAINT prompt_wizard_route_sets_pending_shape_check CHECK (
            status NOT IN ('queued', 'processing', 'failed')
            OR content_purged_at IS NOT NULL
            OR routes IS NULL
          );
        DO $signature$
        DECLARE definition_hash text;
        BEGIN
          SELECT md5(pg_get_constraintdef(oid, true)) INTO STRICT definition_hash
          FROM pg_constraint
          WHERE conname = 'prompt_wizard_route_sets_pending_shape_check'
            AND conrelid = 'prompt_wizard_route_sets'::regclass;
          EXECUTE format(
            'COMMENT ON CONSTRAINT prompt_wizard_route_sets_pending_shape_check ON prompt_wizard_route_sets IS %L',
            'migration071-definition:' || definition_hash
          );
        END
        $signature$;
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);

      const routeTriggerSignature = postgresDatabaseScalar(upgradeDatabase, `
        SELECT obj_description(oid, 'pg_trigger')
        FROM pg_trigger
        WHERE tgname = 'trg_validate_prompt_wizard_route_set'
          AND tgrelid = 'prompt_wizard_route_sets'::regclass
          AND NOT tgisinternal;
      `);
      expect(routeTriggerSignature).toMatch(/^migration071-definition:[0-9a-f]{32}$/u);
      postgresDatabase(upgradeDatabase, `
        CREATE OR REPLACE FUNCTION migration071_wrong_route_trigger()
        RETURNS trigger LANGUAGE plpgsql AS $wrong$
        BEGIN
          RETURN NEW;
        END
        $wrong$;
        DROP TRIGGER trg_validate_prompt_wizard_route_set ON prompt_wizard_route_sets;
        CREATE TRIGGER trg_validate_prompt_wizard_route_set
        BEFORE INSERT ON prompt_wizard_route_sets
        FOR EACH ROW EXECUTE FUNCTION migration071_wrong_route_trigger();
        COMMENT ON TRIGGER trg_validate_prompt_wizard_route_set
          ON prompt_wizard_route_sets IS '${routeTriggerSignature}';
      `);
      const triggerDefinitionFailure = postgresDatabaseScriptFailure(
        upgradeDatabase,
        migration071,
      );
      expect(triggerDefinitionFailure).toContain('Migration 071 拒绝配置或结构漂移');
      postgresDatabase(upgradeDatabase, `
        DROP TRIGGER trg_validate_prompt_wizard_route_set ON prompt_wizard_route_sets;
        DROP FUNCTION migration071_wrong_route_trigger();
        CREATE TRIGGER trg_validate_prompt_wizard_route_set
        BEFORE INSERT OR UPDATE ON prompt_wizard_route_sets
        FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_route_set();
        DO $signature$
        DECLARE definition_hash text;
        BEGIN
          SELECT md5(pg_get_triggerdef(oid, true)) INTO STRICT definition_hash
          FROM pg_trigger
          WHERE tgname = 'trg_validate_prompt_wizard_route_set'
            AND tgrelid = 'prompt_wizard_route_sets'::regclass
            AND NOT tgisinternal;
          EXECUTE format(
            'COMMENT ON TRIGGER trg_validate_prompt_wizard_route_set ON prompt_wizard_route_sets IS %L',
            'migration071-definition:' || definition_hash
          );
        END
        $signature$;
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);

      postgresDatabase(
        upgradeDatabase,
        'ALTER TABLE prompt_wizard_route_sets ADD COLUMN unexpected_partial integer;',
      );
      const columnDriftFailure = postgresDatabaseScriptFailure(upgradeDatabase, migration071);
      expect(columnDriftFailure).toContain('Migration 071 拒绝配置或结构漂移');
      expect(postgresDatabaseScalar(upgradeDatabase, `
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'prompt_wizard_route_sets'
          AND column_name = 'unexpected_partial';
      `)).toBe('1');
      postgresDatabase(
        upgradeDatabase,
        'ALTER TABLE prompt_wizard_route_sets DROP COLUMN unexpected_partial;',
      );
      postgresDatabaseScript(upgradeDatabase, migration071);

      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_settings
          ALTER COLUMN engine_version SET DEFAULT (4::smallint);
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);
      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_settings
          ALTER COLUMN engine_version SET DEFAULT (3::smallint);
      `);
      const defaultDriftFailure = postgresDatabaseScriptFailure(upgradeDatabase, migration071);
      expect(defaultDriftFailure).toContain('Migration 071 拒绝配置或结构漂移');
      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_settings
          ALTER COLUMN engine_version SET DEFAULT (4::smallint);
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);

      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_route_sets
          ALTER COLUMN status SET DEFAULT 'processing';
      `);
      const routeDefaultDriftFailure = postgresDatabaseScriptFailure(
        upgradeDatabase,
        migration071,
      );
      expect(routeDefaultDriftFailure).toContain('Migration 071 拒绝配置或结构漂移');
      postgresDatabase(upgradeDatabase, `
        ALTER TABLE prompt_wizard_route_sets
          ALTER COLUMN status SET DEFAULT 'queued';
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);

      postgresDatabase(upgradeDatabase, `
        DROP TRIGGER trg_validate_prompt_wizard_route_set ON prompt_wizard_route_sets;
        CREATE TRIGGER trg_validate_prompt_wizard_route_set
        BEFORE INSERT OR UPDATE ON prompt_wizard_settings
        FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_route_set();
      `);
      const misplacedTriggerFailure = postgresDatabaseScriptFailure(upgradeDatabase, migration071);
      expect(misplacedTriggerFailure).toContain('Migration 071 拒绝配置或结构漂移');
      expect(postgresDatabaseScalar(upgradeDatabase, `
        SELECT
          count(*) FILTER (
            WHERE tgrelid = 'prompt_wizard_settings'::regclass
          )::text || '|' ||
          count(*) FILTER (
            WHERE tgrelid = 'prompt_wizard_route_sets'::regclass
          )::text
        FROM pg_trigger
        WHERE tgname = 'trg_validate_prompt_wizard_route_set'
          AND NOT tgisinternal;
      `)).toBe('1|0');
      postgresDatabase(upgradeDatabase, `
        DROP TRIGGER trg_validate_prompt_wizard_route_set ON prompt_wizard_settings;
        CREATE TRIGGER trg_validate_prompt_wizard_route_set
        BEFORE INSERT OR UPDATE ON prompt_wizard_route_sets
        FOR EACH ROW EXECUTE FUNCTION validate_prompt_wizard_route_set();
        DO $signature$
        DECLARE definition_hash text;
        BEGIN
          SELECT md5(pg_get_triggerdef(oid, true)) INTO STRICT definition_hash
          FROM pg_trigger
          WHERE tgname = 'trg_validate_prompt_wizard_route_set'
            AND tgrelid = 'prompt_wizard_route_sets'::regclass
            AND NOT tgisinternal;
          EXECUTE format(
            'COMMENT ON TRIGGER trg_validate_prompt_wizard_route_set ON prompt_wizard_route_sets IS %L',
            'migration071-definition:' || definition_hash
          );
        END
        $signature$;
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);

      const providerIndexSignature = postgresDatabaseScalar(upgradeDatabase, `
        SELECT obj_description(index_relation.oid, 'pg_class')
        FROM pg_class index_relation
        JOIN pg_index index_definition
          ON index_definition.indexrelid = index_relation.oid
        WHERE index_relation.relname = 'idx_prompt_wizard_provider_requests_route_set_created'
          AND index_definition.indrelid = 'prompt_wizard_provider_requests'::regclass;
      `);
      expect(providerIndexSignature).toMatch(/^migration071-definition:[0-9a-f]{32}$/u);
      postgresDatabase(upgradeDatabase, `
        DROP INDEX idx_prompt_wizard_provider_requests_route_set_created;
        CREATE INDEX idx_prompt_wizard_provider_requests_route_set_created
          ON prompt_wizard_provider_requests(route_set_id, created_at ASC, id ASC)
          WHERE false;
        COMMENT ON INDEX idx_prompt_wizard_provider_requests_route_set_created
          IS '${providerIndexSignature}';
      `);
      const indexDefinitionFailure = postgresDatabaseScriptFailure(
        upgradeDatabase,
        migration071,
      );
      expect(indexDefinitionFailure).toContain('Migration 071 拒绝配置或结构漂移');
      postgresDatabase(upgradeDatabase, `
        DROP INDEX idx_prompt_wizard_provider_requests_route_set_created;
        CREATE INDEX idx_prompt_wizard_provider_requests_route_set_created
          ON prompt_wizard_provider_requests(route_set_id, created_at ASC, id ASC)
          WHERE route_set_id IS NOT NULL;
        DO $signature$
        DECLARE definition_hash text;
        BEGIN
          SELECT md5(pg_get_indexdef(index_relation.oid, 0, true))
          INTO STRICT definition_hash
          FROM pg_class index_relation
          JOIN pg_index index_definition
            ON index_definition.indexrelid = index_relation.oid
          WHERE index_relation.relname = 'idx_prompt_wizard_provider_requests_route_set_created'
            AND index_definition.indrelid = 'prompt_wizard_provider_requests'::regclass;
          EXECUTE format(
            'COMMENT ON INDEX idx_prompt_wizard_provider_requests_route_set_created IS %L',
            'migration071-definition:' || definition_hash
          );
        END
        $signature$;
      `);
      postgresDatabaseScript(upgradeDatabase, migration071);

      postgresDatabase(
        upgradeDatabase,
        `DROP INDEX idx_prompt_wizard_provider_requests_route_set_created;
         CREATE INDEX idx_prompt_wizard_provider_requests_route_set_created
           ON prompt_wizard_settings(updated_at)
           WHERE available = false;`,
      );
      const driftFailure = postgresDatabaseScriptFailure(upgradeDatabase, migration071);
      expect(driftFailure).toContain('Migration 071 拒绝配置或结构漂移');
      expect(postgresDatabaseScalar(upgradeDatabase, `
        SELECT available::text || '|' || engine_version::text || '|' ||
          (EXISTS (
            SELECT 1
            FROM pg_class index_relation
            JOIN pg_index index_definition ON index_definition.indexrelid = index_relation.oid
            WHERE index_relation.relname = 'idx_prompt_wizard_provider_requests_route_set_created'
              AND index_definition.indrelid = 'prompt_wizard_settings'::regclass
          ))::text
        FROM prompt_wizard_settings;
      `)).toBe('false|4|true');

      postgresDatabase(upgradeDatabase, `
        CREATE OR REPLACE FUNCTION validate_prompt_wizard_batch_route_set()
        RETURNS trigger LANGUAGE plpgsql AS $wrong$
        BEGIN
          RETURN NEW;
        END
        $wrong$;
      `);
      const functionDefinitionFailure = postgresDatabaseScriptFailure(
        upgradeDatabase,
        migration071,
      );
      expect(functionDefinitionFailure).toContain('Migration 071 拒绝配置或结构漂移');
    } finally {
      postgres(`DROP DATABASE IF EXISTS ${upgradeDatabase} WITH (FORCE);`);
    }

    postgresDatabase(bootstrapDatabase, `
      INSERT INTO users (email, password_hash, user_name)
      VALUES ('migration-071-nonempty-${suffix}@lindyson.test', 'fullstack-only', '非空 bootstrap 门禁');
    `);
    const nonemptyBootstrapFailure = postgresDatabaseScriptFailure(
      bootstrapDatabase,
      migration071,
    );
    expect(nonemptyBootstrapFailure).toContain('Migration 071 拒绝配置或结构漂移');
    expect(postgresDatabaseScalar(bootstrapDatabase, `
      SELECT available::text || '|' || engine_version::text || '|' ||
        (to_regclass('public.prompt_wizard_route_sets') IS NULL)::text
      FROM prompt_wizard_settings;
    `)).toBe('true|3|true');
    postgresDatabase(
      bootstrapDatabase,
      `DELETE FROM users WHERE email = 'migration-071-nonempty-${suffix}@lindyson.test';`,
    );
    postgresDatabaseScript(bootstrapDatabase, migration071);
    expect(postgresDatabaseScalar(bootstrapDatabase, `
      SELECT available::text || '|' || engine_version::text
      FROM prompt_wizard_settings;
    `)).toBe('false|4');
  } finally {
    postgres(`DROP DATABASE IF EXISTS ${bootstrapDatabase} WITH (FORCE);`);
  }
});

test('Migration 071 可重放、保留历史 V4/V5 正文与不可变账本并锁定新写引擎 4', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/071_prompt_wizard_v6_three_routes.sql', import.meta.url),
    'utf8',
  );
  const fixture = {
    userId: randomUUID(),
    historicalRunId: randomUUID(),
    newRunId: randomUUID(),
    rejectedRunId: randomUUID(),
    batchId: randomUUID(),
    imageId: randomUUID(),
    providerRequestId: randomUUID(),
    terminalCalibrationRequestId: randomUUID(),
    routeSetId: randomUUID(),
    v6BatchId: randomUUID(),
    firstRouteId: randomUUID(),
    secondRouteId: randomUUID(),
    thirdRouteId: randomUUID(),
    ledgerId: randomUUID(),
    auditId: randomUUID(),
    firstPlanId: randomUUID(),
    secondPlanId: randomUUID(),
  };

  postgresScript(migration);
  postgresScript(migration);

  postgresRollbackScript(`
    ALTER TABLE prompt_wizard_runs DISABLE TRIGGER trg_enforce_prompt_wizard_run_engine_version;

    INSERT INTO users (id, email, password_hash, user_name)
    VALUES (
      '${fixture.userId}', 'migration-071-${fixture.userId}@lindyson.test',
      'fullstack-only', 'Migration 071 历史保留测试用户'
    );

    INSERT INTO prompt_wizard_runs (
      id, user_id, status, revision, image_asset_ids, product_profile,
      production_brief, evidence_graph, engine_version
    ) VALUES (
      '${fixture.historicalRunId}', '${fixture.userId}', 'ready', 1,
      ARRAY['${fixture.imageId}'::uuid], '{"name":"V5 历史产品正文"}'::jsonb,
      '{"audience":"历史受众"}'::jsonb,
      '{"evidence":[{"text":"图片可见证据"}]}'::jsonb, 3
    );
    ALTER TABLE prompt_wizard_runs ENABLE TRIGGER trg_enforce_prompt_wizard_run_engine_version;

    INSERT INTO prompt_wizard_batches (
      id, run_id, user_id, ordinal, idempotency_key, request_hash, run_revision,
      status, is_free, credits, credit_status, image_asset_ids,
      product_profile, creative_brief, video_config, plans,
      strategy_signatures, failure_reason
    ) VALUES (
      '${fixture.batchId}', '${fixture.historicalRunId}', '${fixture.userId}', 1,
      'migration-071-${fixture.batchId}', 'migration-071-history', 1,
      'failed', true, 0, 'none', ARRAY['${fixture.imageId}'::uuid],
      '{"name":"V5 历史批次产品"}'::jsonb, '{"direction":"历史方向"}'::jsonb,
      '{"model":"Seedance 2.0 Mini"}'::jsonb,
      '[{"id":"${fixture.firstPlanId}","deliveryVersion":5,"title":"历史方案一"},{"id":"${fixture.secondPlanId}","deliveryVersion":5,"title":"历史方案二"}]'::jsonb,
      '["history-signature"]'::jsonb, 'V5 历史失败正文'
    );

    INSERT INTO prompt_wizard_provider_requests (
      id, request_key, run_id, batch_id, user_id, operation,
      job_attempt, repair_round, plan_index, transport_attempt,
      provider, model, service_tier, request_status,
      input_tokens, cached_input_tokens, output_tokens,
      pricing_rule_id, price_version, pricing_tier,
      input_price_per_million_cny, cached_input_price_per_million_cny,
      output_price_per_million_cny, cost_cny, cost_status, completed_at
    ) VALUES (
      '${fixture.providerRequestId}', 'migration-071-provider-${fixture.providerRequestId}',
      '${fixture.historicalRunId}', '${fixture.batchId}', '${fixture.userId}',
      'generate-drafts', 1, 0, 0, 1, 'volcengine-ark',
      'doubao-seed-2-0-lite-260428', 'default', 'succeeded',
      100, 10, 20,
      'volcengine-doubao-seed-2-0-lite-260428-default-2026-07-23-0-32k',
      'volcengine-list-2026-07-23', '0-32k',
      0.600000, 0.120000, 3.600000, 0.000127, 'known', now()
    );

    INSERT INTO credit_ledger (
      id, user_id, type, bucket, settlement_status, amount, balance,
      source, operator, note, related_prompt_batch_id, business_event_key
    ) VALUES (
      '${fixture.ledgerId}', '${fixture.userId}', 'adjust', 'system', 'none',
      0, 0, 'Migration 071 积分正文保留测试', 'system', 'V5 历史积分正文',
      '${fixture.batchId}', 'migration-071-ledger-${fixture.ledgerId}'
    );

    INSERT INTO audit_logs (
      id, admin_email, module, action, target, risk, detail
    ) VALUES (
      '${fixture.auditId}', 'migration-071@lindyson.test', 'prompt-wizard',
      'v6-history-fixture', '${fixture.historicalRunId}', 'low', 'V5 历史审计正文'
    );

    ${migration}
    ${migration}

    INSERT INTO prompt_wizard_runs (
      id, user_id, status, revision, image_asset_ids, product_profile
    ) VALUES (
      '${fixture.newRunId}', '${fixture.userId}', 'ready', 1,
      ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb
    );

    INSERT INTO prompt_wizard_route_sets (
      id, run_id, user_id, idempotency_key, request_hash, run_revision,
      status, routes, attempt_count, started_at, completed_at
    ) VALUES (
      '${fixture.routeSetId}', '${fixture.newRunId}', '${fixture.userId}',
      'migration-071-routes-${fixture.routeSetId}', 'migration-071-routes', 1,
      'completed',
      '[{"id":"${fixture.firstRouteId}","role":"proof-conversion"},{"id":"${fixture.secondRouteId}","role":"problem-hook"},{"id":"${fixture.thirdRouteId}","role":"lifestyle-seeding"}]'::jsonb,
      1, now(), now()
    );

    INSERT INTO prompt_wizard_batches (
      id, run_id, user_id, ordinal, idempotency_key, request_hash, run_revision,
      status, is_free, credits, credit_status, image_asset_ids,
      product_profile, creative_brief, video_config, route_set_id, attempt_count
    ) VALUES (
      '${fixture.v6BatchId}', '${fixture.newRunId}', '${fixture.userId}', 1,
      'migration-071-v6-${fixture.v6BatchId}', 'migration-071-v6', 1,
      'processing', true, 0, 'none', ARRAY['${fixture.imageId}'::uuid],
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '${fixture.routeSetId}', 1
    );

    DO $migration071_terminal_owner_rejections$
    DECLARE failed_constraint text;
    BEGIN
      BEGIN
        INSERT INTO prompt_wizard_provider_requests (
          request_key, run_id, batch_id, user_id, operation,
          job_attempt, repair_round, plan_index, transport_attempt,
          provider, model, service_tier, request_status
        ) VALUES (
          'migration-071-reject-v5-round3-${fixture.batchId}',
          '${fixture.historicalRunId}', '${fixture.batchId}', '${fixture.userId}',
          'repair-draft-content', 1, 3, 1, 1, 'volcengine-ark',
          'doubao-seed-2-0-lite-260428', 'default', 'started'
        );
        RAISE EXCEPTION 'Migration 071 允许历史 V5 批次使用第三轮成本身份';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'Migration 071 允许历史 V5 批次使用第三轮成本身份' THEN
          RAISE;
        END IF;
        IF position('第三轮只允许引擎 4 的 V6 批次' IN SQLERRM) = 0 THEN
          RAISE EXCEPTION 'Migration 071 历史 V5 round3 命中了错误异常：%', SQLERRM;
        END IF;
      END;

      BEGIN
        INSERT INTO prompt_wizard_provider_requests (
          request_key, run_id, batch_id, user_id, operation,
          job_attempt, repair_round, plan_index, transport_attempt,
          provider, model, service_tier, request_status
        ) VALUES (
          'migration-071-reject-v6-round4-${fixture.v6BatchId}',
          '${fixture.newRunId}', '${fixture.v6BatchId}', '${fixture.userId}',
          'repair-draft-content', 1, 4, 1, 1, 'volcengine-ark',
          'doubao-seed-2-0-lite-260428', 'default', 'started'
        );
        RAISE EXCEPTION 'Migration 071 允许 V6 批次使用第四轮成本身份';
      EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
        IF failed_constraint <> 'prompt_wizard_provider_requests_repair_round_check' THEN
          RAISE EXCEPTION 'Migration 071 V6 round4 命中了错误约束：%', failed_constraint;
        END IF;
      END;
    END
    $migration071_terminal_owner_rejections$;

    INSERT INTO prompt_wizard_provider_requests (
      id, request_key, run_id, batch_id, user_id, operation,
      job_attempt, repair_round, plan_index, transport_attempt,
      provider, model, service_tier, request_status
    ) VALUES (
      '${fixture.terminalCalibrationRequestId}',
      'migration-071-terminal-calibration-${fixture.terminalCalibrationRequestId}',
      '${fixture.newRunId}', '${fixture.v6BatchId}', '${fixture.userId}',
      'repair-draft-content', 1, 3, 1, 1, 'volcengine-ark',
      'doubao-seed-2-0-lite-260428', 'default', 'started'
    );

    DO $migration071_assertions$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM prompt_wizard_runs
        WHERE id = '${fixture.historicalRunId}'
          AND engine_version = 3 AND status = 'ready'
          AND product_profile = '{"name":"V5 历史产品正文"}'::jsonb
          AND production_brief = '{"audience":"历史受众"}'::jsonb
          AND evidence_graph = '{"evidence":[{"text":"图片可见证据"}]}'::jsonb
      ) THEN
        RAISE EXCEPTION 'Migration 071 改写或归档了历史引擎 3 run';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM prompt_wizard_batches
        WHERE id = '${fixture.batchId}'
          AND status = 'failed'
          AND product_profile = '{"name":"V5 历史批次产品"}'::jsonb
          AND creative_brief = '{"direction":"历史方向"}'::jsonb
          AND video_config = '{"model":"Seedance 2.0 Mini"}'::jsonb
          AND plans = '[{"id":"${fixture.firstPlanId}","deliveryVersion":5,"title":"历史方案一"},{"id":"${fixture.secondPlanId}","deliveryVersion":5,"title":"历史方案二"}]'::jsonb
          AND strategy_signatures = '["history-signature"]'::jsonb
          AND failure_reason = 'V5 历史失败正文'
          AND content_purged_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Migration 071 改写了历史 V5 batch 正文';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM prompt_wizard_provider_requests
        WHERE id = '${fixture.providerRequestId}'
          AND request_status = 'succeeded'
          AND input_tokens = 100 AND cached_input_tokens = 10 AND output_tokens = 20
          AND pricing_rule_id = 'volcengine-doubao-seed-2-0-lite-260428-default-2026-07-23-0-32k'
          AND cost_cny = 0.000127 AND cost_status = 'known'
      ) THEN
        RAISE EXCEPTION 'Migration 071 改写了历史 Provider 成本账本';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM prompt_wizard_provider_requests
        WHERE id = '${fixture.terminalCalibrationRequestId}'
          AND operation = 'repair-draft-content'
          AND repair_round = 3 AND plan_index = 1
          AND run_id = '${fixture.newRunId}'
          AND batch_id = '${fixture.v6BatchId}'
          AND request_status = 'started'
      ) THEN
        RAISE EXCEPTION 'Migration 071 未允许 V6 终局口播校准使用第三轮成本身份';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM credit_ledger
        WHERE id = '${fixture.ledgerId}'
          AND source = 'Migration 071 积分正文保留测试'
          AND note = 'V5 历史积分正文'
          AND related_prompt_batch_id = '${fixture.batchId}'
      ) OR NOT EXISTS (
        SELECT 1 FROM audit_logs
        WHERE id = '${fixture.auditId}'
          AND action = 'v6-history-fixture'
          AND detail = 'V5 历史审计正文'
      ) THEN
        RAISE EXCEPTION 'Migration 071 改写或删除了历史积分、审计正文';
      END IF;

      IF (SELECT engine_version FROM prompt_wizard_settings WHERE singleton_id = 1) <> 4 THEN
        RAISE EXCEPTION 'Migration 071 未固定全局引擎 4';
      END IF;
    END
    $migration071_assertions$;

    DO $migration071_new_writes$
    BEGIN
      IF (SELECT engine_version FROM prompt_wizard_runs WHERE id = '${fixture.newRunId}') <> 4 THEN
        RAISE EXCEPTION 'Migration 071 新任务未默认使用引擎 4';
      END IF;

      BEGIN
        INSERT INTO prompt_wizard_runs (
          id, user_id, status, revision, image_asset_ids, product_profile, engine_version
        ) VALUES (
          '${fixture.rejectedRunId}', '${fixture.userId}', 'analyzing', 0,
          ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb, 3
        );
        RAISE EXCEPTION 'Migration 071 允许新增引擎 3 run';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'Migration 071 允许新增引擎 3 run' THEN RAISE; END IF;
      END;

      BEGIN
        UPDATE prompt_wizard_settings SET engine_version = 3 WHERE singleton_id = 1;
        RAISE EXCEPTION 'Migration 071 允许全局回退到引擎 3';
      EXCEPTION WHEN check_violation THEN
        NULL;
      END;
    END
    $migration071_new_writes$;
  `);
});

test('Migration 071 不归档、不阻断运行中的 V4/V5 任务与冻结积分', () => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/071_prompt_wizard_v6_three_routes.sql', import.meta.url),
    'utf8',
  );
  const fixture = {
    userId: randomUUID(),
    v4RunId: randomUUID(),
    v5RunId: randomUUID(),
    imageId: randomUUID(),
    conceptSetId: randomUUID(),
    directionSetId: randomUUID(),
    heldBatchId: randomUUID(),
    lotId: randomUUID(),
    allocationId: randomUUID(),
    v4ProviderRequestId: randomUUID(),
    v5ProviderRequestId: randomUUID(),
  };

  postgresRollbackScript(`
    ALTER TABLE prompt_wizard_runs DISABLE TRIGGER trg_enforce_prompt_wizard_run_engine_version;
    INSERT INTO users (id, email, password_hash, user_name)
    VALUES (
      '${fixture.userId}', 'migration-071-active-${fixture.userId}@lindyson.test',
      'fullstack-only', 'Migration 071 历史队列测试用户'
    );
    INSERT INTO prompt_wizard_runs (
      id, user_id, status, revision, image_asset_ids, product_profile,
      production_brief, evidence_graph, engine_version
    ) VALUES (
      '${fixture.v4RunId}', '${fixture.userId}', 'ready', 1,
      ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb,
      '{}'::jsonb, '{"evidence":[]}'::jsonb, 3
    ), (
      '${fixture.v5RunId}', '${fixture.userId}', 'ready', 1,
      ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb,
      '{}'::jsonb, '{"evidence":[]}'::jsonb, 3
    );
    ALTER TABLE prompt_wizard_runs ENABLE TRIGGER trg_enforce_prompt_wizard_run_engine_version;

    INSERT INTO prompt_wizard_concept_sets (
      id, run_id, user_id, idempotency_key, request_hash, run_revision,
      status, attempt_count, started_at
    ) VALUES (
      '${fixture.conceptSetId}', '${fixture.v4RunId}', '${fixture.userId}',
      'migration-071-v4-${fixture.conceptSetId}', 'migration-071-v4', 1,
      'processing', 1, now()
    );

    INSERT INTO prompt_wizard_use_direction_sets (
      id, run_id, user_id, idempotency_key, request_hash, run_revision,
      status, attempt_count, started_at
    ) VALUES (
      '${fixture.directionSetId}', '${fixture.v5RunId}', '${fixture.userId}',
      'migration-071-v5-${fixture.directionSetId}', 'migration-071-v5', 1,
      'processing', 1, now()
    );

    INSERT INTO prompt_wizard_batches (
      id, run_id, user_id, ordinal, idempotency_key, request_hash, run_revision,
      status, is_free, credits, credit_status, main_credits_used, addon_credits_used,
      image_asset_ids, product_profile, creative_brief, video_config, attempt_count
    ) VALUES (
      '${fixture.heldBatchId}', '${fixture.v5RunId}', '${fixture.userId}', 1,
      'migration-071-held-${fixture.heldBatchId}', 'migration-071-held', 1,
      'processing', false, 1, 'held', 1, 0,
      ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 1
    );

    INSERT INTO credit_lots (
      id, user_id, bucket, source_type, source_event_key,
      original_amount, available_amount, held_amount
    ) VALUES (
      '${fixture.lotId}', '${fixture.userId}', 'main', 'legacy',
      'migration-071-lot-${fixture.lotId}', 1, 0, 1
    );

    INSERT INTO credit_allocations (
      id, user_id, lot_id, business_event_key, purpose, status, amount,
      related_prompt_batch_id
    ) VALUES (
      '${fixture.allocationId}', '${fixture.userId}', '${fixture.lotId}',
      'migration-071-allocation-${fixture.allocationId}', 'prompt-wizard', 'held', 1,
      '${fixture.heldBatchId}'
    );

    INSERT INTO prompt_wizard_provider_requests (
      id, request_key, run_id, user_id, operation,
      job_attempt, repair_round, transport_attempt,
      provider, model, service_tier, request_status
    ) VALUES (
      '${fixture.v4ProviderRequestId}',
      'migration-071-v4-provider-${fixture.v4ProviderRequestId}',
      '${fixture.v4RunId}', '${fixture.userId}', 'generate-concepts',
      1, 0, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428', 'default', 'started'
    );

    INSERT INTO prompt_wizard_provider_requests (
      id, request_key, run_id, use_direction_set_id, user_id, operation,
      job_attempt, repair_round, transport_attempt,
      provider, model, service_tier, request_status
    ) VALUES (
      '${fixture.v5ProviderRequestId}',
      'use-direction-set:${fixture.directionSetId}:migration-071-${fixture.v5ProviderRequestId}',
      '${fixture.v5RunId}', '${fixture.directionSetId}', '${fixture.userId}',
      'generate-use-directions', 1, 0, 1,
      'volcengine-ark', 'doubao-seed-2-0-lite-260428', 'default', 'started'
    );

    ${migration}
    ${migration}

    DO $migration071_active_assertions$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM prompt_wizard_runs
        WHERE id = '${fixture.v4RunId}' AND engine_version = 3 AND status = 'ready'
      ) OR NOT EXISTS (
        SELECT 1 FROM prompt_wizard_runs
        WHERE id = '${fixture.v5RunId}' AND engine_version = 3 AND status = 'ready'
      ) THEN
        RAISE EXCEPTION 'Migration 071 归档或改写了运行中的 V4/V5 run';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM prompt_wizard_concept_sets
        WHERE id = '${fixture.conceptSetId}' AND status = 'processing' AND content_purged_at IS NULL
      ) OR NOT EXISTS (
        SELECT 1 FROM prompt_wizard_use_direction_sets
        WHERE id = '${fixture.directionSetId}' AND status = 'processing' AND content_purged_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Migration 071 阻断或清理了运行中的 V4/V5 规划任务';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM prompt_wizard_batches
        WHERE id = '${fixture.heldBatchId}'
          AND status = 'processing' AND credit_status = 'held'
      ) OR NOT EXISTS (
        SELECT 1 FROM credit_allocations
        WHERE id = '${fixture.allocationId}' AND status = 'held'
      ) OR NOT EXISTS (
        SELECT 1 FROM credit_lots
        WHERE id = '${fixture.lotId}' AND held_amount = 1
      ) THEN
        RAISE EXCEPTION 'Migration 071 改写或释放了历史冻结积分';
      END IF;
    END
    $migration071_active_assertions$;

    UPDATE prompt_wizard_concept_sets
    SET attempt_count = attempt_count + 1, updated_at = now()
    WHERE id = '${fixture.conceptSetId}';
    UPDATE prompt_wizard_use_direction_sets
    SET attempt_count = attempt_count + 1, updated_at = now()
    WHERE id = '${fixture.directionSetId}';
    UPDATE prompt_wizard_batches
    SET attempt_count = attempt_count + 1, updated_at = now()
    WHERE id = '${fixture.heldBatchId}';
    UPDATE prompt_wizard_provider_requests
    SET request_status = 'succeeded', completed_at = now()
    WHERE id IN ('${fixture.v4ProviderRequestId}', '${fixture.v5ProviderRequestId}');

    DO $migration071_queue_continues$
    BEGIN
      IF (SELECT attempt_count FROM prompt_wizard_concept_sets WHERE id = '${fixture.conceptSetId}') <> 2
        OR (SELECT attempt_count FROM prompt_wizard_use_direction_sets WHERE id = '${fixture.directionSetId}') <> 2
        OR (SELECT attempt_count FROM prompt_wizard_batches WHERE id = '${fixture.heldBatchId}') <> 2
        OR (
          SELECT count(*) FROM prompt_wizard_provider_requests
          WHERE id IN ('${fixture.v4ProviderRequestId}', '${fixture.v5ProviderRequestId}')
            AND request_status = 'succeeded' AND completed_at IS NOT NULL
        ) <> 2
      THEN
        RAISE EXCEPTION 'Migration 071 后历史 V4/V5 worker 无法继续推进';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM credit_allocations
        WHERE id = '${fixture.allocationId}' AND status = 'held'
      ) THEN
        RAISE EXCEPTION 'Migration 071 后历史 worker 推进时冻结积分被意外释放';
      END IF;
    END
    $migration071_queue_continues$;

    SET CONSTRAINTS ALL IMMEDIATE;
  `);
});


test('真实 PostgreSQL 验证 V6 到期冻结积分失败全额退款且重复释放幂等', () => {
  const fixture = {
    imageId: randomUUID(),
    v6UserId: randomUUID(),
    v5UserId: randomUUID(),
    v6RunId: randomUUID(),
    v5RunId: randomUUID(),
    v6BatchId: randomUUID(),
    v5BatchId: randomUUID(),
    v6LotId: randomUUID(),
    v5LotId: randomUUID(),
    v6AllocationId: randomUUID(),
    v5AllocationId: randomUUID(),
    v6HoldLedgerId: randomUUID(),
    v5HoldLedgerId: randomUUID(),
  };
  const setupSql = `
    SET CONSTRAINTS ALL DEFERRED;

    INSERT INTO users (
      id, email, password_hash, user_name, main_credits, addon_credits, total_credits,
      plan_reset_at
    ) VALUES
      (
        '${fixture.v6UserId}', 'prompt-refund-v6-${fixture.v6UserId}@lindyson.test',
        'fullstack-only', 'V6 到期积分退款测试用户', 0, 0, 0, current_date + 7
      ),
      (
        '${fixture.v5UserId}', 'prompt-refund-v5-${fixture.v5UserId}@lindyson.test',
        'fullstack-only', 'V5 到期积分退款测试用户', 0, 0, 0, current_date + 7
      );

    INSERT INTO prompt_wizard_runs (
      id, user_id, status, revision, image_asset_ids, product_profile, engine_version
    ) VALUES (
      '${fixture.v6RunId}', '${fixture.v6UserId}', 'ready', 1,
      ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb, 4
    );

    ALTER TABLE prompt_wizard_runs DISABLE TRIGGER trg_enforce_prompt_wizard_run_engine_version;
    INSERT INTO prompt_wizard_runs (
      id, user_id, status, revision, image_asset_ids, product_profile, engine_version
    ) VALUES (
      '${fixture.v5RunId}', '${fixture.v5UserId}', 'ready', 1,
      ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb, 3
    );
    ALTER TABLE prompt_wizard_runs ENABLE TRIGGER trg_enforce_prompt_wizard_run_engine_version;

    INSERT INTO prompt_wizard_batches (
      id, run_id, user_id, ordinal, idempotency_key, request_hash, run_revision,
      status, is_free, credits, credit_status, main_credits_used, addon_credits_used,
      image_asset_ids, product_profile, creative_brief, video_config, attempt_count
    ) VALUES
      (
        '${fixture.v6BatchId}', '${fixture.v6RunId}', '${fixture.v6UserId}', 1,
        'prompt-refund-v6-${fixture.v6BatchId}', 'prompt-refund-v6', 1,
        'processing', false, 1, 'held', 1, 0,
        ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 1
      ),
      (
        '${fixture.v5BatchId}', '${fixture.v5RunId}', '${fixture.v5UserId}', 1,
        'prompt-refund-v5-${fixture.v5BatchId}', 'prompt-refund-v5', 1,
        'processing', false, 1, 'held', 1, 0,
        ARRAY['${fixture.imageId}'::uuid], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 1
      );

    INSERT INTO credit_lots (
      id, user_id, bucket, source_type, source_event_key,
      original_amount, available_amount, held_amount, expires_at
    ) VALUES
      (
        '${fixture.v6LotId}', '${fixture.v6UserId}', 'main', 'subscription-cycle',
        'prompt-refund-original-v6-${fixture.v6LotId}', 1, 0, 1, now() - interval '1 day'
      ),
      (
        '${fixture.v5LotId}', '${fixture.v5UserId}', 'main', 'subscription-cycle',
        'prompt-refund-original-v5-${fixture.v5LotId}', 1, 0, 1, now() - interval '1 day'
      );

    INSERT INTO credit_allocations (
      id, user_id, lot_id, business_event_key, purpose, status, amount,
      related_prompt_batch_id
    ) VALUES
      (
        '${fixture.v6AllocationId}', '${fixture.v6UserId}', '${fixture.v6LotId}',
        'prompt-wizard-hold:${fixture.v6BatchId}', 'prompt-wizard', 'held', 1,
        '${fixture.v6BatchId}'
      ),
      (
        '${fixture.v5AllocationId}', '${fixture.v5UserId}', '${fixture.v5LotId}',
        'prompt-wizard-hold:${fixture.v5BatchId}', 'prompt-wizard', 'held', 1,
        '${fixture.v5BatchId}'
      );

    INSERT INTO credit_ledger (
      id, user_id, type, bucket, settlement_status, amount, balance,
      source, operator, note, related_prompt_batch_id, business_event_key
    ) VALUES
      (
        '${fixture.v6HoldLedgerId}', '${fixture.v6UserId}', 'hold', 'main', 'held', -1, 0,
        '提示词方案生成预扣', 'system', 'V6 生成期间到期测试冻结',
        '${fixture.v6BatchId}', 'prompt-wizard-hold:${fixture.v6BatchId}'
      ),
      (
        '${fixture.v5HoldLedgerId}', '${fixture.v5UserId}', 'hold', 'main', 'held', -1, 0,
        '提示词方案生成预扣', 'system', 'V5 生成期间到期测试冻结',
        '${fixture.v5BatchId}', 'prompt-wizard-hold:${fixture.v5BatchId}'
      );

    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
  `;
  const countSql = `
    SELECT
      (SELECT count(*)::integer FROM credit_lots WHERE user_id = $1) AS v6_lots,
      (SELECT count(*)::integer FROM credit_ledger WHERE related_prompt_batch_id = $2) AS v6_ledgers,
      (SELECT count(*)::integer FROM credit_lots WHERE user_id = $3) AS v5_lots,
      (SELECT count(*)::integer FROM credit_ledger WHERE related_prompt_batch_id = $4) AS v5_ledgers
  `;
  const snapshotSql = `
    SELECT jsonb_build_object(
      'v6User', (
        SELECT jsonb_build_object(
          'main', main_credits, 'addon', addon_credits, 'total', total_credits,
          'planResetAt', plan_reset_at::text
        ) FROM users WHERE id = $1::uuid
      ),
      'v5User', (
        SELECT jsonb_build_object(
          'main', main_credits, 'addon', addon_credits, 'total', total_credits
        ) FROM users WHERE id = $2::uuid
      ),
      'v6OriginalLot', (
        SELECT jsonb_build_object(
          'available', available_amount, 'held', held_amount, 'expired', expired_amount
        ) FROM credit_lots WHERE id = $3::uuid
      ),
      'v5OriginalLot', (
        SELECT jsonb_build_object(
          'available', available_amount, 'held', held_amount, 'expired', expired_amount
        ) FROM credit_lots WHERE id = $4::uuid
      ),
      'v6Replacement', (
        SELECT jsonb_build_object(
          'count', count(*),
          'sourceType', max(source_type),
          'bucket', max(bucket),
          'original', COALESCE(sum(original_amount), 0),
          'available', COALESCE(sum(available_amount), 0),
          'held', COALESCE(sum(held_amount), 0),
          'consumed', COALESCE(sum(consumed_amount), 0),
          'expired', COALESCE(sum(expired_amount), 0),
          'reversed', COALESCE(sum(reversed_amount), 0),
          'expiresAt', max(expires_at)::date::text
        )
        FROM credit_lots
        WHERE source_event_key = 'prompt-wizard-refund-replacement:'
          || $7::uuid::text || ':' || $5::uuid::text
      ),
      'v5Replacement', (
        SELECT jsonb_build_object('count', count(*))
        FROM credit_lots
        WHERE source_event_key = 'prompt-wizard-refund-replacement:'
          || $8::uuid::text || ':' || $6::uuid::text
      ),
      'v6Allocation', (
        SELECT jsonb_build_object('status', status, 'amount', amount)
        FROM credit_allocations WHERE id = $5::uuid
      ),
      'v5Allocation', (
        SELECT jsonb_build_object('status', status, 'amount', amount)
        FROM credit_allocations WHERE id = $6::uuid
      ),
      'v6Batch', (
        SELECT jsonb_build_object(
          'status', status, 'creditStatus', credit_status, 'credits', credits,
          'mainUsed', main_credits_used, 'addonUsed', addon_credits_used
        ) FROM prompt_wizard_batches WHERE id = $7::uuid
      ),
      'v5Batch', (
        SELECT jsonb_build_object(
          'status', status, 'creditStatus', credit_status, 'credits', credits,
          'mainUsed', main_credits_used, 'addonUsed', addon_credits_used
        ) FROM prompt_wizard_batches WHERE id = $8::uuid
      ),
      'v6Ledger', (
        SELECT jsonb_agg(jsonb_build_object(
          'type', type, 'settlement', settlement_status, 'amount', amount,
          'balance', balance, 'eventKey', business_event_key, 'note', note
        ) ORDER BY type)
        FROM credit_ledger WHERE related_prompt_batch_id = $7::uuid
      ),
      'v5Ledger', (
        SELECT jsonb_agg(jsonb_build_object(
          'type', type, 'settlement', settlement_status, 'amount', amount,
          'balance', balance, 'eventKey', business_event_key, 'note', note
        ) ORDER BY type)
        FROM credit_ledger WHERE related_prompt_batch_id = $8::uuid
      )
    ) AS snapshot
  `;
  const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64');
  const script = `
    const { releasePromptWizardCreditsWithClient } = await import('./apps/api/dist/domain/promptWizardCredits.js');
    const { pool } = await import('./apps/api/dist/db/pool.js');
    const fixture = ${JSON.stringify(fixture)};
    const decode = value => Buffer.from(value, 'base64').toString('utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(decode('${encode(setupSql)}'));
      const v6First = await releasePromptWizardCreditsWithClient(
        client, fixture.v6UserId, fixture.v6BatchId
      );
      // release 只处理账务；这里镜像 failPromptWizardBatch 在同一事务中的批次状态收敛。
      await client.query(
        "UPDATE prompt_wizard_batches SET status = 'failed', credit_status = 'refunded', failure_reason = 'V6 fullstack failure', completed_at = now(), updated_at = now() WHERE id = $1",
        [fixture.v6BatchId]
      );
      const v5First = await releasePromptWizardCreditsWithClient(
        client, fixture.v5UserId, fixture.v5BatchId
      );
      await client.query(
        "UPDATE prompt_wizard_batches SET status = 'failed', credit_status = 'refunded', failure_reason = 'V5 fullstack failure', completed_at = now(), updated_at = now() WHERE id = $1",
        [fixture.v5BatchId]
      );
      const countParams = [
        fixture.v6UserId, fixture.v6BatchId, fixture.v5UserId, fixture.v5BatchId
      ];
      const beforeRepeat = (await client.query(decode('${encode(countSql)}'), countParams)).rows[0];
      const v6Second = await releasePromptWizardCreditsWithClient(
        client, fixture.v6UserId, fixture.v6BatchId
      );
      const v5Second = await releasePromptWizardCreditsWithClient(
        client, fixture.v5UserId, fixture.v5BatchId
      );
      const afterRepeat = (await client.query(decode('${encode(countSql)}'), countParams)).rows[0];
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      const snapshotParams = [
        fixture.v6UserId, fixture.v5UserId, fixture.v6LotId, fixture.v5LotId,
        fixture.v6AllocationId, fixture.v5AllocationId, fixture.v6BatchId, fixture.v5BatchId
      ];
      const snapshot = (await client.query(
        decode('${encode(snapshotSql)}'), snapshotParams
      )).rows[0].snapshot;
      console.log('PROMPT_REFUND_RESULTS=' + JSON.stringify({
        v6First, v6Second, v5First, v5Second, beforeRepeat, afterRepeat, snapshot
      }));
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  `;
  const output = dockerComposeOutput(
    'run', '--rm', '--no-deps', 'worker',
    'node', '--input-type=module', '--eval', script,
  );
  const resultLine = output.split('\n').find(line => line.startsWith('PROMPT_REFUND_RESULTS='));
  expect(resultLine).toBeTruthy();
  const execution = JSON.parse(resultLine!.slice('PROMPT_REFUND_RESULTS='.length));

  expect(execution.v6First).toEqual({ returnedCredits: 1, expiredCredits: 0, reissuedCredits: 1 });
  expect(execution.v6Second).toEqual(execution.v6First);
  expect(execution.v5First).toEqual({ returnedCredits: 0, expiredCredits: 1, reissuedCredits: 0 });
  expect(execution.v5Second).toEqual(execution.v5First);
  expect(execution.beforeRepeat).toEqual({ v6_lots: 2, v6_ledgers: 2, v5_lots: 1, v5_ledgers: 2 });
  expect(execution.afterRepeat).toEqual(execution.beforeRepeat);

  const snapshot = execution.snapshot;
  expect(snapshot.v6User).toMatchObject({ main: 1, addon: 0, total: 1 });
  expect(snapshot.v6Replacement).toEqual({
    count: 1,
    sourceType: 'admin-adjustment',
    bucket: 'main',
    original: 1,
    available: 1,
    held: 0,
    consumed: 0,
    expired: 0,
    reversed: 0,
    expiresAt: snapshot.v6User.planResetAt,
  });
  expect(snapshot.v6OriginalLot).toEqual({ available: 0, held: 0, expired: 1 });
  expect(snapshot.v6Allocation).toEqual({ status: 'expired', amount: 1 });
  expect(snapshot.v6Batch).toEqual({
    status: 'failed', creditStatus: 'refunded', credits: 1, mainUsed: 1, addonUsed: 0,
  });
  expect(snapshot.v6Ledger).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'hold', settlement: 'refunded', amount: -1, balance: 0,
      eventKey: `prompt-wizard-hold:${fixture.v6BatchId}`,
      note: expect.stringContaining('等额补偿批次恢复'),
    }),
    expect.objectContaining({
      type: 'refund', settlement: 'refunded', amount: 1, balance: 1,
      eventKey: `prompt-wizard-refund:${fixture.v6BatchId}`,
      note: expect.stringContaining('已全额退回'),
    }),
  ]));

  expect(snapshot.v5User).toEqual({ main: 0, addon: 0, total: 0 });
  expect(snapshot.v5Replacement).toEqual({ count: 0 });
  expect(snapshot.v5OriginalLot).toEqual({ available: 0, held: 0, expired: 1 });
  expect(snapshot.v5Allocation).toEqual({ status: 'expired', amount: 1 });
  expect(snapshot.v5Batch).toEqual({
    status: 'failed', creditStatus: 'refunded', credits: 1, mainUsed: 1, addonUsed: 0,
  });
  expect(snapshot.v5Ledger).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'hold', settlement: 'refunded', amount: -1, balance: 0,
      note: expect.stringContaining('已过期的积分未恢复'),
    }),
    expect.objectContaining({
      type: 'refund', settlement: 'refunded', amount: 0, balance: 0,
      eventKey: `prompt-wizard-refund:${fixture.v5BatchId}`,
      note: expect.stringContaining('已过期积分未重新计入账户'),
    }),
  ]));
});

test('Migration 076 在真实 PostgreSQL 上可重放并以六条 manifest 幂等归集 Lindyson Admin 运营成本', () => {
  const migrationDirectory = new URL('../../apps/api/migrations/', import.meta.url);
  const migration076 = readFileSync(
    new URL('076_provider_operational_usage_ledger.sql', migrationDirectory),
    'utf8',
  );
  const migration080 = readFileSync(
    new URL('080_exact_admin_cost_pagination.sql', migrationDirectory),
    'utf8',
  );
  const through075 = readdirSync(migrationDirectory)
    .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/u.test(file) && file < '076_')
    .sort()
    .map(file => ({
      id: file,
      sql: readFileSync(new URL(file, migrationDirectory), 'utf8'),
    }));
  const frozenRawManifest = readFileSync(new URL(
    '../../apps/api/fixtures/provider-operational-usage/seedance-25-shadow-20260811.json',
    import.meta.url,
  ));
  const manifest = JSON.parse(frozenRawManifest.toString()) as {
    manifestVersion: string;
    manifestId: string;
    generatedAt: string;
    records: Array<{
      costOwnerUserId: string;
      sourceRunId: string;
      sourceItemKey: string;
      providerTaskId: string | null;
      evidencePath: string;
      evidenceSha256: string;
      valuation: { evidenceSha256: string };
      [key: string]: unknown;
    }>;
  };
  const ownerUserId = manifest.records[0]?.costOwnerUserId;
  expect(ownerUserId).toBe('00000000-0000-4000-8000-00000000ad01');
  expect(manifest.records).toHaveLength(6);

  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const database = `m076_operational_${suffix}`;
  const manifestObjectKey = `fullstack/provider-operational-usage/${suffix}.json`;
  const conflictObjectKey = `fullstack/provider-operational-usage/${suffix}-conflict.json`;
  const missingOriginalManifestObjectKey =
    `fullstack/provider-operational-usage/${suffix}-missing-original.json`;
  const missingOriginalApprovalObjectKey =
    `fullstack/provider-operational-usage/${suffix}-missing-original-approval.json`;
  const evidenceObjectKey = `fullstack/provider-operational-usage/${suffix}.evidence.ndjson`;
  const evidenceBytes = Buffer.from(JSON.stringify({
    kind: 'fullstack-provider-operational-usage-evidence/v1',
    source: 'synthetic-isolated-test-only',
    suffix,
  }) + '\n');
  const evidenceSha256 = createHash('sha256').update(evidenceBytes).digest('hex');
  for (const record of manifest.records) {
    record.evidencePath = `/app/storage/${evidenceObjectKey}`;
    record.evidenceSha256 = evidenceSha256;
    record.valuation.evidenceSha256 = evidenceSha256;
  }
  const rawManifest = Buffer.from(JSON.stringify(manifest, null, 2));
  const databaseUrl = `postgres://lindyson:lindyson@postgres:5432/${database}`;
  const manifestPath = `/app/storage/${manifestObjectKey}`;
  const approvedSha256 = createHash('sha256').update(rawManifest).digest('hex');
  const runImporter = (...args: string[]) => dockerComposeOutput(
    'exec', '--no-TTY',
    '-e', `DATABASE_URL=${databaseUrl}`,
    '-e', `PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID=${ownerUserId}`,
    'api',
    'node', 'apps/api/dist/tools/importProviderOperationalUsage.js',
    '--manifest', manifestPath, ...args,
  );

  postgres(`CREATE DATABASE ${database};`);
  writeApiStorageObject(manifestObjectKey, rawManifest.toString('base64'));
  writeApiStorageObject(evidenceObjectKey, evidenceBytes.toString('base64'));
  try {
    postgresDatabaseMigrationSequence(database, through075);
    postgresDatabaseScript(database, migration076);
    postgresDatabaseScript(database, migration076);
    // 下方直接调用当前成本报表 domain；其精准快照协议由 080 提供版本基础。
    // 只补成本分页迁移，避免把与本场景无关的 077–079 行为混入 076 重放验证。
    postgresDatabaseScript(database, migration080);

    expect(postgresDatabaseScalar(database, `
      SELECT
        (SELECT count(*) FROM pg_class
         WHERE relkind = 'r'
           AND relname IN (
             'provider_operational_usage_records',
             'provider_operational_usage_external_id_registry',
             'provider_operational_usage_valuations',
             'provider_bill_attribution_events'
           ))::text || '|' ||
        (SELECT count(*) FROM pg_trigger
         WHERE NOT tgisinternal
           AND tgname IN (
             'provider_operational_usage_records_immutable',
             'provider_operational_usage_external_id_registry_immutable',
             'provider_operational_usage_valuations_immutable',
             'provider_bill_attribution_events_immutable',
             'provider_bill_detail_revisions_immutable'
           ))::text;
    `)).toBe('4|5');
    expect(postgresDatabaseScalar(database, `
      SELECT count(*) FROM admin_cost_pagination_versions;
    `)).toBe('4');

    postgresDatabase(database, `
      INSERT INTO users (
        id, email, password_hash, user_name, role, status
      ) VALUES (
        '${ownerUserId}', 'admin@lindyson.com', 'fullstack-only',
        'Lindyson Admin', 'admin', 'active'
      );
    `);

    for (const [sourceItemKey, evidenceAttestation] of [
      ['null-attestation', 'NULL'],
      ['empty-attestation', "'{}'::jsonb"],
    ] as const) {
      const invalidAttestationFailure = postgresDatabaseScriptFailure(database, `
        INSERT INTO provider_operational_usage_records (
          manifest_version, manifest_id, manifest_sha256,
          provider, service_type, model, operation, cost_owner_user_id,
          purpose, initiator_type, source_run_id, source_item_key,
          status, provider_reached, occurred_at, local_accounting_date,
          usage_evidence, evidence_path, evidence_sha256,
          evidence_status, evidence_attestation, recorded_at
        ) VALUES (
          'lindyson.provider-operational-usage/v1',
          'fullstack-invalid-attestation-${suffix}', '${'8'.repeat(64)}',
          'volcengine-ark', 'video', 'Seedance 2.5', 'video-generation',
          '${ownerUserId}', 'provider-diagnostic', 'maintenance-script',
          'fullstack-invalid-attestation-${suffix}', '${sourceItemKey}',
          'success', true, '2026-01-01 00:00:00+00', '2026-01-01',
          '{"source":"fullstack-invalid-attestation"}'::jsonb,
          '/fullstack/invalid-attestation/evidence.ndjson', '${'7'.repeat(64)}',
          'admin-confirmed-missing-original', ${evidenceAttestation}, clock_timestamp()
        );
      `);
      expect(invalidAttestationFailure)
        .toContain('provider_operational_usage_evidence_status_check');
    }

    const dryRun = parseLastJsonLine(runImporter()) as Record<string, unknown>;
    expect(dryRun).toMatchObject({
      event: 'provider-operational-usage-import-dry-run',
      dryRun: true,
      recordCount: 6,
      pricedRecordCount: 6,
      insertedRecordCount: 0,
      unchangedRecordCount: 0,
    });
    expect(postgresDatabaseScalar(database, `
      SELECT count(*) FROM provider_operational_usage_records;
    `)).toBe('0');

    const firstApply = parseLastJsonLine(runImporter(
      '--apply', '--manifest-sha256', approvedSha256,
    )) as Record<string, unknown>;
    expect(firstApply).toMatchObject({
      event: 'provider-operational-usage-import-applied',
      dryRun: false,
      recordCount: 6,
      insertedRecordCount: 6,
      unchangedRecordCount: 0,
    });

    const secondApply = parseLastJsonLine(runImporter(
      '--apply', '--manifest-sha256', approvedSha256,
    )) as Record<string, unknown>;
    expect(secondApply).toMatchObject({
      event: 'provider-operational-usage-import-applied',
      dryRun: false,
      recordCount: 6,
      insertedRecordCount: 0,
      unchangedRecordCount: 6,
    });

    expect(postgresDatabaseScalar(database, `
      SELECT
        (SELECT count(*) FROM provider_operational_usage_records
         WHERE manifest_sha256 = '${approvedSha256}')::text || '|' ||
        (SELECT count(*) FROM provider_operational_usage_valuations valuation
         JOIN provider_operational_usage_records usage
           ON usage.id = valuation.operational_usage_record_id
         WHERE usage.manifest_sha256 = '${approvedSha256}')::text || '|' ||
        (SELECT coalesce(sum(valuation.estimated_cost_cny), 0)::numeric(20,6)
         FROM provider_operational_usage_valuations valuation
         JOIN provider_operational_usage_records usage
           ON usage.id = valuation.operational_usage_record_id
         WHERE usage.manifest_sha256 = '${approvedSha256}')::text || '|' ||
        (SELECT count(*) FROM audit_logs
         WHERE target = 'manifest-sha256:${approvedSha256}')::text || '|' ||
        (SELECT count(*) FROM generation_tasks)::text || '|' ||
        (SELECT count(*) FROM credit_ledger)::text;
    `)).toBe('6|6|63.037310|1|0|0');

    const missingOriginalManifest = structuredClone(manifest);
    missingOriginalManifest.manifestId = `fullstack-missing-original-${suffix}`;
    missingOriginalManifest.generatedAt = '2026-08-12T00:00:00.000Z';
    const missingOriginalRecord = structuredClone(manifest.records[0]!);
    missingOriginalRecord.sourceRunId = `fullstack-missing-original-${suffix}`;
    missingOriginalRecord.sourceItemKey = 'admin-confirmed-cost-only';
    missingOriginalRecord.providerTaskId = null;
    missingOriginalRecord.providerOperationId = null;
    missingOriginalRecord.providerRequestId = null;
    missingOriginalRecord.evidencePath =
      `/app/storage/fullstack/provider-operational-usage/${suffix}-unavailable.ndjson`;
    missingOriginalManifest.records = [missingOriginalRecord];
    const rawMissingOriginalManifest = Buffer.from(
      JSON.stringify(missingOriginalManifest, null, 2),
    );
    const missingOriginalManifestSha256 = createHash('sha256')
      .update(rawMissingOriginalManifest)
      .digest('hex');
    const missingOriginalApproval = {
      approvalVersion: 'lindyson.provider-operational-usage-missing-evidence-approval/v1',
      approvalId: `fullstack-missing-original-${suffix}-admin-confirmation-v1`,
      manifestSha256: missingOriginalManifestSha256,
      approvedByUserId: ownerUserId,
      approvedAt: '2026-08-12T02:32:09.000Z',
      reason: 'historical-original-evidence-unavailable',
      note: '全栈隔离测试：管理员确认缺少的历史原始证据只计入 Admin 列表价运营成本。',
      decision: {
        countAsAdminOperationalCost: true,
        allowProviderExternalIdClaims: false,
        allowOfficialBillAttribution: false,
      },
      records: [{
        provider: missingOriginalRecord.provider,
        sourceRunId: missingOriginalRecord.sourceRunId,
        sourceItemKey: missingOriginalRecord.sourceItemKey,
        evidencePath: missingOriginalRecord.evidencePath,
        evidenceSha256: missingOriginalRecord.evidenceSha256,
      }],
    };
    const rawMissingOriginalApproval = Buffer.from(
      JSON.stringify(missingOriginalApproval, null, 2),
    );
    const missingOriginalApprovalSha256 = createHash('sha256')
      .update(rawMissingOriginalApproval)
      .digest('hex');
    writeApiStorageObject(
      missingOriginalManifestObjectKey,
      rawMissingOriginalManifest.toString('base64'),
    );
    writeApiStorageObject(
      missingOriginalApprovalObjectKey,
      rawMissingOriginalApproval.toString('base64'),
    );
    const missingOriginalApply = parseLastJsonLine(dockerComposeOutput(
      'exec', '--no-TTY',
      '-e', `DATABASE_URL=${databaseUrl}`,
      '-e', `PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID=${ownerUserId}`,
      'api',
      'node', 'apps/api/dist/tools/importProviderOperationalUsage.js',
      '--manifest', `/app/storage/${missingOriginalManifestObjectKey}`,
      '--admin-confirm-missing-original-evidence',
      `/app/storage/${missingOriginalApprovalObjectKey}`,
      '--admin-confirm-missing-original-evidence-sha256', missingOriginalApprovalSha256,
      '--apply', '--manifest-sha256', missingOriginalManifestSha256,
    )) as Record<string, unknown>;
    expect(missingOriginalApply).toMatchObject({
      event: 'provider-operational-usage-import-applied',
      dryRun: false,
      recordCount: 1,
      pricedRecordCount: 1,
      verifiedEvidenceRecordCount: 0,
      adminConfirmedMissingOriginalRecordCount: 1,
      adminConfirmationSha256: missingOriginalApprovalSha256,
      insertedRecordCount: 1,
      unchangedRecordCount: 0,
    });
    const missingOriginalSecondApply = parseLastJsonLine(dockerComposeOutput(
      'exec', '--no-TTY',
      '-e', `DATABASE_URL=${databaseUrl}`,
      '-e', `PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID=${ownerUserId}`,
      'api',
      'node', 'apps/api/dist/tools/importProviderOperationalUsage.js',
      '--manifest', `/app/storage/${missingOriginalManifestObjectKey}`,
      '--admin-confirm-missing-original-evidence',
      `/app/storage/${missingOriginalApprovalObjectKey}`,
      '--admin-confirm-missing-original-evidence-sha256', missingOriginalApprovalSha256,
      '--apply', '--manifest-sha256', missingOriginalManifestSha256,
    )) as Record<string, unknown>;
    expect(missingOriginalSecondApply).toMatchObject({
      event: 'provider-operational-usage-import-applied',
      insertedRecordCount: 0,
      unchangedRecordCount: 1,
      adminConfirmedMissingOriginalRecordCount: 1,
    });
    expect(postgresDatabaseScalar(database, `
      SELECT
        (SELECT count(*) FROM provider_operational_usage_records
         WHERE manifest_sha256 = '${missingOriginalManifestSha256}'
           AND evidence_status = 'admin-confirmed-missing-original'
           AND historical_call_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
           AND evidence_attestation->>'manifestSha256' = '${missingOriginalManifestSha256}')::text || '|' ||
        (SELECT coalesce(sum(valuation.estimated_cost_cny), 0)::numeric(20,6)
         FROM provider_operational_usage_valuations valuation
         JOIN provider_operational_usage_records usage
           ON usage.id = valuation.operational_usage_record_id
         WHERE usage.manifest_sha256 = '${missingOriginalManifestSha256}')::text || '|' ||
        (SELECT count(*) FROM provider_bill_attribution_events attribution
         JOIN provider_operational_usage_records usage
           ON usage.id = attribution.operational_usage_record_id
         WHERE usage.manifest_sha256 = '${missingOriginalManifestSha256}')::text || '|' ||
        (SELECT count(*) FROM audit_logs
         WHERE target = 'manifest-sha256:${missingOriginalManifestSha256}'
           AND detail::jsonb->>'adminConfirmationSha256' = '${missingOriginalApprovalSha256}')::text;
    `)).toBe('1|3.390590|0|1');

    const billRunId = randomUUID();
    const linkedBillDetailId = randomUUID();
    const fuzzyBillDetailId = randomUUID();
    const linkedRevisionId = randomUUID();
    const fuzzyRevisionId = randomUUID();
    const attributionEventId = randomUUID();
    const operationalUsageRecordId = postgresDatabaseScalar(database, `
      SELECT id::text
      FROM provider_operational_usage_records
      WHERE manifest_sha256 = '${approvedSha256}'
      ORDER BY occurred_at, id
      LIMIT 1;
    `);
    const linkedPayload = JSON.stringify({
      provider: 'volcengine-ark',
      sourceDetailKey: `fullstack-linked-${suffix}`,
      billPeriod: '2026-08',
      expenseDate: '2026-08-11',
      product: 'ark_bd',
      productZh: '豆包大模型',
      billingMode: '后付费',
      billCategory: '消费',
      instanceNo: null,
      configName: 'Seedance 2.5 exact-token candidate',
      usageCount: '48437.000000',
      usageUnit: 'tokens',
      deductionCount: '0.000000',
      originalBillAmountCny: '3.390590',
      preferentialBillAmountCny: '0.100000',
      discountBillAmountCny: '0.200000',
      couponAmountCny: '0.300000',
      payableAmountCny: '2.790590',
      paidAmountCny: '2.000000',
      unpaidAmountCny: '0.790590',
      roundAmountCny: '0.000000',
      currency: 'CNY',
      recognizedModel: 'Seedance 2.5',
      billLineType: 'usage',
    });
    const fuzzyPayload = JSON.stringify({
      ...JSON.parse(linkedPayload) as Record<string, unknown>,
      sourceDetailKey: `fullstack-fuzzy-${suffix}`,
      configName: 'Seedance 2.5 fuzzy-only exact-token candidate',
      preferentialBillAmountCny: '0.000000',
      discountBillAmountCny: '0.000000',
      couponAmountCny: '0.000000',
      payableAmountCny: '3.390590',
      paidAmountCny: '3.390590',
      unpaidAmountCny: '0.000000',
    });
    postgresDatabase(database, `
      INSERT INTO provider_billing_sync_runs (
        id, provider, kind, status, window_start, window_end,
        page_count, row_count, started_at, completed_at, is_final
      ) VALUES (
        '${billRunId}', 'volcengine-ark', 'bill', 'success',
        '2026-08-11', '2026-08-11', 1, 2,
        clock_timestamp() - interval '10 seconds',
        clock_timestamp() - interval '9 seconds', true
      );

      INSERT INTO provider_bill_detail_revisions (
        id, provider, source_detail_key, sync_run_id, payload_hash,
        raw_payload, normalized_payload, normalization_version, observed_at
      ) VALUES
        (
          '${linkedRevisionId}', 'volcengine-ark', 'fullstack-linked-${suffix}',
          '${billRunId}', '${'a'.repeat(64)}', '{}'::jsonb,
          '${linkedPayload.replaceAll("'", "''")}'::jsonb,
          'fullstack-v1', clock_timestamp() - interval '8 seconds'
        ),
        (
          '${fuzzyRevisionId}', 'volcengine-ark', 'fullstack-fuzzy-${suffix}',
          '${billRunId}', '${'b'.repeat(64)}', '{}'::jsonb,
          '${fuzzyPayload.replaceAll("'", "''")}'::jsonb,
          'fullstack-v1', clock_timestamp() - interval '8 seconds'
        );

      INSERT INTO provider_bill_details (
        id, provider, source_detail_key, bill_period, expense_date,
        product, product_zh, billing_mode, bill_category, config_name,
        usage_count, usage_unit, deduction_count,
        original_bill_amount_cny, preferential_bill_amount_cny,
        discount_bill_amount_cny, coupon_amount_cny, payable_amount_cny,
        paid_amount_cny, unpaid_amount_cny, round_amount_cny, currency,
        recognized_model, is_final, active, raw_payload, last_seen_run_id,
        synced_at, bill_line_type, normalization_version, current_revision_id
      ) VALUES
        (
          '${linkedBillDetailId}', 'volcengine-ark', 'fullstack-linked-${suffix}',
          '2026-08', '2026-08-11', 'ark_bd', '豆包大模型', '后付费', '消费',
          'Seedance 2.5 exact-token candidate', 48437, 'tokens', 0,
          3.390590, 0.100000, 0.200000, 0.300000, 2.790590,
          2.000000, 0.790590, 0, 'CNY', 'Seedance 2.5', true, true,
          '{}'::jsonb, '${billRunId}', clock_timestamp() - interval '8 seconds',
          'usage', 'fullstack-v1', '${linkedRevisionId}'
        ),
        (
          '${fuzzyBillDetailId}', 'volcengine-ark', 'fullstack-fuzzy-${suffix}',
          '2026-08', '2026-08-11', 'ark_bd', '豆包大模型', '后付费', '消费',
          'Seedance 2.5 fuzzy-only exact-token candidate', 48437, 'tokens', 0,
          3.390590, 0, 0, 0, 3.390590,
          3.390590, 0, 0, 'CNY', 'Seedance 2.5', true, true,
          '{}'::jsonb, '${billRunId}', clock_timestamp() - interval '8 seconds',
          'usage', 'fullstack-v1', '${fuzzyRevisionId}'
        );

      INSERT INTO provider_bill_sync_run_items (
        sync_run_id, bill_detail_revision_id, source_detail_key, created_at
      ) VALUES
        (
          '${billRunId}', '${linkedRevisionId}', 'fullstack-linked-${suffix}',
          clock_timestamp() - interval '7 seconds'
        ),
        (
          '${billRunId}', '${fuzzyRevisionId}', 'fullstack-fuzzy-${suffix}',
          clock_timestamp() - interval '7 seconds'
        );

      INSERT INTO provider_bill_attribution_events (
        id, attribution_key, event_type, operational_usage_record_id,
        provider_bill_detail_id, provider_bill_detail_revision_id,
        allocated_billable_tokens, allocated_usage_count, allocated_cost_cny,
        currency, confidence, evidence, evidence_sha256, recorded_at
      ) VALUES (
        '${attributionEventId}', 'fullstack-attribution-${suffix}', 'link',
        '${operationalUsageRecordId}', '${linkedBillDetailId}', '${linkedRevisionId}',
        48437, 48437, 2.790590, 'CNY', 'direct',
        '{"source":"fullstack-explicit-link"}'::jsonb, '${'c'.repeat(64)}',
        clock_timestamp()
      );
    `);

    const missingOriginalUsageRecordId = postgresDatabaseScalar(database, `
      SELECT id::text
      FROM provider_operational_usage_records
      WHERE manifest_sha256 = '${missingOriginalManifestSha256}';
    `);
    const missingOriginalAttributionFailure = postgresDatabaseScriptFailure(database, `
      INSERT INTO provider_bill_attribution_events (
        attribution_key, event_type, operational_usage_record_id,
        provider_bill_detail_id, provider_bill_detail_revision_id,
        allocated_billable_tokens, allocated_usage_count, allocated_cost_cny,
        currency, confidence, evidence, evidence_sha256, recorded_at
      ) VALUES (
        'fullstack-missing-original-forbidden-${suffix}', 'link',
        '${missingOriginalUsageRecordId}', '${linkedBillDetailId}', '${linkedRevisionId}',
        48437, 48437, 2.790590, 'CNY', 'direct',
        '{"source":"fullstack-forbidden-missing-original-link"}'::jsonb,
        '${'9'.repeat(64)}', clock_timestamp()
      );
    `);
    expect(missingOriginalAttributionFailure)
      .toContain('管理员确认的缺文件历史运营调用只能计入列表价成本，不得归属官方账单');
    expect(postgresDatabaseScalar(database, `
      SELECT count(*)
      FROM provider_bill_attribution_events attribution
      JOIN provider_operational_usage_records usage
        ON usage.id = attribution.operational_usage_record_id
      WHERE usage.manifest_sha256 = '${missingOriginalManifestSha256}';
    `)).toBe('0');

    const attributionRecordedAt = postgresDatabaseScalar(database, `
      SELECT to_char(
        recorded_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
      FROM provider_bill_attribution_events
      WHERE id = '${attributionEventId}';
    `);
    const attributionRecordedMs = Date.parse(attributionRecordedAt);
    expect(attributionRecordedMs).not.toBeNaN();
    const beforeAttributionAsOf = new Date(attributionRecordedMs - 1).toISOString();
    const afterAttributionAsOf = new Date(attributionRecordedMs + 1).toISOString();
    const operationalReadAsOf = new Date().toISOString();
    expect(postgresDatabaseScalar(database, `
      SELECT count(*)
      FROM provider_operational_usage_records
      WHERE local_accounting_date = '2026-08-12'
        AND recorded_at <= '${operationalReadAsOf}'::timestamptz;
    `)).toBe('7');
    const reportingScript = `
      import { pool } from './apps/api/dist/db/pool.js';
      import {
        getAdminProviderBillingOverview,
        listAdminProviderBillingDetails,
        listAdminProviderOperationalUsage
      } from './apps/api/dist/domain/providerBillingReporting.js';
      try {
        const before = await listAdminProviderBillingDetails(pool, {
          range: 'date', date: '2026-08-11', asOf: '${beforeAttributionAsOf}', limit: 20
        });
        const after = await listAdminProviderBillingDetails(pool, {
          range: 'date', date: '2026-08-11', asOf: '${afterAttributionAsOf}', limit: 20
        });
        const overview = await getAdminProviderBillingOverview(pool, {
          range: 'date', date: '2026-08-11', asOf: '${afterAttributionAsOf}'
        });
        const operations = await listAdminProviderOperationalUsage(pool, {
          range: 'date', date: '2026-08-12', asOf: '${operationalReadAsOf}', limit: 20
        });
        console.log('PROVIDER_BILLING_REPORTS=' + JSON.stringify({
          before, after, overview, operations
        }));
      } finally {
        await pool.end();
      }
    `;
    const reportingOutput = dockerComposeOutput(
      'exec', '--no-TTY', '-e', `DATABASE_URL=${databaseUrl}`, 'api',
      'node', '--input-type=module', '--eval', reportingScript,
    );
    const reportingLine = reportingOutput.split('\n')
      .find(line => line.startsWith('PROVIDER_BILLING_REPORTS='));
    expect(reportingLine).toBeTruthy();
    const reporting = JSON.parse(
      reportingLine!.slice('PROVIDER_BILLING_REPORTS='.length),
    ) as {
      before: { items: Array<{ sourceDetailKey: string; attributionStatus: string }> };
      after: { items: Array<{ sourceDetailKey: string; attributionStatus: string }> };
      overview: {
        summary: { originalBillAmountCny: string; payableAmountCny: string };
        byAttribution: Array<{ attributionStatus: string; lineCount: number }>;
      };
      operations: {
        items: Array<{
          id: string;
          localAccountingDate: string;
          evidenceStatus: string | null;
          officialSourceDetailKey: string | null;
          officialAttributionCount: number;
        }>;
      };
    };
    expect(reporting.before.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceDetailKey: `fullstack-linked-${suffix}`,
        attributionStatus: 'unattributed',
      }),
      expect.objectContaining({
        sourceDetailKey: `fullstack-fuzzy-${suffix}`,
        attributionStatus: 'unattributed',
      }),
    ]));
    expect(reporting.after.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceDetailKey: `fullstack-linked-${suffix}`,
        attributionStatus: 'admin-operational',
      }),
      expect.objectContaining({
        sourceDetailKey: `fullstack-fuzzy-${suffix}`,
        attributionStatus: 'unattributed',
      }),
    ]));
    expect(reporting.overview.summary).toMatchObject({
      originalBillAmountCny: '6.781180',
      payableAmountCny: '6.181180',
    });
    expect(reporting.overview.byAttribution).toEqual(expect.arrayContaining([
      expect.objectContaining({ attributionStatus: 'admin-operational', lineCount: 1 }),
      expect.objectContaining({ attributionStatus: 'unattributed', lineCount: 1 }),
    ]));
    expect(reporting.operations.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: operationalUsageRecordId,
        localAccountingDate: '2026-08-12',
        officialSourceDetailKey: `fullstack-linked-${suffix}`,
        officialAttributionCount: 1,
      }),
      expect.objectContaining({
        id: missingOriginalUsageRecordId,
        evidenceStatus: 'admin-confirmed-missing-original',
        officialSourceDetailKey: null,
        officialAttributionCount: 0,
      }),
    ]));

    const linkedLegacyUsageId = randomUUID();
    const fuzzyLegacyUsageId = randomUUID();
    // 两套历史账本允许相同 UUID；这是没有真实外部 ID 时唯一可证明的同一事实。
    // 不使用 manifest 中的 SHA 前缀做模糊去重。
    const duplicateLegacyUsageId = operationalUsageRecordId;
    const linkedLegacyCaseId = randomUUID();
    const fuzzyLegacyCaseId = randomUUID();
    const linkedLegacyLinkId = randomUUID();
    const fuzzyLegacyLinkId = randomUUID();
    postgresDatabase(database, `
      INSERT INTO provider_usage_records (
        id, provider, model, task_id, initiated_by_admin_user_id,
        status, provider_task_id, completed_at, usage_observed_at,
        local_accounting_date, created_at
      ) VALUES
        (
          '${linkedLegacyUsageId}', 'volcengine-ark', 'Seedance 2.0', NULL,
          '${ownerUserId}', 'success', 'fullstack-legacy-linked-${suffix}',
          '2026-08-12 01:00:00+00', '2026-08-12 01:00:00+00',
          '2026-08-12', '2026-08-12 01:00:01+00'
        ),
        (
          '${fuzzyLegacyUsageId}', 'volcengine-ark', 'Seedance 2.0', NULL,
          '${ownerUserId}', 'success', 'fullstack-legacy-fuzzy-${suffix}',
          '2026-08-12 01:01:00+00', '2026-08-12 01:01:00+00',
          '2026-08-12', '2026-08-12 01:01:01+00'
        ),
        (
          '${duplicateLegacyUsageId}', 'volcengine-ark', 'Seedance 2.5', NULL,
          '${ownerUserId}', 'success', NULL,
          '2026-08-12 01:02:00+00', '2026-08-12 01:02:00+00',
          '2026-08-12', '2026-08-12 01:02:01+00'
        );

      INSERT INTO provider_reconciliation_cases (
        id, provider, case_key, bill_period, case_type, status, root_cause,
        confidence, token_adjustment, cost_adjustment_cny,
        official_expense_date, local_accounting_date, evidence, evidence_hash
      ) VALUES
        (
          '${linkedLegacyCaseId}', 'volcengine-ark', 'fullstack-legacy-linked-${suffix}',
          '2026-08', 'other', 'approved', 'legacy-admin-direct-explicit-link',
          'direct', 48437, 2.790590, '2026-08-11', '2026-08-12',
          '{"source":"fullstack-legacy-admin-direct"}'::jsonb, '${'d'.repeat(64)}'
        ),
        (
          '${fuzzyLegacyCaseId}', 'volcengine-ark', 'fullstack-legacy-fuzzy-${suffix}',
          '2026-08', 'other', 'approved', 'legacy-admin-direct-explicit-link',
          'direct', 48437, 3.390590, '2026-08-11', '2026-08-12',
          '{"source":"fullstack-legacy-admin-direct"}'::jsonb, '${'e'.repeat(64)}'
        );

      INSERT INTO provider_reconciliation_case_links (
        id, case_id, usage_record_id, bill_detail_id,
        bill_detail_revision_id, allocated_tokens, allocated_cost_cny
      ) VALUES
        (
          '${linkedLegacyLinkId}', '${linkedLegacyCaseId}', '${linkedLegacyUsageId}',
          '${linkedBillDetailId}', '${linkedRevisionId}', 48437, 2.790590
        ),
        (
          '${fuzzyLegacyLinkId}', '${fuzzyLegacyCaseId}', '${fuzzyLegacyUsageId}',
          '${fuzzyBillDetailId}', '${fuzzyRevisionId}', 48437, 3.390590
        );
    `);
    const legacyAdminReadAsOf = new Date().toISOString();
    const legacyAdminReportingScript = `
      import { pool } from './apps/api/dist/db/pool.js';
      import {
        getAdminProviderBillingOverview,
        listAdminProviderBillingDetails,
        listAdminProviderOperationalUsage
      } from './apps/api/dist/domain/providerBillingReporting.js';
      try {
        const details = await listAdminProviderBillingDetails(pool, {
          range: 'date', date: '2026-08-11', asOf: '${legacyAdminReadAsOf}', limit: 20
        });
        const overview = await getAdminProviderBillingOverview(pool, {
          range: 'date', date: '2026-08-11', asOf: '${legacyAdminReadAsOf}'
        });
        const operations = await listAdminProviderOperationalUsage(pool, {
          range: 'date', date: '2026-08-12', asOf: '${legacyAdminReadAsOf}', limit: 20
        });
        console.log('LEGACY_ADMIN_BILLING_REPORTS=' + JSON.stringify({ details, overview, operations }));
      } finally {
        await pool.end();
      }
    `;
    const legacyAdminOutput = dockerComposeOutput(
      'exec', '--no-TTY', '-e', `DATABASE_URL=${databaseUrl}`, 'api',
      'node', '--input-type=module', '--eval', legacyAdminReportingScript,
    );
    const legacyAdminLine = legacyAdminOutput.split('\n')
      .find(line => line.startsWith('LEGACY_ADMIN_BILLING_REPORTS='));
    expect(legacyAdminLine).toBeTruthy();
    const legacyAdminReporting = JSON.parse(
      legacyAdminLine!.slice('LEGACY_ADMIN_BILLING_REPORTS='.length),
    ) as {
      details: {
        items: Array<{
          sourceDetailKey: string;
          attributionStatus: string;
          attributionEvidenceId: string | null;
        }>;
      };
      overview: {
        summary: { lineCount: number };
        byAttribution: Array<{ attributionStatus: string; lineCount: number }>;
      };
      operations: {
        items: Array<{
          id: string;
          origin: string;
          evidenceSha256: string | null;
          manifestSha256: string | null;
        }>;
      };
    };
    expect(legacyAdminReporting.details.items).toHaveLength(2);
    expect(legacyAdminReporting.details.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceDetailKey: `fullstack-linked-${suffix}`,
        attributionStatus: 'admin-operational',
        attributionEvidenceId: attributionEventId,
      }),
      expect.objectContaining({
        sourceDetailKey: `fullstack-fuzzy-${suffix}`,
        attributionStatus: 'admin-operational',
        attributionEvidenceId: fuzzyLegacyLinkId,
      }),
    ]));
    expect(legacyAdminReporting.overview.summary.lineCount).toBe(2);
    expect(legacyAdminReporting.overview.byAttribution).toEqual([
      expect.objectContaining({ attributionStatus: 'admin-operational', lineCount: 2 }),
    ]);
    expect(legacyAdminReporting.operations.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: linkedLegacyUsageId,
        origin: 'legacy-admin-direct',
        evidenceSha256: null,
        manifestSha256: null,
      }),
      expect.objectContaining({
        id: fuzzyLegacyUsageId,
        origin: 'legacy-admin-direct',
        evidenceSha256: null,
        manifestSha256: null,
      }),
    ]));
    expect(legacyAdminReporting.operations.items.filter(item => item.id === duplicateLegacyUsageId)).toEqual([
      expect.objectContaining({ origin: 'manifest-v1' }),
    ]);

    const updateFailure = postgresDatabaseScriptFailure(database, `
      UPDATE provider_operational_usage_records
      SET operation = 'tampered'
      WHERE manifest_sha256 = '${approvedSha256}';
    `);
    expect(updateFailure).toContain('运营调用、估值和账单归属均为不可变事实');
    const deleteFailure = postgresDatabaseScriptFailure(database, `
      DELETE FROM provider_operational_usage_valuations
      WHERE operational_usage_record_id IN (
        SELECT id FROM provider_operational_usage_records
        WHERE manifest_sha256 = '${approvedSha256}'
      );
    `);
    expect(deleteFailure).toContain('运营调用、估值和账单归属均为不可变事实');
    const revisionUpdateFailure = postgresDatabaseScriptFailure(database, `
      UPDATE provider_bill_detail_revisions
      SET normalized_payload = '{"tampered":true}'::jsonb
      WHERE id = '${linkedRevisionId}';
    `);
    expect(revisionUpdateFailure).toContain('运营调用、估值和账单归属均为不可变事实');
    const revisionDeleteFailure = postgresDatabaseScriptFailure(database, `
      DELETE FROM provider_bill_detail_revisions
      WHERE id = '${fuzzyRevisionId}';
    `);
    expect(revisionDeleteFailure).toContain('运营调用、估值和账单归属均为不可变事实');

    const concurrentExternalId = `fullstack-cross-slot-${suffix}`;
    const concurrentRecordA = randomUUID();
    const concurrentRecordB = randomUUID();
    const concurrentInsert = (
      recordId: string,
      sourceItemKey: string,
      identifierColumn: 'provider_task_id' | 'provider_operation_id',
    ) => `
      BEGIN ISOLATION LEVEL REPEATABLE READ;
      SELECT count(*) FROM provider_operational_usage_records;
      SELECT pg_sleep(0.2);
      INSERT INTO provider_operational_usage_records (
        id, manifest_version, manifest_id, manifest_sha256,
        provider, service_type, model, operation, cost_owner_user_id,
        purpose, initiator_type, source_run_id, source_item_key,
        ${identifierColumn}, status, provider_reached, occurred_at,
        local_accounting_date, usage_evidence, evidence_path, evidence_sha256,
        evidence_status, recorded_at
      ) VALUES (
        '${recordId}', 'lindyson.provider-operational-usage/v1',
        'fullstack-cross-slot-${suffix}', '${'f'.repeat(64)}',
        'volcengine-ark', 'video', 'Seedance 2.5', 'video-generation',
        '${ownerUserId}', 'provider-diagnostic', 'maintenance-script',
        'fullstack-cross-slot-${suffix}', '${sourceItemKey}',
        '${concurrentExternalId}', 'success', true, '2026-01-01 00:00:00+00',
        '2026-01-01', '{}'::jsonb, '/fullstack/cross-slot/evidence.ndjson',
        '${'e'.repeat(64)}', 'verified', clock_timestamp()
      );
      SELECT pg_sleep(0.5);
      COMMIT;
    `;
    const sqlA = Buffer.from(concurrentInsert(concurrentRecordA, 'task-slot', 'provider_task_id'))
      .toString('base64');
    const sqlB = Buffer.from(concurrentInsert(concurrentRecordB, 'operation-slot', 'provider_operation_id'))
      .toString('base64');
    const concurrentOutput = dockerComposeOutput(
      'exec', '--no-TTY', 'postgres', 'sh', '-c', `
        set +e
        printf '%s' '${sqlA}' | base64 -d | psql -v ON_ERROR_STOP=1 -U lindyson -d '${database}' >/tmp/m076-a-${suffix}.log 2>&1 &
        a_pid=$!
        printf '%s' '${sqlB}' | base64 -d | psql -v ON_ERROR_STOP=1 -U lindyson -d '${database}' >/tmp/m076-b-${suffix}.log 2>&1 &
        b_pid=$!
        wait "$a_pid"; a_status=$?
        wait "$b_pid"; b_status=$?
        printf '%s|%s\n' "$a_status" "$b_status"
      `,
    ).trim();
    expect(concurrentOutput.split('|').sort()).toEqual(['0', '3']);
    expect(postgresDatabaseScalar(database, `
      SELECT
        (SELECT count(*) FROM provider_operational_usage_records
         WHERE source_run_id = 'fullstack-cross-slot-${suffix}')::text || '|' ||
        (SELECT count(*) FROM provider_operational_usage_external_id_registry
         WHERE provider = 'volcengine-ark'
           AND external_id = '${concurrentExternalId}')::text;
    `)).toBe('1|1');
    const registryMutationFailure = postgresDatabaseScriptFailure(database, `
      UPDATE provider_operational_usage_external_id_registry
      SET identifier_kind = 'request'
      WHERE provider = 'volcengine-ark' AND external_id = '${concurrentExternalId}';
    `);
    expect(registryMutationFailure).toContain('运营调用、估值和账单归属均为不可变事实');

    const conflictManifest = structuredClone(manifest);
    conflictManifest.manifestId = `fullstack-rollback-${suffix}`;
    const newRecord = structuredClone(manifest.records[0]!);
    newRecord.sourceRunId = `fullstack-rollback-${suffix}`;
    newRecord.sourceItemKey = 'inserted-before-conflict';
    newRecord.providerTaskId = `fullstack-rollback-new-${suffix}`;
    const conflictingRecord = structuredClone(manifest.records[1]!);
    conflictingRecord.providerTaskId = `fullstack-rollback-conflict-${suffix}`;
    conflictManifest.records = [newRecord, conflictingRecord];
    const rawConflictManifest = Buffer.from(JSON.stringify(conflictManifest, null, 2));
    const conflictSha256 = createHash('sha256').update(rawConflictManifest).digest('hex');
    writeApiStorageObject(conflictObjectKey, rawConflictManifest.toString('base64'));
    const conflictFailure = dockerComposeFailureOutput(
      'exec', '--no-TTY',
      '-e', `DATABASE_URL=${databaseUrl}`,
      '-e', `PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID=${ownerUserId}`,
      'api',
      'node', 'apps/api/dist/tools/importProviderOperationalUsage.js',
      '--manifest', `/app/storage/${conflictObjectKey}`,
      '--apply', '--manifest-sha256', conflictSha256,
    );
    expect(conflictFailure).toContain('PROVIDER_OPERATIONAL_USAGE_SOURCE_CONFLICT');
    expect(postgresDatabaseScalar(database, `
      SELECT
        (SELECT count(*) FROM provider_operational_usage_records)::text || '|' ||
        (SELECT count(*) FROM provider_operational_usage_records
         WHERE source_run_id = 'fullstack-rollback-${suffix}')::text || '|' ||
        (SELECT count(*) FROM audit_logs
         WHERE target = 'manifest-sha256:${conflictSha256}')::text;
    `)).toBe('8|0|0');
  } finally {
    removeApiStorageObject(manifestObjectKey);
    removeApiStorageObject(conflictObjectKey);
    removeApiStorageObject(missingOriginalManifestObjectKey);
    removeApiStorageObject(missingOriginalApprovalObjectKey);
    removeApiStorageObject(evidenceObjectKey);
    postgres(`DROP DATABASE IF EXISTS ${database} WITH (FORCE);`);
  }
});

test('Migration 060 可重放并把三次 Provider 用量计入管理员普通用户汇总', async ({ browser }) => {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/060_admin_direct_provider_usage.sql', import.meta.url),
    'utf8',
  );
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const providerTaskIds = [
    `fullstack-admin-usage-${randomUUID()}`,
    `fullstack-admin-usage-${randomUUID()}`,
    `fullstack-admin-usage-${randomUUID()}`,
  ];

  postgresScript(migration);
  postgresScript(migration);
  postgres(`
    INSERT INTO provider_usage_records (
      id, provider, model, task_id, initiated_by_admin_user_id, status,
      raw_units, deducted_units, completed_at, usage_unit, attempt,
      provider_task_id, completion_tokens, total_tokens, billable_tokens,
      billable_basis, resolution, has_video_input, price_version,
      unit_price_per_million, estimated_cost, currency, pricing_status,
      usage_evidence_origin, pricing_rule_status, pricing_input_class,
      pricing_resolution_band, attribution_confidence, provider_terminal_at,
      usage_observed_at, local_accounting_date, accounting_date_origin, created_at
    )
    SELECT
      source.id, 'volcengine-ark', 'Seedance 2.0', NULL, admin.id, 'success',
      245025, 245025, source.completed_at, 'tokens', 0,
      source.provider_task_id, 245025, 245025, 245025,
      'completion_tokens', '1080p', false, 'volcengine-seedance-2026-07-10',
      51, 12.496275, 'CNY', 'priced',
      'provider-reported', 'priced', 'without-video',
      '1080p', 'direct', source.completed_at,
      source.completed_at, '2026-07-26', 'usage-observed', '2026-07-25 20:00:00+00'
    FROM users admin
    CROSS JOIN (VALUES
      ('${ids[0]}'::uuid, '${providerTaskIds[0]}'::text, '2026-07-25 19:32:26+00'::timestamptz),
      ('${ids[1]}'::uuid, '${providerTaskIds[1]}'::text, '2026-07-25 19:32:43+00'::timestamptz),
      ('${ids[2]}'::uuid, '${providerTaskIds[2]}'::text, '2026-07-25 19:33:45+00'::timestamptz)
    ) source(id, provider_task_id, completed_at)
    WHERE admin.email = '${primaryAccount.email}';
  `);

  expect(postgresScalar(`
    SELECT count(*) || '|' || sum(billable_tokens) || '|' || sum(estimated_cost)
    FROM provider_usage_records
    WHERE id IN ('${ids.join("','")}');
  `)).toBe('3|735075|37.488825');
  expect(() => postgres(`
    INSERT INTO provider_usage_records (
      provider, model, initiated_by_admin_user_id, status, provider_task_id
    )
    SELECT 'volcengine-ark', 'Seedance 2.0', id, 'success', '${providerTaskIds[0]}'
    FROM users WHERE email = '${primaryAccount.email}';
  `)).toThrow();

  const session = await createAuthenticatedPage(browser, primaryAccount);
  try {
    const asOf = encodeURIComponent(new Date().toISOString());
    const search = encodeURIComponent(primaryAccount.email);
    const range = `range=date&date=2026-07-26&asOf=${asOf}&search=${search}&limit=20`;
    const users = await api(session.page, `/api/admin/api-usage/users?${range}`);
    const attempts = await api(session.page, `/api/admin/api-usage/attempts?${range}`);
    const tasks = await api(session.page, `/api/admin/api-usage/tasks?${range}`);

    expect(users.status).toBe(200);
    expect(users.body.items).toEqual([expect.objectContaining({
      email: primaryAccount.email,
      taskCount: 0,
      operationalCallCount: 3,
      successfulTasks: 0,
      failedTasks: 0,
      canceledTasks: 0,
      settledCredits: 0,
      refundedCredits: 0,
      billableTokens: 735075,
      estimatedCostCny: '37.488825',
      businessEstimatedCostCny: '0.000000',
      operationalEstimatedCostCny: '37.488825',
      knownAccountCostCny: '37.488825',
      operationalUnpricedCallCount: 0,
      incompleteTaskCount: 0,
      averageTaskCostCny: null,
      lastTaskAt: '-',
    })]);
    expect(attempts.status).toBe(200);
    expect(attempts.body.items).toHaveLength(3);
    expect(attempts.body.items).toEqual(expect.arrayContaining(providerTaskIds.map(providerTaskId => expect.objectContaining({
      taskId: null,
      origin: 'admin-direct',
      providerTaskId,
      email: primaryAccount.email,
      billableTokens: 245025,
      estimatedCostCny: '12.496275',
    }))));
    expect(tasks.status).toBe(200);
    expect(tasks.body.items).toHaveLength(0);

    const oldSnapshot = await api(
      session.page,
      `/api/admin/api-usage/users?range=date&date=2026-07-26&asOf=2026-07-25T19%3A59%3A59.000Z&search=${search}&limit=20`,
    );
    expect(oldSnapshot.status).toBe(200);
    expect(oldSnapshot.body.items).toHaveLength(0);
  } finally {
    await session.context.close();
    postgres(`DELETE FROM provider_usage_records WHERE id IN ('${ids.join("','")}');`);
  }
});

test('真实 PostgreSQL 中并发扫描只认领一次，并按免费、付费、到期与永久策略分批清理', () => {
  const marker = randomUUID();
  const ids = {
    freeUser: randomUUID(),
    paidUser: randomUUID(),
    expiredUser: randomUUID(),
    foreverUser: randomUUID(),
    freeImageFolder: randomUUID(),
    freeUploadFolder: randomUUID(),
    paidImageFolder: randomUUID(),
    expiredVideoFolder: randomUUID(),
    foreverImageFolder: randomUUID(),
    freeOld: randomUUID(),
    paidYoung: randomUUID(),
    expiredOld: randomUUID(),
    foreverOld: randomUUID(),
    uploadedOld: randomUUID(),
    freshAi: randomUUID(),
    alreadyDeleted: randomUUID(),
    legacyDeleting: randomUUID(),
  };
  const permanentPlanCode = `retention-forever-${marker}`;
  const sharedObjectKey = `fullstack/retention/${marker}/shared.bin`;
  const futureClaimToken = randomUUID();
  const allAssetIds = [
    ids.freeOld, ids.paidYoung, ids.expiredOld, ids.foreverOld,
    ids.uploadedOld, ids.freshAi, ids.alreadyDeleted, ids.legacyDeleting,
  ];

  dockerCompose('stop', 'worker');
  try {
    postgres(`
      DELETE FROM asset_retention_sweep_runs;

      INSERT INTO asset_retention_sweep_runs (
        business_date, status, claim_token, lease_expires_at, attempt_count
      ) VALUES (
        date '2099-01-01', 'running', '${futureClaimToken}'::uuid, now() - interval '1 minute', 1
      );

      INSERT INTO plans (
        code, name, name_en, kind, billing, description, monthly_price,
        yearly_price, credits, storage_label, tiktok_accounts, cta_label,
        status, features, asset_retention_days
      ) VALUES (
        '${permanentPlanCode}', '全栈永久保留', 'Fullstack Forever', 'main', 'both',
        '全栈保留期测试', 0, 0, 0, '0', '0', '测试', 'active', '[]'::jsonb, 0
      );

      INSERT INTO users (id, email, password_hash, user_name, plan_id, plan_expires_at)
      VALUES
        ('${ids.freeUser}', 'retention-free-${marker}@lindyson.test', 'test', '保留期免费用户', NULL, NULL),
        ('${ids.paidUser}', 'retention-paid-${marker}@lindyson.test', 'test', '保留期付费用户',
          (SELECT id FROM plans WHERE code = 'pro'), date '2020-02-01'),
        ('${ids.expiredUser}', 'retention-expired-${marker}@lindyson.test', 'test', '保留期到期用户',
          (SELECT id FROM plans WHERE code = 'pro'), date '2020-01-10'),
        ('${ids.foreverUser}', 'retention-forever-${marker}@lindyson.test', 'test', '保留期永久用户',
          (SELECT id FROM plans WHERE code = '${permanentPlanCode}'), NULL);

      INSERT INTO asset_folders (id, user_id, name, source, is_system)
      VALUES
        ('${ids.freeImageFolder}', '${ids.freeUser}', 'AI 图片', 'ai-image', true),
        ('${ids.freeUploadFolder}', '${ids.freeUser}', '已上传图片', 'uploaded-image', true),
        ('${ids.paidImageFolder}', '${ids.paidUser}', 'AI 图片', 'ai-image', true),
        ('${ids.expiredVideoFolder}', '${ids.expiredUser}', 'AI 视频', 'ai-video', true),
        ('${ids.foreverImageFolder}', '${ids.foreverUser}', 'AI 图片', 'ai-image', true);

      INSERT INTO assets (
        id, user_id, folder_id, name, type, source, object_key, thumbnail_key,
        size_bytes, duration_seconds, deletion_status, deleted_at,
        thumbnail_status, thumbnail_updated_at, created_at, updated_at
      ) VALUES
        ('${ids.freeOld}', '${ids.freeUser}', '${ids.freeImageFolder}', '免费超期图片',
          'image', 'ai-image', '${sharedObjectKey}', 'fullstack/retention/${marker}/free-thumb.webp',
          10, NULL, 'active', NULL, 'ready', timestamptz '2020-01-01 03:00:00+08',
          timestamptz '2020-01-01 03:00:00+08', timestamptz '2020-01-01 03:00:00+08'),
        ('${ids.expiredOld}', '${ids.expiredUser}', '${ids.expiredVideoFolder}', '到期套餐超期视频',
          'video', 'ai-video', '${sharedObjectKey}', 'fullstack/retention/${marker}/expired-thumb.jpg',
          10, 1, 'active', NULL, 'ready', timestamptz '2019-12-20 03:00:00+08',
          timestamptz '2019-12-20 03:00:00+08', timestamptz '2019-12-20 03:00:00+08'),
        ('${ids.paidYoung}', '${ids.paidUser}', '${ids.paidImageFolder}', '付费套餐未超期图片',
          'image', 'ai-image', 'fullstack/retention/${marker}/paid.webp', 'fullstack/retention/${marker}/paid-thumb.webp',
          10, NULL, 'active', NULL, 'ready', timestamptz '2019-12-20 03:00:00+08',
          timestamptz '2019-12-20 03:00:00+08', timestamptz '2019-12-20 03:00:00+08'),
        ('${ids.foreverOld}', '${ids.foreverUser}', '${ids.foreverImageFolder}', '永久保留历史图片',
          'image', 'ai-image', 'fullstack/retention/${marker}/forever.webp', 'fullstack/retention/${marker}/forever-thumb.webp',
          10, NULL, 'active', NULL, 'ready', timestamptz '2010-01-01 03:00:00+08',
          timestamptz '2010-01-01 03:00:00+08', timestamptz '2010-01-01 03:00:00+08'),
        ('${ids.uploadedOld}', '${ids.freeUser}', '${ids.freeUploadFolder}', '历史上传图片',
          'image', 'uploaded-image', 'fullstack/retention/${marker}/upload.webp', 'fullstack/retention/${marker}/upload-thumb.webp',
          10, NULL, 'active', NULL, 'ready', timestamptz '2010-01-01 03:00:00+08',
          timestamptz '2010-01-01 03:00:00+08', timestamptz '2010-01-01 03:00:00+08'),
        ('${ids.freshAi}', '${ids.freeUser}', '${ids.freeImageFolder}', '免费版未超期图片',
          'image', 'ai-image', 'fullstack/retention/${marker}/fresh.webp', 'fullstack/retention/${marker}/fresh-thumb.webp',
          10, NULL, 'active', NULL, 'ready', timestamptz '2020-01-05 03:00:00+08',
          timestamptz '2020-01-05 03:00:00+08', timestamptz '2020-01-05 03:00:00+08'),
        ('${ids.alreadyDeleted}', '${ids.freeUser}', '${ids.freeImageFolder}', '已删除历史图片',
          'image', 'ai-image', 'fullstack/retention/${marker}/deleted.webp', 'fullstack/retention/${marker}/deleted-thumb.webp',
          10, NULL, 'deleted', timestamptz '2019-01-02 03:00:00+08', 'ready', timestamptz '2019-01-01 03:00:00+08',
          timestamptz '2019-01-01 03:00:00+08', timestamptz '2019-01-02 03:00:00+08'),
        ('${ids.legacyDeleting}', '${ids.paidUser}', '${ids.paidImageFolder}', '旧代码遗留删除中共享图片',
          'image', 'ai-image', '${sharedObjectKey}', 'fullstack/retention/${marker}/legacy-thumb.webp',
          10, NULL, 'deleting', NULL, 'ready', timestamptz '2019-01-01 03:00:00+08',
          timestamptz '2019-01-01 03:00:00+08', timestamptz '2019-01-01 03:00:00+08');
    `);

    const script = `
      const retention = await import('./apps/api/dist/domain/assetRetentionService.js');
      const deletion = await import('./apps/api/dist/domain/assetDeletionService.js');
      const { pool } = await import('./apps/api/dist/db/pool.js');
      try {
        retention.resetAssetRetentionSweepMemoryForTests();
        const results = await Promise.all([
          retention.runDailyAssetRetentionSweep({ now: new Date('2020-01-09T19:01:00.000Z'), batchSize: 1, bypassMemoryCache: true }),
          retention.runDailyAssetRetentionSweep({ now: new Date('2020-01-09T19:01:00.000Z'), batchSize: 1, bypassMemoryCache: true })
        ]);
        const outbox = await deletion.processObjectDeletionOutbox(10);
        console.log('RETENTION_RESULTS=' + JSON.stringify({ results, outbox }));
      } finally {
        await pool.end();
      }
    `;
    const output = dockerComposeOutput(
      'run', '--rm', '--no-deps', 'worker',
      'node', '--input-type=module', '--eval', script,
    );
    const resultLine = output.split('\n').find(line => line.startsWith('RETENTION_RESULTS='));
    expect(resultLine).toBeTruthy();
    const execution = JSON.parse(resultLine!.slice('RETENTION_RESULTS='.length)) as {
      results: Array<{
        businessDate: string;
        status: string;
        scanned: number;
        scheduled: number;
      }>;
      outbox: { completed: number; skipped: number; failed: number };
    };
    const { results } = execution;
    expect(results.filter(result => result.status === 'completed')).toHaveLength(1);
    expect(results.filter(result => ['already-running', 'already-completed'].includes(result.status))).toHaveLength(1);
    expect(results.find(result => result.status === 'completed')).toMatchObject({
      businessDate: '2020-01-10', scanned: 2, scheduled: 2,
    });
    expect(execution.outbox).toEqual({ completed: 3, skipped: 0, failed: 0 });

    expect(postgresScalar(`
      SELECT concat_ws('|', status, scanned_count::text, scheduled_count::text, attempt_count::text)
      FROM asset_retention_sweep_runs WHERE business_date = date '2020-01-10';
    `)).toBe('completed|2|2|1');
    expect(postgresScalar(`
      SELECT concat_ws('|', status, claim_token::text, attempt_count::text)
      FROM asset_retention_sweep_runs WHERE business_date = date '2099-01-01';
    `)).toBe(`running|${futureClaimToken}|1`);
    expect(postgresScalar(`
      SELECT string_agg(id::text || ':' || deletion_status, ',' ORDER BY id)
      FROM assets WHERE id IN ('${ids.freeOld}'::uuid, '${ids.expiredOld}'::uuid);
    `)).toBe([
      `${ids.freeOld}:deleted`, `${ids.expiredOld}:deleted`,
    ].sort().join(','));
    expect(postgresScalar(`
      SELECT deletion_status FROM assets WHERE id = '${ids.legacyDeleting}'::uuid;
    `)).toBe('deleting');
    expect(postgresScalar(`
      SELECT count(*) FROM assets
      WHERE id IN (
        '${ids.paidYoung}'::uuid, '${ids.foreverOld}'::uuid,
        '${ids.uploadedOld}'::uuid, '${ids.freshAi}'::uuid
      ) AND deletion_status = 'active';
    `)).toBe('4');
    expect(postgresScalar(`
      SELECT array_length(asset_ids, 1)::text
      FROM object_deletion_outbox WHERE object_key = '${sharedObjectKey}';
    `)).toBe('2');
    expect(postgresScalar(`
      SELECT count(*) FROM object_deletion_outbox
      WHERE object_key LIKE 'fullstack/retention/${marker}/%';
    `)).toBe('3');
  } finally {
    postgres(`
      DELETE FROM object_deletion_outbox WHERE object_key LIKE 'fullstack/retention/${marker}/%';
      DELETE FROM assets WHERE id IN (${allAssetIds.map(id => `'${id}'::uuid`).join(', ')});
      DELETE FROM asset_folders WHERE id IN (
        '${ids.freeImageFolder}'::uuid, '${ids.freeUploadFolder}'::uuid,
        '${ids.paidImageFolder}'::uuid, '${ids.expiredVideoFolder}'::uuid,
        '${ids.foreverImageFolder}'::uuid
      );
      DELETE FROM users WHERE id IN (
        '${ids.freeUser}'::uuid, '${ids.paidUser}'::uuid,
        '${ids.expiredUser}'::uuid, '${ids.foreverUser}'::uuid
      );
      DELETE FROM plans WHERE code = '${permanentPlanCode}';
      DELETE FROM asset_retention_sweep_runs
      WHERE business_date IN (date '2020-01-10', date '2099-01-01');
    `);
    dockerCompose('start', 'worker');
  }
});

test('真实 API、PostgreSQL、Redis 与 HttpOnly Cookie 会话可用', async ({ browser }) => {
  const { context, page } = await createAuthenticatedPage(browser, primaryAccount);
  try {
    const me = await api(page, '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('admin');
    expect(await page.evaluate(() => document.cookie)).not.toContain('lindyson_session');

    const overview = await api(page, '/api/admin/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.summary.timezone).toBe('Asia/Shanghai');

    const logout = await api(page, '/api/auth/logout', { method: 'POST' });
    expect(logout.status).toBe(200);
    expect((await api(page, '/api/auth/me')).status).toBe(401);
  } finally {
    await context.close();
  }
});

test('COM 与 CN 共用业务数据但保持独立 Host-only 会话和搜索边界', async ({ browser, request }) => {
  const comContext = await browser.newContext({ baseURL: 'http://com.localhost:8080' });
  const cnContext = await browser.newContext({ baseURL: 'http://cn.localhost:8081' });
  const comPage = await comContext.newPage();
  const cnPage = await cnContext.newPage();

  try {
    await Promise.all([comPage.goto('/'), cnPage.goto('/')]);

    const comLogin = await api(comPage, '/api/auth/login', {
      method: 'POST',
      body: primaryAccount,
    });
    expect(comLogin.status).toBe(200);
    expect((await api(cnPage, '/api/auth/me')).status).toBe(401);

    const cnLogin = await api(cnPage, '/api/auth/login', {
      method: 'POST',
      body: primaryAccount,
    });
    expect(cnLogin.status).toBe(200);
    expect(cnLogin.body.user.id).toBe(comLogin.body.user.id);

    const [comCredits, cnCredits] = await Promise.all([
      api(comPage, '/api/account/credits'),
      api(cnPage, '/api/account/credits'),
    ]);
    expect(comCredits.status).toBe(200);
    expect(cnCredits.status).toBe(200);
    expect(cnCredits.body).toEqual(comCredits.body);

    const comCookie = (await comContext.cookies()).find(cookie => cookie.name === 'lindyson_session');
    const cnCookie = (await cnContext.cookies()).find(cookie => cookie.name === 'lindyson_session');
    expect(comCookie).toMatchObject({ domain: 'com.localhost', httpOnly: true, sameSite: 'Lax' });
    expect(cnCookie).toMatchObject({ domain: 'cn.localhost', httpOnly: true, sameSite: 'Lax' });
    expect(comCookie?.domain).not.toBe(cnCookie?.domain);

    const [
      comVersion, cnVersion, comHome, cnHome, comApp, cnApp,
      comPortraitConsent, cnPortraitConsent, cnRobots, cnSitemap,
    ] = await Promise.all([
      request.get('http://127.0.0.1:8080/version.json'),
      request.get('http://127.0.0.1:8081/version.json'),
      request.get('http://127.0.0.1:8080/'),
      request.get('http://127.0.0.1:8081/'),
      request.get('http://127.0.0.1:8080/workspace'),
      request.get('http://127.0.0.1:8081/workspace'),
      request.get('http://127.0.0.1:8080/portrait-consent/invite#token=must-not-reach-server'),
      request.get('http://127.0.0.1:8081/portrait-consent/invite#token=must-not-reach-server'),
      request.get('http://127.0.0.1:8081/robots.txt'),
      request.get('http://127.0.0.1:8081/sitemap.xml'),
    ]);
    expect(comVersion.status()).toBe(200);
    expect(cnVersion.status()).toBe(200);
    expect(await cnVersion.json()).toEqual(await comVersion.json());
    expect(await cnHome.text()).toBe(await comHome.text());
    expect(await cnApp.text()).toBe(await comApp.text());
    expect(cnHome.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(cnApp.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(comPortraitConsent.status()).toBe(200);
    expect(cnPortraitConsent.status()).toBe(200);
    expect(comPortraitConsent.headers()['referrer-policy']).toBe('no-referrer');
    expect(cnPortraitConsent.headers()['referrer-policy']).toBe('no-referrer');
    expect(comPortraitConsent.headers()['cache-control']).toBe('no-store');
    expect(cnPortraitConsent.headers()['cache-control']).toBe('no-store');
    expect(await comPortraitConsent.text()).not.toContain('must-not-reach-server');
    expect(await cnPortraitConsent.text()).not.toContain('must-not-reach-server');
    expect(cnRobots.status()).toBe(200);
    expect(await cnRobots.text()).toBe('User-agent: *\nDisallow: /\n');
    expect(cnSitemap.status()).toBe(404);
  } finally {
    await Promise.all([comContext.close(), cnContext.close()]);
  }
});

test('提示词向导 V6 在真实队列中完成自动三路线、免费首批、付费换批、幂等与恢复', async ({ browser }) => {
  test.setTimeout(180_000);
  const userId = randomUUID();
  const testAccount = {
    email: `prompt-wizard-v6-${userId}@lindyson.test`,
    password: primaryAccount.password,
  };
  const assetId = randomUUID();
  const folderId = randomUUID();
  const thumbnailObjectKey = `fullstack/prompt-wizard-v6/${assetId}-thumbnail-512.webp`;

  postgres(`
    INSERT INTO users (id, email, password_hash, user_name)
    SELECT '${userId}', '${testAccount.email}', password_hash, '提示词向导 V6 全栈专用用户'
    FROM users WHERE email = '${primaryAccount.email}';
  `);

  const admin = await createAuthenticatedPage(browser, primaryAccount);
  const primaryCreditsBefore = await readCredits(admin.page);
  const seededCredits = await api(admin.page, '/api/admin/credits/adjust', {
    method: 'POST',
    headers: { 'Idempotency-Key': `fullstack-prompt-v6-credit-${randomUUID()}` },
    body: {
      userId,
      mainDelta: 0,
      addonDelta: 3,
      note: '全栈测试：准备 V6 换一批积分',
    },
  });
  expect(seededCredits.status).toBe(200);
  expect(seededCredits.body.user).toMatchObject({ mainCredits: 0, addonCredits: 3, credits: 3 });

  const session = await createAuthenticatedPage(browser, testAccount);
  writeApiStorageObject(thumbnailObjectKey, promptWizardThumbnailWebpBase64);
  postgres(`
    INSERT INTO asset_folders (id, user_id, name, source, is_system)
    VALUES ('${folderId}', '${userId}', '全栈提示词向导 V6 图片', 'uploaded-image', false);

    INSERT INTO assets (
      id, user_id, folder_id, name, type, source, object_key, thumbnail_key, size_bytes,
      deletion_status, thumbnail_status, thumbnail_updated_at, created_at, updated_at
    ) VALUES (
      '${assetId}', '${userId}', '${folderId}', '全栈 V6 开放式耳机.png', 'image', 'uploaded-image',
      'fullstack/prompt-wizard-v6/${assetId}.png', '${thumbnailObjectKey}', 128,
      'active', 'ready', now(), now(), now()
    );
  `);

  try {
    expect(postgresScalar(`
      SELECT available::text || '|' || engine_version::text
      FROM prompt_wizard_settings WHERE singleton_id = 1;
    `)).toBe('false|4');
    postgres(`
      UPDATE prompt_wizard_settings
      SET available = true, updated_at = now()
      WHERE singleton_id = 1 AND engine_version = 4 AND available = false;
    `);
    expect(postgresScalar(`
      SELECT available::text || '|' || engine_version::text
      FROM prompt_wizard_settings WHERE singleton_id = 1;
    `)).toBe('true|4');

    const creditsBefore = await readCredits(session.page);
    const createdRun = await api(session.page, '/api/ai/prompt-wizard/runs', {
      method: 'POST',
      body: { imageAssetIds: [assetId], referenceMode: 'general' },
    });
    expect(createdRun.status).toBe(202);
    expect(createdRun.body.run).toMatchObject({
      engineVersion: 4,
      status: 'analyzing',
      revision: 0,
      imageAssetIds: [assetId],
    });

    const analyzedRun = await waitForPromptWizardRun(session.page, createdRun.body.run.id);
    expect(analyzedRun).toMatchObject({ engineVersion: 4, status: 'ready', revision: 1 });
    expect(analyzedRun.productProfile.visibleFacts).toEqual(['已收到 1 张产品图片']);
    expect(analyzedRun.evidenceGraph.reliableEvidenceIds.length).toBeGreaterThan(0);

    // 用户修正识别结果后必须自动作废旧 revision 的路线并预生成新三路线。
    const correctedProfile = {
      ...analyzedRun.productProfile,
      productName: '全栈测试开放式蓝牙耳机',
      category: '电子产品 > 音频 > 开放式耳机',
      colors: '',
      materials: '',
      structure: '以参考图中可见外观、耳挂和充电仓结构为准',
      usage: '按参考图可见的耳挂方向正确佩戴',
      suggestedAudience: '重视舒适佩戴和环境感知的成年用户',
      suggestedScenarios: '日常通勤、桌面工作与轻量运动',
      visibleFacts: ['图片中可见耳挂式耳机与圆形充电仓'],
      needsConfirmation: [],
      userConfirmedClaims: '',
      consistencyConstraints: '保持参考图中耳机、耳挂、充电仓和可见部件一致',
    };
    const correctedRunResponse = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}`,
      {
        method: 'PATCH',
        body: { revision: analyzedRun.revision, productProfile: correctedProfile },
      },
    );
    expect(correctedRunResponse.status).toBe(200);
    const correctedRun = correctedRunResponse.body.run;
    expect(correctedRun).toMatchObject({ engineVersion: 4, status: 'ready', revision: 2 });
    expect(correctedRun.productProfile.colors).toBe('');

    await expect.poll(() => postgresScalar(`
      SELECT status
      FROM prompt_wizard_route_sets
      WHERE run_id = '${analyzedRun.id}'::uuid AND run_revision = ${correctedRun.revision}
      ORDER BY created_at DESC LIMIT 1;
    `), { timeout: 45_000, intervals: [250, 500, 1_000] }).toBe('completed');
    expect(postgresScalar(`
      SELECT jsonb_array_length(routes)::text
      FROM prompt_wizard_route_sets
      WHERE run_id = '${analyzedRun.id}'::uuid AND run_revision = ${correctedRun.revision}
        AND status = 'completed';
    `)).toBe('3');

    const retiredConcept = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/concept-sets`,
      { method: 'POST', body: {} },
    );
    expect(retiredConcept.status).toBe(410);
    const retiredDirections = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/use-direction-sets`,
      { method: 'POST', body: {} },
    );
    expect(retiredDirections.status).toBe(410);

    const videoConfig = {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 5,
    };
    const invalidLegacyBatch = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/batches`,
      {
        method: 'POST',
        body: {
          idempotencyKey: `fullstack-prompt-v6-invalid-${randomUUID()}`,
          revision: correctedRun.revision,
          expectedGenerationCredits: 1,
          voiceoverLanguage: '英语',
          videoConfig,
          useDirectionSetId: randomUUID(),
        },
      },
    );
    expect(invalidLegacyBatch.status).toBe(400);
    expect(await readCredits(session.page)).toBe(creditsBefore);

    const firstBatchKey = `fullstack-prompt-v6-first-${randomUUID()}`;
    const firstPayload = {
      idempotencyKey: firstBatchKey,
      revision: correctedRun.revision,
      expectedGenerationCredits: 1,
      videoConfig,
    };
    const firstBatchRequest = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/batches`,
      { method: 'POST', body: firstPayload },
    );
    expect(firstBatchRequest.status).toBe(202);
    expect(firstBatchRequest.body.batch).toMatchObject({
      status: 'queued',
      isFree: true,
      credits: 0,
      creditStatus: 'none',
    });
    expect(firstBatchRequest.body.batch.routeSetId).toBeTruthy();

    const firstBatch = await waitForPromptWizardBatch(session.page, firstBatchRequest.body.batch.id);
    expect(firstBatch).toMatchObject({
      status: 'completed',
      isFree: true,
      credits: 0,
      creditStatus: 'none',
    });
    expect(firstBatch.plans).toHaveLength(3);
    expect(firstBatch.plans.map((plan: { role: string }) => plan.role)).toEqual([
      'proof-conversion',
      'problem-hook',
      'lifestyle-seeding',
    ]);
    expect(new Set(firstBatch.plans.map((plan: { prompt: string }) => plan.prompt)).size).toBe(3);
    expect(firstBatch.plans.every((plan: {
      deliveryVersion: number;
      audioMode: string;
      prompt: string;
      shots: Array<{ role: string; voiceover: string; voiceoverZh: string }>;
      claimBasisTags: Array<{ basis: string }>;
      productionWarnings: string[];
    }) => (
      plan.deliveryVersion === 6
      && plan.audioMode === 'sound-design-only'
      && plan.shots.length === 2
      && plan.shots.map(shot => shot.role).join('|') === 'hook|proof-resolution'
      && plan.prompt.includes('@图片1')
      && /[㐀-鿿]/u.test(plan.prompt)
      && plan.prompt.includes('无对白、无人声、无旁白；仅使用音乐、环境声和真实商品操作拟音。')
      && !plan.prompt.includes('旁白（')
      && plan.shots.every(shot => shot.voiceover === '' && shot.voiceoverZh === '')
      && plan.productionWarnings.every(warning => !plan.prompt.includes(warning))
      && plan.claimBasisTags.every(tag => ['visible', 'user-confirmed', 'category-inferred'].includes(tag.basis))
      && !/proof-conversion|problem-hook|lifestyle-seeding/u.test(plan.prompt)
    ))).toBe(true);
    expect(await readCredits(session.page)).toBe(creditsBefore);
    expect(postgresScalar(`
      SELECT count(*) FROM credit_ledger
      WHERE related_prompt_batch_id = '${firstBatch.id}'::uuid;
    `)).toBe('0');

    const replayedFirst = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/batches`,
      { method: 'POST', body: firstPayload },
    );
    expect(replayedFirst.status).toBe(202);
    expect(replayedFirst.body.batch).toEqual(firstBatch);

    const retiredRefinement = await api(
      session.page,
      `/api/ai/prompt-wizard/batches/${firstBatch.id}/plans/${firstBatch.plans[0].id}/refinements`,
      { method: 'POST', body: { action: 'stronger-hook' } },
    );
    expect(retiredRefinement.status).toBe(410);

    const refreshPayload = {
      ...firstPayload,
      idempotencyKey: `fullstack-prompt-v6-refresh-${randomUUID()}`,
    };
    const refreshRequest = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/batches`,
      { method: 'POST', body: refreshPayload },
    );
    expect(refreshRequest.status).toBe(202);
    expect(refreshRequest.body.batch).toMatchObject({
      status: 'queued',
      isFree: false,
      credits: 1,
      creditStatus: 'held',
    });
    expect(await readCredits(session.page)).toBe(creditsBefore - 1);

    // 模拟关闭向导后重开：resume 必须优先返回活动批次，不能让用户再创建一批。
    const activeResume = await api(session.page, '/api/ai/prompt-wizard/resume');
    expect(activeResume.status).toBe(200);
    expect(activeResume.body.run.id).toBe(analyzedRun.id);
    expect(activeResume.body.batch.id).toBe(refreshRequest.body.batch.id);
    expect(['queued', 'processing']).toContain(activeResume.body.batch.status);

    const refreshedBatch = await waitForPromptWizardBatch(session.page, refreshRequest.body.batch.id);
    expect(refreshedBatch).toMatchObject({
      status: 'completed',
      isFree: false,
      credits: 1,
      creditStatus: 'settled',
    });
    expect(refreshedBatch.plans).toHaveLength(3);
    expect(await readCredits(session.page)).toBe(creditsBefore - 1);
    expect(postgresScalar(`
      SELECT concat_ws('|', type, settlement_status, amount::text)
      FROM credit_ledger WHERE related_prompt_batch_id = '${refreshedBatch.id}'::uuid;
    `)).toBe('spend|settled|-1');

    const replayedRefresh = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/batches`,
      { method: 'POST', body: refreshPayload },
    );
    expect(replayedRefresh.status).toBe(202);
    expect(replayedRefresh.body.batch).toEqual(refreshedBatch);
    expect(await readCredits(session.page)).toBe(creditsBefore - 1);
    expect(postgresScalar(`
      SELECT count(*) FROM credit_ledger
      WHERE related_prompt_batch_id = '${refreshedBatch.id}'::uuid;
    `)).toBe('1');

    const completedResume = await api(session.page, '/api/ai/prompt-wizard/resume');
    expect(completedResume.status).toBe(200);
    expect(completedResume.body.run.id).toBe(analyzedRun.id);
    expect(completedResume.body.batch.id).toBe(refreshedBatch.id);
    expect(completedResume.body.batch.plans).toHaveLength(3);

    const financialSnapshotBeforePurge = postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM credit_ledger WHERE user_id = '${userId}'::uuid),
        (SELECT coalesce(sum(amount), 0) FROM credit_ledger WHERE user_id = '${userId}'::uuid),
        (SELECT count(*) FROM credit_allocations WHERE user_id = '${userId}'::uuid),
        (SELECT coalesce(sum(amount), 0) FROM credit_allocations WHERE user_id = '${userId}'::uuid)
      );
    `);
    const providerSnapshotBeforePurge = postgresScalar(`
      SELECT concat_ws('|', count(*), coalesce(sum(input_tokens), 0),
        coalesce(sum(output_tokens), 0), coalesce(sum(cost_cny), 0))
      FROM prompt_wizard_provider_requests WHERE user_id = '${userId}'::uuid;
    `);

    postgres(`
      UPDATE prompt_wizard_runs SET expires_at = now() - interval '1 minute'
      WHERE id = '${analyzedRun.id}'::uuid;
    `);
    await expect.poll(() => postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM prompt_wizard_runs
         WHERE id = '${analyzedRun.id}'::uuid AND status = 'archived'
           AND product_profile IS NULL AND evidence_graph IS NULL),
        (SELECT count(*) FROM prompt_wizard_batches
         WHERE run_id = '${analyzedRun.id}'::uuid
           AND plans IS NULL AND content_purged_at IS NOT NULL),
        (SELECT count(*) FROM prompt_wizard_route_sets
         WHERE run_id = '${analyzedRun.id}'::uuid
           AND routes IS NULL AND content_purged_at IS NOT NULL)
      );
    `), { timeout: 45_000, intervals: [1_000, 2_000, 3_000] }).toBe('1|2|2');
    expect(postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM credit_ledger WHERE user_id = '${userId}'::uuid),
        (SELECT coalesce(sum(amount), 0) FROM credit_ledger WHERE user_id = '${userId}'::uuid),
        (SELECT count(*) FROM credit_allocations WHERE user_id = '${userId}'::uuid),
        (SELECT coalesce(sum(amount), 0) FROM credit_allocations WHERE user_id = '${userId}'::uuid)
      );
    `)).toBe(financialSnapshotBeforePurge);
    expect(postgresScalar(`
      SELECT concat_ws('|', count(*), coalesce(sum(input_tokens), 0),
        coalesce(sum(output_tokens), 0), coalesce(sum(cost_cny), 0))
      FROM prompt_wizard_provider_requests WHERE user_id = '${userId}'::uuid;
    `)).toBe(providerSnapshotBeforePurge);
    expect(await readCredits(session.page)).toBe(creditsBefore - 1);
    expect(await readCredits(admin.page)).toBe(primaryCreditsBefore);
  } finally {
    postgres(`
      UPDATE prompt_wizard_settings
      SET available = false, updated_at = now()
      WHERE singleton_id = 1 AND engine_version = 4;
    `);
    await session.context.close();
    await admin.context.close();
    postgres(`DELETE FROM assets WHERE id = '${assetId}'::uuid;`);
    postgres(`DELETE FROM asset_folders WHERE id = '${folderId}'::uuid;`);
    removeApiStorageObject(thumbnailObjectKey);
  }
});

test.skip('历史 V5 使用方向、双方案与单方案微调全栈链路（写入接口已退役，仅保留原始验收记录）', async ({ browser }) => {
  // 该用例故意覆盖 9 个顺序的异步节点，且隔离环境将
  // Fake Provider 单次延迟固定为 8 秒以验证状态恢复。只放宽本条
  // 业务链路的总时限，各状态轮询仍保留更短的独立超时。
  test.setTimeout(210_000);
  const userId = randomUUID();
  const testAccount = {
    email: `prompt-wizard-${userId}@lindyson.test`,
    password: primaryAccount.password,
  };
  const assetId = randomUUID();
  const folderId = randomUUID();
  const thumbnailObjectKey = `fullstack/prompt-wizard/${assetId}-thumbnail-512.webp`;

  // 使用专用零套餐账户隔离真实计费，避免永久流水改变 primaryAccount 的余额并污染后续用例。
  // 密码哈希仅复用本套件固定测试密码；该账户和不可变财务历史随一次性 Docker volume 销毁。
  postgres(`
    INSERT INTO users (id, email, password_hash, user_name)
    SELECT '${userId}', '${testAccount.email}', password_hash, '提示词向导全栈专用用户'
    FROM users WHERE email = '${primaryAccount.email}';
  `);

  const admin = await createAuthenticatedPage(browser, primaryAccount);
  const primaryCreditsBefore = await readCredits(admin.page);
  const seededCredits = await api(admin.page, '/api/admin/credits/adjust', {
    method: 'POST',
    headers: { 'Idempotency-Key': `fullstack-prompt-credit-seed-${randomUUID()}` },
    body: {
      userId,
      mainDelta: 0,
      addonDelta: 3,
      note: '全栈测试：准备提示词方案付费换批积分',
    },
  });
  expect(seededCredits.status).toBe(200);
  expect(seededCredits.body.user).toMatchObject({
    mainCredits: 0,
    addonCredits: 3,
    credits: 3,
  });

  const session = await createAuthenticatedPage(browser, testAccount);

  // 本用例验证的是向导 API、Redis 与 worker 链路；上传状态机已有独立全链路用例。
  // fake provider 不解码图片内容，但向导仍会严格校验 ready WebP 并读取共享存储中的真实对象大小。
  writeApiStorageObject(thumbnailObjectKey, promptWizardThumbnailWebpBase64);
  postgres(`
    INSERT INTO asset_folders (id, user_id, name, source, is_system)
    VALUES ('${folderId}', '${userId}', '全栈提示词向导图片', 'uploaded-image', false);

    INSERT INTO assets (
      id, user_id, folder_id, name, type, source, object_key, thumbnail_key, size_bytes,
      deletion_status, thumbnail_status, thumbnail_updated_at, created_at, updated_at
    ) VALUES (
      '${assetId}', '${userId}', '${folderId}', '全栈提示词向导产品.png', 'image', 'uploaded-image',
      'fullstack/prompt-wizard/${assetId}.png', '${thumbnailObjectKey}', 128,
      'active', 'ready', now(), now(), now()
    );
  `);

  expect(postgresScalar(`
    SELECT engine_version::text
    FROM prompt_wizard_settings
    WHERE singleton_id = 1;
  `)).toBe('3');

  try {
    const rejectedEngineRollback = await api(admin.page, '/api/admin/prompt-wizard-settings', {
      method: 'PATCH',
      headers: { 'Idempotency-Key': `fullstack-prompt-engine-v2-${randomUUID()}` },
      body: { engineVersion: 2 },
    });
    expect(rejectedEngineRollback.status).toBe(400);

    const creditsBefore = await readCredits(session.page);
    const runCountBeforeInvalidRequest = postgresScalar(`
      SELECT count(*) FROM prompt_wizard_runs WHERE user_id = '${userId}'::uuid;
    `);
    const firstLastRequest = await api(session.page, '/api/ai/prompt-wizard/runs', {
      method: 'POST',
      body: { imageAssetIds: [assetId], referenceMode: 'first-last' },
    });
    expect(firstLastRequest.status).toBe(400);
    expect(postgresScalar(`
      SELECT count(*) FROM prompt_wizard_runs WHERE user_id = '${userId}'::uuid;
    `)).toBe(runCountBeforeInvalidRequest);

    const createdRun = await api(session.page, '/api/ai/prompt-wizard/runs', {
      method: 'POST',
      body: { imageAssetIds: [assetId], referenceMode: 'general' },
    });
    expect(createdRun.status).toBe(202);
    expect(createdRun.body.run).toMatchObject({
      status: 'analyzing',
      revision: 0,
      imageAssetIds: [assetId],
    });
    const analyzedRun = await waitForPromptWizardRun(session.page, createdRun.body.run.id);
    expect(analyzedRun).toMatchObject({ status: 'ready', revision: 1 });
    expect(analyzedRun.productProfile.visibleFacts).toEqual(['已收到 1 张产品图片']);
    expect(analyzedRun.productProfile.colors).toBe('');

    const productProfile = {
      ...analyzedRun.productProfile,
      productName: '全栈测试便携产品',
      category: '便携配件',
      colors: '黑色',
      materials: '哑光材质',
      structure: '单体结构，外形以参考图为准',
      logo: '无可确认的品牌标识',
      usage: '按参考图所示的方向手持使用',
      suggestedAudience: '需要便携日常用品的成年用户',
      suggestedScenarios: '日常通勤与桌面使用',
      visibleFacts: ['图片中存在一个黑色产品主体'],
      needsConfirmation: [],
      userConfirmedClaims: '仅使用用户已确认的便携属性，不使用价格或性能数字',
      consistencyConstraints: '保持黑色哑光外观、单体结构和所有可见部件不变',
    };
    const creativeBrief = {
      targetLanguage: '英语',
      direction: 'problem-solution',
      marketingGoal: 'conversion',
      creativeIntensity: 'balanced',
    };
    const videoConfig = {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 5,
    };
    const productionBrief = {
      primaryPurchaseReason: '黑色哑光外观和便携单体结构',
      appearanceMode: 'hands-only',
      availableScenes: ['日常通勤', '桌面使用'],
      availableAssets: ['产品参考图片', '手部素材'],
    };
    const configuredRun = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}`,
      {
        method: 'PATCH',
        body: {
          revision: analyzedRun.revision,
          productProfile,
          creativeBrief,
          videoConfig,
          productionBrief,
        },
      },
    );
    expect(configuredRun.status).toBe(200);
    expect(configuredRun.body.run).toMatchObject({
      status: 'ready',
      revision: 2,
      creativeBrief,
      videoConfig,
      productionBrief,
    });
    expect(configuredRun.body.run.productProfile.colors).toBe('');
    expect(configuredRun.body.run.evidenceGraph.reliableEvidenceIds.length).toBeGreaterThan(0);

    const retiredConceptSetRequest = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/concept-sets`,
      {
        method: 'POST',
        body: {
          idempotencyKey: `fullstack-retired-concepts-${randomUUID()}`,
          revision: configuredRun.body.run.revision,
        },
      },
    );
    expect(retiredConceptSetRequest.status).toBe(410);
    expect(retiredConceptSetRequest.body.message).toBe('提示词流程已升级，请刷新后重新选择使用方向。');

    const useDirectionSetRequest = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/use-direction-sets`,
      {
        method: 'POST',
        body: {
          idempotencyKey: `fullstack-prompt-use-directions-${randomUUID()}`,
          revision: configuredRun.body.run.revision,
        },
      },
    );
    expect(useDirectionSetRequest.status).toBe(202);
    expect(useDirectionSetRequest.body.useDirectionSet).toMatchObject({ status: 'queued' });
    const useDirectionSet = await waitForPromptWizardUseDirectionSet(
      session.page,
      useDirectionSetRequest.body.useDirectionSet.id,
    );
    expect(useDirectionSet.directions.length).toBeGreaterThanOrEqual(2);
    expect(useDirectionSet.directions.length).toBeLessThanOrEqual(3);
    expect(useDirectionSet.directions.every((direction: {
      purchaseReason: string;
      proofAction: string;
      evidenceIds: string[];
      sceneOptions: unknown[];
      recommendedSceneId: string;
    }) => (
      direction.purchaseReason.length > 0
      && direction.proofAction.length > 0
      && direction.evidenceIds.length > 0
      && direction.sceneOptions.length >= 2
      && direction.sceneOptions.some((scene: { id: string }) => scene.id === direction.recommendedSceneId)
    ))).toBe(true);
    const selectedUseDirection = useDirectionSet.directions[0];
    const selectedScene = selectedUseDirection.sceneOptions.find((scene: { id: string }) => (
      scene.id === selectedUseDirection.recommendedSceneId
    ));
    expect(selectedScene).toBeTruthy();

    const firstBatchKey = `fullstack-prompt-first-${randomUUID()}`;
    const firstBatchRequest = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/batches`,
      {
        method: 'POST',
        body: {
          idempotencyKey: firstBatchKey,
          revision: configuredRun.body.run.revision,
          expectedGenerationCredits: 1,
          useDirectionSetId: useDirectionSet.id,
          selectedUseDirectionId: selectedUseDirection.id,
          selectedSceneId: selectedScene.id,
          targetLanguage: '英语',
          videoConfig,
        },
      },
    );
    expect(firstBatchRequest.status).toBe(202);
    expect(firstBatchRequest.body.batch).toMatchObject({
      status: 'queued',
      isFree: true,
      credits: 0,
      creditStatus: 'none',
      useDirectionSetId: useDirectionSet.id,
      selectedUseDirectionId: selectedUseDirection.id,
      selectedSceneId: selectedScene.id,
    });
    const firstBatch = await waitForPromptWizardBatch(
      session.page,
      firstBatchRequest.body.batch.id,
    );
    expect(firstBatch).toMatchObject({
      status: 'completed',
      isFree: true,
      credits: 0,
      creditStatus: 'none',
    });
    expect(firstBatch.plans).toHaveLength(2);
    expect(new Set(firstBatch.plans.map((plan: { prompt: string }) => plan.prompt)).size).toBe(2);
    expect(firstBatch.plans.every((plan: { prompt: string }) => plan.prompt.length <= 3_800)).toBe(true);
    const forbiddenProductionPromptPatterns = [
      ['禁止事项区块', /【禁止事项】/u],
      ['视频规格区块', /【视频规格】/u],
      ['独立颜色字段', /^颜色：/mu],
      ['独立产品名称字段', /^产品名称：/mu],
      ['独立品类字段', /^品类：/mu],
      ['画面文字字段', /^画面文字(?:（[^）]+）)?[：:]/mu],
      ['重复句末标点', /(?:。。|\.。|；。)/u],
    ] as const;
    const invalidProductionPrompts = firstBatch.plans.flatMap((plan: { prompt: string }, planIndex: number) => (
      forbiddenProductionPromptPatterns
        .filter(([, pattern]) => pattern.test(plan.prompt))
        .map(([label]) => ({ planIndex, label }))
    ));
    expect(invalidProductionPrompts).toEqual([]);
    expect(firstBatch.plans.every((plan: {
      name: string;
      hook: string;
      narrative: string;
      primaryScene: string;
      cameraAndPacing: string;
      differenceTags: string[];
      prompt: string;
      deliveryVersion: number;
      variant: string;
      useDirection: {
        id: string;
        purchaseReason: string;
        proofAction: string;
        evidenceIds: string[];
      };
      selectedScene: { id: string | null; title: string; environment: string; mainAction: string };
      shots: Array<{
        role: string;
        location: string;
        subject: string;
        shotSize: string;
        action: string;
        cameraMovement: string;
        lightingAndRealism: string;
        voiceover: string;
        voiceoverZh: string;
        foley: string;
        editingCue: string;
        evidenceRefs: string[];
        productionNote: string;
      }>;
      productionWarnings: string[];
    }) => {
      const chineseFields = [
        plan.name,
        plan.hook,
        plan.narrative,
        plan.primaryScene,
        plan.cameraAndPacing,
        ...plan.differenceTags,
      ];
      const visualLines = Array.from(plan.prompt.matchAll(/^画面：(.+)$/gmu), match => match[1] ?? '');
      const voiceoverLines = Array.from(plan.prompt.matchAll(/^旁白（英语）：(.+)$/gmu), match => match[1] ?? '');
      return chineseFields.every(value => /[\u3400-\u9fff]/u.test(value))
        && plan.deliveryVersion === 5
        && ['reliable', 'hook'].includes(plan.variant)
        && plan.useDirection.id === selectedUseDirection.id
        && plan.useDirection.purchaseReason === selectedUseDirection.purchaseReason
        && plan.useDirection.proofAction === selectedUseDirection.proofAction
        && plan.useDirection.evidenceIds.length > 0
        && plan.selectedScene.id === selectedScene.id
        && plan.selectedScene.title === selectedScene.title
        && plan.shots.length === 3
        && plan.shots.map(shot => shot.role).join('|') === 'hook|proof-resolution|cta'
        && plan.shots.every(shot => (
          [
            shot.location,
            shot.subject,
            shot.shotSize,
            shot.action,
            shot.cameraMovement,
            shot.lightingAndRealism,
            shot.foley,
            shot.editingCue,
          ].every(value => /[\u3400-\u9fff]/u.test(value))
          && (!shot.productionNote || /[\u3400-\u9fff]/u.test(shot.productionNote))
          && /[A-Za-z]/u.test(shot.voiceover)
          && /[\u3400-\u9fff]/u.test(shot.voiceoverZh)
          && !plan.prompt.includes(shot.voiceoverZh)
          && (!shot.productionNote || !plan.prompt.includes(shot.productionNote))
        ))
        && plan.shots[1]!.evidenceRefs.length > 0
        && !('alternativeHooks' in plan)
        && !('translationSegments' in plan)
        && !('concept' in plan)
        && !('strategy' in plan)
        && plan.productionWarnings.every(value => /[\u3400-\u9fff]/u.test(value))
        && visualLines.length > 0
        && visualLines.every(value => /[\u3400-\u9fff]/u.test(value))
        && voiceoverLines.length > 0
        && voiceoverLines.every(value => /[A-Za-z]/u.test(value));
    })).toBe(true);
    expect(await readCredits(session.page)).toBe(creditsBefore);
    expect(postgresScalar(`
      SELECT count(*) FROM credit_ledger
      WHERE related_prompt_batch_id = '${firstBatch.id}'::uuid;
    `)).toBe('0');

    const sourcePlan = firstBatch.plans[0];
    const untouchedPlan = structuredClone(firstBatch.plans[1]);
    const refinementRequest = await api(
      session.page,
      `/api/ai/prompt-wizard/batches/${firstBatch.id}/plans/${sourcePlan.id}/refinements`,
      {
        method: 'POST',
        body: {
          idempotencyKey: `fullstack-prompt-refinement-${randomUUID()}`,
          action: 'stronger-hook',
        },
      },
    );
    expect(refinementRequest.status).toBe(202);
    expect(refinementRequest.body.revision).toMatchObject({
      status: 'queued',
      isFree: true,
      sourcePlanId: sourcePlan.id,
      planIndex: 0,
    });
    const refinedPlan = await waitForPromptWizardPlanRevision(
      session.page,
      refinementRequest.body.revision.id,
    );
    expect(refinedPlan).toMatchObject({
      status: 'completed',
      isFree: true,
      sourcePlanId: sourcePlan.id,
      planIndex: 0,
    });
    expect(refinedPlan.plan.deliveryVersion).toBe(5);
    expect(refinedPlan.useDirectionId).toBe(selectedUseDirection.id);
    expect(refinedPlan.plan.id).not.toBe(sourcePlan.id);
    const unchangedBatch = await api(
      session.page,
      `/api/ai/prompt-wizard/batches/${firstBatch.id}`,
    );
    expect(unchangedBatch.status).toBe(200);
    expect(unchangedBatch.body.batch.plans[1]).toEqual(untouchedPlan);
    expect(await readCredits(session.page)).toBe(creditsBefore);

    const secondRefinement = await api(
      session.page,
      `/api/ai/prompt-wizard/batches/${firstBatch.id}/plans/${firstBatch.plans[1].id}/refinements`,
      {
        method: 'POST',
        body: {
          idempotencyKey: `fullstack-prompt-refinement-used-${randomUUID()}`,
          action: 'natural-voiceover',
        },
      },
    );
    expect(secondRefinement.status).toBe(409);
    expect(secondRefinement.body.code).toBe('PROMPT_WIZARD_FREE_REFINEMENT_USED');

    // “换一批”继续复用用户已经确认的同一使用方向和场景，只重新扩写 A/B 两套表现方式。
    const refreshBatchKey = `fullstack-prompt-refresh-${randomUUID()}`;
    const refreshPayload = {
      idempotencyKey: refreshBatchKey,
      revision: configuredRun.body.run.revision,
      expectedGenerationCredits: 1,
      useDirectionSetId: useDirectionSet.id,
      selectedUseDirectionId: selectedUseDirection.id,
      selectedSceneId: selectedScene.id,
      targetLanguage: '英语',
      videoConfig,
    };
    const refreshBatchRequest = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/batches`,
      { method: 'POST', body: refreshPayload },
    );
    expect(refreshBatchRequest.status).toBe(202);
    expect(refreshBatchRequest.body.batch).toMatchObject({
      status: 'queued',
      isFree: false,
      credits: 1,
      creditStatus: 'held',
    });
    expect(await readCredits(session.page)).toBe(creditsBefore - 1);

    const refreshedBatch = await waitForPromptWizardBatch(
      session.page,
      refreshBatchRequest.body.batch.id,
    );
    expect(refreshedBatch).toMatchObject({
      status: 'completed',
      isFree: false,
      credits: 1,
      creditStatus: 'settled',
    });
    expect(refreshedBatch.plans).toHaveLength(2);
    expect(await readCredits(session.page)).toBe(creditsBefore - 1);
    expect(postgresScalar(`
      SELECT concat_ws('|', type, settlement_status, amount::text)
      FROM credit_ledger
      WHERE related_prompt_batch_id = '${refreshedBatch.id}'::uuid;
    `)).toBe('spend|settled|-1');

    const replayedRefresh = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${analyzedRun.id}/batches`,
      { method: 'POST', body: refreshPayload },
    );
    expect(replayedRefresh.status).toBe(202);
    expect(replayedRefresh.body.batch).toEqual(refreshedBatch);
    expect(await readCredits(session.page)).toBe(creditsBefore - 1);
    expect(postgresScalar(`
      SELECT count(*) FROM credit_ledger
      WHERE related_prompt_batch_id = '${refreshedBatch.id}'::uuid;
    `)).toBe('1');

    // 关闭弹窗在前端的等价语义是丢弃旧 run；重新打开必须创建全新 run，不读取旧批次历史。
    const reopenedRunRequest = await api(session.page, '/api/ai/prompt-wizard/runs', {
      method: 'POST',
      body: { imageAssetIds: [assetId], referenceMode: 'general' },
    });
    expect(reopenedRunRequest.status).toBe(202);
    expect(reopenedRunRequest.body.run.id).not.toBe(analyzedRun.id);
    const reopenedRun = await waitForPromptWizardRun(session.page, reopenedRunRequest.body.run.id);
    const reopenedConfigured = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${reopenedRun.id}`,
      {
        method: 'PATCH',
        body: {
          revision: reopenedRun.revision,
          productProfile,
          creativeBrief,
          videoConfig,
          productionBrief,
        },
      },
    );
    expect(reopenedConfigured.status).toBe(200);

    const reopenedUseDirectionSetRequest = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${reopenedRun.id}/use-direction-sets`,
      {
        method: 'POST',
        body: {
          idempotencyKey: `fullstack-prompt-reopen-use-directions-${randomUUID()}`,
          revision: reopenedConfigured.body.run.revision,
        },
      },
    );
    expect(reopenedUseDirectionSetRequest.status).toBe(202);
    const reopenedUseDirectionSet = await waitForPromptWizardUseDirectionSet(
      session.page,
      reopenedUseDirectionSetRequest.body.useDirectionSet.id,
    );
    const reopenedDirection = reopenedUseDirectionSet.directions[0];
    const reopenedCustomScene = {
      title: '全栈自定义桌面演示',
      environment: '自然光桌面上的全栈自定义拍摄区域',
      mainAction: reopenedDirection.proofAction,
    };

    const reopenedBatchRequest = await api(
      session.page,
      `/api/ai/prompt-wizard/runs/${reopenedRun.id}/batches`,
      {
        method: 'POST',
        body: {
          idempotencyKey: `fullstack-prompt-reopen-${randomUUID()}`,
          revision: reopenedConfigured.body.run.revision,
          expectedGenerationCredits: 1,
          useDirectionSetId: reopenedUseDirectionSet.id,
          selectedUseDirectionId: reopenedDirection.id,
          customScene: reopenedCustomScene,
          targetLanguage: '英语',
          videoConfig,
        },
      },
    );
    expect(reopenedBatchRequest.status).toBe(202);
    expect(reopenedBatchRequest.body.batch).toMatchObject({
      isFree: true,
      credits: 0,
      creditStatus: 'none',
      selectedSceneId: null,
      customScene: reopenedCustomScene,
    });
    const reopenedBatch = await waitForPromptWizardBatch(
      session.page,
      reopenedBatchRequest.body.batch.id,
    );
    expect(reopenedBatch).toMatchObject({
      status: 'completed',
      isFree: true,
      credits: 0,
      creditStatus: 'none',
    });
    expect(reopenedBatch.plans).toHaveLength(2);
    expect(reopenedBatch.plans.every((plan: { deliveryVersion: number }) => (
      plan.deliveryVersion === 5
    ))).toBe(true);
    expect(await readCredits(session.page)).toBe(creditsBefore - 1);
    expect(await readCredits(admin.page)).toBe(primaryCreditsBefore);

    const financialSnapshotBeforePurge = postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM credit_ledger WHERE user_id = '${userId}'::uuid),
        (SELECT coalesce(sum(amount), 0) FROM credit_ledger WHERE user_id = '${userId}'::uuid),
        (SELECT count(*) FROM credit_allocations WHERE user_id = '${userId}'::uuid),
        (SELECT coalesce(sum(amount), 0) FROM credit_allocations WHERE user_id = '${userId}'::uuid)
      );
    `);
    const providerSnapshotBeforePurge = postgresScalar(`
      SELECT concat_ws('|', count(*), coalesce(sum(input_tokens), 0),
        coalesce(sum(output_tokens), 0), coalesce(sum(cost_cny), 0))
      FROM prompt_wizard_provider_requests
      WHERE user_id = '${userId}'::uuid;
    `);

    // 同时过期一个预设场景 run 与一个自定义场景 run，真实 worker 维护任务必须
    // 清空业务正文而不触发 070 shape check/trigger，也不得改动不可变财务证据。
    postgres(`
      UPDATE prompt_wizard_runs
      SET expires_at = now() - interval '1 minute'
      WHERE id IN ('${analyzedRun.id}'::uuid, '${reopenedRun.id}'::uuid);
    `);
    await expect.poll(() => postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM prompt_wizard_use_direction_sets
         WHERE id IN ('${useDirectionSet.id}'::uuid, '${reopenedUseDirectionSet.id}'::uuid)
           AND directions IS NULL AND content_purged_at IS NOT NULL),
        (SELECT count(*) FROM prompt_wizard_batches
         WHERE run_id IN ('${analyzedRun.id}'::uuid, '${reopenedRun.id}'::uuid)
           AND plans IS NULL AND content_purged_at IS NOT NULL)
      );
    `), { timeout: 45_000, intervals: [1_000, 2_000, 3_000] }).toBe('2|3');

    expect(postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM prompt_wizard_runs
         WHERE id IN ('${analyzedRun.id}'::uuid, '${reopenedRun.id}'::uuid)
           AND status = 'archived' AND product_profile IS NULL
           AND evidence_graph IS NULL),
        (SELECT count(*) FROM prompt_wizard_batches
         WHERE id = '${firstBatch.id}'::uuid
           AND selected_scene_id = '${selectedScene.id}'::uuid
           AND custom_scene IS NULL AND plans IS NULL),
        (SELECT count(*) FROM prompt_wizard_batches
         WHERE id = '${reopenedBatch.id}'::uuid
           AND selected_scene_id IS NULL AND custom_scene IS NULL AND plans IS NULL)
      );
    `)).toBe('2|1|1');
    expect(postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM prompt_wizard_use_direction_sets
         WHERE id IN ('${useDirectionSet.id}'::uuid, '${reopenedUseDirectionSet.id}'::uuid)
           AND directions IS NULL AND clarification_question IS NULL
           AND failure_reason IS NULL AND content_purged_at IS NOT NULL),
        (SELECT count(*) FROM prompt_wizard_plan_revisions
         WHERE id = '${refinedPlan.id}'::uuid AND plan IS NULL
           AND content_purged_at IS NOT NULL)
      );
    `)).toBe('2|1');
    expect(postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM credit_ledger WHERE user_id = '${userId}'::uuid),
        (SELECT coalesce(sum(amount), 0) FROM credit_ledger WHERE user_id = '${userId}'::uuid),
        (SELECT count(*) FROM credit_allocations WHERE user_id = '${userId}'::uuid),
        (SELECT coalesce(sum(amount), 0) FROM credit_allocations WHERE user_id = '${userId}'::uuid)
      );
    `)).toBe(financialSnapshotBeforePurge);
    expect(postgresScalar(`
      SELECT concat_ws('|', count(*), coalesce(sum(input_tokens), 0),
        coalesce(sum(output_tokens), 0), coalesce(sum(cost_cny), 0))
      FROM prompt_wizard_provider_requests
      WHERE user_id = '${userId}'::uuid;
    `)).toBe(providerSnapshotBeforePurge);
    expect(await readCredits(session.page)).toBe(creditsBefore - 1);
  } finally {
    await session.context.close();
    await admin.context.close();
    // 计费流水与积分分配是不可变历史，不为测试清理而绕过数据库保护。
    postgres(`DELETE FROM assets WHERE id = '${assetId}'::uuid;`);
    postgres(`DELETE FROM asset_folders WHERE id = '${folderId}'::uuid;`);
    removeApiStorageObject(thumbnailObjectKey);
  }
});

test('管理员修改套餐会在真实账户生效，带入标准主积分并保留加购积分', async ({ browser }) => {
  const admin = await createAuthenticatedPage(browser, primaryAccount);
  const affectedUser = await createAuthenticatedPage(browser, secondaryAccount);
  try {
    const usersResult = await api(
      admin.page,
      `/api/admin/users?search=${encodeURIComponent(secondaryAccount.email)}&limit=20`,
    );
    expect(usersResult.status).toBe(200);
    const initialUser = usersResult.body.items.find(
      (item: { email: string }) => item.email === secondaryAccount.email,
    );
    expect(initialUser).toBeTruthy();
    expect(initialUser).toMatchObject({
      addonCredits: 0,
    });

    const plansResult = await api(admin.page, '/api/admin/plans');
    expect(plansResult.status).toBe(200);
    const initialPlan = plansResult.body.items.find(
      (item: { id: string }) => item.id === initialUser.planId,
    );
    expect(initialPlan).toBeTruthy();
    expect(initialUser.mainCredits).toBe(initialPlan.credits);
    const targetPlan = plansResult.body.items.find(
      (item: { id: string; code: string; kind: string; status: string }) => (
        item.id !== initialUser.planId
        && item.code !== 'free'
        && item.kind === 'main'
        && item.status === 'active'
      ),
    );
    expect(targetPlan).toBeTruthy();

    const seededCredits = await api(admin.page, '/api/admin/credits/adjust', {
      method: 'POST',
      headers: { 'Idempotency-Key': `fullstack-credit-seed-${randomUUID()}` },
      body: {
        userId: initialUser.id,
        mainDelta: 0,
        addonDelta: 25,
        note: '全栈测试：准备套餐切换前积分',
      },
    });
    expect(seededCredits.status).toBe(200);
    expect(seededCredits.body.user).toMatchObject({
      mainCredits: initialUser.mainCredits,
      addonCredits: 25,
      credits: initialUser.mainCredits + 25,
    });

    const billingDate = postgresScalar(`
      SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD');
    `);
    const resetDate = postgresScalar(`
      SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai')::date + 30, 'YYYY-MM-DD');
    `);
    const expiresDate = postgresScalar(`
      SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai')::date + 365, 'YYYY-MM-DD');
    `);
    const billingCycle = targetPlan.billing === 'yearly' ? 'yearly' : 'monthly';
    const subscriptionKey = `fullstack-subscription-${randomUUID()}`;
    const paidPayload = {
      planId: targetPlan.id,
      billingCycle,
      planResetAt: resetDate,
      planExpiresAt: expiresDate,
      note: '全栈测试：切换到另一启用主套餐',
      expected: {
        planId: seededCredits.body.user.planId,
        billingCycle: seededCredits.body.user.billingCycle,
        planCycleStartedAt: seededCredits.body.user.planCycleStartedAt,
        planResetAt: seededCredits.body.user.planResetAt,
        planExpiresAt: seededCredits.body.user.planExpiresAt,
        activeSubscriptionOrderId: seededCredits.body.user.activeSubscriptionOrderId,
        mainCredits: seededCredits.body.user.mainCredits,
      },
      expectedPlanCredits: targetPlan.credits,
    };
    const paidResult = await api(
      admin.page,
      `/api/admin/users/${initialUser.id}/subscription`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': subscriptionKey },
        body: paidPayload,
      },
    );
    expect(paidResult.status).toBe(200);
    expect(paidResult.body.user).toMatchObject({
      planId: targetPlan.id,
      planCode: targetPlan.code,
      planName: targetPlan.name,
      billingCycle,
      mainCredits: targetPlan.credits,
      addonCredits: 25,
      credits: targetPlan.credits + 25,
      totalCredits: targetPlan.credits + 25,
      planCycleStartedAt: billingDate,
      planResetAt: resetDate,
      planExpiresAt: expiresDate,
    });
    expect(paidResult.body.entry).toMatchObject({
      bucket: 'main',
      amount: targetPlan.credits - initialUser.mainCredits,
      balance: targetPlan.credits + 25,
    });

    const replay = await api(
      admin.page,
      `/api/admin/users/${initialUser.id}/subscription`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': subscriptionKey },
        body: paidPayload,
      },
    );
    expect(replay.status).toBe(200);
    expect(replay.idempotencyReplayed).toBe('true');
    expect(replay.body).toEqual(paidResult.body);

    const userProfile = await api(affectedUser.page, '/api/auth/me');
    expect(userProfile.status).toBe(200);
    expect(userProfile.body.user).toMatchObject({
      planCode: targetPlan.code,
      planName: targetPlan.name,
      billingCycle,
      mainCredits: targetPlan.credits,
      addonCredits: 25,
      credits: targetPlan.credits + 25,
      totalCredits: targetPlan.credits + 25,
      planResetAt: resetDate,
      planExpiresAt: expiresDate,
    });
    expect(postgresScalar(`
      SELECT concat_ws('|',
        COALESCE(sum(available_amount) FILTER (WHERE bucket = 'main'), 0)::text,
        COALESCE(sum(available_amount) FILTER (WHERE bucket = 'addon'), 0)::text
      )
      FROM credit_lots
      WHERE user_id = '${initialUser.id}'::uuid;
    `)).toBe(`${targetPlan.credits}|25`);
    expect(postgresScalar(`
      SELECT count(*)
      FROM audit_logs
      WHERE target = '${initialUser.id}' AND action = '调整用户套餐';
    `)).toBe('1');
    expect(postgresScalar(`
      SELECT count(*)
      FROM orders
      WHERE user_id = '${initialUser.id}'::uuid;
    `)).toBe('0');

    const freeResult = await api(
      admin.page,
      `/api/admin/users/${initialUser.id}/subscription`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': `fullstack-subscription-free-${randomUUID()}` },
        body: {
          planId: null,
          billingCycle: null,
          planResetAt: null,
          planExpiresAt: null,
          note: '全栈测试：切换免费版并验证清零规则',
          expected: {
            planId: paidResult.body.user.planId,
            billingCycle: paidResult.body.user.billingCycle,
            planCycleStartedAt: paidResult.body.user.planCycleStartedAt,
            planResetAt: paidResult.body.user.planResetAt,
            planExpiresAt: paidResult.body.user.planExpiresAt,
            activeSubscriptionOrderId: paidResult.body.user.activeSubscriptionOrderId,
            mainCredits: paidResult.body.user.mainCredits,
          },
          expectedPlanCredits: 0,
        },
      },
    );
    expect(freeResult.status).toBe(200);
    expect(freeResult.body.user).toMatchObject({
      planId: null,
      planCode: null,
      planName: null,
      mainCredits: 0,
      addonCredits: 25,
      credits: 25,
      totalCredits: 25,
      planResetAt: null,
      planExpiresAt: null,
    });
    const freeProfile = await api(affectedUser.page, '/api/auth/me');
    expect(freeProfile.status).toBe(200);
    expect(freeProfile.body.user).toMatchObject({
      planCode: null,
      planName: null,
      mainCredits: 0,
      addonCredits: 25,
      credits: 25,
      totalCredits: 25,
      planResetAt: null,
      planExpiresAt: null,
    });

    const restoredResult = await api(
      admin.page,
      `/api/admin/users/${initialUser.id}/subscription`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': `fullstack-subscription-restore-${randomUUID()}` },
        body: {
          planId: initialPlan.id,
          billingCycle: initialUser.billingCycle,
          planResetAt: initialUser.planResetAt,
          planExpiresAt: initialUser.planExpiresAt,
          note: '全栈测试：恢复引导账号初始套餐',
          expected: {
            planId: freeResult.body.user.planId,
            billingCycle: freeResult.body.user.billingCycle,
            planCycleStartedAt: freeResult.body.user.planCycleStartedAt,
            planResetAt: freeResult.body.user.planResetAt,
            planExpiresAt: freeResult.body.user.planExpiresAt,
            activeSubscriptionOrderId: freeResult.body.user.activeSubscriptionOrderId,
            mainCredits: freeResult.body.user.mainCredits,
          },
          expectedPlanCredits: initialPlan.credits,
        },
      },
    );
    expect(restoredResult.status).toBe(200);
    expect(restoredResult.body.user).toMatchObject({
      planId: initialPlan.id,
      planCode: initialPlan.code,
      planName: initialPlan.name,
      billingCycle: initialUser.billingCycle,
      mainCredits: initialPlan.credits,
      addonCredits: 25,
      credits: initialPlan.credits + 25,
      totalCredits: initialPlan.credits + 25,
      planCycleStartedAt: billingDate,
      planResetAt: initialUser.planResetAt,
      planExpiresAt: initialUser.planExpiresAt,
    });

    const cleanupCredits = await api(admin.page, '/api/admin/credits/adjust', {
      method: 'POST',
      headers: { 'Idempotency-Key': `fullstack-credit-cleanup-${randomUUID()}` },
      body: {
        userId: initialUser.id,
        mainDelta: 0,
        addonDelta: -25,
        note: '全栈测试：清理加购积分',
      },
    });
    expect(cleanupCredits.status).toBe(200);
    expect(cleanupCredits.body.user).toMatchObject({
      planId: initialPlan.id,
      mainCredits: initialPlan.credits,
      addonCredits: 0,
      credits: initialPlan.credits,
    });
  } finally {
    await affectedUser.context.close();
    await admin.context.close();
  }
});

test('用户仪表盘在真实 PostgreSQL 上返回连续30个北京时间自然日并补零', async ({ browser }) => {
  const ids = {
    outsideWindow: randomUUID(),
    windowStart: randomUUID(),
    yesterday: randomUUID(),
    today: randomUUID(),
  };
  const taskIds = Object.values(ids);
  const today = postgresScalar(`
    SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD');
  `);
  const yesterday = postgresScalar(`
    SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai')::date - 1, 'YYYY-MM-DD');
  `);
  const windowStart = postgresScalar(`
    SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai')::date - 29, 'YYYY-MM-DD');
  `);
  const windowSecondDay = postgresScalar(`
    SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai')::date - 28, 'YYYY-MM-DD');
  `);

  postgres(`
    INSERT INTO generation_tasks (
      id, user_id, kind, model, status, prompt, config,
      credits, reserved_credits, settled_credits, refunded_credits, credit_status,
      attempt, provider_task_attempt, processing_stage,
      created_at, completed_at, updated_at
    ) VALUES
      (
        '${ids.outsideWindow}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'video', 'Seedance 2.0', 'completed', '仪表盘窗口外任务', '{}'::jsonb,
        1, 1, 1, 0, 'settled', 0, 0, 'completed',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '30 days' + interval '12 hours') AT TIME ZONE 'Asia/Shanghai',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '30 days' + interval '12 hours 1 minute') AT TIME ZONE 'Asia/Shanghai',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '30 days' + interval '12 hours 1 minute') AT TIME ZONE 'Asia/Shanghai'
      ),
      (
        '${ids.windowStart}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'video', 'Seedance 2.0', 'completed', '仪表盘窗口首日任务', '{}'::jsonb,
        1, 1, 1, 0, 'settled', 0, 0, 'completed',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '29 days' + interval '5 minutes') AT TIME ZONE 'Asia/Shanghai',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '29 days' + interval '6 minutes') AT TIME ZONE 'Asia/Shanghai',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '29 days' + interval '6 minutes') AT TIME ZONE 'Asia/Shanghai'
      ),
      (
        '${ids.yesterday}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'video', 'Seedance 2.0', 'completed', '仪表盘昨日边界任务', '{}'::jsonb,
        1, 1, 1, 0, 'settled', 0, 0, 'completed',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '1 second') AT TIME ZONE 'Asia/Shanghai',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '500 milliseconds') AT TIME ZONE 'Asia/Shanghai',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '500 milliseconds') AT TIME ZONE 'Asia/Shanghai'
      ),
      (
        '${ids.today}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'image', 'Seedream 5.0 Pro', 'completed', '仪表盘今日边界任务', '{}'::jsonb,
        1, 1, 1, 0, 'settled', 0, 0, 'completed',
        date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') + interval '1 minute') AT TIME ZONE 'Asia/Shanghai',
        (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') + interval '1 minute') AT TIME ZONE 'Asia/Shanghai'
      );
  `);

  const session = await createAuthenticatedPage(browser, primaryAccount);
  try {
    const dashboard = await api(session.page, '/api/account/dashboard-summary');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.timezone).toBe('Asia/Shanghai');
    expect(dashboard.body.trend).toHaveLength(30);
    expect(dashboard.body.trend[0]).toEqual({ day: windowStart, videos: 1, images: 0 });
    expect(dashboard.body.trend[1]).toEqual({ day: windowSecondDay, videos: 0, images: 0 });
    expect(dashboard.body.trend[28]).toEqual({ day: yesterday, videos: 1, images: 0 });
    expect(dashboard.body.trend[29]).toEqual({ day: today, videos: 0, images: 1 });
    expect(dashboard.body.modelUsage).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'Seedream 5.0 Pro', count: 1 }),
    ]));
  } finally {
    await session.context.close();
    postgres(`
      DELETE FROM generation_tasks
      WHERE id IN (${taskIds.map(id => `'${id}'::uuid`).join(', ')});
    `);
  }
});

test('新注册用户在真实数据库中创建为零积分且无套餐关联的免费账户', async ({ browser }) => {
  const verificationId = randomUUID();
  const email = `fullstack-new-${randomUUID()}@lindyson.test`;
  const userName = '全栈新用户';
  const verificationCode = '135790';
  const verificationSalt = 'fullstack-registration-salt';
  const verificationHash = createHash('sha256')
    .update(`${verificationSalt}:${verificationCode}`)
    .digest('hex');
  postgres(`
    INSERT INTO registration_verification_codes (
      id, email, user_name, code_hash, code_salt, expires_at
    ) VALUES (
      '${verificationId}', '${email}', '${userName}',
      '${verificationHash}', '${verificationSalt}', now() + interval '10 minutes'
    );
  `);

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('/');
    const registration = await api(page, '/api/auth/register', {
      method: 'POST',
      body: {
        userName,
        email,
        password: 'FullstackUser2026!',
        verificationId,
        verificationCode,
      },
    });

    expect(registration.status).toBe(200);
    expect(registration.body.user).toMatchObject({
      email,
      userName,
      planCode: null,
      planName: null,
      mainCredits: 0,
      addonCredits: 0,
      credits: 0,
      totalCredits: 0,
      planResetAt: null,
      planExpiresAt: null,
    });
    expect(postgresScalar(`
      SELECT concat_ws('|',
        coalesce(plan_id::text, 'NULL'),
        main_credits::text,
        addon_credits::text,
        total_credits::text,
        coalesce(plan_reset_at::text, 'NULL'),
        coalesce(plan_expires_at::text, 'NULL')
      )
      FROM users WHERE email = '${email}';
    `)).toBe('NULL|0|0|0|NULL|NULL');
    expect(postgresScalar(`
      SELECT count(*) FROM credit_ledger
      WHERE user_id = (SELECT id FROM users WHERE email = '${email}');
    `)).toBe('0');
  } finally {
    await context.close();
  }
});

test('成本看盘在真实 PostgreSQL 上按任务口径聚合并支持自选周期与高级对账', async ({ browser }) => {
  const ids = {
    oldBillingRun: '10000000-0000-4000-8000-000000000001',
    newBillingRun: '10000000-0000-4000-8000-000000000002',
    oldReconciliationRun: '10000000-0000-4000-8000-000000000011',
    newReconciliationRun: '10000000-0000-4000-8000-000000000012',
    oldBucket: '10000000-0000-4000-8000-000000000021',
    newBucket: '10000000-0000-4000-8000-000000000022',
    newMiniBucket: '10000000-0000-4000-8000-000000000023',
    olderTask: '10000000-0000-4000-8000-000000000031',
    newerTask: '10000000-0000-4000-8000-000000000032',
    olderAttemptOne: '10000000-0000-4000-8000-000000000041',
    olderAttemptTwo: '10000000-0000-4000-8000-000000000042',
    newerAttempt: '10000000-0000-4000-8000-000000000043',
    fastRevision: '10000000-0000-4000-8000-000000000051',
    miniRevision: '10000000-0000-4000-8000-000000000052',
  };
  postgres(`
    INSERT INTO provider_billing_sync_runs (
      id, provider, kind, status, window_start, window_end,
      page_count, row_count, started_at, completed_at, is_final
    ) VALUES
      ('${ids.oldBillingRun}', 'volcengine-ark', 'bill', 'success', '2026-07-01', '2026-07-01',
       1, 1, now() - interval '3 minutes', now() - interval '3 minutes', false),
      ('${ids.newBillingRun}', 'volcengine-ark', 'bill', 'success', '2026-07-01', '2026-07-01',
       1, 2, now() - interval '1 minute', now() - interval '1 minute', false);

    INSERT INTO provider_bill_detail_revisions (
      id, provider, source_detail_key, sync_run_id, payload_hash, raw_payload,
      normalized_payload, normalization_version, observed_at
    ) VALUES
      (
        '${ids.fastRevision}', 'volcengine-ark', 'fullstack-fast-2026-07-01',
        '${ids.newBillingRun}', repeat('e', 64), '{}'::jsonb,
        jsonb_build_object(
          'billPeriod', '2026-07', 'expenseDate', '2026-07-01', 'product', 'ark_bd',
          'billLineType', 'usage', 'recognizedModel', 'Seedance 2.0 Fast',
          'seedanceCandidate', true, 'pricingResolution', '480P/720P',
          'pricingInputHasVideo', false, 'normalizedUnitPricePerMillion', 37,
          'billableTokens', 200, 'deductionCount', 200,
          'listEquivalentCostCny', 0.007400, 'originalBillAmountCny', 0,
          'preferentialBillAmountCny', 0, 'discountBillAmountCny', 0,
          'couponAmountCny', 0, 'payableAmountCny', 0, 'paidAmountCny', 0,
          'unpaidAmountCny', 0, 'currency', 'CNY', 'instanceNo', 'fullstack-fast'
        ),
        'fullstack-v1', now() - interval '1 minute'
      ),
      (
        '${ids.miniRevision}', 'volcengine-ark', 'fullstack-mini-2026-07-01',
        '${ids.newBillingRun}', repeat('f', 64), '{}'::jsonb,
        jsonb_build_object(
          'billPeriod', '2026-07', 'expenseDate', '2026-07-01', 'product', 'ark_bd',
          'billLineType', 'usage', 'recognizedModel', 'Seedance 2.0 Mini',
          'seedanceCandidate', true, 'pricingResolution', '480P/720P',
          'pricingInputHasVideo', false, 'normalizedUnitPricePerMillion', 23,
          'billableTokens', 100, 'deductionCount', 100,
          'listEquivalentCostCny', 0.002300, 'originalBillAmountCny', 0,
          'preferentialBillAmountCny', 0, 'discountBillAmountCny', 0,
          'couponAmountCny', 0, 'payableAmountCny', 0, 'paidAmountCny', 0,
          'unpaidAmountCny', 0, 'currency', 'CNY', 'instanceNo', 'fullstack-mini'
        ),
        'fullstack-v1', now() - interval '1 minute'
      );

    INSERT INTO provider_bill_sync_run_items (
      sync_run_id, bill_detail_revision_id, source_detail_key
    ) VALUES
      ('${ids.newBillingRun}', '${ids.fastRevision}', 'fullstack-fast-2026-07-01'),
      ('${ids.newBillingRun}', '${ids.miniRevision}', 'fullstack-mini-2026-07-01');

    INSERT INTO generation_tasks (
      id, user_id, kind, model, status, prompt, config, provider_task_id,
      credits, reserved_credits, settled_credits, refunded_credits, credit_status,
      attempt, provider_task_attempt, processing_stage, created_at, started_at,
      completed_at, updated_at
    ) VALUES
      (
        '${ids.olderTask}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'video', 'Seedance 2.0 Fast', 'completed', '全栈成本聚合旧任务',
        '{"resolution":"480p"}'::jsonb, 'fullstack-provider-fast',
        40, 40, 40, 0, 'settled', 1, 1, 'completed',
        '2026-07-01 09:00:00+08', '2026-07-01 09:01:00+08',
        '2026-07-01 09:05:00+08', '2026-07-01 09:05:00+08'
      ),
      (
        '${ids.newerTask}',
        (SELECT id FROM users WHERE email = '${secondaryAccount.email}'),
        'video', 'Seedance 2.0 Mini', 'completed', '全栈成本聚合新任务',
        '{"resolution":"480p"}'::jsonb, 'fullstack-provider-mini',
        10, 10, 10, 0, 'settled', 0, 0, 'completed',
        '2026-07-01 10:00:00+08', '2026-07-01 10:01:00+08',
        '2026-07-01 10:05:00+08', '2026-07-01 10:05:00+08'
      );

    INSERT INTO provider_usage_records (
      id, provider, model, task_id, attempt, provider_task_id, status,
      raw_units, deducted_units, usage_unit, completed_at, completion_tokens,
      total_tokens, billable_tokens, billable_basis, resolution, has_video_input,
      price_version, unit_price_per_million, estimated_cost, currency, pricing_status,
      usage_evidence_origin, pricing_rule_status, pricing_input_class,
      pricing_resolution_band, attribution_confidence, provider_terminal_at,
      usage_observed_at, local_accounting_date, accounting_date_origin, created_at
    ) VALUES
      (
        '${ids.olderAttemptOne}', 'volcengine-ark', 'Seedance 2.0 Fast',
        '${ids.olderTask}', 0, 'fullstack-provider-fast-0', 'success',
        80, 80, 'tokens', '2026-07-01 09:03:00+08', 80, 80, 80,
        'completion_tokens', '480p', false, 'volcengine-seedance-2026-07-10',
        37, 0.002960, 'CNY', 'priced', 'provider-reported', 'priced',
        'without-video', '480p-720p', 'direct', '2026-07-01 09:03:00+08',
        '2026-07-01 09:03:00+08', '2026-07-01', 'provider-terminal',
        '2026-07-01 09:03:00+08'
      ),
      (
        '${ids.olderAttemptTwo}', 'volcengine-ark', 'Seedance 2.0 Fast',
        '${ids.olderTask}', 1, 'fullstack-provider-fast-1', 'success',
        120, 120, 'tokens', '2026-07-01 09:04:00+08', 120, 120, 120,
        'completion_tokens', '480p', false, 'volcengine-seedance-2026-07-10',
        37, 0.004440, 'CNY', 'priced', 'provider-reported', 'priced',
        'without-video', '480p-720p', 'direct', '2026-07-01 09:04:00+08',
        '2026-07-01 09:04:00+08', '2026-07-01', 'provider-terminal',
        '2026-07-01 09:04:00+08'
      ),
      (
        '${ids.newerAttempt}', 'volcengine-ark', 'Seedance 2.0 Mini',
        '${ids.newerTask}', 0, 'fullstack-provider-mini-0', 'success',
        100, 100, 'tokens', '2026-07-01 10:04:00+08', 100, 100, 100,
        'completion_tokens', '480p', false, 'volcengine-seedance-2026-07-10',
        23, 0.002300, 'CNY', 'priced', 'provider-reported', 'priced',
        'without-video', '480p-720p', 'direct', '2026-07-01 10:04:00+08',
        '2026-07-01 10:04:00+08', '2026-07-01', 'provider-terminal',
        '2026-07-01 10:04:00+08'
      );

    INSERT INTO provider_reconciliation_runs (
      id, provider, bill_period, window_start, window_end, official_sync_run_id,
      local_cutoff, normalization_version, official_snapshot_hash, local_snapshot_hash,
      bill_state, match_state, coverage_state, official_tokens, official_cost_cny,
      residual_tokens, residual_cost_cny, created_at
    ) VALUES
      ('${ids.oldReconciliationRun}', 'volcengine-ark', '2026-07', '2026-07-01', '2026-07-01',
       '${ids.oldBillingRun}', now() - interval '3 minutes', 'fullstack-v1', repeat('a', 64), repeat('b', 64),
       'provisional', 'residual', 'complete', 100, 0.002300, 100, 0.002300, now() - interval '3 minutes'),
      ('${ids.newReconciliationRun}', 'volcengine-ark', '2026-07', '2026-07-01', '2026-07-01',
       '${ids.newBillingRun}', now() - interval '1 minute', 'fullstack-v1', repeat('c', 64), repeat('d', 64),
       'provisional', 'raw-matched', 'complete', 300, 0.009700, 0, 0, now() - interval '1 minute');

    INSERT INTO provider_reconciliation_buckets (
      id, reconciliation_run_id, provider, bill_period, expense_date, bill_line_type,
      product, recognized_model, pricing_resolution_band, pricing_input_class,
      unit_price_per_million, currency, raw_local_tokens, raw_local_cost_cny,
      adjusted_local_tokens, adjusted_local_cost_cny, official_tokens,
      official_cost_cny, residual_tokens, residual_cost_cny, status
    ) VALUES
      ('${ids.oldBucket}', '${ids.oldReconciliationRun}', 'volcengine-ark', '2026-07', '2026-07-01',
       'usage', 'ark_bd', 'Seedance 2.0 Mini', '480p-720p', 'without-video', 23, 'CNY',
       0, 0, 0, 0, 100, 0.002300, 100, 0.002300, 'residual'),
      ('${ids.newBucket}', '${ids.newReconciliationRun}', 'volcengine-ark', '2026-07', '2026-07-01',
       'usage', 'ark_bd', 'Seedance 2.0 Fast', '480p-720p', 'without-video', 37, 'CNY',
       200, 0.007400, 200, 0.007400, 200, 0.007400, 0, 0, 'raw-matched'),
      ('${ids.newMiniBucket}', '${ids.newReconciliationRun}', 'volcengine-ark', '2026-07', '2026-07-01',
       'usage', 'ark_bd', 'Seedance 2.0 Mini', '480p-720p', 'without-video', 23, 'CNY',
       100, 0.002300, 100, 0.002300, 100, 0.002300, 0, 0, 'raw-matched');
  `);

  const session = await createAuthenticatedPage(browser, primaryAccount);
  const range = 'range=custom&from=2026-07-01&to=2026-07-01';
  try {
    const dashboard = await api(session.page, `/api/admin/api-usage?${range}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.selection).toMatchObject({
      range: 'custom', rangeStart: '2026-07-01', rangeEnd: '2026-07-01', timezone: 'Asia/Shanghai',
    });
    const snapshotRange = `${range}&asOf=${encodeURIComponent(dashboard.body.asOf)}`;

    expect(dashboard.body.operations).toMatchObject({
      taskCount: 2,
      userCount: 2,
      settledCredits: 50,
      heldCredits: 0,
      refundedCredits: 0,
      estimatedCostCny: '0.009700',
      estimateCompleteness: 'complete',
      incompleteTaskCount: 0,
      officialEquivalentCostCny: '0.009700',
      differenceCny: '0.000000',
      officialPayableCny: '0.000000',
      reconciliationStatus: 'matched',
    });
    expect(dashboard.body.operations.models).toEqual([
      expect.objectContaining({
        model: 'Seedance 2.5', priceVersions: [], taskCount: 0,
        operationalCallCount: 0, settledCredits: 0, heldCredits: 0, refundedCredits: 0,
        estimatedCostCny: '0.000000', businessEstimatedCostCny: '0.000000',
        operationalEstimatedCostCny: '0.000000', knownAccountCostCny: '0.000000',
        operationalUnpricedCallCount: 0, estimateCompleteness: 'complete',
        incompleteTaskCount: 0, averageTaskCostCny: null,
      }),
      expect.objectContaining({
        model: 'Seedance 2.0', priceVersions: [], taskCount: 0,
        operationalCallCount: 0, settledCredits: 0, heldCredits: 0, refundedCredits: 0,
        estimatedCostCny: '0.000000', businessEstimatedCostCny: '0.000000',
        operationalEstimatedCostCny: '0.000000', knownAccountCostCny: '0.000000',
        operationalUnpricedCallCount: 0, estimateCompleteness: 'complete',
        incompleteTaskCount: 0, averageTaskCostCny: null,
      }),
      expect.objectContaining({
        model: 'Seedance 2.0 Fast', taskCount: 1, settledCredits: 40,
        operationalCallCount: 0, estimatedCostCny: '0.007400',
        businessEstimatedCostCny: '0.007400', operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.007400', operationalUnpricedCallCount: 0,
        estimateCompleteness: 'complete', averageTaskCostCny: '0.007400',
      }),
      expect.objectContaining({
        model: 'Seedance 2.0 Mini', taskCount: 1, settledCredits: 10,
        operationalCallCount: 0, estimatedCostCny: '0.002300',
        businessEstimatedCostCny: '0.002300', operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.002300', operationalUnpricedCallCount: 0,
        estimateCompleteness: 'complete', averageTaskCostCny: '0.002300',
      }),
    ]);

    const tasks = await api(session.page, `/api/admin/api-usage/tasks?${snapshotRange}&limit=20`);
    const users = await api(session.page, `/api/admin/api-usage/users?${snapshotRange}&limit=20`);
    const attempts = await api(session.page, `/api/admin/api-usage/attempts?${snapshotRange}&limit=20`);
    const settlement = await api(session.page, `/api/admin/api-usage/settlement?${snapshotRange}&limit=20`);
    for (const response of [tasks, users, attempts, settlement]) expect(response.status).toBe(200);

    expect(tasks.body.items.map((item: { id: string }) => item.id)).toEqual([
      ids.newerTask,
      ids.olderTask,
    ]);
    const taskCreatedAt = tasks.body.items.map((item: { createdAt: string }) => item.createdAt);
    expect(taskCreatedAt).toEqual([...taskCreatedAt].sort((left, right) => right.localeCompare(left)));
    expect(tasks.body.items).toEqual([
      expect.objectContaining({
        id: ids.newerTask, taskId: ids.newerTask, model: 'Seedance 2.0 Mini',
        settledCredits: 10, attemptCount: 1, billableTokens: 100,
        estimatedCostCny: '0.002300', estimateCompleteness: 'complete', costFinalized: true,
      }),
      expect.objectContaining({
        id: ids.olderTask, taskId: ids.olderTask, model: 'Seedance 2.0 Fast',
        settledCredits: 40, attemptCount: 2, billableTokens: 200,
        estimatedCostCny: '0.007400', estimateCompleteness: 'complete', costFinalized: true,
      }),
    ]);
    expect(attempts.body.items).toHaveLength(3);
    expect(attempts.body.items.filter(
      (item: { taskId: string }) => item.taskId === ids.olderTask,
    )).toHaveLength(2);

    const taskCostMicros = tasks.body.items.reduce(
      (sum: bigint, item: { estimatedCostCny: string }) => sum + parseCnyMicros(item.estimatedCostCny),
      0n,
    );
    const taskCredits = tasks.body.items.reduce(
      (sum: number, item: { settledCredits: number }) => sum + item.settledCredits,
      0,
    );
    const userCostMicros = users.body.items.reduce(
      (sum: bigint, item: { estimatedCostCny: string }) => sum + parseCnyMicros(item.estimatedCostCny),
      0n,
    );
    const userCredits = users.body.items.reduce(
      (sum: number, item: { settledCredits: number }) => sum + item.settledCredits,
      0,
    );
    expect(users.body.items).toHaveLength(2);
    expect(users.body.items.reduce(
      (sum: number, item: { taskCount: number }) => sum + item.taskCount,
      0,
    )).toBe(dashboard.body.operations.taskCount);
    expect(taskCostMicros).toBe(parseCnyMicros(dashboard.body.operations.estimatedCostCny));
    expect(userCostMicros).toBe(taskCostMicros);
    expect(taskCredits).toBe(dashboard.body.operations.settledCredits);
    expect(userCredits).toBe(taskCredits);

    for (const amount of [
      dashboard.body.operations.estimatedCostCny,
      dashboard.body.operations.officialEquivalentCostCny,
      dashboard.body.operations.differenceCny,
      dashboard.body.operations.officialPayableCny,
      ...dashboard.body.operations.models.map((item: { estimatedCostCny: string }) => item.estimatedCostCny),
      ...tasks.body.items.map((item: { estimatedCostCny: string }) => item.estimatedCostCny),
      ...users.body.items.map((item: { estimatedCostCny: string }) => item.estimatedCostCny),
      ...attempts.body.items.map((item: { estimatedCostCny: string }) => item.estimatedCostCny),
    ]) expect(String(amount)).toMatch(/^-?\d+\.\d{6}$/);

    const reconciliation = await api(
      session.page,
      `/api/admin/api-usage/reconciliation?${snapshotRange}&limit=20`,
    );
    expect(reconciliation.status).toBe(200);
    expect(reconciliation.body.items).toEqual([
      expect.objectContaining({
        id: ids.newBucket,
        model: 'Seedance 2.0 Fast',
        officialTokens: 200,
        residualTokens: 0,
      }),
      expect.objectContaining({
        id: ids.newMiniBucket,
        model: 'Seedance 2.0 Mini',
        officialTokens: 100,
        residualTokens: 0,
      }),
    ]);
  } finally {
    await session.context.close();
    postgres(`
      DELETE FROM provider_usage_records
      WHERE id IN ('${ids.olderAttemptOne}', '${ids.olderAttemptTwo}', '${ids.newerAttempt}');
      DELETE FROM generation_tasks
      WHERE id IN ('${ids.olderTask}', '${ids.newerTask}');
      DELETE FROM provider_reconciliation_runs
      WHERE id IN ('${ids.oldReconciliationRun}', '${ids.newReconciliationRun}');
      DELETE FROM provider_bill_sync_run_items
      WHERE sync_run_id IN ('${ids.oldBillingRun}', '${ids.newBillingRun}');
      -- Migration 076 后官方 revision 不可变；其所属同步 run 随隔离全栈库销毁。
    `);
  }
});

test('多模态成本看盘在真实 PostgreSQL 上隔离逐请求、历史聚合定价与免费付费批次', async ({ browser }) => {
  const ids = {
    knownRun: randomUUID(),
    reconciledRun: randomUUID(),
    historicalRun: randomUUID(),
    parentRun: randomUUID(),
    geminiRun: randomUUID(),
    olderGeminiRun: randomUUID(),
    mixedRun: randomUUID(),
    terminalUnknownRun: randomUUID(),
    inFlightUnknownRun: randomUUID(),
    freeBatch: randomUUID(),
    paidBatch: randomUUID(),
    geminiBatch: randomUUID(),
    referenceAsset: randomUUID(),
    requests: Array.from({ length: 10 }, () => randomUUID()),
  };
  const lowRuleId = 'volcengine-doubao-seed-2-0-lite-260428-default-2026-07-23-0-32k';

  postgres(`
    INSERT INTO prompt_wizard_runs (
      id, user_id, status, revision, image_asset_ids, failure_reason,
      provider_model, provider_input_tokens, provider_output_tokens, attempt_count,
      started_at, completed_at, expires_at, created_at, updated_at
    ) VALUES
      (
        '${ids.reconciledRun}', (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'failed', 0, ARRAY['${ids.referenceAsset}'::uuid], '全栈成本测试：供应商未返回 usage',
        'doubao-seed-2-0-lite-260428', NULL, NULL, 1,
        '2026-07-23 17:10:01+08', '2026-07-23 17:10:20+08', '2099-01-01 00:00:00+08',
        '2026-07-23 17:10:00+08', '2026-07-23 17:10:20+08'
      ),
      (
        '${ids.knownRun}', (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'failed', 0, ARRAY['${ids.referenceAsset}'::uuid], '全栈成本测试：修复请求失败',
        'doubao-seed-2-0-lite-260428', 150, 15, 1,
        '2026-07-23 19:00:01+08', '2026-07-23 19:00:20+08', '2099-01-01 00:00:00+08',
        '2026-07-23 19:00:00+08', '2026-07-23 19:00:20+08'
      ),
      (
        '${ids.historicalRun}', (SELECT id FROM users WHERE email = '${secondaryAccount.email}'),
        'archived', 1, '{}'::uuid[], NULL,
        'doubao-seed-2-0-lite-260428', 900, 120, 1,
        '2026-07-23 19:10:01+08', '2026-07-23 19:10:20+08', '2026-07-23 19:11:00+08',
        '2026-07-23 19:10:00+08', '2026-07-23 19:11:00+08'
      ),
      (
        '${ids.parentRun}', (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'ready', 1, ARRAY['${ids.referenceAsset}'::uuid], NULL,
        'doubao-seed-2-0-lite-260428', NULL, NULL, 1,
        '2026-07-23 19:20:01+08', '2026-07-23 19:20:20+08', '2099-01-01 00:00:00+08',
        '2026-07-23 19:20:00+08', '2026-07-23 19:20:20+08'
      ),
      (
        '${ids.geminiRun}', (SELECT id FROM users WHERE email = '${secondaryAccount.email}'),
        'ready', 1, ARRAY['${ids.referenceAsset}'::uuid], NULL,
        'gemini-3.5-flash', 700, 70, 1,
        '2026-07-23 18:00:01+08', '2026-07-23 18:00:20+08', '2099-01-01 00:00:00+08',
        '2026-07-23 18:00:00+08', '2026-07-23 18:00:20+08'
      ),
      (
        '${ids.olderGeminiRun}', (SELECT id FROM users WHERE email = '${secondaryAccount.email}'),
        'archived', 1, '{}'::uuid[], NULL,
        'gemini-3.5-flash', 800, 80, 1,
        '1999-01-01 00:00:01+08', '1999-01-01 00:00:20+08', '1999-01-01 00:01:00+08',
        '1999-01-01 00:00:00+08', '1999-01-01 00:01:00+08'
      ),
      (
        '${ids.mixedRun}', (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'failed', 0, ARRAY['${ids.referenceAsset}'::uuid], '全栈成本测试：混合模型 owner',
        'doubao-seed-2-0-lite-260428', 999, 99, 1,
        '2026-07-23 18:30:01+08', '2026-07-23 18:30:20+08', '2099-01-01 00:00:00+08',
        '2026-07-23 18:30:00+08', '2026-07-23 18:30:20+08'
      ),
      (
        '${ids.terminalUnknownRun}', (SELECT id FROM users WHERE email = '${secondaryAccount.email}'),
        'archived', 1, '{}'::uuid[], NULL,
        NULL, 600, 60, 1,
        '2026-07-23 18:10:01+08', '2026-07-23 18:10:20+08', '2026-07-23 18:11:00+08',
        '2026-07-23 18:10:00+08', '2026-07-23 18:11:00+08'
      ),
      (
        '${ids.inFlightUnknownRun}', (SELECT id FROM users WHERE email = '${secondaryAccount.email}'),
        'analyzing', 0, ARRAY['${ids.referenceAsset}'::uuid], NULL,
        NULL, NULL, NULL, 0,
        '2026-07-23 18:20:01+08', NULL, '2099-01-01 00:00:00+08',
        '2026-07-23 18:20:00+08', '2026-07-23 18:20:01+08'
      );

    INSERT INTO prompt_wizard_batches (
      id, run_id, user_id, ordinal, idempotency_key, request_hash, run_revision,
      status, is_free, credits, credit_status, main_credits_used, addon_credits_used,
      image_asset_ids, product_profile, creative_brief, video_config, plans,
      provider_model, provider_input_tokens, provider_output_tokens, attempt_count,
      content_purged_at, started_at, completed_at, created_at, updated_at
    ) VALUES
      (
        '${ids.freeBatch}', '${ids.parentRun}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        1, 'fullstack-mm-free-${ids.freeBatch}', 'fullstack-mm-free', 1,
        'completed', true, 0, 'none', 0, 0,
        '{}'::uuid[], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, NULL,
        'doubao-seed-2-0-lite-260428', 30, 3, 1,
        '2026-07-23 19:31:00+08', '2026-07-23 19:30:01+08',
        '2026-07-23 19:30:20+08', '2026-07-23 19:30:00+08', '2026-07-23 19:31:00+08'
      ),
      (
        '${ids.paidBatch}', '${ids.parentRun}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        2, 'fullstack-mm-paid-${ids.paidBatch}', 'fullstack-mm-paid', 1,
        'completed', false, 1, 'settled', 1, 0,
        '{}'::uuid[], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, NULL,
        'doubao-seed-2-0-lite-260428', NULL, NULL, 1,
        '2026-07-23 19:41:00+08', '2026-07-23 19:40:01+08',
        '2026-07-23 19:40:20+08', '2026-07-23 19:40:00+08', '2026-07-23 19:41:00+08'
      ),
      (
        '${ids.geminiBatch}', '${ids.geminiRun}',
        (SELECT id FROM users WHERE email = '${secondaryAccount.email}'),
        1, 'fullstack-mm-gemini-${ids.geminiBatch}', 'fullstack-mm-gemini', 1,
        'completed', false, 9, 'settled', 9, 0,
        '{}'::uuid[], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, NULL,
        'gemini-3.5-flash', 3000, 300, 1,
        '2026-07-23 18:06:00+08', '2026-07-23 18:05:01+08',
        '2026-07-23 18:05:20+08', '2026-07-23 18:05:00+08', '2026-07-23 18:06:00+08'
      );

    INSERT INTO prompt_wizard_provider_requests (
      id, request_key, run_id, batch_id, user_id, operation,
      job_attempt, repair_round, plan_index, transport_attempt,
      provider, model, service_tier, request_status, provider_response_id, http_status,
      input_tokens, cached_input_tokens, output_tokens,
      pricing_rule_id, price_version, pricing_tier,
      input_price_per_million_cny, cached_input_price_per_million_cny,
      output_price_per_million_cny, cost_cny, cost_status,
      started_at, completed_at, created_at
    ) VALUES
      (
        '${ids.requests[0]}', 'fullstack-mm-${ids.requests[0]}', '${ids.knownRun}', NULL,
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'analyze-product', 1, 0, NULL, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
        'default', 'succeeded', 'fullstack-mm-analysis', 200, 100, 20, 10,
        '${lowRuleId}', 'volcengine-list-2026-07-23', '0-32k', 0.600000, 0.120000,
        3.600000, 0.000086, 'known',
        '2026-07-23 19:00:02+08', '2026-07-23 19:00:08+08', '2026-07-23 19:00:02+08'
      ),
      (
        '${ids.requests[1]}', 'fullstack-mm-${ids.requests[1]}', '${ids.knownRun}', NULL,
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'repair-product-chinese', 1, 0, NULL, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
        'default', 'failed', 'fullstack-mm-chinese-repair', 200, 50, 0, 5,
        '${lowRuleId}', 'volcengine-list-2026-07-23', '0-32k', 0.600000, 0.120000,
        3.600000, 0.000048, 'known',
        '2026-07-23 19:00:09+08', '2026-07-23 19:00:15+08', '2026-07-23 19:00:09+08'
      ),
      (
        '${ids.requests[2]}', 'fullstack-mm-${ids.requests[2]}', '${ids.parentRun}', '${ids.freeBatch}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'generate-drafts', 1, 0, 0, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
        'default', 'failed', NULL, 503, 10, 0, 1,
        '${lowRuleId}', 'volcengine-list-2026-07-23', '0-32k', 0.600000, 0.120000,
        3.600000, 0.000010, 'known',
        '2026-07-23 19:30:02+08', '2026-07-23 19:30:05+08', '2026-07-23 19:30:02+08'
      ),
      (
        '${ids.requests[3]}', 'fullstack-mm-${ids.requests[3]}', '${ids.parentRun}', '${ids.freeBatch}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'generate-drafts', 1, 0, 0, 2, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
        'default', 'succeeded', 'fullstack-mm-transport-retry', 200, 20, 0, 2,
        '${lowRuleId}', 'volcengine-list-2026-07-23', '0-32k', 0.600000, 0.120000,
        3.600000, 0.000019, 'known',
        '2026-07-23 19:30:06+08', '2026-07-23 19:30:10+08', '2026-07-23 19:30:06+08'
      ),
      (
        '${ids.requests[4]}', 'fullstack-mm-${ids.requests[4]}', '${ids.parentRun}', '${ids.paidBatch}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'generate-drafts', 1, 0, 0, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
        'default', 'succeeded', 'fullstack-mm-paid-1', 200, 100, 0, 10,
        '${lowRuleId}', 'volcengine-list-2026-07-23', '0-32k', 0.600000, 0.120000,
        3.600000, 0.000096, 'known',
        '2026-07-23 19:40:02+08', '2026-07-23 19:40:08+08', '2026-07-23 19:40:02+08'
      ),
      (
        '${ids.requests[5]}', 'fullstack-mm-${ids.requests[5]}', '${ids.parentRun}', '${ids.paidBatch}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'generate-drafts', 1, 0, 1, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
        'default', 'succeeded', 'fullstack-mm-paid-2', 200, 100, 0, 10,
        '${lowRuleId}', 'volcengine-list-2026-07-23', '0-32k', 0.600000, 0.120000,
        3.600000, 0.000096, 'known',
        '2026-07-23 19:40:03+08', '2026-07-23 19:40:09+08', '2026-07-23 19:40:03+08'
      ),
      (
        '${ids.requests[6]}', 'fullstack-mm-${ids.requests[6]}', '${ids.parentRun}', '${ids.paidBatch}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'generate-drafts', 1, 0, 2, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
        'default', 'failed', NULL, 500, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'unknown',
        '2026-07-23 19:40:04+08', '2026-07-23 19:40:10+08', '2026-07-23 19:40:04+08'
      ),
      (
        '${ids.requests[7]}', 'fullstack-mm-${ids.requests[7]}', '${ids.mixedRun}', NULL,
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'analyze-product', 1, 0, NULL, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
        'default', 'succeeded', 'fullstack-mm-mixed-target', 200, 10, 0, 1,
        '${lowRuleId}', 'volcengine-list-2026-07-23', '0-32k', 0.600000, 0.120000,
        3.600000, 0.000010, 'known',
        '2026-07-23 18:30:02+08', '2026-07-23 18:30:08+08', '2026-07-23 18:30:02+08'
      ),
      (
        '${ids.requests[8]}', 'fullstack-mm-${ids.requests[8]}', '${ids.mixedRun}', NULL,
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'repair-product-chinese', 1, 1, NULL, 1, 'volcengine-ark', 'aaa-legacy-model',
        'default', 'succeeded', 'fullstack-mm-mixed-legacy', 200, 999, 0, 99,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'unknown',
        '2026-07-23 18:30:09+08', '2026-07-23 18:30:15+08', '2026-07-23 18:30:09+08'
      ),
      (
        '${ids.requests[9]}', 'fullstack-mm-${ids.requests[9]}', '${ids.reconciledRun}', NULL,
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'analyze-product', 1, 0, NULL, 1, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
        'default', 'failed', NULL, 503, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'unknown',
        '2026-07-23 17:10:02+08', '2026-07-23 17:10:08+08', '2026-07-23 17:10:02+08'
      );

    INSERT INTO prompt_wizard_provider_request_reconciliations (
      request_id, reconciliation_status,
      effective_input_tokens, effective_cached_input_tokens,
      effective_output_tokens, effective_cost_cny,
      evidence_source, evidence_source_url,
      official_window_start, official_window_end,
      official_request_count, official_input_tokens, official_output_tokens, official_total_tokens,
      local_known_request_count, local_known_input_tokens, local_known_output_tokens,
      local_known_total_tokens, observed_at, reconciled_at, reconciled_by, evidence_note, created_at
    ) VALUES (
      '${ids.requests[9]}', 'confirmed-zero', 0, 0, 0, 0.000000,
      'volcengine-ark-hourly-usage',
      'https://console.volcengine.com/ark/region:ark+cn-beijing/usage',
      '2026-07-23 17:00:00+08', '2026-07-23 18:00:00+08',
      0, 0, 0, 0, 0, 0, 0, 0,
      '2026-07-23 18:01:00+08', '2026-07-23 18:05:00+08',
      'fullstack-test', '官方小时桶与本地已知请求均为零，确认该失败请求未产生用量。',
      '2026-07-23 18:05:00+08'
    );

    INSERT INTO prompt_wizard_historical_operation_cost_evidence (
      analysis_run_id, batch_id, provider, model,
      input_tokens, cached_input_tokens, output_tokens,
      input_tier_min_exclusive, input_tier_max_inclusive,
      input_rate_cny_per_million, cached_input_rate_cny_per_million,
      output_rate_cny_per_million, pricing_version, pricing_source_url,
      cost_cny, calculation_basis, evidence_source,
      observed_at, priced_at, priced_by, note, created_at
    ) VALUES (
      '${ids.historicalRun}', NULL, 'volcengine-ark', 'doubao-seed-2-0-lite-260428',
      900, 0, 120, NULL, 32000,
      0.600000, 0.120000, 3.600000,
      'volcengine-list-2026-07-23',
      'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
      0.000972, 'historical-operation-aggregate-token',
      '全栈测试：官方模型日范围 CacheTokensHit=0 + 本地 operation 聚合 Token',
      '2026-07-23 19:14:00+08', '2026-07-23 19:15:00+08',
      'fullstack-test', '仅按历史 operation 聚合 Token 与官方列表价折算，不伪造逐请求拆分。',
      '2026-07-23 19:15:00+08'
    );

    DO $$
    BEGIN
      BEGIN
        UPDATE prompt_wizard_historical_operation_cost_evidence
        SET note = '篡改测试'
        WHERE analysis_run_id = '${ids.historicalRun}';
        RAISE EXCEPTION '测试失败：历史成本证据更新未被拒绝';
      EXCEPTION WHEN OTHERS THEN
        IF position('禁止修改' IN SQLERRM) = 0 THEN RAISE; END IF;
      END;

      BEGIN
        DELETE FROM prompt_wizard_historical_operation_cost_evidence
        WHERE analysis_run_id = '${ids.historicalRun}';
        RAISE EXCEPTION '测试失败：历史成本证据删除未被拒绝';
      EXCEPTION WHEN OTHERS THEN
        IF position('禁止删除' IN SQLERRM) = 0 THEN RAISE; END IF;
      END;
    END;
    $$;
  `);

  const session = await createAuthenticatedPage(browser, primaryAccount);
  const range = 'range=custom&from=2026-07-23&to=2026-07-23';
  // 固定在夹具全部写入后的业务快照，避免真实 worker 按当前墙钟恢复历史 analyzing 任务。
  const overviewAsOf = encodeURIComponent('2026-07-23T12:00:00.000Z');
  try {
    const overview = await api(
      session.page,
      `/api/admin/api-usage/multimodal/overview?${range}&asOf=${overviewAsOf}`,
    );
    expect(overview.status).toBe(200);
    expect(overview.body.summary).toMatchObject({
      analysisCount: 6,
      batchCount: 2,
      userCount: 2,
      settledCredits: 1,
      refundedCredits: 0,
      knownInputTokens: 1290,
      knownCachedInputTokens: 20,
      knownOutputTokens: 159,
      knownCostCny: '0.001337',
      providerRequestCount: 9,
      reconciledZeroRequestCount: 1,
      unknownUsageRequestCount: 1,
      unpricedRequestCount: 0,
      incompleteOperationCount: 3,
      historicalEvidenceOperationCount: 0,
      historicalPricedOperationCount: 1,
      operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      businessEstimatedCostCny: '0.001337',
      operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '0.001337',
      estimateCompleteness: 'partial',
    });
    expect(overview.body.models).toEqual([
      expect.objectContaining({
        id: 'doubao-seed-2-0-lite-260428',
        model: 'Doubao Seed 2.0 Lite',
        settledCredits: 1,
        knownCostCny: '0.001337',
        reconciledZeroRequestCount: 1,
        historicalEvidenceOperationCount: 0,
        historicalPricedOperationCount: 1,
        operationalCallCount: 0,
        operationalUnpricedCallCount: 0,
        businessEstimatedCostCny: '0.001337',
        operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.001337',
        estimateCompleteness: 'partial',
      }),
    ]);
    const snapshotRange = `${range}&asOf=${encodeURIComponent(overview.body.asOf)}`;

    const beforeReconciliation = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${range}`
        + `&asOf=${encodeURIComponent('2026-07-23T09:30:00.000Z')}`
        + `&position=first&limit=20&search=${ids.reconciledRun}`,
    );
    expect(beforeReconciliation.status).toBe(200);
    expect(beforeReconciliation.body.items).toEqual([
      expect.objectContaining({
        id: ids.reconciledRun,
        providerRequestCount: 1,
        reconciledZeroRequestCount: 0,
        unknownUsageRequestCount: 1,
        knownInputTokens: null,
        knownCachedInputTokens: null,
        knownOutputTokens: null,
        knownCostCny: null,
        estimateCompleteness: 'unavailable',
        usageEvidence: 'ledger',
      }),
    ]);

    const afterReconciliation = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${snapshotRange}`
        + `&position=first&limit=20&search=${ids.reconciledRun}`,
    );
    expect(afterReconciliation.status).toBe(200);
    expect(afterReconciliation.body.items).toEqual([
      expect.objectContaining({
        id: ids.reconciledRun,
        providerRequestCount: 1,
        reconciledZeroRequestCount: 1,
        unknownUsageRequestCount: 0,
        knownInputTokens: 0,
        knownCachedInputTokens: 0,
        knownOutputTokens: 0,
        knownCostCny: '0.000000',
        estimateCompleteness: 'complete',
        usageEvidence: 'ledger-reconciled',
      }),
    ]);

    const beforeHistoricalPricing = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${range}`
        + `&asOf=${encodeURIComponent('2026-07-23T11:14:30.000Z')}`
        + `&position=first&limit=20&search=${ids.historicalRun}`,
    );
    expect(beforeHistoricalPricing.status).toBe(200);
    expect(beforeHistoricalPricing.body.items).toEqual([
      expect.objectContaining({
        id: ids.historicalRun,
        providerRequestCount: 0,
        knownInputTokens: 900,
        knownCachedInputTokens: null,
        knownOutputTokens: 120,
        knownCostCny: null,
        estimateCompleteness: 'unavailable',
        usageEvidence: 'historical',
        priceVersion: null,
        pricingSourceUrl: null,
      }),
    ]);

    const allRange = await api(session.page, '/api/admin/api-usage/multimodal/overview?range=all');
    expect(allRange.status).toBe(200);
    expect(allRange.body.selection.rangeStart).not.toBe('1999-01-01');

    const firstPage = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${snapshotRange}&position=first&limit=2`,
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items.map((item: { id: string }) => item.id)).toEqual([
      ids.paidBatch,
      ids.freeBatch,
    ]);
    expect(firstPage.body.pagination.hasNext).toBe(true);
    expect(firstPage.body.items).toEqual([
      expect.objectContaining({
        operationType: 'plan-batch', isFree: false, settledCredits: 1,
        providerRequestCount: 3, unknownUsageRequestCount: 1,
        knownCostCny: '0.000192', estimateCompleteness: 'partial', usageEvidence: 'ledger',
      }),
      expect.objectContaining({
        operationType: 'plan-batch', isFree: true, settledCredits: 0,
        providerRequestCount: 2, knownCostCny: '0.000029',
        estimateCompleteness: 'complete', usageEvidence: 'ledger',
      }),
    ]);

    const inFlightAsOf = encodeURIComponent('2026-07-23T11:30:15.000Z');
    const inFlight = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${range}&asOf=${inFlightAsOf}&position=first&limit=20&status=processing&search=${ids.freeBatch}`,
    );
    expect(inFlight.status).toBe(200);
    expect(inFlight.body.items).toEqual([
      expect.objectContaining({
        id: ids.freeBatch,
        status: 'processing',
        providerRequestCount: 2,
        unknownUsageRequestCount: 0,
        knownCostCny: '0.000029',
        estimateCompleteness: 'partial',
      }),
    ]);

    const filter = new URLSearchParams({
      range: 'custom', from: '2026-07-23', to: '2026-07-23', asOf: overview.body.asOf,
      position: 'first', limit: '20', operationType: 'analysis', status: 'failed',
      search: ids.knownRun,
    });
    const failedAnalysis = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${filter.toString()}`,
    );
    expect(failedAnalysis.status).toBe(200);
    expect(failedAnalysis.body.items).toEqual([
      expect.objectContaining({
        id: ids.knownRun, operationType: 'analysis', status: 'failed',
        providerRequestCount: 2, knownCostCny: '0.000134',
        estimateCompleteness: 'complete', usageEvidence: 'ledger',
      }),
    ]);

    const mixedModelOwner = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${snapshotRange}&position=first&limit=20&search=${ids.mixedRun}`,
    );
    expect(mixedModelOwner.status).toBe(200);
    expect(mixedModelOwner.body.items).toEqual([
      expect.objectContaining({
        id: ids.mixedRun,
        model: 'Doubao Seed 2.0 Lite',
        providerRequestCount: 1,
        knownInputTokens: 10,
        knownOutputTokens: 1,
        knownCostCny: '0.000010',
      }),
    ]);

    const excludedGemini = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${snapshotRange}&position=first&limit=20&search=${ids.geminiRun}`,
    );
    expect(excludedGemini.status).toBe(200);
    expect(excludedGemini.body.items).toEqual([]);

    const excludedTerminalUnknown = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${snapshotRange}&position=first&limit=20&search=${ids.terminalUnknownRun}`,
    );
    expect(excludedTerminalUnknown.status).toBe(200);
    expect(excludedTerminalUnknown.body.items).toEqual([]);

    const retainedInFlightUnknown = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${snapshotRange}&position=first&limit=20&search=${ids.inFlightUnknownRun}`,
    );
    expect(retainedInFlightUnknown.status).toBe(200);
    expect(retainedInFlightUnknown.body.items).toEqual([
      expect.objectContaining({
        id: ids.inFlightUnknownRun,
        model: 'Doubao Seed 2.0 Lite',
        status: 'analyzing',
        providerRequestCount: 0,
        knownCostCny: null,
        estimateCompleteness: 'unavailable',
      }),
    ]);

    const archived = await api(
      session.page,
      `/api/admin/api-usage/multimodal/operations?${snapshotRange}&position=first&limit=20&status=archived`,
    );
    expect(archived.status).toBe(200);
    expect(archived.body.items).toEqual([
      expect.objectContaining({
        id: ids.historicalRun, knownInputTokens: 900, knownOutputTokens: 120,
        knownCachedInputTokens: 0, knownCostCny: '0.000972',
        providerRequestCount: 0, estimateCompleteness: 'complete',
        usageEvidence: 'historical-aggregate-priced',
        priceVersion: 'volcengine-list-2026-07-23',
        pricingSourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
      }),
    ]);

    const users = await api(
      session.page,
      `/api/admin/api-usage/multimodal/users?${snapshotRange}&position=first&limit=20`,
    );
    expect(users.status).toBe(200);
    expect(users.body.items).toHaveLength(2);
    expect(users.body.items).toContainEqual(expect.objectContaining({
      email: primaryAccount.email,
      analysisCount: 4,
      batchCount: 2,
      settledCredits: 1,
      knownCostCny: '0.000365',
      reconciledZeroRequestCount: 1,
      historicalEvidenceOperationCount: 0,
      historicalPricedOperationCount: 0,
      operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      businessEstimatedCostCny: '0.000365',
      operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '0.000365',
      estimateCompleteness: 'partial',
    }));
    expect(users.body.items).toContainEqual(expect.objectContaining({
      email: secondaryAccount.email,
      analysisCount: 2,
      batchCount: 0,
      knownCostCny: '0.000972',
      reconciledZeroRequestCount: 0,
      historicalEvidenceOperationCount: 0,
      historicalPricedOperationCount: 1,
      operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      businessEstimatedCostCny: '0.000972',
      operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '0.000972',
      estimateCompleteness: 'partial',
    }));

    const videoOverview = await api(session.page, `/api/admin/api-usage/overview?${snapshotRange}`);
    expect(videoOverview.status).toBe(200);
    expect(videoOverview.body.operations.taskCount).toBe(0);
  } finally {
    await session.context.close();
    // 成本账本终态由数据库触发器保护，测试也不得为清理而删除审计证据；
    // 本套件使用一次性 Docker volume，完整环境结束后统一销毁。
  }
});

test('零成本案件在真实 PostgreSQL 上从待终账切换为审计确认且不补写原始 Token', async ({ browser }) => {
  const ids = {
    task: '20000000-0000-4000-8000-000000000031',
    usage: '20000000-0000-4000-8000-000000000041',
    reconciliationCase: '20000000-0000-4000-8000-000000000051',
    linkOne: '20000000-0000-4000-8000-000000000061',
    linkTwo: '20000000-0000-4000-8000-000000000062',
  };
  postgres(`
    INSERT INTO generation_tasks (
      id, user_id, kind, model, status, prompt, config,
      credits, reserved_credits, settled_credits, refunded_credits, credit_status,
      attempt, provider_task_attempt, processing_stage, failure_category,
      failure_reason, created_at, started_at, completed_at, updated_at
    ) VALUES (
      '${ids.task}',
      (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
      'video', 'Seedance 2.0 Fast', 'failed', '全栈零成本终账案件',
      '{"resolution":"720p"}'::jsonb,
      48, 48, 0, 48, 'refunded', 0, NULL, 'failed', 'provider-failed',
      '历史失败回执已过查询期',
      '2026-07-10 09:00:00+08', '2026-07-10 09:01:00+08',
      '2026-07-10 09:05:00+08', '2026-07-10 09:05:00+08'
    );

    INSERT INTO provider_usage_records (
      id, provider, model, task_id, attempt, provider_task_id, status,
      raw_units, deducted_units, usage_unit, completed_at, completion_tokens,
      total_tokens, billable_tokens, billable_basis, resolution, has_video_input,
      price_version, unit_price_per_million, estimated_cost, currency, pricing_status,
      usage_evidence_origin, pricing_rule_status, pricing_input_class,
      pricing_resolution_band, attribution_confidence, provider_terminal_at,
      usage_observed_at, local_accounting_date, accounting_date_origin, error, created_at
    ) VALUES (
      '${ids.usage}', 'volcengine-ark', 'Seedance 2.0 Fast', '${ids.task}', -1,
      NULL, 'failed', NULL, NULL, 'tokens', '2026-07-10 09:05:00+08',
      NULL, NULL, NULL, NULL, '720p', false, NULL, NULL, NULL, 'CNY',
      'legacy-inferred', 'unavailable', 'rule-missing', 'without-video',
      '480p-720p', 'unallocated', NULL, '2026-07-10 09:05:00+08',
      '2026-07-10', 'legacy-completed', '历史失败回执已过查询期',
      '2026-07-10 09:05:00+08'
    );

    INSERT INTO provider_reconciliation_cases (
      id, provider, case_key, bill_period, case_type, status, root_cause,
      confidence, token_adjustment, cost_adjustment_cny,
      official_expense_date, local_accounting_date, evidence, evidence_hash
    ) VALUES (
      '${ids.reconciliationCase}', 'volcengine-ark', 'fullstack-zero-cost:${ids.task}',
      '2026-07', 'missing-local-usage', 'open', 'provider-terminal-usage-unavailable',
      'high', 0, 0, '2026-07-10', '2026-07-10',
      jsonb_build_object(
        'resolutionKind', 'zero-cost', 'taskId', '${ids.task}',
        'usageRecordId', '${ids.usage}',
        'review', jsonb_build_object('status', 'pending-final-bill')
      ),
      repeat('7', 64)
    );

    INSERT INTO provider_reconciliation_case_links (
      id, case_id, usage_record_id, allocated_tokens, allocated_cost_cny
    ) VALUES
      ('${ids.linkOne}', '${ids.reconciliationCase}', '${ids.usage}', 0, 0),
      ('${ids.linkTwo}', '${ids.reconciliationCase}', '${ids.usage}', 0, 0);
  `);

  const session = await createAuthenticatedPage(browser, primaryAccount);
  const range = 'range=custom&from=2026-07-10&to=2026-07-10';
  try {
    const pendingOverview = await api(session.page, `/api/admin/api-usage/overview?${range}`);
    const pendingTasks = await api(session.page, `/api/admin/api-usage/tasks?${range}&limit=20`);
    const pendingAttempts = await api(session.page, `/api/admin/api-usage/attempts?${range}&limit=20`);
    for (const response of [pendingOverview, pendingTasks, pendingAttempts]) {
      expect(response.status).toBe(200);
    }
    expect(pendingOverview.body.operations).toMatchObject({
      taskCount: 1,
      estimatedCostCny: '0.000000',
      incompleteTaskCount: 1,
      pendingFinalBillTaskCount: 1,
      approvedZeroCostTaskCount: 0,
    });
    expect(pendingTasks.body.items).toEqual([
      expect.objectContaining({
        id: ids.task,
        costResolutionStatus: 'pending-final-bill',
        costResolutionCaseId: ids.reconciliationCase,
        missingUsageAttempts: 1,
        costFinalized: false,
      }),
    ]);
    expect(pendingAttempts.body.items).toEqual([
      expect.objectContaining({
        id: ids.usage,
        completionTokens: null,
        totalTokens: null,
        billableTokens: null,
        estimatedCostCny: null,
        usageEvidenceOrigin: 'unavailable',
        costResolutionStatus: 'pending-final-bill',
        costResolutionCaseId: ids.reconciliationCase,
        costResolutionCaseStatus: 'open',
      }),
    ]);

    postgres(`
      UPDATE provider_reconciliation_cases
      SET status = 'approved',
          evidence = jsonb_set(
            evidence,
            '{review}',
            '{"status":"approved-zero","reason":"全栈终账确认"}'::jsonb,
            true
          )
      WHERE id = '${ids.reconciliationCase}';
    `);

    const approvedOverview = await api(session.page, `/api/admin/api-usage/overview?${range}`);
    const approvedTasks = await api(session.page, `/api/admin/api-usage/tasks?${range}&limit=20`);
    const approvedAttempts = await api(session.page, `/api/admin/api-usage/attempts?${range}&limit=20`);
    for (const response of [approvedOverview, approvedTasks, approvedAttempts]) {
      expect(response.status).toBe(200);
    }
    expect(approvedOverview.body.operations).toMatchObject({
      taskCount: 1,
      estimatedCostCny: '0.000000',
      estimateCompleteness: 'complete',
      incompleteTaskCount: 0,
      pendingFinalBillTaskCount: 0,
      approvedZeroCostTaskCount: 1,
    });
    expect(approvedTasks.body.items).toEqual([
      expect.objectContaining({
        id: ids.task,
        billableTokens: 0,
        estimatedCostCny: '0.000000',
        estimateCompleteness: 'complete',
        costResolutionStatus: 'approved-zero',
        costResolutionCaseId: ids.reconciliationCase,
        missingUsageAttempts: 0,
        costFinalized: true,
      }),
    ]);
    expect(approvedAttempts.body.items).toEqual([
      expect.objectContaining({
        id: ids.usage,
        completionTokens: null,
        totalTokens: null,
        billableTokens: null,
        estimatedCostCny: null,
        usageEvidenceOrigin: 'unavailable',
        costResolutionStatus: 'approved-zero',
        costResolutionCaseId: ids.reconciliationCase,
        costResolutionCaseStatus: 'approved',
      }),
    ]);
  } finally {
    await session.context.close();
    postgres(`
      DELETE FROM provider_reconciliation_cases WHERE id = '${ids.reconciliationCase}';
      DELETE FROM provider_usage_records WHERE id = '${ids.usage}';
      DELETE FROM generation_tasks WHERE id = '${ids.task}';
    `);
  }
});

test('成本报表以一万任务三次 attempt 验证分页、积分去重和性能门槛', async ({ browser }) => {
  const billingRunId = randomUUID();
  const billingRevisionId = randomUUID();
  const day = postgresScalar(
    "SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD');",
  );
  const marker = `fullstack-perf-${randomUUID()}-`;

  postgres(`
    DELETE FROM provider_usage_records WHERE provider_task_id LIKE '${marker}%';
    DELETE FROM generation_tasks WHERE prompt LIKE '全栈性能任务-%';
    INSERT INTO provider_billing_sync_runs (
      id, provider, kind, status, window_start, window_end,
      page_count, row_count, started_at, completed_at, is_final
    ) VALUES (
      '${billingRunId}', 'volcengine-ark', 'bill', 'success', '${day}', '${day}',
      1, 1, now() - interval '1 second', now(), false
    );

    INSERT INTO provider_bill_detail_revisions (
      id, provider, source_detail_key, sync_run_id, payload_hash, raw_payload,
      normalized_payload, normalization_version, observed_at
    ) VALUES (
      '${billingRevisionId}', 'volcengine-ark', '${marker}bill-${day}',
      '${billingRunId}', repeat('9', 64), '{}'::jsonb,
      jsonb_build_object(
        'billPeriod', substring('${day}' from 1 for 7),
        'expenseDate', '${day}', 'product', 'ark_bd', 'billLineType', 'usage',
        'recognizedModel', 'Seedance 2.0 Mini', 'seedanceCandidate', true,
        'pricingResolution', '480P/720P', 'pricingInputHasVideo', false,
        'normalizedUnitPricePerMillion', 23, 'billableTokens', 30000000,
        'deductionCount', 30000000, 'listEquivalentCostCny', 690.000000,
        'originalBillAmountCny', 0, 'preferentialBillAmountCny', 0,
        'discountBillAmountCny', 0, 'couponAmountCny', 0,
        'payableAmountCny', 0, 'paidAmountCny', 0, 'unpaidAmountCny', 0,
        'currency', 'CNY', 'instanceNo', '${marker}instance'
      ),
      'fullstack-performance-v1', now()
    );

    INSERT INTO provider_bill_sync_run_items (
      sync_run_id, bill_detail_revision_id, source_detail_key
    ) VALUES (
      '${billingRunId}', '${billingRevisionId}', '${marker}bill-${day}'
    );

    WITH generated_tasks AS (
      SELECT task_number,
             md5('${marker}task-' || task_number)::uuid AS task_id,
             now() - task_number * interval '1 millisecond' AS occurred_at
      FROM generate_series(1, 10000) task_number
    )
    INSERT INTO generation_tasks (
      id, user_id, kind, model, status, prompt, config, provider_task_id,
      credits, reserved_credits, settled_credits, refunded_credits, credit_status,
      attempt, provider_task_attempt, processing_stage, created_at, started_at,
      completed_at, updated_at
    )
    SELECT generated.task_id,
           (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
           'video', 'Seedance 2.0 Mini', 'completed',
           '全栈性能任务-' || generated.task_number,
           '{"resolution":"480p"}'::jsonb,
           '${marker}task-' || generated.task_number,
           10, 10, 10, 0, 'settled', 2, 2, 'completed',
           generated.occurred_at, generated.occurred_at,
           generated.occurred_at, generated.occurred_at
    FROM generated_tasks generated;

    INSERT INTO provider_usage_records (
      id, provider, model, task_id, attempt, provider_task_id, status,
      raw_units, deducted_units, usage_unit, completed_at, completion_tokens,
      total_tokens, billable_tokens, billable_basis, resolution, has_video_input,
      price_version, unit_price_per_million, estimated_cost, currency, pricing_status,
      usage_evidence_origin, pricing_rule_status, pricing_input_class,
      pricing_resolution_band, attribution_confidence, provider_terminal_at,
      usage_observed_at, local_accounting_date, accounting_date_origin, created_at
    )
    SELECT md5(
             '${marker}attempt-' || task_number || '-' || attempt_number
           )::uuid,
           'volcengine-ark', 'Seedance 2.0 Mini', task.id, attempt_number,
           '${marker}task-' || task_number || '-attempt-' || attempt_number,
           'success', 1000, 1000, 'tokens', task.created_at,
           1000, 1000, 1000, 'completion_tokens', '480p', false,
           'volcengine-seedance-2026-07-10', 23, 0.023000, 'CNY', 'priced',
           'provider-reported', 'priced', 'without-video', '480p-720p',
           'direct', task.created_at, task.created_at, '${day}',
           'provider-terminal', task.created_at
    FROM generate_series(1, 10000) task_number
    CROSS JOIN generate_series(0, 2) attempt_number
    JOIN generation_tasks task
      ON task.id = md5('${marker}task-' || task_number)::uuid;
  `);

  const session = await createAuthenticatedPage(browser, primaryAccount);
  const range = `range=custom&from=${day}&to=${day}`;
  try {
    const overview = await api(session.page, `/api/admin/api-usage/overview?${range}`);
    expect(overview.status).toBe(200);
    expect(overview.body.operations).toMatchObject({
      taskCount: 10000,
      userCount: 1,
      settledCredits: 100000,
      refundedCredits: 0,
      estimatedCostCny: '690.000000',
      estimateCompleteness: 'complete',
      officialEquivalentCostCny: '690.000000',
      differenceCny: '0.000000',
      officialPayableCny: '0.000000',
      reconciliationStatus: 'matched',
    });
    expect(overview.body.models).toEqual([
      expect.objectContaining({
        model: 'Seedance 2.5', priceVersions: [], taskCount: 0,
        operationalCallCount: 0, settledCredits: 0, heldCredits: 0, refundedCredits: 0,
        estimatedCostCny: '0.000000', businessEstimatedCostCny: '0.000000',
        operationalEstimatedCostCny: '0.000000', knownAccountCostCny: '0.000000',
        operationalUnpricedCallCount: 0, estimateCompleteness: 'complete',
        incompleteTaskCount: 0, averageTaskCostCny: null,
      }),
      expect.objectContaining({
        model: 'Seedance 2.0', priceVersions: [], taskCount: 0,
        operationalCallCount: 0, settledCredits: 0, heldCredits: 0, refundedCredits: 0,
        estimatedCostCny: '0.000000', businessEstimatedCostCny: '0.000000',
        operationalEstimatedCostCny: '0.000000', knownAccountCostCny: '0.000000',
        operationalUnpricedCallCount: 0, estimateCompleteness: 'complete',
        incompleteTaskCount: 0, averageTaskCostCny: null,
      }),
      expect.objectContaining({
        model: 'Seedance 2.0 Fast', priceVersions: [], taskCount: 0,
        operationalCallCount: 0, settledCredits: 0, heldCredits: 0, refundedCredits: 0,
        estimatedCostCny: '0.000000', businessEstimatedCostCny: '0.000000',
        operationalEstimatedCostCny: '0.000000', knownAccountCostCny: '0.000000',
        operationalUnpricedCallCount: 0, estimateCompleteness: 'complete',
        incompleteTaskCount: 0, averageTaskCostCny: null,
      }),
      expect.objectContaining({
        model: 'Seedance 2.0 Mini',
        taskCount: 10000,
        operationalCallCount: 0,
        settledCredits: 100000,
        estimatedCostCny: '690.000000',
        businessEstimatedCostCny: '690.000000',
        operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '690.000000',
        operationalUnpricedCallCount: 0,
        estimateCompleteness: 'complete',
        incompleteTaskCount: 0,
        averageTaskCostCny: '0.069000',
      }),
    ]);

    const snapshotRange = `${range}&asOf=${encodeURIComponent(overview.body.asOf)}`;
    const tasksPath = `/api/admin/api-usage/tasks?${snapshotRange}&limit=50`;
    const usersPath = `/api/admin/api-usage/users?${snapshotRange}&limit=50`;
    const tasks = await api(session.page, tasksPath);
    const users = await api(session.page, usersPath);
    expect(tasks.status).toBe(200);
    expect(users.status).toBe(200);
    expect(tasks.body.items).toHaveLength(50);
    expect(tasks.body.pagination).toMatchObject({
      limit: 50,
      hasPrevious: false,
      hasNext: true,
      previousCursor: null,
      nextCursor: expect.any(String),
    });
    expect(tasks.body.pagination).not.toHaveProperty('hasMore');
    expect(new Set(tasks.body.items.map((item: { id: string }) => item.id)).size).toBe(50);
    expect(tasks.body.items.every((item: {
      attemptCount: number;
      settledCredits: number;
      billableTokens: number;
      estimatedCostCny: string;
    }) => (
      item.attemptCount === 3
      && item.settledCredits === 10
      && item.billableTokens === 3000
      && item.estimatedCostCny === '0.069000'
    ))).toBe(true);
    const createdAt = tasks.body.items.map((item: { createdAt: string }) => item.createdAt);
    expect(createdAt).toEqual([...createdAt].sort((left, right) => right.localeCompare(left)));
    const nextTasks = await api(
      session.page,
      `${tasksPath}&position=next&cursor=${encodeURIComponent(tasks.body.pagination.nextCursor)}`,
    );
    expect(nextTasks.status).toBe(200);
    expect(nextTasks.body.pagination).toMatchObject({
      hasPrevious: true,
      previousCursor: expect.any(String),
    });
    const firstTaskIds = new Set(tasks.body.items.map((item: { id: string }) => item.id));
    expect(nextTasks.body.items.every((item: { id: string }) => !firstTaskIds.has(item.id))).toBe(true);
    const lastTasks = await api(session.page, `${tasksPath}&position=last`);
    expect(lastTasks.status).toBe(200);
    expect(lastTasks.body.pagination).toMatchObject({ hasNext: false, nextCursor: null });
    const lastCreatedAt = lastTasks.body.items.map((item: { createdAt: string }) => item.createdAt);
    expect(lastCreatedAt).toEqual([...lastCreatedAt].sort((left, right) => right.localeCompare(left)));
    expect(users.body.items).toEqual([
      expect.objectContaining({
        taskCount: 10000,
        settledCredits: 100000,
        refundedCredits: 0,
        billableTokens: 30000000,
        estimatedCostCny: '690.000000',
      }),
    ]);

    const paths = {
      overview: `/api/admin/api-usage/overview?${snapshotRange}`,
      tasks: tasksPath,
      users: usersPath,
    };
    for (const path of Object.values(paths)) {
      expect((await timedApi(session.page, path)).status).toBe(200);
    }
    const timings: Record<string, number[]> = {};
    for (const [name, path] of Object.entries(paths)) {
      timings[name] = [];
      for (let sample = 0; sample < 5; sample += 1) {
        const measured = await timedApi(session.page, path);
        expect(measured.status).toBe(200);
        timings[name].push(measured.elapsedMs);
      }
    }
    const p95 = Object.fromEntries(
      Object.entries(timings).map(([name, values]) => [name, percentile(values, 0.95)]),
    ) as Record<string, number>;
    expect(p95.overview).toBeLessThan(500);
    expect(p95.tasks).toBeLessThan(500);
    expect(p95.users).toBeLessThan(500);

    const coverageExecutionMs = postgresExplainExecutionMs(
      buildCoverageBenchmarkSql(overview.body.asOf),
    );
    expect(coverageExecutionMs).toBeLessThan(100);
    await test.info().attach('cost-report-performance.json', {
      body: Buffer.from(JSON.stringify({ fixture: '10000x3', timings, p95, coverageExecutionMs }, null, 2)),
      contentType: 'application/json',
    });
  } finally {
    await session.context.close();
    postgres(`
      DELETE FROM provider_usage_records WHERE provider_task_id LIKE '${marker}%';
      DELETE FROM generation_tasks WHERE prompt LIKE '全栈性能任务-%';
      DELETE FROM provider_bill_sync_run_items WHERE sync_run_id = '${billingRunId}'::uuid;
      -- 官方 revision 及其 sync run 由本次短生命周期全栈数据库统一销毁。
    `);
  }
});

test('后台公告写操作在真实 PostgreSQL 中按请求键幂等', async ({ browser }) => {
  const session = await createAuthenticatedPage(browser, primaryAccount);
  const suffix = randomUUID();
  const createdIds = new Set<string>();
  const sequentialCreateKey = `fullstack-announcement-create-${suffix}`;
  const concurrentCreateKey = `fullstack-announcement-concurrent-${suffix}`;
  const sequentialDeleteKey = `fullstack-announcement-delete-${suffix}`;
  const sequentialPayload = {
    title: `全链路幂等公告-${suffix}`,
    content: '验证相同请求键的顺序重放只产生一次业务副作用。',
    pinned: false,
  };

  try {
    const firstCreate = await api(session.page, '/api/admin/announcements', {
      method: 'POST',
      headers: { 'Idempotency-Key': sequentialCreateKey },
      body: sequentialPayload,
    });
    expect(firstCreate.status).toBe(200);
    createdIds.add(firstCreate.body.announcement.id);

    const replayedCreate = await api(session.page, '/api/admin/announcements', {
      method: 'POST',
      headers: { 'Idempotency-Key': sequentialCreateKey },
      body: sequentialPayload,
    });
    expect(replayedCreate.status).toBe(200);
    expect(replayedCreate.idempotencyReplayed).toBe('true');
    expect(replayedCreate.body).toEqual(firstCreate.body);

    const conflictingCreate = await api(session.page, '/api/admin/announcements', {
      method: 'POST',
      headers: { 'Idempotency-Key': sequentialCreateKey },
      body: { ...sequentialPayload, content: '同一个键不得执行不同的公告请求。' },
    });
    expect(conflictingCreate.status).toBe(409);
    expect(conflictingCreate.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const crossActionConflict = await api(
      session.page,
      `/api/admin/announcements/${firstCreate.body.announcement.id}`,
      { method: 'DELETE', headers: { 'Idempotency-Key': sequentialCreateKey } },
    );
    expect(crossActionConflict.status).toBe(409);
    expect(crossActionConflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const concurrentPayload = {
      title: `全链路并发幂等公告-${suffix}`,
      content: '验证并发请求只能创建一条公告。',
      pinned: false,
    };
    const concurrentOptions = {
      method: 'POST',
      headers: { 'Idempotency-Key': concurrentCreateKey },
      body: concurrentPayload,
    };
    const concurrentCreates = await Promise.all([
      api(session.page, '/api/admin/announcements', concurrentOptions),
      api(session.page, '/api/admin/announcements', concurrentOptions),
    ]);
    expect(concurrentCreates.map(result => result.status)).toEqual([200, 200]);
    for (const result of concurrentCreates) createdIds.add(result.body.announcement.id);
    expect(new Set(concurrentCreates.map(result => result.body.announcement.id)).size).toBe(1);
    expect(concurrentCreates.filter(result => result.idempotencyReplayed === 'true')).toHaveLength(1);
    const concurrentAnnouncementId = concurrentCreates[0].body.announcement.id;

    const announcements = await api(session.page, '/api/admin/announcements');
    expect(announcements.status).toBe(200);
    expect(announcements.body.items.filter(
      (item: { id: string }) => item.id === firstCreate.body.announcement.id,
    )).toHaveLength(1);
    expect(announcements.body.items.filter(
      (item: { id: string }) => item.id === concurrentAnnouncementId,
    )).toHaveLength(1);

    const firstDelete = await api(
      session.page,
      `/api/admin/announcements/${firstCreate.body.announcement.id}`,
      { method: 'DELETE', headers: { 'Idempotency-Key': sequentialDeleteKey } },
    );
    expect(firstDelete.status).toBe(200);
    createdIds.delete(firstCreate.body.announcement.id);

    const replayedDelete = await api(
      session.page,
      `/api/admin/announcements/${firstCreate.body.announcement.id}`,
      { method: 'DELETE', headers: { 'Idempotency-Key': sequentialDeleteKey } },
    );
    expect(replayedDelete.status).toBe(200);
    expect(replayedDelete.idempotencyReplayed).toBe('true');
    expect(replayedDelete.body).toEqual(firstDelete.body);

    const afterDelete = await api(session.page, '/api/admin/announcements');
    expect(afterDelete.body.items.some(
      (item: { id: string }) => item.id === firstCreate.body.announcement.id,
    )).toBe(false);

    const auditLogs = await api(session.page, '/api/admin/audit-logs?limit=50');
    expect(auditLogs.status).toBe(200);
    expect(auditLogs.body.items.filter((item: { action: string; target: string }) => (
      item.action === '发布公告' && item.target === firstCreate.body.announcement.id
    ))).toHaveLength(1);
    expect(auditLogs.body.items.filter((item: { action: string; target: string }) => (
      item.action === '发布公告' && item.target === concurrentAnnouncementId
    ))).toHaveLength(1);
    expect(auditLogs.body.items.filter((item: { action: string; target: string }) => (
      item.action === '删除公告' && item.target === firstCreate.body.announcement.id
    ))).toHaveLength(1);
  } finally {
    await Promise.all([...createdIds].map((id, index) => api(
      session.page,
      `/api/admin/announcements/${id}`,
      { method: 'DELETE', headers: { 'Idempotency-Key': `fullstack-announcement-cleanup-${suffix}-${index}` } },
    )));
    await session.context.close();
  }
});

test('完成上传可安全重试，且用户与管理员素材下载保持权限和状态边界', async ({ browser }) => {
  // Fullstack 启动脚本借用管理员初始化命令创建第二个固定登录账号；本用例显式
  // 降为普通用户，确保 403 与跨所有者边界由真实角色验证，而不是只比较账号 ID。
  postgres(`UPDATE users SET role = 'user' WHERE email = '${secondaryAccount.email}';`);
  const owner = await createAuthenticatedPage(browser, secondaryAccount);
  const other = await createAuthenticatedPage(browser, primaryAccount);
  try {
    // 使用仓库内真实可完整解码的 PNG；只有文件头或损坏 CRC 的旧夹具会被
    // 上传 worker 的 EOF 解码校验正确拒绝，不能据此放松生产媒体校验。
    const pngBase64 = readFileSync('src/imports/alipay-logo.png').toString('base64');
    const sizeBytes = Buffer.from(pngBase64, 'base64').length;
    const signatureResult = await api(owner.page, '/api/assets/upload-signature', {
      method: 'POST',
      body: {
        filename: 'integration.png', contentType: 'image/png', sizeBytes,
        source: 'uploaded-image', folderId: null, idempotencyKey: `fullstack-upload-image-${Date.now()}`,
      },
    });
    expect(signatureResult.status).toBe(200);
    const signature = signatureResult.body.signature;
    expect(signature).toMatchObject({ driver: 'local', method: 'PUT' });

    const uploadStatus = await uploadSignedBytes(owner.page, signature, pngBase64);
    expect(uploadStatus).toBe(204);

    const completeBody = { uploadSessionId: signature.sessionId };
    const [firstCompletion, retriedCompletion] = await Promise.all([
      api(owner.page, '/api/assets/complete-upload', {
        method: 'POST',
        body: completeBody,
      }),
      api(owner.page, '/api/assets/complete-upload', {
        method: 'POST',
        body: completeBody,
      }),
    ]);
    expect(firstCompletion.status).toBe(200);
    expect(retriedCompletion.status).toBe(200);
    expect(retriedCompletion.body.session.id).toBe(firstCompletion.body.session.id);
    await expect.poll(async () => {
      const current = await api(owner.page, `/api/assets/upload-sessions/${signature.sessionId}`);
      if (['failed', 'canceled', 'expired'].includes(current.body.session.status)) {
        throw new Error(`图片上传会话异常结束：${JSON.stringify(current.body.session)}`);
      }
      return current.body.session.status;
    }, { timeout: 30_000 }).toBe('completed');
    const completedImage = await api(owner.page, `/api/assets/upload-sessions/${signature.sessionId}`);
    expect(completedImage.body.session.asset).toBeTruthy();

    const ownerFolders = await api(owner.page, '/api/assets/folders?source=uploaded-image');
    const ownerRootFolder = ownerFolders.body.items.find(
      (folder: { isSystem: boolean }) => folder.isSystem,
    );
    expect(ownerRootFolder?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(completedImage.body.session.asset.folderId).toBe(ownerRootFolder.id);

    const otherFolders = await api(other.page, '/api/assets/folders?source=uploaded-image');
    const otherRootFolder = otherFolders.body.items.find(
      (folder: { isSystem: boolean }) => folder.isSystem,
    );
    expect(otherRootFolder?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(otherRootFolder.id).not.toBe(ownerRootFolder.id);

    const assetId = completedImage.body.session.asset.id;
    const ordinaryUserAdminDownload = await api(owner.page, `/api/admin/assets/${assetId}/download`, {
      method: 'POST',
    });
    expect(ordinaryUserAdminDownload.status).toBe(403);

    const downloadRequestedAtBeforeAdmin = postgresScalar(`
      SELECT coalesce(download_requested_at::text, 'NULL')
      FROM assets WHERE id = '${assetId}'::uuid;
    `);
    expect(downloadRequestedAtBeforeAdmin).toBe('NULL');

    const adminDownload = await api(other.page, `/api/admin/assets/${assetId}/download`, {
      method: 'POST',
    });
    expect(adminDownload.status).toBe(200);
    expect(adminDownload.body).toEqual({
      download: {
        url: expect.any(String),
        filename: 'integration.png',
      },
    });
    expect(postgresScalar(`
      SELECT coalesce(download_requested_at::text, 'NULL')
      FROM assets WHERE id = '${assetId}'::uuid;
    `)).toBe(downloadRequestedAtBeforeAdmin);

    const adminOrdinaryDownload = await api(other.page, `/api/assets/${assetId}/download`, {
      method: 'POST',
    });
    expect(adminOrdinaryDownload.status).toBe(404);
    expect(await fetchStatus(owner.page, `/api/assets/${assetId}/download`)).toBe(200);
    expect(await fetchStatus(other.page, `/api/assets/${assetId}/download`)).toBe(404);
    expect(postgresScalar(`
      SELECT (download_requested_at IS NOT NULL)::text
      FROM assets WHERE id = '${assetId}'::uuid;
    `)).toBe('true');

    const crossAccountPatch = await api(other.page, `/api/assets/${assetId}`, {
      method: 'PATCH',
      body: { name: '不应被修改' },
    });
    expect(crossAccountPatch.status).toBe(404);

    const crossUserFolderPatch = await api(owner.page, `/api/assets/${assetId}`, {
      method: 'PATCH',
      body: { folderId: otherRootFolder.id },
    });
    expect(crossUserFolderPatch.status).toBe(400);

    const ordinaryFolder = await api(owner.page, '/api/assets/folders', {
      method: 'POST',
      body: { name: '全链路普通目录', source: 'uploaded-image' },
    });
    expect(ordinaryFolder.status).toBe(200);
    const ordinaryFolderId = ordinaryFolder.body.folder.id;

    const movedToOrdinaryFolder = await api(owner.page, `/api/assets/${assetId}`, {
      method: 'PATCH',
      body: { folderId: ordinaryFolderId },
    });
    expect(movedToOrdinaryFolder.body.asset.folderId).toBe(ordinaryFolderId);

    const movedToRoot = await api(owner.page, `/api/assets/${assetId}`, {
      method: 'PATCH',
      body: { folderId: null },
    });
    expect(movedToRoot.body.asset.folderId).toBe(ownerRootFolder.id);

    const bulkMovedToOrdinaryFolder = await api(owner.page, '/api/assets/bulk-move', {
      method: 'POST',
      body: { assetIds: [assetId], folderId: ordinaryFolderId },
    });
    expect(bulkMovedToOrdinaryFolder.body.items[0].folderId).toBe(ordinaryFolderId);

    const bulkMovedToRoot = await api(owner.page, '/api/assets/bulk-move', {
      method: 'POST',
      body: { assetIds: [assetId], folderId: null },
    });
    expect(bulkMovedToRoot.body.items[0].folderId).toBe(ownerRootFolder.id);

    const mp4SizeBytes = Buffer.from(mp4Base64, 'base64').length;
    expect(mp4SizeBytes).toBe(1538);
    const videoSignatureResult = await api(owner.page, '/api/assets/upload-signature', {
      method: 'POST',
      body: {
        filename: 'integration.mp4', contentType: 'video/mp4', sizeBytes: mp4SizeBytes,
        source: 'uploaded-video', folderId: null, idempotencyKey: `fullstack-upload-video-${Date.now()}`,
      },
    });
    expect(videoSignatureResult.status).toBe(200);
    const videoSignature = videoSignatureResult.body.signature;
    expect(videoSignature).toMatchObject({ driver: 'local', method: 'PUT' });
    expect(await uploadSignedBytes(owner.page, videoSignature, mp4Base64)).toBe(204);

    const completedVideo = await api(owner.page, '/api/assets/complete-upload', {
      method: 'POST',
      body: { uploadSessionId: videoSignature.sessionId },
    });
    expect(completedVideo.status).toBe(200);
    await expect.poll(async () => {
      const current = await api(owner.page, `/api/assets/upload-sessions/${videoSignature.sessionId}`);
      if (['failed', 'canceled', 'expired'].includes(current.body.session.status)) {
        throw new Error(`视频上传会话异常结束：${JSON.stringify(current.body.session)}`);
      }
      return current.body.session.status;
    }, { timeout: 30_000 }).toBe('completed');
    const finalizedVideo = await api(owner.page, `/api/assets/upload-sessions/${videoSignature.sessionId}`);
    expect(finalizedVideo.body.session.asset).toMatchObject({
      type: 'video',
      source: 'uploaded-video',
      sizeBytes: mp4SizeBytes,
      width: 16,
      height: 16,
    });
    expect(Number(finalizedVideo.body.session.asset.durationSeconds)).toBeCloseTo(1, 1);
    expect(await fetchStatus(owner.page, `/api/assets/${finalizedVideo.body.session.asset.id}/download`)).toBe(200);
  } finally {
    await Promise.all([owner.context.close(), other.context.close()]);
    postgres(`UPDATE users SET role = 'admin' WHERE email = '${secondaryAccount.email}';`);
  }
});

test('素材文件夹删除在真实 PostgreSQL 中支持两种内容动作、墓碑幂等与缺主目录原子回滚', async ({ browser }) => {
  test.setTimeout(90_000);
  const marker = randomUUID();
  const account = {
    id: randomUUID(),
    email: `asset-folder-delete-${marker}@lindyson.test`,
    password: secondaryAccount.password,
  };
  const ids = {
    audioRoot: randomUUID(),
    videoRoot: randomUUID(),
    aiVideoRoot: randomUUID(),
    aiImageRoot: randomUUID(),
    imageRoot: randomUUID(),
    moveFolder: randomUUID(),
    deleteFolder: randomUUID(),
    missingRootFolder: randomUUID(),
    historicalTombstone: randomUUID(),
    completedSession: randomUUID(),
    moveAssetOne: randomUUID(),
    moveAssetTwo: randomUUID(),
    deleteAssetOne: randomUUID(),
    deleteAssetTwo: randomUUID(),
    missingRootAsset: randomUUID(),
  };
  const objectPrefix = `fullstack/asset-folder-delete/${marker}`;
  let session: Awaited<ReturnType<typeof createAuthenticatedPage>> | undefined;

  try {
    postgres(`
      INSERT INTO users (id, email, password_hash, user_name, plan_id)
      SELECT '${account.id}'::uuid, '${account.email}', password_hash,
             '全栈素材目录删除用户', NULL::uuid
      FROM users WHERE email = '${secondaryAccount.email}';

    INSERT INTO asset_folders (id, user_id, name, source, is_system)
    VALUES
      ('${ids.aiVideoRoot}'::uuid, '${account.id}'::uuid, 'AI 视频', 'ai-video', true),
      ('${ids.aiImageRoot}'::uuid, '${account.id}'::uuid, 'AI 图片', 'ai-image', true),
      ('${ids.videoRoot}'::uuid, '${account.id}'::uuid, '已上传视频', 'uploaded-video', true),
      ('${ids.imageRoot}'::uuid, '${account.id}'::uuid, '已上传图片', 'uploaded-image', true),
      ('${ids.audioRoot}'::uuid, '${account.id}'::uuid, '已上传音频', 'uploaded-audio', true),
      ('${ids.moveFolder}'::uuid, '${account.id}'::uuid, '迁回主目录', 'uploaded-audio', false),
      ('${ids.deleteFolder}'::uuid, '${account.id}'::uuid, '连同素材删除', 'uploaded-audio', false),
      ('${ids.missingRootFolder}'::uuid, '${account.id}'::uuid, '缺失主目录回滚', 'uploaded-video', false);

    INSERT INTO assets (
      id, user_id, folder_id, name, type, source, object_key, thumbnail_key,
      size_bytes, duration_seconds, deletion_status, thumbnail_status, created_at, updated_at
    ) VALUES
      ('${ids.moveAssetOne}'::uuid, '${account.id}'::uuid, '${ids.moveFolder}'::uuid,
       '迁移音频一', 'audio', 'uploaded-audio', '${objectPrefix}/move-1.mp3', NULL,
       32, 1, 'active', 'not-required', now(), now()),
      ('${ids.moveAssetTwo}'::uuid, '${account.id}'::uuid, '${ids.moveFolder}'::uuid,
       '迁移音频二', 'audio', 'uploaded-audio', '${objectPrefix}/move-2.mp3', NULL,
       32, 1, 'active', 'not-required', now(), now()),
      ('${ids.deleteAssetOne}'::uuid, '${account.id}'::uuid, '${ids.deleteFolder}'::uuid,
       '删除音频一', 'audio', 'uploaded-audio', '${objectPrefix}/delete-1.mp3', NULL,
       32, 1, 'active', 'not-required', now(), now()),
      ('${ids.deleteAssetTwo}'::uuid, '${account.id}'::uuid, '${ids.deleteFolder}'::uuid,
       '删除音频二', 'audio', 'uploaded-audio', '${objectPrefix}/delete-2.mp3', NULL,
       32, 1, 'active', 'not-required', now(), now()),
      ('${ids.missingRootAsset}'::uuid, '${account.id}'::uuid, '${ids.missingRootFolder}'::uuid,
       '缺主目录视频', 'video', 'uploaded-video', '${objectPrefix}/missing-root.mp4',
       '${objectPrefix}/missing-root.webp', 32, 1, 'active', 'ready', now(), now());

    INSERT INTO upload_sessions (
      id, user_id, object_key, filename, content_type, max_size_bytes,
      status, asset_id, expires_at, completed_at,
      idempotency_key, request_hash, source, asset_type, asset_name, folder_id,
      final_object_key, actual_size_bytes, sealed_at, sealed_size_bytes,
      retryable, attempt, processing_stage, retention_until, started_at
    ) VALUES (
      '${ids.completedSession}'::uuid, '${account.id}'::uuid,
      '${objectPrefix}/completed-staging.mp3', 'move-1.mp3', 'audio/mpeg', 32,
      'completed', '${ids.moveAssetOne}'::uuid, now() + interval '10 minutes', now(),
      'fullstack-folder-delete-completed-${marker}', 'fullstack-folder-delete-completed-${marker}',
      'uploaded-audio', 'audio', '迁移音频一', '${ids.moveFolder}'::uuid,
      '${objectPrefix}/move-1.mp3', 32, now(), 32,
      false, 1, 'completed', now() + interval '1 day', now()
    );

    -- 只写入 027 时代已有列，验证 077 为历史墓碑补上的真实默认语义。
      INSERT INTO asset_folder_deletion_records (user_id, folder_id)
      VALUES ('${account.id}'::uuid, '${ids.historicalTombstone}'::uuid);
    `);

    session = await createAuthenticatedPage(browser, account);
    // 本用例只走 API；离开首页可避免长时间加载的媒体响应在 context.close 时
    // 与 Playwright trace 数据流同时被中断，造成与业务无关的 zip/stream 截断。
    await session.page.goto('/api/ready');
    const createPendingSession = async (folderId: string, suffix: string, source: 'uploaded-audio' | 'uploaded-video') => {
      const audio = source === 'uploaded-audio';
      const result = await api(session!.page, '/api/assets/upload-signature', {
        method: 'POST',
        body: {
          filename: `${suffix}.${audio ? 'mp3' : 'mp4'}`,
          contentType: audio ? 'audio/mpeg' : 'video/mp4',
          sizeBytes: 32,
          source,
          folderId,
          idempotencyKey: `fullstack-folder-delete-${marker}-${suffix}`,
        },
      });
      expect(result.status).toBe(200);
      expect(result.body.signature?.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
      return String(result.body.signature.sessionId);
    };

    const pendingSessionId = await createPendingSession(ids.moveFolder, 'pending', 'uploaded-audio');
    const processingSessionId = await createPendingSession(ids.moveFolder, 'processing', 'uploaded-audio');
    const retryableSessionId = await createPendingSession(ids.moveFolder, 'retryable', 'uploaded-audio');
    postgres(`
      UPDATE upload_sessions
      SET status = 'processing', processing_stage = 'sealing',
          lease_token = gen_random_uuid(), lease_expires_at = now() + interval '10 minutes',
          heartbeat_at = now(), updated_at = now()
      WHERE id = '${processingSessionId}'::uuid;
      UPDATE upload_sessions
      SET status = 'failed', processing_stage = 'failed', retryable = true,
          retention_until = now() + interval '1 day', updated_at = now()
      WHERE id = '${retryableSessionId}'::uuid;
    `);

    const terminalMoveFailure = postgresRollbackScriptFailure(`
      UPDATE upload_sessions
      SET folder_id = '${ids.audioRoot}'::uuid
      WHERE id = '${ids.completedSession}'::uuid;
    `);
    expect(terminalMoveFailure).toContain('仅允许可恢复会话迁入同来源主目录或终态会话从普通目录脱钩');

    const crossSourceMoveFailure = postgresRollbackScriptFailure(`
      UPDATE upload_sessions
      SET folder_id = '${ids.videoRoot}'::uuid
      WHERE id = '${pendingSessionId}'::uuid;
    `);
    expect(crossSourceMoveFailure).toContain('仅允许可恢复会话迁入同来源主目录或终态会话从普通目录脱钩');

    const moveToRoot = await api(session.page, `/api/assets/folders/${ids.moveFolder}`, { method: 'DELETE' });
    expect(moveToRoot.status).toBe(200);
    expect(moveToRoot.body).toEqual({
      ok: true,
      contentAction: 'move-to-root',
      affectedAssetCount: 2,
    });
    expect(postgresScalar(`
      SELECT count(*) FROM assets
      WHERE id IN ('${ids.moveAssetOne}'::uuid, '${ids.moveAssetTwo}'::uuid)
        AND folder_id = '${ids.audioRoot}'::uuid AND deletion_status = 'active';
    `)).toBe('2');
    expect(postgresScalar(`
      SELECT count(*) FROM upload_sessions
      WHERE id IN ('${pendingSessionId}'::uuid, '${processingSessionId}'::uuid, '${retryableSessionId}'::uuid)
        AND folder_id = '${ids.audioRoot}'::uuid;
    `)).toBe('3');
    expect(postgresScalar(`
      SELECT concat_ws('|', status, folder_id IS NULL)
      FROM upload_sessions WHERE id = '${ids.completedSession}'::uuid;
    `)).toBe('completed|t');
    expect(postgresScalar(`SELECT count(*) FROM asset_folders WHERE id = '${ids.moveFolder}'::uuid;`)).toBe('0');

    const moveReplay = await api(session.page, `/api/assets/folders/${ids.moveFolder}`, { method: 'DELETE' });
    expect(moveReplay.body).toEqual(moveToRoot.body);
    const explicitMoveReplay = await api(
      session.page,
      `/api/assets/folders/${ids.moveFolder}?contentAction=move-to-root`,
      { method: 'DELETE' },
    );
    expect(explicitMoveReplay.body).toEqual(moveToRoot.body);
    const moveConflict = await api(
      session.page,
      `/api/assets/folders/${ids.moveFolder}?contentAction=delete-assets`,
      { method: 'DELETE' },
    );
    expect(moveConflict.status).toBe(409);
    expect(moveConflict.body.code).toBe('ASSET_FOLDER_DELETE_ACTION_CONFLICT');

    const deleteFolderSessionId = await createPendingSession(ids.deleteFolder, 'delete-assets', 'uploaded-audio');
    const deleteAssets = await api(
      session.page,
      `/api/assets/folders/${ids.deleteFolder}?contentAction=delete-assets`,
      { method: 'DELETE' },
    );
    expect(deleteAssets.status).toBe(200);
    expect(deleteAssets.body).toEqual({
      ok: true,
      contentAction: 'delete-assets',
      affectedAssetCount: 2,
    });
    expect(postgresScalar(`
      SELECT count(*) FROM assets
      WHERE id IN ('${ids.deleteAssetOne}'::uuid, '${ids.deleteAssetTwo}'::uuid)
        AND deletion_status = 'active';
    `)).toBe('0');
    expect(postgresScalar(`
      SELECT count(*) FROM assets
      WHERE id IN ('${ids.deleteAssetOne}'::uuid, '${ids.deleteAssetTwo}'::uuid)
        AND folder_id IS NULL;
    `)).toBe('2');
    expect(postgresScalar(`
      SELECT folder_id FROM upload_sessions WHERE id = '${deleteFolderSessionId}'::uuid;
    `)).toBe(ids.audioRoot);

    const deleteReplay = await api(session.page, `/api/assets/folders/${ids.deleteFolder}`, { method: 'DELETE' });
    expect(deleteReplay.body).toEqual(deleteAssets.body);
    const explicitDeleteReplay = await api(
      session.page,
      `/api/assets/folders/${ids.deleteFolder}?contentAction=delete-assets`,
      { method: 'DELETE' },
    );
    expect(explicitDeleteReplay.body).toEqual(deleteAssets.body);
    const deleteConflict = await api(
      session.page,
      `/api/assets/folders/${ids.deleteFolder}?contentAction=move-to-root`,
      { method: 'DELETE' },
    );
    expect(deleteConflict.status).toBe(409);
    expect(deleteConflict.body.code).toBe('ASSET_FOLDER_DELETE_ACTION_CONFLICT');

    const historicalReplay = await api(
      session.page,
      `/api/assets/folders/${ids.historicalTombstone}`,
      { method: 'DELETE' },
    );
    expect(historicalReplay.status).toBe(200);
    expect(historicalReplay.body).toEqual({
      ok: true,
      contentAction: 'delete-assets',
      affectedAssetCount: null,
    });
    const historicalConflict = await api(
      session.page,
      `/api/assets/folders/${ids.historicalTombstone}?contentAction=move-to-root`,
      { method: 'DELETE' },
    );
    expect(historicalConflict.status).toBe(409);
    expect(historicalConflict.body.code).toBe('ASSET_FOLDER_DELETE_ACTION_CONFLICT');

    const missingRootSessionId = await createPendingSession(
      ids.missingRootFolder,
      'missing-root',
      'uploaded-video',
    );
    postgres(`DELETE FROM asset_folders WHERE id = '${ids.videoRoot}'::uuid;`);
    const missingRootDelete = await api(
      session.page,
      `/api/assets/folders/${ids.missingRootFolder}`,
      { method: 'DELETE' },
    );
    expect(missingRootDelete.status).toBe(500);
    expect(missingRootDelete.body.code).toBe('ASSET_ROOT_FOLDER_MISSING');
    expect(postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM asset_folders WHERE id = '${ids.missingRootFolder}'::uuid),
        (SELECT count(*) FROM assets
         WHERE id = '${ids.missingRootAsset}'::uuid
           AND folder_id = '${ids.missingRootFolder}'::uuid AND deletion_status = 'active'),
        (SELECT count(*) FROM upload_sessions
         WHERE id = '${missingRootSessionId}'::uuid AND folder_id = '${ids.missingRootFolder}'::uuid),
        (SELECT count(*) FROM asset_folder_deletion_records
         WHERE user_id = '${account.id}'::uuid AND folder_id = '${ids.missingRootFolder}'::uuid)
      );
    `)).toBe('1|1|1|0');
    postgres(`
      INSERT INTO asset_folders (id, user_id, name, source, is_system)
      VALUES ('${ids.videoRoot}'::uuid, '${account.id}'::uuid, '已上传视频', 'uploaded-video', true);
    `);
  } finally {
    await session?.context.close();
    postgres(`
      DELETE FROM object_deletion_outbox
      WHERE object_key LIKE '${objectPrefix}/%'
         OR object_key IN (
           SELECT object_key FROM upload_sessions WHERE user_id = '${account.id}'::uuid
           UNION SELECT final_object_key FROM upload_sessions WHERE user_id = '${account.id}'::uuid
           UNION SELECT thumbnail_key FROM upload_sessions WHERE user_id = '${account.id}'::uuid
         );
      DELETE FROM upload_sessions WHERE user_id = '${account.id}'::uuid;
      DELETE FROM assets WHERE user_id = '${account.id}'::uuid;
      DELETE FROM asset_folder_deletion_records WHERE user_id = '${account.id}'::uuid;
      DELETE FROM asset_folders WHERE user_id = '${account.id}'::uuid;
      DELETE FROM users WHERE id = '${account.id}'::uuid;
    `);
  }
});

test('文件夹删除与未完成上传会话创建在真实 PostgreSQL 中按目录到会话锁序列化', async ({ browser }) => {
  test.setTimeout(60_000);
  const marker = randomUUID();
  const lockKey = `fullstack-folder-upload-lock-${marker}`;
  const idempotencyKey = `fullstack-folder-upload-concurrency-${marker}`;
  const account = {
    id: randomUUID(),
    email: `asset-folder-lock-${marker}@lindyson.test`,
    password: secondaryAccount.password,
  };
  const audioRootId = randomUUID();
  const folderId = randomUUID();
  const assetId = randomUUID();
  const objectKey = `fullstack/asset-folder-lock/${marker}/existing.mp3`;
  const sqlSuffix = marker.replaceAll('-', '').slice(0, 16);
  const triggerName = `fullstack_gate_upload_${sqlSuffix}`;
  const functionName = `fullstack_gate_upload_fn_${sqlSuffix}`;
  let uploader: Awaited<ReturnType<typeof createAuthenticatedPage>> | undefined;
  let deleter: Awaited<ReturnType<typeof createAuthenticatedPage>> | undefined;
  let lockHolder: Awaited<ReturnType<typeof holdPostgresAdvisoryLock>> | undefined;

  try {
    postgres(`
      INSERT INTO users (id, email, password_hash, user_name, plan_id)
      SELECT '${account.id}'::uuid, '${account.email}', password_hash,
             '全栈素材目录锁用户', NULL::uuid
      FROM users WHERE email = '${secondaryAccount.email}';
      INSERT INTO asset_folders (user_id, name, source, is_system)
      VALUES
        ('${account.id}'::uuid, 'AI 视频', 'ai-video', true),
        ('${account.id}'::uuid, 'AI 图片', 'ai-image', true),
        ('${account.id}'::uuid, '已上传视频', 'uploaded-video', true),
        ('${account.id}'::uuid, '已上传图片', 'uploaded-image', true);
      INSERT INTO asset_folders (id, user_id, name, source, is_system)
      VALUES
        ('${audioRootId}'::uuid, '${account.id}'::uuid, '已上传音频', 'uploaded-audio', true),
        ('${folderId}'::uuid, '${account.id}'::uuid, '并发上传目录', 'uploaded-audio', false);
      INSERT INTO assets (
        id, user_id, folder_id, name, type, source, object_key,
        size_bytes, duration_seconds, deletion_status, thumbnail_status
      ) VALUES (
        '${assetId}'::uuid, '${account.id}'::uuid, '${folderId}'::uuid,
        '并发既有音频', 'audio', 'uploaded-audio', '${objectKey}',
        32, 1, 'active', 'not-required'
      );

      CREATE OR REPLACE FUNCTION ${functionName}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $fullstack_gate$
      BEGIN
        IF NEW.idempotency_key = '${idempotencyKey}' THEN
          PERFORM pg_advisory_xact_lock(hashtextextended('${lockKey}', 0));
        END IF;
        RETURN NEW;
      END
      $fullstack_gate$;
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON upload_sessions
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `);

    uploader = await createAuthenticatedPage(browser, account);
    deleter = await createAuthenticatedPage(browser, account);
    await Promise.all([uploader.page.goto('/api/ready'), deleter.page.goto('/api/ready')]);
    lockHolder = await holdPostgresAdvisoryLock(lockKey);
    const signaturePromise = api(uploader.page, '/api/assets/upload-signature', {
      method: 'POST',
      body: {
        filename: `concurrent-${marker}.mp3`,
        contentType: 'audio/mpeg',
        sizeBytes: 32,
        source: 'uploaded-audio',
        folderId,
        idempotencyKey,
      },
    });

    await expect.poll(() => postgresScalar(`
      SELECT count(*) FROM pg_stat_activity
      WHERE datname = 'lindyson'
        AND wait_event_type = 'Lock'
        AND wait_event = 'advisory'
        AND query ILIKE '%INSERT INTO upload_sessions%';
    `), { timeout: 10_000, intervals: [50, 100, 200] }).toBe('1');

    const deletePromise = api(deleter.page, `/api/assets/folders/${folderId}`, { method: 'DELETE' });
    await expect.poll(() => postgresScalar(`
      SELECT count(*) FROM pg_stat_activity
      WHERE datname = 'lindyson'
        AND wait_event_type = 'Lock'
        AND query ILIKE '%FROM asset_folders%FOR UPDATE%';
    `), { timeout: 10_000, intervals: [50, 100, 200] }).toBe('1');

    await lockHolder.release();
    lockHolder = undefined;
    const [signature, deletion] = await Promise.all([signaturePromise, deletePromise]);

    expect(signature.status).toBe(200);
    expect(signature.body.signature?.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(deletion.status).toBe(200);
    expect(deletion.body).toEqual({
      ok: true,
      contentAction: 'move-to-root',
      affectedAssetCount: 1,
    });
    expect(postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM asset_folders WHERE id = '${folderId}'::uuid),
        (SELECT count(*) FROM assets
         WHERE id = '${assetId}'::uuid AND folder_id = '${audioRootId}'::uuid),
        (SELECT count(*) FROM upload_sessions
         WHERE id = '${signature.body.signature.sessionId}'::uuid
           AND folder_id = '${audioRootId}'::uuid AND status = 'pending')
      );
    `)).toBe('0|1|1');
  } finally {
    await lockHolder?.release();
    postgres(`
      DROP TRIGGER IF EXISTS ${triggerName} ON upload_sessions;
      DROP FUNCTION IF EXISTS ${functionName}();
    `);
    await Promise.all([uploader?.context.close(), deleter?.context.close()]);
    postgres(`
      DELETE FROM object_deletion_outbox
      WHERE object_key = '${objectKey}'
         OR object_key IN (
           SELECT object_key FROM upload_sessions WHERE user_id = '${account.id}'::uuid
           UNION SELECT final_object_key FROM upload_sessions WHERE user_id = '${account.id}'::uuid
           UNION SELECT thumbnail_key FROM upload_sessions WHERE user_id = '${account.id}'::uuid
         );
      DELETE FROM upload_sessions WHERE user_id = '${account.id}'::uuid;
      DELETE FROM assets WHERE user_id = '${account.id}'::uuid;
      DELETE FROM asset_folder_deletion_records WHERE user_id = '${account.id}'::uuid;
      DELETE FROM asset_folders WHERE user_id = '${account.id}'::uuid;
      DELETE FROM users WHERE id = '${account.id}'::uuid;
    `);
  }
});

test('历史生成参考素材迁移会清除跨用户存储凭证且可重复执行', async ({ browser }) => {
  const ids = {
    ownReference: randomUUID(),
    victimReference: randomUUID(),
    deletedReference: randomUUID(),
    legacyReference: randomUUID(),
    legacyRootReference: randomUUID(),
    outputAsset: randomUUID(),
    task: randomUUID(),
  };
  const ownObjectKey = `fullstack/reference-security/${ids.ownReference}.png`;
  const ownThumbnailKey = `fullstack/reference-security/${ids.ownReference}-thumb.jpg`;
  const victimObjectKey = `fullstack/reference-security/${ids.victimReference}.png`;
  const victimThumbnailKey = `fullstack/reference-security/${ids.victimReference}-thumb.jpg`;
  const deletedObjectKey = `fullstack/reference-security/${ids.deletedReference}.png`;
  const legacyExternalUrl = 'https://legacy.example.test/reference.png';
  const fixedUpdatedAt = '2026-01-02 03:04:05+08';
  const session = await createAuthenticatedPage(browser, primaryAccount);

  try {
    postgres(`
      INSERT INTO assets (
        id, user_id, folder_id, name, type, source, object_key, thumbnail_key,
        size_bytes, duration_seconds, deletion_status, deleted_at, created_at, updated_at
      ) VALUES
        (
          '${ids.ownReference}',
          (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
          (SELECT id FROM asset_folders
           WHERE user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}')
             AND source = 'uploaded-image' AND is_system = true),
          '数据库自有参考图', 'image', 'uploaded-image', '${ownObjectKey}',
          '${ownThumbnailKey}', 321, NULL, 'active', NULL, now(), '${fixedUpdatedAt}'
        ),
        (
          '${ids.victimReference}',
          (SELECT id FROM users WHERE email = '${secondaryAccount.email}'),
          (SELECT id FROM asset_folders
           WHERE user_id = (SELECT id FROM users WHERE email = '${secondaryAccount.email}')
             AND source = 'uploaded-image' AND is_system = true),
          '其他用户私有参考图', 'image', 'uploaded-image', '${victimObjectKey}',
          '${victimThumbnailKey}', 654, NULL, 'active', NULL, now(), '${fixedUpdatedAt}'
        ),
        (
          '${ids.deletedReference}',
          (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
          NULL,
          '已删除参考图', 'image', 'uploaded-image', '${deletedObjectKey}',
          NULL, 111, NULL, 'deleted', now(), now(), '${fixedUpdatedAt}'
        );

      INSERT INTO generation_tasks (
        id, user_id, kind, model, status, processing_stage, claim_token, lease_expires_at,
        prompt, config, credits, created_at, updated_at
      ) VALUES (
        '${ids.task}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        'video', 'Seedance 2.0', 'processing', 'prepared', gen_random_uuid(),
        now() + interval '10 minutes', '历史参考素材迁移测试',
        jsonb_build_object(
          'mode', 'general',
          'aspectRatio', '9:16',
          'resolution', '720p',
          'durationSeconds', 5,
          'generateAudio', true,
          'referenceAssets', jsonb_build_array(
            jsonb_build_object(
              'id', '伪造 ID', 'name', '伪造名称', 'thumbnail', 'https://victim.example.test/thumb',
              'objectKey', '${ownObjectKey}', 'thumbnailKey', '${victimThumbnailKey}',
              'publicUrl', 'https://victim.example.test/object', 'type', 'video',
              'role', 'reference_image', 'durationSeconds', 999, 'sizeBytes', 999
            ),
            jsonb_build_object(
              'id', '${ids.victimReference}', 'name', '跨用户素材', 'thumbnail', 'blob:unsafe',
              'objectKey', '${victimObjectKey}', 'thumbnailKey', '${victimThumbnailKey}',
              'publicUrl', 'https://victim.example.test/private', 'type', 'image'
            ),
            jsonb_build_object(
              'id', '${ids.deletedReference}', 'name', '失效素材',
              'objectKey', '${deletedObjectKey}', 'url', 'https://victim.example.test/deleted',
              'type', 'image'
            ),
            jsonb_build_object(
              'id', '${ids.legacyReference}', 'name', '旧版外链', 'thumbnail', '${legacyExternalUrl}',
              'thumbnailKey', '${victimThumbnailKey}', 'publicUrl', '${legacyExternalUrl}',
              'type', 'image'
            )
          )
        ),
        0, now(), '${fixedUpdatedAt}'
      );

      INSERT INTO assets (
        id, user_id, folder_id, name, type, source, object_key, size_bytes,
        generation_meta, deletion_status, created_at, updated_at
      ) VALUES (
        '${ids.outputAsset}',
        (SELECT id FROM users WHERE email = '${primaryAccount.email}'),
        (SELECT id FROM asset_folders
         WHERE user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}')
           AND source = 'ai-video' AND is_system = true),
        '带历史引用的生成视频', 'video', 'ai-video',
        'fullstack/reference-security/${ids.outputAsset}.mp4', 1024,
        jsonb_build_object(
          'kind', 'video',
          'model', 'Seedance 2.0',
          'prompt', '历史参考素材迁移测试',
          'credits', 0,
          'config', (SELECT config FROM generation_tasks WHERE id = '${ids.task}'),
          'referenceImages', jsonb_build_array(
            jsonb_build_object(
              'id', '伪造图片 ID', 'name', '伪造图片名', 'thumbnail', 'blob:unsafe',
              'objectKey', '${ownObjectKey}', 'thumbnailKey', '${victimThumbnailKey}',
              'publicUrl', 'https://victim.example.test/image', 'type', 'video'
            ),
            jsonb_build_object(
              'id', '${ids.legacyRootReference}', 'name', '根级旧版外链',
              'thumbnail', '${legacyExternalUrl}', 'publicUrl', '${legacyExternalUrl}'
            )
          )
        ),
        'active', now(), '${fixedUpdatedAt}'
      );
    `);

    const migrationSql = readFileSync(
      'apps/api/migrations/043_secure_generation_asset_references.sql',
      'utf8',
    );
    expect(() => postgresScript(migrationSql)).toThrow();
    expect(postgresScalar(`
      SELECT config::text FROM generation_tasks WHERE id = '${ids.task}';
    `)).toContain(victimThumbnailKey);
    postgres(`
      UPDATE generation_tasks
      SET status = 'failed', processing_stage = 'failed',
          credit_status = 'refunded', settled_credits = 0, refunded_credits = 0,
          claim_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
      WHERE id = '${ids.task}';
    `);
    postgresScript(migrationSql);

    const taskConfig = JSON.parse(postgresScalar(`
      SELECT config::text FROM generation_tasks WHERE id = '${ids.task}';
    `));
    expect(taskConfig.referenceAssets).toEqual([
      {
        id: ids.ownReference,
        name: '数据库自有参考图',
        thumbnail: '',
        objectKey: ownObjectKey,
        thumbnailKey: ownThumbnailKey,
        type: 'image',
        role: 'reference_image',
        sizeBytes: 321,
      },
      {
        id: ids.victimReference,
        name: '跨用户素材',
        thumbnail: '',
        type: 'image',
      },
      {
        id: ids.deletedReference,
        name: '失效素材',
        thumbnail: '',
        type: 'image',
      },
      {
        id: ids.legacyReference,
        name: '旧版外链',
        thumbnail: legacyExternalUrl,
        publicUrl: legacyExternalUrl,
        type: 'image',
      },
    ]);
    expect(JSON.stringify(taskConfig)).not.toContain(victimThumbnailKey);
    expect(JSON.stringify(taskConfig)).not.toContain('victim.example.test');

    const generationMeta = JSON.parse(postgresScalar(`
      SELECT generation_meta::text FROM assets WHERE id = '${ids.outputAsset}';
    `));
    expect(generationMeta.config).toEqual(taskConfig);
    expect(generationMeta.referenceImages).toEqual([
      {
        id: ids.ownReference,
        name: '数据库自有参考图',
        thumbnail: '',
        objectKey: ownObjectKey,
        thumbnailKey: ownThumbnailKey,
        type: 'image',
        sizeBytes: 321,
      },
      {
        id: ids.legacyRootReference,
        name: '根级旧版外链',
        thumbnail: legacyExternalUrl,
        publicUrl: legacyExternalUrl,
        type: 'image',
      },
    ]);

    expect(postgresScalar(`
      SELECT updated_at::text FROM generation_tasks WHERE id = '${ids.task}';
    `)).toBe('2026-01-01 19:04:05+00');
    expect(postgresScalar(`
      SELECT updated_at::text FROM assets WHERE id = '${ids.outputAsset}';
    `)).toBe('2026-01-01 19:04:05+00');

    const firstHash = postgresScalar(`
      SELECT md5(task.config::text || asset.generation_meta::text)
      FROM generation_tasks task
      CROSS JOIN assets asset
      WHERE task.id = '${ids.task}' AND asset.id = '${ids.outputAsset}';
    `);
    postgresScript(migrationSql);
    expect(postgresScalar(`
      SELECT md5(task.config::text || asset.generation_meta::text)
      FROM generation_tasks task
      CROSS JOIN assets asset
      WHERE task.id = '${ids.task}' AND asset.id = '${ids.outputAsset}';
    `)).toBe(firstHash);

    const removedLegacyList = await api(session.page, '/api/assets');
    expect(removedLegacyList.status).toBe(404);

    const detail = await api(session.page, `/api/assets/${ids.outputAsset}`);
    expect(detail.status).toBe(200);
    const output = detail.body.asset;
    expect(JSON.stringify(output)).not.toContain(victimObjectKey);
    expect(JSON.stringify(output)).not.toContain(victimThumbnailKey);
    expect(JSON.stringify(output)).not.toContain(ownObjectKey);
    expect(JSON.stringify(output)).not.toContain(ownThumbnailKey);
    expect(JSON.stringify(output)).not.toContain('victim.example.test');
    expect(JSON.stringify(output)).not.toContain('legacy.example.test');
    expect(output.generation.config.referenceAssets[0]).toEqual({
      id: ids.ownReference,
      name: '数据库自有参考图',
      type: 'image',
      role: 'reference_image',
      previewUrl: null,
      sizeBytes: 321,
    });
  } finally {
    postgres(`
      DELETE FROM generation_tasks WHERE id = '${ids.task}';
      DELETE FROM assets WHERE id IN (
        '${ids.outputAsset}', '${ids.ownReference}', '${ids.victimReference}', '${ids.deletedReference}'
      );
    `);
    await session.context.close();
  }
});

test('批量生成幂等重试返回原任务且余额只预扣一次', async ({ browser }) => {
  const session = await createAuthenticatedPage(browser, primaryAccount);
  try {
    const beforeCredits = await readCredits(session.page);
    const body = {
      idempotencyKey: 'integration-batch-idempotency-0001',
      requests: [{
        model: 'Seedance 2.0',
        prompt: '验证批量生成幂等性的商品展示视频',
        config: { aspectRatio: '9:16', durationSeconds: 5, resolution: '480p' },
      }],
    };

    const first = await api(session.page, '/api/ai/video-tasks/batch', { method: 'POST', body });
    expect(first.status).toBe(200);
    expect(first.body.tasks).toHaveLength(1);
    const creditsAfterFirst = await readCredits(session.page);

    const retry = await api(session.page, '/api/ai/video-tasks/batch', { method: 'POST', body });
    expect(retry.status).toBe(200);
    expect(retry.body.tasks).toHaveLength(1);
    expect(retry.body.tasks[0].id).toBe(first.body.tasks[0].id);
    const creditsAfterRetry = await readCredits(session.page);

    expect(creditsAfterFirst).toBe(beforeCredits - Number(first.body.tasks[0].credits));
    expect(creditsAfterRetry).toBe(creditsAfterFirst);

    await expect.poll(
      async () => (await readTask(session.page, first.body.tasks[0].id)).status,
      { timeout: 30_000 },
    ).toBe('completed');
  } finally {
    await session.context.close();
  }
});

test('生成任务失败退款后管理员原地重试成功，旧 attempt 流水快照不漂移', async ({ browser }) => {
  test.setTimeout(45_000);
  const session = await createAuthenticatedPage(browser, primaryAccount);
  try {
    const beforeCredits = await readCredits(session.page);
    const created = await api(session.page, '/api/ai/video-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: `integration-generation-failure-${randomUUID()}`,
        requests: [{
          model: 'Seedance 2.0',
          prompt: '验证供应商终态失败后退回全部预扣积分',
          config: { aspectRatio: '9:16', durationSeconds: 5, resolution: '480p' },
        }],
      },
    });
    expect(created.status).toBe(200);
    const task = created.body.tasks[0];
    const reservedCredits = Number(task.reservedCredits);
    expect(task).toMatchObject({ status: 'queued', creditStatus: 'held' });
    expect(await readCredits(session.page)).toBe(beforeCredits - reservedCredits);

    const canceled = await api(session.page, `/api/ai/tasks/${task.id}/cancel`, { method: 'POST' });
    expect(canceled.status).toBe(404);

    await expect.poll(
      async () => (await readTask(session.page, task.id)).status,
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    ).toBe('failed');

    const failedTask = await readTask(session.page, task.id);
    expect(failedTask).toMatchObject({
      status: 'failed',
      creditStatus: 'refunded',
      settledCredits: 0,
      refundedCredits: reservedCredits,
      assetId: null,
    });
    expect(await readCredits(session.page)).toBe(beforeCredits);

    const ledger = await api(session.page, '/api/account/credit-ledger?limit=50');
    expect(ledger.status).toBe(200);
    const taskEntries = ledger.body.items.filter(
      (item: { relatedJobId: string | null }) => item.relatedJobId === task.id,
    );
    expect(taskEntries).toHaveLength(2);
    expect(taskEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'hold',
        settlementStatus: 'refunded',
        amount: -reservedCredits,
        generationSnapshot: expect.objectContaining({
          attempt: 0,
          model: 'Seedance 2.0',
          durationSeconds: 5,
          resolution: '480p',
          reservedCredits,
          settledCredits: 0,
          refundedCredits: 0,
          taskStatus: 'failed',
          creditStatus: 'refunded',
        }),
      }),
      expect.objectContaining({
        type: 'refund',
        settlementStatus: 'refunded',
        amount: reservedCredits,
        generationSnapshot: expect.objectContaining({
          attempt: 0,
          model: 'Seedance 2.0',
          durationSeconds: 5,
          resolution: '480p',
          reservedCredits,
          settledCredits: 0,
          refundedCredits: reservedCredits,
          taskStatus: 'failed',
          creditStatus: 'refunded',
        }),
      }),
    ]));

    expect(postgresScalar(`
      SELECT concat_ws('|', task.status, task.credit_status, task.settled_credits::text,
        task.refunded_credits::text, (task.asset_id IS NULL)::text, run.status)
      FROM generation_tasks task
      JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
      WHERE task.id = '${task.id}'::uuid;
    `)).toBe(`failed|refunded|0|${reservedCredits}|true|provider-failed`);
    expect(postgresScalar(`
      SELECT concat_ws('|', count(*)::text, min(status), min(provider))
      FROM provider_usage_records
      WHERE task_id = '${task.id}'::uuid;
    `)).toBe('1|failed|fake-provider');

    // 测试夹具只移除 Fake Provider 的“失败”触发词；管理员接口仍在同一 task id 上推进 attempt。
    postgres(`
      UPDATE generation_tasks
      SET prompt = '验证管理员原地重试后正常完成', updated_at = now()
      WHERE id = '${task.id}'::uuid;
    `);
    const retried = await api(session.page, `/api/admin/jobs/${task.id}/retry`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `fullstack-generation-retry-${randomUUID()}` },
    });
    expect(retried.status).toBe(200);
    expect(retried.body.task).toMatchObject({
      id: task.id,
      attempt: 1,
      status: 'queued',
      creditStatus: 'held',
      reservedCredits,
    });

    await expect.poll(
      async () => (await readTask(session.page, task.id)).status,
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    ).toBe('completed');
    expect(await readCredits(session.page)).toBe(beforeCredits - reservedCredits);

    const afterRetryLedger = await api(session.page, '/api/account/credit-ledger?limit=50');
    expect(afterRetryLedger.status).toBe(200);
    const afterRetryEntries = afterRetryLedger.body.items.filter(
      (item: { relatedJobId: string | null }) => item.relatedJobId === task.id,
    );
    expect(afterRetryEntries).toHaveLength(3);
    const oldHold = afterRetryEntries.find((item: { type: string; generationSnapshot?: { attempt?: number } | null }) => (
      item.type === 'hold' && item.generationSnapshot?.attempt === 0
    ));
    const oldRefund = afterRetryEntries.find((item: { type: string; generationSnapshot?: { attempt?: number } | null }) => (
      item.type === 'refund' && item.generationSnapshot?.attempt === 0
    ));
    const newSpend = afterRetryEntries.find((item: { type: string; generationSnapshot?: { attempt?: number } | null }) => (
      item.type === 'spend' && item.generationSnapshot?.attempt === 1
    ));
    expect(oldHold).toMatchObject({
      settlementStatus: 'refunded',
      amount: -reservedCredits,
      generationSnapshot: {
        attempt: 0,
        model: 'Seedance 2.0',
        durationSeconds: 5,
        resolution: '480p',
        hasReferenceVideo: false,
        reservedCredits,
        settledCredits: 0,
        refundedCredits: 0,
        taskStatus: 'failed',
        creditStatus: 'refunded',
      },
    });
    expect(oldRefund).toMatchObject({
      settlementStatus: 'refunded',
      amount: reservedCredits,
      generationSnapshot: {
        attempt: 0,
        model: 'Seedance 2.0',
        durationSeconds: 5,
        resolution: '480p',
        hasReferenceVideo: false,
        reservedCredits,
        settledCredits: 0,
        refundedCredits: reservedCredits,
        taskStatus: 'failed',
        creditStatus: 'refunded',
      },
    });
    expect(newSpend).toMatchObject({
      settlementStatus: 'settled',
      amount: -reservedCredits,
      generationSnapshot: {
        attempt: 1,
        model: 'Seedance 2.0',
        durationSeconds: 5,
        resolution: '480p',
        hasReferenceVideo: false,
        reservedCredits,
        settledCredits: reservedCredits,
        refundedCredits: 0,
        taskStatus: 'completed',
        creditStatus: 'settled',
      },
    });
    expect(postgresScalar(`
      SELECT concat_ws('|', count(*)::text, count(*) FILTER (WHERE status = 'failed')::text,
        count(*) FILTER (WHERE status = 'success')::text)
      FROM provider_usage_records
      WHERE task_id = '${task.id}'::uuid;
    `)).toBe('2|1|1');
  } finally {
    await session.context.close();
  }
});

test('修改密码后当前会话续签，其他旧会话立即失效', async ({ browser }) => {
  const current = await createAuthenticatedPage(browser, primaryAccount);
  const stale = await createAuthenticatedPage(browser, primaryAccount);
  const temporaryPassword = 'IntegrationTemporary2026!';
  let passwordChanged = false;

  try {
    const changed = await api(current.page, '/api/account/password', {
      method: 'PATCH',
      body: {
        currentPassword: primaryAccount.password,
        newPassword: temporaryPassword,
      },
    });
    expect(changed.status).toBe(200);
    passwordChanged = true;

    expect((await api(current.page, '/api/auth/me')).status).toBe(200);
    expect((await api(stale.page, '/api/auth/me')).status).toBe(401);
  } finally {
    if (passwordChanged) {
      const restored = await api(current.page, '/api/account/password', {
        method: 'PATCH',
        body: {
          currentPassword: temporaryPassword,
          newPassword: primaryAccount.password,
        },
      });
      expect(restored.status).toBe(200);
      expect((await api(current.page, '/api/auth/me')).status).toBe(200);
    }
    await Promise.all([current.context.close(), stale.context.close()]);
  }
});

test('Worker 异常退出后租约任务会恢复且不会重复扣费', async ({ browser }) => {
  test.setTimeout(100_000);
  const session = await createAuthenticatedPage(browser, primaryAccount);
  try {
    const beforeCredits = await readCredits(session.page);
    const created = await api(session.page, '/api/ai/video-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: 'integration-worker-crash-0001',
        requests: [{
          model: 'Seedance 2.0',
          prompt: '验证 Worker 崩溃后恢复的延时视频',
          config: { aspectRatio: '16:9', durationSeconds: 5, resolution: '480p' },
        }],
      },
    });
    expect(created.status).toBe(200);
    const task = created.body.tasks[0];
    const creditsAfterHold = await readCredits(session.page);
    expect(creditsAfterHold).toBe(beforeCredits - Number(task.credits));

    // 管理后台任务列表是轻量卡片 DTO，不暴露 providerTaskId。直接观察持久化关口，
    // 确保 worker 在供应商已提交、结果尚未返回且尚未结算时被强制终止。
    await expect.poll(
      () => readGenerationSubmissionCheckpoint(task.id),
      { timeout: 15_000, intervals: [100, 200, 300, 500] },
    ).toEqual({
      status: 'processing',
      processingStage: 'submitted',
      providerTaskId: `fake-${task.id}`,
      providerRunStatus: 'submitted',
      providerRunTaskId: `fake-${task.id}`,
      hasProviderResult: false,
      hasAsset: false,
    });

    dockerCompose('kill', '-s', 'KILL', 'worker');
    dockerCompose('up', '--detach', 'worker');

    await expect.poll(
      async () => (await readTask(session.page, task.id)).status,
      { timeout: 75_000, intervals: [1_000, 2_000, 3_000, 5_000] },
    ).toBe('completed');

    const completedTask = await readTask(session.page, task.id);
    // attempt 只表示用户/管理员发起的业务重试；worker 崩溃接管只推进 claimEpoch。
    expect(Number(completedTask.attempt)).toBe(Number(task.attempt));
    expect(readGenerationTaskClaimEpoch(task.id)).toBeGreaterThanOrEqual(2);
    expect(await readCredits(session.page)).toBe(creditsAfterHold);

    const ledger = await api(session.page, '/api/account/credit-ledger?limit=50');
    expect(ledger.status).toBe(200);
    const taskEntries = ledger.body.items.filter(
      (item: { relatedJobId: string | null }) => item.relatedJobId === task.id,
    );
    expect(taskEntries).toHaveLength(1);
    expect(taskEntries[0]).toMatchObject({
      type: 'spend',
      settlementStatus: 'settled',
      amount: -Number(task.credits),
    });
  } finally {
    // 即使断言失败，也保证后续清理前 Worker 已恢复运行。
    dockerCompose('up', '--detach', 'worker');
    await session.context.close();
  }
});

test('Provider 成功但本地结算失败后会自动恢复且不会二次扣费', async ({ browser }) => {
  test.setTimeout(90_000);
  const session = await createAuthenticatedPage(browser, primaryAccount);
  let failureTriggerInstalled = false;
  try {
    postgres(`
      CREATE OR REPLACE FUNCTION fullstack_reject_generated_asset()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.object_key LIKE 'generated/video/%' THEN
          RAISE EXCEPTION 'FULLSTACK_SETTLEMENT_FAILURE';
        END IF;
        RETURN NEW;
      END;
      $$;
      DROP TRIGGER IF EXISTS fullstack_reject_generated_asset ON assets;
      CREATE TRIGGER fullstack_reject_generated_asset
      BEFORE INSERT ON assets
      FOR EACH ROW EXECUTE FUNCTION fullstack_reject_generated_asset();
    `);
    failureTriggerInstalled = true;

    const beforeCredits = await readCredits(session.page);
    const created = await api(session.page, '/api/ai/video-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: 'integration-settlement-recovery-0001',
        requests: [{
          model: 'Seedance 2.0',
          prompt: '验证 Provider 成功后的本地结算恢复',
          config: { aspectRatio: '9:16', durationSeconds: 5, resolution: '480p' },
        }],
      },
    });
    expect(created.status).toBe(200);
    const task = created.body.tasks[0];
    const creditsAfterHold = await readCredits(session.page);
    expect(creditsAfterHold).toBe(beforeCredits - Number(task.credits));

    // 任务列表是轻量卡片 DTO，不携带结算内部字段。直接观察数据库中的持久化
    // 结算关口，确认供应商结果已安全落库后才移除故障触发器。
    await expect.poll(
      () => readGenerationSettlementCheckpoint(task.id),
      { timeout: 20_000, intervals: [100, 200, 300, 500] },
    ).toEqual({
      status: 'processing',
      processingStage: 'settlement-pending',
      providerRunStatus: 'settlement-pending',
      hasTaskProviderResult: true,
      hasProviderRunResult: true,
      hasSettlementError: true,
      hasAsset: false,
    });

    removeSettlementFailureTrigger();
    failureTriggerInstalled = false;

    await expect.poll(
      async () => (await readTask(session.page, task.id)).status,
      { timeout: 45_000, intervals: [1_000, 2_000, 3_000, 5_000] },
    ).toBe('completed');

    const completedTask = await readTask(session.page, task.id);
    expect(Number(completedTask.attempt)).toBe(Number(task.attempt));
    expect(readGenerationTaskClaimEpoch(task.id)).toBeGreaterThanOrEqual(2);
    // 用户任务 DTO 不暴露结算内部字段；恢复结果通过后台详情 DTO 核验。
    expect(completedTask).not.toHaveProperty('settlementError');
    const completedJob = await api(session.page, `/api/admin/jobs/${task.id}`);
    expect(completedJob.status).toBe(200);
    expect(completedJob.body.task).toMatchObject({
      status: 'completed',
      processingStage: 'completed',
      settlementError: null,
      assetId: expect.any(String),
    });
    expect(await readCredits(session.page)).toBe(creditsAfterHold);

    const ledger = await api(session.page, '/api/account/credit-ledger?limit=50');
    const taskEntries = ledger.body.items.filter(
      (item: { relatedJobId: string | null }) => item.relatedJobId === task.id,
    );
    expect(taskEntries).toHaveLength(1);
    expect(taskEntries[0]).toMatchObject({
      type: 'spend',
      settlementStatus: 'settled',
      amount: -Number(task.credits),
    });
  } finally {
    if (failureTriggerInstalled) removeSettlementFailureTrigger();
    await session.context.close();
  }
});

test('人工发票申请只写一条管理员通知 Outbox 且不会产生用户邮件事件', async ({ browser }) => {
  const session = await createAuthenticatedPage(browser, primaryAccount);
  const orderId = randomUUID();
  const providerTradeId = `fullstack-invoice-${randomUUID()}`;
  const receiveEmail = `invoice-${randomUUID()}@example.com`;

  postgres(`
    INSERT INTO orders (
      id, user_id, plan_id, kind, plan_name, amount, billing, status,
      invoice_status, credit_status, credit_amount, credit_bucket,
      payment_method, payment_provider, provider_trade_id, paid_at
    )
    SELECT
      '${orderId}'::uuid, u.id, NULL, 'main', '全链路人工发票测试订单', 2900,
      'monthly', 'paid', 'unissued', 'settled', 0, 'system',
      '全链路测试支付', 'manual', '${providerTradeId}', now()
    FROM users u
    WHERE u.email = '${primaryAccount.email}';
  `);

  try {
    const payload = {
      orderId,
      invoiceTitle: '全链路人工开票测试公司',
      taxId: '91310000FULLSTACK',
      receiveEmail,
      note: '管理员在外部开票系统制作并人工发送。',
    };
    const created = await api(session.page, '/api/invoices', {
      method: 'POST',
      body: payload,
    });

    expect(created.status).toBe(200);
    expect(created.body.invoice).toMatchObject({
      orderId,
      invoiceTitle: payload.invoiceTitle,
      taxId: payload.taxId,
      receiveEmail,
      status: 'unissued',
    });
    const invoiceId = String(created.body.invoice.id);
    expect(invoiceId).toMatch(/^[0-9a-f-]{36}$/i);

    expect(postgresScalar(`
      SELECT count(*)
      FROM invoice_notification_outbox
      WHERE invoice_id = '${invoiceId}'::uuid;
    `)).toBe('1');
    expect(postgresScalar(`
      SELECT event_key
      FROM invoice_notification_outbox
      WHERE invoice_id = '${invoiceId}'::uuid;
    `)).toBe(`invoice-requested-admin:${invoiceId}`);
    expect(postgresScalar(`
      SELECT count(*)
      FROM notification_events
      WHERE related_invoice_id = '${invoiceId}'::uuid
        AND (
          event_type IN ('invoice-requested', 'invoice-status-changed')
          OR recipient IN ('${primaryAccount.email}', '${receiveEmail}')
        );
    `)).toBe('0');

    const duplicate = await api(session.page, '/api/invoices', {
      method: 'POST',
      body: payload,
    });
    expect(duplicate.status).toBe(409);
    expect(postgresScalar(`
      SELECT count(*)
      FROM invoice_requests
      WHERE order_id = '${orderId}'::uuid;
    `)).toBe('1');
    expect(postgresScalar(`
      SELECT count(*)
      FROM invoice_notification_outbox outbox
      JOIN invoice_requests invoice ON invoice.id = outbox.invoice_id
      WHERE invoice.order_id = '${orderId}'::uuid;
    `)).toBe('1');
  } finally {
    postgres(`
      DELETE FROM notification_events
      WHERE related_order_id = '${orderId}'::uuid
         OR related_invoice_id IN (
           SELECT id FROM invoice_requests WHERE order_id = '${orderId}'::uuid
         );
      DELETE FROM invoice_notification_outbox
      WHERE invoice_id IN (
        SELECT id FROM invoice_requests WHERE order_id = '${orderId}'::uuid
      );
      DELETE FROM invoice_requests WHERE order_id = '${orderId}'::uuid;
      DELETE FROM orders WHERE id = '${orderId}'::uuid;
    `);
    await session.context.close();
  }
});

test('Seedream 图片批次完成文生图、多图融合、跨图框选、资产沿用与独立成本归档', async ({ browser }) => {
  test.setTimeout(120_000);
  const session = await createAuthenticatedPage(browser, primaryAccount);
  try {
    postgres(`
      UPDATE consumption_settings
      SET credits = CASE resolution WHEN '1K' THEN 14 WHEN '2K' THEN 28 END,
          available = true,
          updated_at = now()
      WHERE kind = 'image'
        AND model = 'Seedream 5.0 Pro'
        AND resolution IN ('1K', '2K');
    `);

    const [firstReference, secondReference] = await Promise.all([
      uploadFullstackImage(session.page, `seedream-first-${randomUUID()}`),
      uploadFullstackImage(session.page, `seedream-second-${randomUUID()}`),
    ]);
    expect(firstReference).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
      sizeBytes: expect.any(Number),
    });
    const originalDimensions = `${firstReference.width}x${firstReference.height}`;
    postgres(`
      UPDATE assets
      SET width = NULL, height = NULL
      WHERE id = '${firstReference.id}'::uuid;
    `);

    const financialSnapshotBeforeRejectedLegacyReference = postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM generation_batches
         WHERE user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}')),
        (SELECT count(*) FROM generation_tasks
         WHERE user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}')),
        (SELECT count(*) FROM credit_ledger
         WHERE user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}')),
        (SELECT count(*) FROM generation_provider_runs run
         JOIN generation_tasks task ON task.id = run.task_id
         WHERE task.user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}'))
      );
    `);
    const creditsBeforeRejectedLegacyReference = await readCredits(session.page);
    const rejectedLegacyReference = await api(session.page, '/api/ai/image-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: `fullstack-seedream-legacy-rejected-${randomUUID()}`,
        requests: [{
          model: 'Seedream 5.0 Pro',
          prompt: '使用历史参考图生成产品海报',
          config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
          references: [{ assetId: firstReference.id, role: 'reference_image' }],
          annotations: [],
        }],
      },
    });
    expect(rejectedLegacyReference.status).toBe(400);
    expect(rejectedLegacyReference.body).toMatchObject({
      code: 'REFERENCE_IMAGE_METADATA_INCOMPLETE',
    });
    expect(await readCredits(session.page)).toBe(creditsBeforeRejectedLegacyReference);
    expect(postgresScalar(`
      SELECT concat_ws('|',
        (SELECT count(*) FROM generation_batches
         WHERE user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}')),
        (SELECT count(*) FROM generation_tasks
         WHERE user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}')),
        (SELECT count(*) FROM credit_ledger
         WHERE user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}')),
        (SELECT count(*) FROM generation_provider_runs run
         JOIN generation_tasks task ON task.id = run.task_id
         WHERE task.user_id = (SELECT id FROM users WHERE email = '${primaryAccount.email}'))
      );
    `)).toBe(financialSnapshotBeforeRejectedLegacyReference);

    const metadataDryRun = dockerComposeOutput(
      'exec', '--no-TTY', 'api',
      'npm', '--workspace', 'apps/api', 'run', 'backfill:image-metadata:prod',
      '--', '--dry-run', '--asset-id', firstReference.id,
    );
    expect(metadataDryRun).toContain('"wouldUpdate":1');
    expect(metadataDryRun).toContain('"remainingCount":1');

    const metadataBackfill = dockerComposeOutput(
      'exec', '--no-TTY', 'api',
      'npm', '--workspace', 'apps/api', 'run', 'backfill:image-metadata:prod',
      '--', '--asset-id', firstReference.id,
    );
    expect(metadataBackfill).toContain('"updated":1');
    expect(metadataBackfill).toContain('"remainingCount":0');
    expect(postgresScalar(`
      SELECT concat(width, 'x', height)
      FROM assets WHERE id = '${firstReference.id}'::uuid;
    `)).toBe(originalDimensions);

    const metadataReplay = dockerComposeOutput(
      'exec', '--no-TTY', 'api',
      'npm', '--workspace', 'apps/api', 'run', 'backfill:image-metadata:prod',
      '--', '--asset-id', firstReference.id,
    );
    expect(metadataReplay).toContain('"scanned":0');
    expect(metadataReplay).toContain('"remainingCount":0');

    const beforeCredits = await readCredits(session.page);
    const idempotencyKey = `fullstack-seedream-batch-${randomUUID()}`;
    const batchBody = {
      idempotencyKey,
      requests: [
        {
          model: 'Seedream 5.0 Pro',
          prompt: '生成一张极简摄影棚中的白色陶瓷杯产品图',
          config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
          references: [],
          annotations: [],
        },
        {
          model: 'Seedream 5.0 Pro',
          prompt: '融合两张参考图的主体与配色，生成现代产品海报',
          config: { resolution: '1K', aspectRatio: '4:3', optimizePromptMode: 'fast' },
          references: [
            { assetId: firstReference.id, role: 'reference_image' },
            { assetId: secondReference.id, role: 'reference_image' },
          ],
          annotations: [],
        },
        {
          model: 'Seedream 5.0 Pro',
          prompt: '将 @标记1 的主体放到 @标记2 区域，保持其他内容不变',
          config: { resolution: '2K', aspectRatio: '3:4', optimizePromptMode: 'standard' },
          references: [
            { assetId: firstReference.id, role: 'reference_image' },
            { assetId: secondReference.id, role: 'reference_image' },
          ],
          annotations: [
            { token: '@标记1', assetId: firstReference.id, type: 'bbox', x1: 120, y1: 180, x2: 640, y2: 760 },
            { token: '@标记2', assetId: secondReference.id, type: 'bbox', x1: 118, y1: 331, x2: 933, y2: 871 },
          ],
        },
      ],
    };

    const created = await api(session.page, '/api/ai/image-tasks/batch', {
      method: 'POST',
      body: batchBody,
    });
    expect(created.status).toBe(200);
    expect(created.body.tasks).toHaveLength(3);
    expect(created.body.tasks.map((task: { kind: string }) => task.kind)).toEqual(['image', 'image', 'image']);
    expect(created.body.tasks.map((task: { credits: number }) => Number(task.credits))).toEqual([14, 14, 28]);

    const replayed = await api(session.page, '/api/ai/image-tasks/batch', {
      method: 'POST',
      body: batchBody,
    });
    expect(replayed.status).toBe(200);
    expect(replayed.body.tasks.map((task: { id: string }) => task.id)).toEqual(
      created.body.tasks.map((task: { id: string }) => task.id),
    );
    expect(await readCredits(session.page)).toBe(beforeCredits - 56);

    const taskIds = created.body.tasks.map((task: { id: string }) => task.id);
    await expect.poll(async () => Promise.all(taskIds.map(async (taskId: string) => (
      (await readTask(session.page, taskId)).status
    ))), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000, 3_000],
    }).toEqual(['completed', 'completed', 'completed']);

    const completedTasks = await Promise.all(taskIds.map((taskId: string) => readTask(session.page, taskId)));
    expect(completedTasks.map(task => task.creditStatus)).toEqual(['settled', 'settled', 'settled']);
    expect(completedTasks.every(task => typeof task.assetId === 'string')).toBe(true);
    expect(await readCredits(session.page)).toBe(beforeCredits - 56);

    const imageQueue = await api(session.page, '/api/ai/tasks?kind=image&limit=50');
    expect(imageQueue.status).toBe(200);
    expect(taskIds.every((taskId: string) => imageQueue.body.items.some((task: { id: string }) => task.id === taskId))).toBe(true);
    const videoQueue = await api(session.page, '/api/ai/tasks?kind=video&limit=50');
    expect(videoQueue.status).toBe(200);
    expect(taskIds.some((taskId: string) => videoQueue.body.items.some((task: { id: string }) => task.id === taskId))).toBe(false);

    const generatedAssets = await Promise.all(completedTasks.map(async task => {
      const result = await api(session.page, `/api/assets/${task.assetId}`);
      expect(result.status).toBe(200);
      expect(result.body.asset).toMatchObject({ type: 'image', source: 'ai-image' });
      expect(result.body.asset.thumbnailUrl).toEqual(expect.any(String));
      expect(await fetchStatus(session.page, `/api/assets/${task.assetId}/download`)).toBe(200);
      return result.body.asset;
    }));
    const editedAsset = generatedAssets[2];
    expect(editedAsset.generation).toMatchObject({
      kind: 'image',
      model: 'Seedream 5.0 Pro',
      prompt: '将 @标记1 的主体放到 @标记2 区域，保持其他内容不变',
      config: {
        resolution: '2K',
        aspectRatio: '3:4',
        optimizePromptMode: 'standard',
        annotations: batchBody.requests[2].annotations,
      },
    });
    expect(editedAsset.generation.config.referenceAssets.map((reference: { id: string }) => reference.id)).toEqual([
      firstReference.id,
      secondReference.id,
    ]);
    expect(JSON.stringify(editedAsset)).not.toMatch(/objectKey|thumbnailKey|data:image\//i);

    const month = postgresScalar(`
      SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM');
    `);
    const imageCostOverview = await api(session.page, `/api/admin/api-usage/image/overview?range=month&month=${month}`);
    expect(imageCostOverview.status).toBe(200);
    expect(imageCostOverview.body.pricing).toMatchObject({
      model: 'Seedream 5.0 Pro',
      firstReferenceImageIncluded: 1,
      additionalReferenceUnitPriceCny: '0.020000',
      outputPixelThreshold: 2_360_000,
      smallOutputPriceCny: '0.300000',
      largeOutputPriceCny: '0.600000',
    });
    expect(imageCostOverview.body.pricing.disclaimer).toContain('官网公开列表价估算');
    expect(imageCostOverview.body.summary).toMatchObject({
      taskCount: 3,
      settledCredits: 56,
      referenceImageCount: 4,
      knownCostTaskCount: 3,
      missingEvidenceTaskCount: 0,
      knownCostCny: '0.940000',
      operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      businessEstimatedCostCny: '0.940000',
      operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '0.940000',
    });
    const imageCostTasks = await api(session.page, `/api/admin/api-usage/image/tasks?range=month&month=${month}&limit=50`);
    expect(imageCostTasks.status).toBe(200);
    const ourCostRows = imageCostTasks.body.items.filter((row: { taskId: string }) => taskIds.includes(row.taskId));
    expect(ourCostRows).toHaveLength(3);
    expect(ourCostRows.map((row: { estimatedCostCny: string }) => row.estimatedCostCny).sort()).toEqual([
      '0.300000',
      '0.320000',
      '0.320000',
    ]);
    expect(ourCostRows.every((row: { estimatedCostCny: unknown }) => (
      typeof row.estimatedCostCny === 'string' && /^\d+\.\d{6}$/.test(row.estimatedCostCny)
    ))).toBe(true);
    expect(ourCostRows.every((row: { requestEvidenceStatus: string }) => row.requestEvidenceStatus === 'local-only')).toBe(true);
    expect(postgresScalar(`
      SELECT count(*) FROM provider_usage_records
      WHERE task_id = ANY(ARRAY[${taskIds.map((taskId: string) => `'${taskId}'::uuid`).join(',')}]);
    `)).toBe('0');
    expect(postgresScalar(`
      SELECT count(*) FROM image_provider_usage_records
      WHERE task_id = ANY(ARRAY[${taskIds.map((taskId: string) => `'${taskId}'::uuid`).join(',')}]);
    `)).toBe('3');

    await session.page.goto('/app/ai-studio');
    await session.page.getByRole('tab', { name: 'AI 图片' }).click();
    const imageQueuePanel = session.page.getByRole('region', { name: '生成记录' });
    await expect(imageQueuePanel).toBeVisible();
    await expect(imageQueuePanel.getByText('已完成')).toHaveCount(3);
    await imageQueuePanel.getByRole('button', { name: '预览图片', exact: true }).first().click();
    await expect(session.page.getByRole('heading', { name: '素材预览' })).toBeVisible();
    await session.page.getByRole('button', { name: '关闭素材预览' }).click();

    await session.page.getByRole('button', { name: '数字资产', exact: true }).click();
    await expect(session.page.getByRole('heading', { name: '数字资产' })).toBeVisible();
    // 数字资产分类统一使用共享 Studio 标签，并通过明确的 aria-label 播报数量。
    await session.page.getByRole('tab', { name: /^AI图片，(?:\d+个素材|数量暂不可用)$/ }).click();
    await expect(session.page.getByText(/Seedream 5\.0 Pro 图片/).first()).toBeVisible();
    // 生成记录使用只读预览；沿用操作从数字资产的可编辑详情进入。
    await session.page.getByRole('button', { name: /^打开素材 Seedream 5\.0 Pro 图片/ }).first().click();
    await session.page.getByRole('button', { name: '沿用生成', exact: true }).click();
    await expect(session.page.locator('#image-prompt')).not.toHaveValue('');
  } finally {
    await session.context.close();
  }
});

test('Seedream 模拟 HTTP 200 经过真实 checkpoint、PNG 归档和积分结算链路', async ({ browser }) => {
  test.setTimeout(120_000);
  const session = await createAuthenticatedPage(browser, primaryAccount);
  const isolatedWorkerName = `${composeProject}-seedream-checkpoint-${randomUUID().slice(0, 8)}`;
  let isolatedWorkerId = '';
  let outputObjectKey = '';

  dockerCompose('stop', 'worker');
  try {
    postgres(`
      UPDATE consumption_settings
      SET credits = 14, available = true, updated_at = now()
      WHERE kind = 'image'
        AND model = 'Seedream 5.0 Pro'
        AND resolution = '1K';
    `);
    expect(postgresScalar(`
      SELECT count(*)
      FROM generation_tasks
      WHERE status IN ('queued', 'processing');
    `)).toBe('0');

    const beforeCredits = await readCredits(session.page);
    const created = await api(session.page, '/api/ai/image-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: `fullstack-seedream-checkpoint-${randomUUID()}`,
        requests: [{
          model: 'Seedream 5.0 Pro',
          prompt: '验证全栈 checkpoint 落库、归档与结算',
          config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
          references: [],
          annotations: [],
        }],
      },
    });
    expect(created.status).toBe(200);
    const task = created.body.tasks[0];
    expect(task).toMatchObject({ status: 'queued', creditStatus: 'held', credits: 14 });
    expect(await readCredits(session.page)).toBe(beforeCredits - 14);

    const userId = postgresScalar(`
      SELECT id FROM users WHERE email = '${primaryAccount.email}';
    `);
    outputObjectKey = `generated/image/${userId}/${task.id}/attempt-0/output.png`;
    const png = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 24, g: 20, b: 36, alpha: 1 },
      },
    }).png().toBuffer();
    writeApiStorageObject(outputObjectKey, png.toString('base64'));

    isolatedWorkerId = dockerComposeOutput(
      'run', '--detach', '--no-deps', '--name', isolatedWorkerName,
      '-e', 'ARK_API_KEY=fullstack-seedream-key',
      '-e', 'ARK_BASE_URL=http://seedream-mock:4400/api/v3',
      '-e', 'ARK_SEEDREAM_TIMEOUT_MS=10000',
      '-e', 'ARK_DOWNLOAD_TIMEOUT_MS=10000',
      'worker',
    ).trim();
    expect(isolatedWorkerId).not.toBe('');

    await expect.poll(
      async () => (await readTask(session.page, task.id)).status,
      { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] },
    ).toBe('completed');

    const completed = await readTask(session.page, task.id);
    expect(completed).toMatchObject({
      processingStage: 'completed',
      creditStatus: 'settled',
      settledCredits: 14,
      refundedCredits: 0,
      assetId: expect.any(String),
    });
    expect(await readCredits(session.page)).toBe(beforeCredits - 14);

    expect(postgresScalar(`
      SELECT concat_ws('|',
        run.provider,
        run.provider_task_id,
        run.provider_request_id,
        run.provider_response_checkpoint->>'version',
        (run.provider_response_url IS NULL)::text,
        (run.provider_response_observed_at IS NOT NULL)::text,
        (run.provider_response_url_expires_at IS NOT NULL)::text
      )
      FROM generation_provider_runs run
      WHERE run.task_id = '${task.id}'::uuid;
    `)).toBe([
      'volcengine-ark',
      `seedream-sync:${task.id}:0`,
      'fullstack-seedream-checkpoint-request',
      '1',
      'true',
      'true',
      'true',
    ].join('|'));

    expect(postgresScalar(`
      SELECT concat_ws('|',
        provider_request_id, request_evidence_status, evidence_status,
        reference_image_count, additional_reference_image_count,
        output_width, output_height, output_pixels, output_tier,
        estimated_cost_cny, generated_images, output_tokens, total_tokens
      )
      FROM image_provider_usage_records
      WHERE task_id = '${task.id}'::uuid;
    `)).toBe([
      'fullstack-seedream-checkpoint-request', 'provider-id', 'known',
      '0', '0', '1024', '1024', '1048576', 'small',
      '0.300000', '1', '12', '12',
    ].join('|'));

    const asset = await api(session.page, `/api/assets/${completed.assetId}`);
    expect(asset.status).toBe(200);
    expect(asset.body.asset).toMatchObject({
      type: 'image',
      source: 'ai-image',
      width: 1024,
      height: 1024,
      thumbnailUrl: expect.any(String),
    });
    expect(await fetchStatus(session.page, `/api/assets/${completed.assetId}/download`)).toBe(200);
  } finally {
    if (isolatedWorkerId) {
      execFileSync('docker', ['rm', '--force', isolatedWorkerId], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      });
    }
    dockerCompose('start', 'worker');
    await session.context.close();
  }
});

test('十万条历史资产使用四向键集分页、直达尾页并满足卡片性能门槛', async ({ browser }) => {
  const folderId = randomUUID();
  const marker = `fullstack-p1-assets-${folderId}`;
  const ownerId = postgresScalar(`
    SELECT id FROM users WHERE email = '${primaryAccount.email}';
  `);
  postgres(`
    INSERT INTO asset_folders (id, user_id, name, source, is_system, created_at)
    VALUES (
      '${folderId}'::uuid, '${ownerId}'::uuid,
      'P1 十万资产分页验收', 'uploaded-audio', false, now()
    );

    INSERT INTO assets (
      id, user_id, folder_id, name, type, source, object_key, thumbnail_key,
      size_bytes, duration_seconds, deletion_status, thumbnail_status,
      created_at, updated_at
    )
    SELECT
      CASE
        WHEN asset_number = 24 THEN (
          'ffffffff-ffff-4fff-bfff-' || substr(md5('${marker}-tie-24'), 1, 12)
        )::uuid
        WHEN asset_number = 25 THEN (
          '00000000-0000-4000-8000-' || substr(md5('${marker}-tie-25'), 1, 12)
        )::uuid
        ELSE md5('${marker}-id-' || asset_number)::uuid
      END,
      '${ownerId}'::uuid,
      '${folderId}'::uuid,
      'P1四向分页-' || lpad(asset_number::text, 6, '0'),
      'audio', 'uploaded-audio',
      '${marker}/' || lpad(asset_number::text, 6, '0') || '.mp3',
      NULL, 128, 1, 'active', 'not-required',
      timestamptz '2026-07-17 00:00:00+00'
        - CASE WHEN asset_number = 25 THEN 24 ELSE asset_number END * interval '1 microsecond',
      timestamptz '2026-07-17 00:00:00+00'
        - CASE WHEN asset_number = 25 THEN 24 ELSE asset_number END * interval '1 microsecond'
    FROM generate_series(1, 100000) AS assets_to_create(asset_number);

    ANALYZE assets;
  `);

  const session = await createAuthenticatedPage(browser, primaryAccount);
  const pageSize = 24;
  const basePath = `/api/assets/cards?folderId=${folderId}&limit=${pageSize}`;
  try {
    const first = await api(session.page, `${basePath}&position=first`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(pageSize);
    expect(first.body.items[0].name).toBe('P1四向分页-000001');
    expect(first.body.items.at(-1).name).toBe('P1四向分页-000024');
    expect(first.body.pagination).toMatchObject({
      position: 'first',
      limit: pageSize,
      hasPrevious: false,
      hasNext: true,
      previousCursor: null,
      currentPage: 1,
      totalPages: 4167,
      totalItems: 100000,
      snapshotCursor: expect.any(String),
      nextCursor: expect.any(String),
    });

    const next = await api(
      session.page,
      `${basePath}&position=next&cursor=${encodeURIComponent(first.body.pagination.nextCursor)}`,
    );
    expect(next.status).toBe(200);
    expect(next.body.items).toHaveLength(pageSize);
    expect(next.body.items[0].name).toBe('P1四向分页-000025');
    expect(next.body.items.at(-1).name).toBe('P1四向分页-000048');
    expect(next.body.pagination).toMatchObject({
      position: 'next',
      hasPrevious: true,
      hasNext: true,
      currentPage: 2,
      totalPages: 4167,
      totalItems: 100000,
      snapshotCursor: first.body.pagination.snapshotCursor,
    });
    expect(intersection(assetIds(first.body.items), assetIds(next.body.items))).toEqual([]);

    const previous = await api(
      session.page,
      `${basePath}&position=previous&cursor=${encodeURIComponent(next.body.pagination.previousCursor)}`,
    );
    expect(previous.status).toBe(200);
    expect(assetIds(previous.body.items)).toEqual(assetIds(first.body.items));
    expect(previous.body.pagination).toMatchObject({
      position: 'previous',
      hasPrevious: false,
      hasNext: true,
      currentPage: 1,
      totalPages: 4167,
      totalItems: 100000,
      snapshotCursor: first.body.pagination.snapshotCursor,
    });

    let observedLastRequests = 0;
    const observeLastRequest = (request: Request) => {
      const url = new URL(request.url());
      if (
        url.pathname === '/api/assets/cards'
        && url.searchParams.get('folderId') === folderId
        && url.searchParams.get('position') === 'last'
      ) observedLastRequests += 1;
    };
    session.page.on('request', observeLastRequest);
    const last = await api(session.page, `${basePath}&position=last`);
    session.page.off('request', observeLastRequest);

    expect(last.status).toBe(200);
    expect(observedLastRequests).toBe(1);
    expect(last.body.items).toHaveLength(16);
    expect(last.body.items[0].name).toBe('P1四向分页-099985');
    expect(last.body.items.at(-1).name).toBe('P1四向分页-100000');
    expect(last.body.pagination).toMatchObject({
      position: 'last',
      hasPrevious: true,
      hasNext: false,
      nextCursor: null,
      currentPage: 4167,
      totalPages: 4167,
      totalItems: 100000,
      snapshotCursor: expect.any(String),
    });
    expect(intersection(assetIds(next.body.items), assetIds(last.body.items))).toEqual([]);

    const beforeLast = await api(
      session.page,
      `${basePath}&position=previous&cursor=${encodeURIComponent(last.body.pagination.previousCursor)}`,
    );
    expect(beforeLast.status).toBe(200);
    expect(beforeLast.body.items).toHaveLength(pageSize);
    expect(beforeLast.body.items[0].name).toBe('P1四向分页-099961');
    expect(beforeLast.body.items.at(-1).name).toBe('P1四向分页-099984');
    expect(beforeLast.body.pagination).toMatchObject({
      position: 'previous',
      hasPrevious: true,
      hasNext: true,
      currentPage: 4166,
      totalPages: 4167,
      totalItems: 100000,
      snapshotCursor: last.body.pagination.snapshotCursor,
    });
    expect(intersection(assetIds(beforeLast.body.items), assetIds(last.body.items))).toEqual([]);

    const nextBoundary = await readAssetCursorBoundary(first.body.items.at(-1).id);
    const previousBoundary = await readAssetCursorBoundary(next.body.items[0].id);
    const explainQueries = [
      {
        position: 'first',
        sql: buildAssetCardExplainSql({ ownerId, folderId, order: 'DESC' }),
      },
      {
        position: 'next',
        sql: buildAssetCardExplainSql({
          ownerId, folderId, order: 'DESC', comparison: '<', boundary: nextBoundary,
        }),
      },
      {
        position: 'previous',
        sql: buildAssetCardExplainSql({
          ownerId, folderId, order: 'ASC', comparison: '>', boundary: previousBoundary,
        }),
      },
      {
        position: 'last',
        sql: buildAssetCardExplainSql({ ownerId, folderId, order: 'ASC', includeTotalCount: true }),
      },
    ];
    for (const query of explainQueries) {
      expect(query.sql, `${query.position} 不得使用 OFFSET`).not.toMatch(/\bOFFSET\b/i);
      const explain = postgresExplain(query.sql);
      const indexNames = collectExplainIndexNames(explain.plan);
      // 此压测的 10 万条数据同属一个文件夹，PostgreSQL 可能合理选择更窄的
      // user cursor 索引；两者均保持 created_at/id 键集顺序，不强制优化器使用某一个等价索引。
      expect(
        indexNames.some(indexName => (
          indexName === 'idx_assets_user_folder_cursor'
          || indexName === 'idx_assets_user_cursor'
        )),
        `${query.position} 必须通过用户资产键集索引读取，执行计划：${JSON.stringify(explain.plan)}`,
      ).toBe(true);
    }

    await timedApi(session.page, `${basePath}&position=first`);
    await timedApi(session.page, `${basePath}&position=last`);
    const performanceSamples: Array<{ status: number; elapsedMs: number }> = [];
    for (let index = 0; index < 20; index += 1) {
      performanceSamples.push(await timedApi(
        session.page,
        `${basePath}&position=${index % 2 === 0 ? 'first' : 'last'}`,
      ));
    }
    expect(performanceSamples.every(sample => sample.status === 200)).toBe(true);
    expect(
      percentile(performanceSamples.map(sample => sample.elapsedMs), 0.95),
      `资产卡片接口耗时样本：${performanceSamples.map(sample => sample.elapsedMs.toFixed(1)).join(', ')}`,
    ).toBeLessThan(300);
  } finally {
    await session.context.close();
    postgres(`
      DELETE FROM assets WHERE folder_id = '${folderId}'::uuid;
      DELETE FROM asset_folders WHERE id = '${folderId}'::uuid;
      ANALYZE assets;
    `);
  }
});

test('真人库在真实事务并发下执行 free 1/1、pro 5/3、enterprise 不限/10 配额', async ({ browser }) => {
  const marker = randomUUID();
  const accounts = {
    free: {
      id: randomUUID(),
      email: `portrait-free-${marker}@lindyson.test`,
      password: secondaryAccount.password,
    },
    pro: {
      id: randomUUID(),
      email: `portrait-pro-${marker}@lindyson.test`,
      password: secondaryAccount.password,
    },
    enterprise: {
      id: randomUUID(),
      email: `portrait-enterprise-${marker}@lindyson.test`,
      password: secondaryAccount.password,
    },
  };

  postgres(`
    INSERT INTO users (id, email, password_hash, user_name, plan_id)
    SELECT '${accounts.free.id}'::uuid, '${accounts.free.email}', password_hash,
           '全栈免费真人用户', NULL::uuid
    FROM users WHERE email = '${secondaryAccount.email}'
    UNION ALL
    SELECT '${accounts.pro.id}'::uuid, '${accounts.pro.email}', password_hash,
           '全栈专业真人用户', (SELECT id FROM plans WHERE code = 'pro' AND kind = 'main')
    FROM users WHERE email = '${secondaryAccount.email}'
    UNION ALL
    SELECT '${accounts.enterprise.id}'::uuid, '${accounts.enterprise.email}', password_hash,
           '全栈企业真人用户', (SELECT id FROM plans WHERE code = 'enterprise' AND kind = 'main')
    FROM users WHERE email = '${secondaryAccount.email}';
  `);

  const free = await createAuthenticatedPage(browser, accounts.free);
  const pro = await createAuthenticatedPage(browser, accounts.pro);
  const enterprise = await createAuthenticatedPage(browser, accounts.enterprise);
  const other = await createAuthenticatedPage(browser, primaryAccount);
  try {
    expect(postgresScalar(`
      SELECT coalesce(plan_id::text, 'NULL')
      FROM users WHERE id = '${accounts.free.id}'::uuid;
    `)).toBe('NULL');

    const initialCapacity = await api(free.page, '/api/real-portrait-capacity');
    expect(initialCapacity.status).toBe(200);
    expect(initialCapacity.body.capacity).toMatchObject({
      sourcePlanCode: 'free',
      entitlements: { enabled: true, profileLimit: 1, activeLimit: 1, assetsPerActor: 1 },
      usage: { profiles: 0, active: 0 },
    });
    expect(initialCapacity.body.capacity.sourcePlanName).toBeTruthy();

    const createActors = async (page: Page, prefix: string, count: number) => Promise.all(
      Array.from({ length: count }, (_, index) => api(page, '/api/real-portrait-actors', {
        method: 'POST',
        body: { alias: `${prefix}-${index + 1}` },
      })),
    );
    const successes = (results: Awaited<ReturnType<typeof createActors>>) => (
      results.filter(result => result.status === 200).map(result => result.body.actor)
    );
    const expectQuotaFailures = (
      results: Awaited<ReturnType<typeof createActors>>,
      expected: number,
      code: string,
    ) => {
      const failures = results.filter(result => result.status !== 200);
      expect(failures).toHaveLength(expected);
      expect(failures.every(result => result.status === 409 && result.body.code === code)).toBe(true);
    };

    const freeCreates = await createActors(free.page, '免费演员', 2);
    const freeActors = successes(freeCreates);
    expect(freeActors).toHaveLength(1);
    expectQuotaFailures(freeCreates, 1, 'REAL_PORTRAIT_PROFILE_QUOTA_EXCEEDED');

    const proCreates = await createActors(pro.page, '专业演员', 6);
    const proActors = successes(proCreates);
    expect(proActors).toHaveLength(5);
    expectQuotaFailures(proCreates, 1, 'REAL_PORTRAIT_PROFILE_QUOTA_EXCEEDED');

    const enterpriseCreates = await createActors(enterprise.page, '企业演员', 11);
    const enterpriseActors = successes(enterpriseCreates);
    expect(enterpriseActors).toHaveLength(11);
    expectQuotaFailures(enterpriseCreates, 0, 'REAL_PORTRAIT_PROFILE_QUOTA_EXCEEDED');

    const activationBody = {
      purpose: '全栈测试：在授权后用于商业 AI 视频生成',
      commercialUse: true,
      portraitNoticeVersion: 'fullstack-portrait-v1',
      sensitiveInfoNoticeVersion: 'fullstack-sensitive-v1',
    };
    const activateActors = async (page: Page, actors: Array<{ id: string }>) => Promise.all(
      actors.map(actor => api(page, `/api/real-portrait-actors/${actor.id}/activation-requests`, {
        method: 'POST',
        body: activationBody,
      })),
    );

    const freeActivations = await activateActors(free.page, freeActors);
    expect(freeActivations.filter(result => result.status === 200)).toHaveLength(1);

    const proActivations = await activateActors(pro.page, proActors);
    expect(proActivations.filter(result => result.status === 200)).toHaveLength(3);
    expect(proActivations.filter(result => result.body.code === 'REAL_PORTRAIT_ACTIVE_QUOTA_EXCEEDED')).toHaveLength(2);

    const enterpriseWarmupActivations = await activateActors(
      enterprise.page,
      enterpriseActors.slice(0, 9),
    );
    expect(enterpriseWarmupActivations.filter(result => result.status === 200)).toHaveLength(9);

    // 激活接口另有每账号每小时 10 次的安全限流。这里重置隔离测试库中的账号维度
    // 计数，让最后两个并发请求真正竞争第 10 个套餐名额，而不是被独立限流遮蔽。
    postgres(`
      DELETE FROM auth_rate_limit_events
      WHERE scope = 'real-portrait-activation:account';
    `);
    const enterpriseLastSlotActivations = await activateActors(
      enterprise.page,
      enterpriseActors.slice(9),
    );
    expect(enterpriseLastSlotActivations.filter(result => result.status === 200)).toHaveLength(1);
    expect(
      enterpriseLastSlotActivations.filter(
        result => result.status === 409
          && result.body.code === 'REAL_PORTRAIT_ACTIVE_QUOTA_EXCEEDED',
      ),
    ).toHaveLength(1);

    const [freeList, proList, enterpriseList] = await Promise.all([
      api(free.page, '/api/real-portrait-actors'),
      api(pro.page, '/api/real-portrait-actors'),
      api(enterprise.page, '/api/real-portrait-actors'),
    ]);
    expect(freeList.body.capacity).toMatchObject({
      sourcePlanCode: 'free',
      entitlements: { profileLimit: 1, activeLimit: 1, assetsPerActor: 1 },
      usage: { profiles: 1, active: 1 },
    });
    expect(proList.body.capacity).toMatchObject({
      sourcePlanCode: 'pro',
      entitlements: { profileLimit: 5, activeLimit: 3, assetsPerActor: 2 },
      usage: { profiles: 5, active: 3 },
    });
    expect(enterpriseList.body.capacity).toMatchObject({
      sourcePlanCode: 'enterprise',
      entitlements: { profileLimit: null, activeLimit: 10, assetsPerActor: 2 },
      usage: { profiles: 11, active: 10 },
    });

    const crossUserRead = await api(other.page, `/api/real-portrait-actors/${freeActors[0].id}`);
    expect(crossUserRead.status).toBe(404);
    expect(crossUserRead.body).not.toHaveProperty('providerGroupId');
    expect(JSON.stringify(freeList.body)).not.toContain('asset://');
  } finally {
    await Promise.all([
      free.context.close(),
      pro.context.close(),
      enterprise.context.close(),
      other.context.close(),
    ]);
  }
});

test('真人演员从本人授权、官方 H5 回调、素材上传到视频生成，并在本人撤回后立即阻断新任务', async ({ browser }) => {
  test.setTimeout(120_000);
  const marker = randomUUID();
  const account = {
    id: randomUUID(),
    email: `portrait-lifecycle-${marker}@lindyson.test`,
    password: secondaryAccount.password,
  };
  postgres(`
    INSERT INTO users (id, email, password_hash, user_name, plan_id)
    SELECT '${account.id}', '${account.email}', password_hash,
           '全栈真人链路用户', NULL::uuid
    FROM users WHERE email = '${secondaryAccount.email}';

    INSERT INTO asset_folders (user_id, name, source, is_system)
    VALUES
      ('${account.id}', 'AI 视频', 'ai-video', true),
      ('${account.id}', 'AI 图片', 'ai-image', true),
      ('${account.id}', '已上传视频', 'uploaded-video', true),
      ('${account.id}', '已上传图片', 'uploaded-image', true),
      ('${account.id}', '已上传音频', 'uploaded-audio', true);
  `);

  const creator = await createAuthenticatedPage(browser, account);
  const admin = await createAuthenticatedPage(browser, primaryAccount);
  const subjectContext = await browser.newContext();
  const subjectPage = await subjectContext.newPage();
  await subjectPage.goto('/');

  try {
    const creditGrant = await api(admin.page, '/api/admin/credits/adjust', {
      method: 'POST',
      headers: { 'Idempotency-Key': `fullstack-portrait-credit-${marker}` },
      body: {
        userId: account.id,
        mainDelta: 0,
        addonDelta: 100,
        note: '全栈测试：真人演员视频生成积分',
      },
    });
    expect(creditGrant.status).toBe(200);
    expect(creditGrant.body.user).toMatchObject({ addonCredits: 100, credits: 100 });

    const created = await api(creator.page, '/api/real-portrait-actors', {
      method: 'POST',
      body: { alias: '全栈本人授权演员' },
    });
    expect(created.status).toBe(200);
    const actorId = String(created.body.actor.id);
    expect(created.body.actor).toMatchObject({
      id: actorId,
      lifecycleStatus: 'draft',
      authorizationStatus: 'none',
      planAccessStatus: 'available',
      assets: [],
    });

    const activation = await api(
      creator.page,
      `/api/real-portrait-actors/${actorId}/activation-requests`,
      {
        method: 'POST',
        body: {
          purpose: '全栈测试：经本人同意后用于商业 AI 视频生成',
          commercialUse: true,
          portraitNoticeVersion: 'fullstack-portrait-consent-v1',
          sensitiveInfoNoticeVersion: 'fullstack-sensitive-face-v1',
        },
      },
    );
    expect(activation.status).toBe(200);
    expect(activation.body.activation).toMatchObject({
      actor: { id: actorId, lifecycleStatus: 'invited', authorizationStatus: 'draft' },
      queuePosition: null,
    });
    const invitationUrl = new URL(String(activation.body.activation.invitationUrl));
    expect(invitationUrl.pathname).toBe('/portrait-consent/invite');
    expect(invitationUrl.search).toBe('');
    const inviteToken = new URLSearchParams(invitationUrl.hash.slice(1)).get('token');
    expect(inviteToken).toBeTruthy();
    expect(invitationUrl.pathname).not.toContain(String(inviteToken));

    const invite = await api(
      subjectPage,
      `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}`,
    );
    expect(invite.status).toBe(200);
    expect(invite.body.invite).toMatchObject({
      status: 'pending',
      purpose: '全栈测试：经本人同意后用于商业 AI 视频生成',
      commercialUse: true,
      canStartVerification: false,
      portraitNoticeVersion: 'fullstack-portrait-consent-v1',
      sensitiveInfoNoticeVersion: 'fullstack-sensitive-face-v1',
    });

    const consent = await api(
      subjectPage,
      `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}`,
      {
        method: 'POST',
        body: {
          accepted: true,
          adultConfirmed: true,
          portraitConsent: true,
          sensitiveFaceConsent: true,
          commercialUseConsent: true,
          authorizationDays: 90,
        },
      },
    );
    expect(consent.status).toBe(200);
    expect(consent.body.status).toBe('accepted');
    const manageUrl = new URL(String(consent.body.manageUrl));
    expect(manageUrl.pathname).toBe('/portrait-consent/authorization');
    expect(manageUrl.search).toBe('');
    const manageToken = new URLSearchParams(manageUrl.hash.slice(1)).get('token');
    expect(manageToken).toBeTruthy();
    expect(manageUrl.pathname).not.toContain(String(manageToken));

    const savedAuthorization = await api(
      subjectPage,
      `/api/public/real-portrait-authorizations/${encodeURIComponent(String(manageToken))}`,
    );
    expect(savedAuthorization.status).toBe(200);
    expect(savedAuthorization.body.authorization).toMatchObject({
      status: 'pending',
      purpose: '全栈测试：经本人同意后用于商业 AI 视频生成',
      commercialUse: true,
      cleanupStatus: 'not-requested',
    });

    const verification = await api(
      subjectPage,
      `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}/start-verification`,
      { method: 'POST' },
    );
    expect(verification.status).toBe(200);
    expect(verification.body.verification).toMatchObject({
      status: 'verification-ready',
      queuePosition: null,
    });
    const verificationUrl = new URL(String(verification.body.verification.verificationUrl));
    expect(verificationUrl.origin).toBe('https://example.invalid');
    expect(verificationUrl.search).toBe('');
    const verificationFragment = new URLSearchParams(verificationUrl.hash.slice(1));
    const callbackUrl = new URL(String(verificationFragment.get('callbackUrl')));
    const bytedToken = verificationFragment.get('bytedToken');
    expect(callbackUrl.pathname).toMatch(/^\/api\/providers\/volc\/real-portrait-validation\/[^/]+$/);
    expect(bytedToken).toMatch(/^fake-byted-/);

    callbackUrl.searchParams.set('bytedToken', String(bytedToken));
    callbackUrl.searchParams.set('resultCode', '10000');
    callbackUrl.searchParams.set('algorithmBaseRespCode', '0');
    callbackUrl.searchParams.set('reqMeasureInfoValue', '1');
    callbackUrl.searchParams.set('verify_type', 'real_time');
    const callbackNavigation = await subjectPage.goto(callbackUrl.toString(), {
      waitUntil: 'domcontentloaded',
    });
    expect(callbackNavigation?.status()).toBe(200);
    expect(new URL(subjectPage.url()).pathname).toBe('/portrait-consent/verification-complete');
    await expect(subjectPage.getByRole('heading', { name: '本人认证已完成' })).toBeVisible();

    await expect.poll(async () => {
      const status = await api(
        subjectPage,
        `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}/status`,
      );
      expect(status.status).toBe(200);
      return status.body.status;
    }, {
      timeout: 10_000,
      intervals: [100, 250, 500],
    }).toBe('awaiting_upload');

    const jpeg = await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 3,
        background: { r: 88, g: 121, b: 160 },
      },
    }).jpeg({ quality: 90 }).toBuffer();
    const jpegBase64 = jpeg.toString('base64');
    const jpegSha256 = createHash('sha256').update(jpeg).digest('hex');
    const upload = await api(
      creator.page,
      `/api/real-portrait-actors/${actorId}/uploads`,
      {
        method: 'POST',
        body: {
          kind: 'primary',
          mimeType: 'image/jpeg',
          sizeBytes: jpeg.byteLength,
        },
      },
    );
    expect(upload.status).toBe(200);
    expect(upload.body.upload).toMatchObject({
      kind: 'primary',
      status: 'waiting_upload',
      signature: { driver: 'local', method: 'PUT' },
    });
    expect(await uploadSignedBytes(
      creator.page,
      upload.body.upload.signature,
      jpegBase64,
    )).toBe(204);

    const completedUpload = await api(
      creator.page,
      `/api/real-portrait-uploads/${upload.body.upload.id}/complete`,
      {
        method: 'POST',
        body: {
          mimeType: 'image/jpeg',
          sizeBytes: jpeg.byteLength,
          width: 512,
          height: 512,
          sha256: jpegSha256,
        },
      },
    );
    expect(completedUpload.status).toBe(200);
    const portraitAssetId = String(completedUpload.body.asset.id);

    await expect.poll(async () => {
      const actor = await api(creator.page, `/api/real-portrait-actors/${actorId}`);
      expect(actor.status).toBe(200);
      return actor.body.actor;
    }, {
      // Worker 的真人素材协调周期是 15 秒；预留跨过一个完整调度周期的余量，
      // 避免上传刚好发生在本轮扫描之后时把正常异步处理误判为失败。
      timeout: 40_000,
      intervals: [250, 500, 1_000, 2_000],
    }).toMatchObject({
      id: actorId,
      lifecycleStatus: 'active',
      authorizationStatus: 'active',
      assets: [{
        id: portraitAssetId,
        kind: 'primary',
        status: 'active',
        consistencyStatus: 'passed',
      }],
    });

    const creditsBeforeGeneration = await readCredits(creator.page);
    const generated = await api(creator.page, '/api/ai/video-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: `fullstack-portrait-generation-${marker}`,
        requests: [{
          model: 'Seedance 2.0',
          prompt: '让已授权演员自然转身并向镜头挥手，背景保持简洁',
          config: {
            mode: 'general',
            aspectRatio: '9:16',
            resolution: '480p',
            durationSeconds: 5,
            generateAudio: false,
          },
          references: [],
          realPortrait: { actorId },
        }],
      },
    });
    expect(generated.status).toBe(200);
    expect(generated.body.tasks).toHaveLength(1);
    const generatedTask = generated.body.tasks[0];
    expect(JSON.stringify(generatedTask)).not.toContain('asset://');
    expect(JSON.stringify(generatedTask)).not.toContain('fake-group-');
    expect(JSON.stringify(generatedTask)).not.toContain('fake-asset-');
    expect(await readCredits(creator.page)).toBe(
      creditsBeforeGeneration - Number(generatedTask.credits),
    );

    await expect.poll(
      async () => (await readTask(creator.page, generatedTask.id)).status,
      { timeout: 45_000, intervals: [500, 1_000, 2_000] },
    ).toBe('completed');
    const completedTask = await readTask(creator.page, generatedTask.id);
    expect(completedTask).toMatchObject({
      status: 'completed',
      creditStatus: 'settled',
      assetId: expect.any(String),
    });
    expect(completedTask.config).not.toHaveProperty('realPortrait');
    expect(JSON.stringify(completedTask)).not.toContain('asset://');
    const settledCredits = await readCredits(creator.page);

    const revoked = await api(
      subjectPage,
      `/api/public/real-portrait-authorizations/${encodeURIComponent(String(manageToken))}/revoke`,
      {
        method: 'POST',
        body: { reasonCode: 'subject-withdrawn-fullstack' },
      },
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.authorization).toMatchObject({
      status: 'revoked',
      cleanupStatus: 'completed',
    });

    const actorAfterRevoke = await api(creator.page, `/api/real-portrait-actors/${actorId}`);
    expect(actorAfterRevoke.status).toBe(200);
    expect(actorAfterRevoke.body.actor).toMatchObject({
      lifecycleStatus: 'revoked',
      authorizationStatus: 'revoked',
    });

    const rejected = await api(creator.page, '/api/ai/video-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: `fullstack-portrait-revoked-${marker}`,
        requests: [{
          model: 'Seedance 2.0',
          prompt: '撤回授权后不得再生成真人视频',
          config: {
            mode: 'general',
            aspectRatio: '9:16',
            resolution: '480p',
            durationSeconds: 5,
          },
          references: [],
          realPortrait: { actorId },
        }],
      },
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('REAL_PORTRAIT_REFERENCE_UNAVAILABLE');
    expect(await readCredits(creator.page)).toBe(settledCredits);

    const historicalTask = await readTask(creator.page, generatedTask.id);
    expect(historicalTask).toMatchObject({
      status: 'completed',
      creditStatus: 'settled',
      assetId: completedTask.assetId,
    });
    const historicalAsset = await api(creator.page, `/api/assets/${completedTask.assetId}`);
    expect(historicalAsset.status).toBe(404);
    expect(historicalAsset.body).toMatchObject({ message: '素材不存在' });
  } finally {
    await Promise.all([
      creator.context.close(),
      admin.context.close(),
      subjectContext.close(),
    ]);
  }
});

test('已接受邀请但未开始 H5 时，创建者可释放容量并删除档案', async ({ browser }) => {
  const marker = randomUUID();
  const account = {
    id: randomUUID(),
    email: `portrait-accepted-release-${marker}@lindyson.test`,
    password: secondaryAccount.password,
  };
  postgres(`
    INSERT INTO users (id, email, password_hash, user_name, plan_id)
    SELECT '${account.id}', '${account.email}', password_hash,
           '全栈真人释放用户', NULL::uuid
    FROM users WHERE email = '${secondaryAccount.email}';
  `);

  const creator = await createAuthenticatedPage(browser, account);
  const subjectContext = await browser.newContext();
  const subjectPage = await subjectContext.newPage();
  await subjectPage.goto('/');

  try {
    const created = await api(creator.page, '/api/real-portrait-actors', {
      method: 'POST',
      body: { alias: '已接受未扫脸演员' },
    });
    expect(created.status).toBe(200);
    const actorId = String(created.body.actor.id);

    const activation = await api(
      creator.page,
      `/api/real-portrait-actors/${actorId}/activation-requests`,
      {
        method: 'POST',
        body: {
          purpose: '全栈测试：接受后未扫脸即撤回',
          commercialUse: true,
          portraitNoticeVersion: 'fullstack-accepted-release-v1',
          sensitiveInfoNoticeVersion: 'fullstack-accepted-release-sensitive-v1',
        },
      },
    );
    expect(activation.status).toBe(200);
    const invitationUrl = new URL(String(activation.body.activation.invitationUrl));
    const inviteToken = new URLSearchParams(invitationUrl.hash.slice(1)).get('token');
    expect(inviteToken).toBeTruthy();

    const consent = await api(
      subjectPage,
      `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}`,
      {
        method: 'POST',
        body: {
          accepted: true,
          adultConfirmed: true,
          portraitConsent: true,
          sensitiveFaceConsent: true,
          commercialUseConsent: true,
          authorizationDays: 90,
        },
      },
    );
    expect(consent.status).toBe(200);
    expect(consent.body.status).toBe('accepted');
    expect(postgresScalar(`
      SELECT status || '|' || (accepted_at IS NOT NULL)::text
      FROM real_portrait_invites
      WHERE actor_id = '${actorId}'::uuid;
    `)).toBe('accepted|true');

    const released = await api(
      creator.page,
      `/api/real-portrait-actors/${actorId}/revoke`,
      {
        method: 'POST',
        body: { reasonCode: 'owner-release-before-h5' },
      },
    );
    expect(released.status).toBe(200);
    expect(released.body.actor).toMatchObject({
      id: actorId,
      lifecycleStatus: 'revoked',
      authorizationStatus: 'revoked',
    });
    expect(postgresScalar(`
      SELECT status || '|' || (accepted_at IS NULL)::text
      FROM real_portrait_invites
      WHERE actor_id = '${actorId}'::uuid;
    `)).toBe('cancelled|true');

    const deleted = await api(
      creator.page,
      `/api/real-portrait-actors/${actorId}`,
      { method: 'DELETE' },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true });

    const actors = await api(creator.page, '/api/real-portrait-actors');
    expect(actors.status).toBe(200);
    expect(actors.body.items).toEqual([]);
    expect(actors.body.capacity.usage).toMatchObject({ profiles: 0, active: 0 });

  } finally {
    await Promise.all([
      creator.context.close(),
      subjectContext.close(),
    ]);
  }
});

test('已撤回演员即使火山验证查单仍在重试，也可立即软删除且保留晚到资源清理', async ({ browser }) => {
  test.setTimeout(150_000);
  const marker = randomUUID();
  const disabledPlanCode = `portrait-disabled-${marker}`;
  const account = {
    id: randomUUID(),
    email: `portrait-pending-lookup-delete-${marker}@lindyson.test`,
    password: secondaryAccount.password,
  };
  postgres(`
    INSERT INTO users (id, email, password_hash, user_name, plan_id)
    SELECT '${account.id}', '${account.email}', password_hash,
           '全栈真人查单软删除用户', NULL::uuid
    FROM users WHERE email = '${secondaryAccount.email}';

    INSERT INTO plans (
      code, name, name_en, kind, billing, credits, status, asset_retention_days,
      portrait_enabled, portrait_profile_limit, portrait_active_limit,
      portrait_assets_per_actor
    ) VALUES (
      '${disabledPlanCode}', '全栈真人停用套餐', 'Fullstack Portrait Disabled',
      'main', 'both', 0, 'active', 0, false, 0, 0, 0
    );
  `);

  const creator = await createAuthenticatedPage(browser, account);
  const subjectContext = await browser.newContext();
  const subjectPage = await subjectContext.newPage();
  await subjectPage.goto('/');

  try {
    const created = await api(creator.page, '/api/real-portrait-actors', {
      method: 'POST',
      body: { alias: '查单中软删除演员' },
    });
    expect(created.status).toBe(200);
    const actorId = String(created.body.actor.id);

    const activation = await api(
      creator.page,
      `/api/real-portrait-actors/${actorId}/activation-requests`,
      {
        method: 'POST',
        body: {
          purpose: '全栈测试：验证结果未知时撤回并删除',
          commercialUse: true,
          portraitNoticeVersion: 'fullstack-pending-lookup-delete-v1',
          sensitiveInfoNoticeVersion: 'fullstack-pending-lookup-delete-sensitive-v1',
        },
      },
    );
    expect(activation.status).toBe(200);
    const invitationUrl = new URL(String(activation.body.activation.invitationUrl));
    const inviteToken = new URLSearchParams(invitationUrl.hash.slice(1)).get('token');
    expect(inviteToken).toBeTruthy();

    const consent = await api(
      subjectPage,
      `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}`,
      {
        method: 'POST',
        body: {
          accepted: true,
          adultConfirmed: true,
          portraitConsent: true,
          sensitiveFaceConsent: true,
          commercialUseConsent: true,
          authorizationDays: 90,
        },
      },
    );
    expect(consent.status).toBe(200);

    const verification = await api(
      subjectPage,
      `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}/start-verification`,
      { method: 'POST' },
    );
    expect(verification.status).toBe(200);
    expect(verification.body.verification.status).toBe('verification-ready');

    postgres(`
      UPDATE real_portrait_verification_sessions session
      SET status = 'submission_unknown', updated_at = now()
      WHERE session.actor_id = '${actorId}'::uuid;

      UPDATE real_portrait_remote_operations operation
      SET status = 'submission_unknown', attempt_count = 3,
          next_retry_at = now() + interval '1 day',
          last_error_code = 'FULLSTACK_PROVIDER_NOT_FOUND', updated_at = now()
      FROM real_portrait_verification_sessions session
      WHERE operation.verification_session_id = session.id
        AND operation.operation_type = 'get_visual_validation_result'
        AND session.actor_id = '${actorId}'::uuid;
    `);

    const released = await api(
      creator.page,
      `/api/real-portrait-actors/${actorId}/revoke`,
      {
        method: 'POST',
        body: { reasonCode: 'owner-release-pending-provider-lookup' },
      },
    );
    expect(released.status).toBe(200);
    expect(released.body.actor).toMatchObject({
      lifecycleStatus: 'revoked',
      authorizationStatus: 'revoked',
    });
    expect(postgresScalar(`
      SELECT materialization.status || '|' ||
             (materialization.provider_group_id IS NULL)::text || '|' || reservation.status
      FROM real_portrait_materializations materialization
      JOIN real_portrait_capacity_reservations reservation
        ON reservation.actor_id = materialization.actor_id
      WHERE materialization.actor_id = '${actorId}'::uuid
      ORDER BY reservation.created_at DESC
      LIMIT 1;
    `)).toBe('verifying|true|released');

    // 模拟生产中的结构化权益关闭和七天宽限到期。查单仍可能返回迟到 Group，
    // 因此 quota 可以完成锁定，但无 Group 物化必须继续停在 verifying。
    postgres(`
      UPDATE users
      SET plan_id = (SELECT id FROM plans WHERE code = '${disabledPlanCode}'),
          plan_expires_at = NULL, updated_at = now()
      WHERE id = '${account.id}'::uuid;

      UPDATE user_portrait_quota_states
      SET source_plan_id = (SELECT id FROM plans WHERE code = '${disabledPlanCode}'),
          portrait_enabled = false, profile_limit = 0,
          active_limit = 0, assets_per_actor = 0,
          grace_status = 'active', grace_until = now() - interval '1 second',
          retained_actor_ids = '[]'::jsonb, active_actor_ids = '[]'::jsonb,
          updated_at = now()
      WHERE user_id = '${account.id}'::uuid;

      UPDATE real_portrait_actors
      SET plan_access_status = 'grace', locked_at = NULL, updated_at = now()
      WHERE id = '${actorId}'::uuid;
    `);

    await expect.poll(() => postgresScalar(`
      SELECT concat_ws('|', quota.grace_status, actor.plan_access_status,
                        materialization.status,
                        (materialization.provider_group_id IS NULL)::text,
                        (materialization.remote_deleted_at IS NULL)::text,
                        lookup.status)
      FROM user_portrait_quota_states quota
      JOIN real_portrait_actors actor ON actor.user_id = quota.user_id
      JOIN real_portrait_materializations materialization ON materialization.actor_id = actor.id
      JOIN real_portrait_remote_operations lookup
        ON lookup.materialization_id = materialization.id
       AND lookup.operation_type = 'get_visual_validation_result'
      WHERE quota.user_id = '${account.id}'::uuid
        AND actor.id = '${actorId}'::uuid;
    `), {
      timeout: 45_000,
      intervals: [500, 1_000, 2_000],
    }).toBe('completed|plan_locked|verifying|true|true|submission_unknown');

    const deleted = await api(
      creator.page,
      `/api/real-portrait-actors/${actorId}`,
      { method: 'DELETE' },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true });
    expect(postgresScalar(`
      SELECT alias || '|' || (deleted_at IS NOT NULL)::text
      FROM real_portrait_actors
      WHERE id = '${actorId}'::uuid;
    `)).toBe('已删除演员|true');
    expect(postgresScalar(`
      SELECT status
      FROM real_portrait_remote_operations
      WHERE actor_id = '${actorId}'::uuid
        AND operation_type = 'get_visual_validation_result';
    `)).toBe('submission_unknown');

    const actors = await api(creator.page, '/api/real-portrait-actors');
    expect(actors.status).toBe(200);
    expect(actors.body.items).toEqual([]);
    expect(actors.body.capacity.usage).toMatchObject({ profiles: 0, active: 0 });

    // 让测试栈内假供应商返回迟到 Group。worker 必须先持久化唯一删除操作，
    // 再完成 Group 删除；这里没有外网或真实 Provider 调用。
    postgres(`
      UPDATE real_portrait_remote_operations
      SET status = 'submission_unknown', next_retry_at = now(), updated_at = now()
      WHERE actor_id = '${actorId}'::uuid
        AND operation_type = 'get_visual_validation_result';
    `);

    await expect.poll(() => postgresScalar(`
      SELECT concat_ws('|', materialization.status,
                        (materialization.provider_group_id IS NOT NULL)::text,
                        (materialization.remote_deleted_at IS NOT NULL)::text,
                        verification_session.status, lookup.status,
                        cleanup.status, cleanup.attempt_count::text,
                        cleanup.idempotency_key,
                        (SELECT count(*)::text
                         FROM real_portrait_remote_operations duplicate
                         WHERE duplicate.actor_id = '${actorId}'::uuid
                           AND duplicate.operation_type = 'expired_verification_delete_group'))
      FROM real_portrait_materializations materialization
      JOIN real_portrait_verification_sessions verification_session
        ON verification_session.actor_id = materialization.actor_id
       AND verification_session.authorization_id = materialization.authorization_id
      JOIN real_portrait_remote_operations lookup
        ON lookup.verification_session_id = verification_session.id
       AND lookup.operation_type = 'get_visual_validation_result'
      JOIN real_portrait_remote_operations cleanup
        ON cleanup.verification_session_id = verification_session.id
       AND cleanup.operation_type = 'expired_verification_delete_group'
      WHERE materialization.actor_id = '${actorId}'::uuid;
    `), {
      timeout: 45_000,
      intervals: [500, 1_000, 2_000],
    }).toMatch(/^deleted\|true\|true\|failed\|completed\|completed\|1\|late-validation-group:[0-9a-f-]+\|1$/);

    // 重放同一权威结果：completed 删除操作既不能插入第二条，也不能再次 claim 或增加 attempt。
    postgres(`
      UPDATE real_portrait_verification_sessions
      SET status = 'submission_unknown', failure_code = 'FULLSTACK_TEST_REPLAY',
          updated_at = now()
      WHERE actor_id = '${actorId}'::uuid;

      UPDATE real_portrait_remote_operations
      SET status = 'submission_unknown', next_retry_at = now(), updated_at = now()
      WHERE actor_id = '${actorId}'::uuid
        AND operation_type = 'get_visual_validation_result';
    `);

    await expect.poll(() => postgresScalar(`
      SELECT concat_ws('|', count(*)::text, max(attempt_count)::text,
                        min(status), min(idempotency_key),
                        (SELECT status FROM real_portrait_materializations
                         WHERE actor_id = '${actorId}'::uuid))
      FROM real_portrait_remote_operations
      WHERE actor_id = '${actorId}'::uuid
        AND operation_type = 'expired_verification_delete_group';
    `), {
      timeout: 45_000,
      intervals: [500, 1_000, 2_000],
    }).toMatch(/^1\|1\|completed\|late-validation-group:[0-9a-f-]+\|deleted$/);
  } finally {
    await Promise.all([
      creator.context.close(),
      subjectContext.close(),
    ]);
  }
});

test('专业版降级免费版可选择保留演员，宽限到期后释放超额远端资源且再升级必须重新认证', async ({ browser }) => {
  test.setTimeout(240_000);
  const marker = randomUUID();
  const account = {
    id: randomUUID(),
    email: `portrait-downgrade-${marker}@lindyson.test`,
    password: secondaryAccount.password,
  };
  postgres(`
    INSERT INTO users (id, email, password_hash, user_name, plan_id)
    SELECT '${account.id}', '${account.email}', source.password_hash,
           '全栈真人降级用户', plan.id
    FROM users source
    JOIN plans plan ON plan.code = 'pro' AND plan.kind = 'main'
    WHERE source.email = '${secondaryAccount.email}'
    LIMIT 1;

    INSERT INTO asset_folders (user_id, name, source, is_system)
    VALUES
      ('${account.id}', 'AI 视频', 'ai-video', true),
      ('${account.id}', 'AI 图片', 'ai-image', true),
      ('${account.id}', '已上传视频', 'uploaded-video', true),
      ('${account.id}', '已上传图片', 'uploaded-image', true),
      ('${account.id}', '已上传音频', 'uploaded-audio', true);
  `);

  const creator = await createAuthenticatedPage(browser, account);
  const admin = await createAuthenticatedPage(browser, primaryAccount);
  const subjectContext = await browser.newContext();
  const subjectPage = await subjectContext.newPage();
  await subjectPage.goto('/');

  try {
    const first = await activateRealPortraitActorForFullstack(
      creator.page,
      subjectPage,
      `${marker}-retained`,
      '降级后保留演员',
    );
    const second = await activateRealPortraitActorForFullstack(
      creator.page,
      subjectPage,
      `${marker}-released`,
      '降级后释放演员',
    );

    const beforeDowngrade = await api(creator.page, '/api/real-portrait-capacity');
    expect(beforeDowngrade.status).toBe(200);
    expect(beforeDowngrade.body.capacity).toMatchObject({
      sourcePlanCode: 'pro',
      entitlements: {
        enabled: true,
        profileLimit: 5,
        activeLimit: 3,
        assetsPerActor: 2,
      },
      usage: { profiles: 2, active: 2 },
    });

    const usersResult = await api(
      admin.page,
      `/api/admin/users?search=${encodeURIComponent(account.email)}&limit=20`,
    );
    expect(usersResult.status).toBe(200);
    const adminUser = usersResult.body.items.find(
      (item: { email: string }) => item.email === account.email,
    );
    expect(adminUser).toBeTruthy();
    expect(adminUser.planCode).toBe('pro');

    const downgraded = await api(
      admin.page,
      `/api/admin/users/${account.id}/subscription`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': `fullstack-portrait-downgrade-${marker}` },
        body: {
          planId: null,
          billingCycle: null,
          planResetAt: null,
          planExpiresAt: null,
          note: '全栈测试：真人演员额度降级至免费版',
          expected: {
            planId: adminUser.planId,
            billingCycle: adminUser.billingCycle,
            planCycleStartedAt: adminUser.planCycleStartedAt,
            planResetAt: adminUser.planResetAt,
            planExpiresAt: adminUser.planExpiresAt,
            activeSubscriptionOrderId: adminUser.activeSubscriptionOrderId,
            mainCredits: adminUser.mainCredits,
          },
          expectedPlanCredits: 0,
        },
      },
    );
    expect(downgraded.status).toBe(200);
    expect(downgraded.body.user).toMatchObject({
      id: account.id,
      planId: null,
      planCode: null,
      mainCredits: 0,
    });

    await expect.poll(async () => {
      const capacity = await api(creator.page, '/api/real-portrait-capacity');
      expect(capacity.status).toBe(200);
      return capacity.body.capacity;
    }, {
      timeout: 30_000,
      intervals: [250, 500, 1_000],
    }).toMatchObject({
      sourcePlanCode: 'free',
      entitlements: {
        enabled: true,
        profileLimit: 1,
        activeLimit: 1,
        assetsPerActor: 1,
      },
      usage: { profiles: 2, active: 2 },
      quotaState: {
        graceStatus: 'active',
        graceUntil: expect.any(String),
      },
    });

    const actorsInGrace = await api(creator.page, '/api/real-portrait-actors');
    expect(actorsInGrace.status).toBe(200);
    expect(actorsInGrace.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.actorId, planAccessStatus: 'grace' }),
      expect.objectContaining({ id: second.actorId, planAccessStatus: 'grace' }),
    ]));

    const selection = await api(
      creator.page,
      '/api/account/real-portrait-quota-selection',
      {
        method: 'POST',
        body: {
          retainedActorIds: [first.actorId],
          activeActorIds: [first.actorId],
        },
      },
    );
    expect(selection.status).toBe(200);
    expect(selection.body.capacity.quotaState).toMatchObject({
      graceStatus: 'reconciling',
      retainedActorIds: [first.actorId],
      activeActorIds: [first.actorId],
    });

    // 仅推进套餐宽限期时钟；演员锁定、供应商资源删除和状态收敛必须由 worker 完成。
    postgres(`
      UPDATE user_portrait_quota_states
      SET grace_until = now() - interval '1 second'
      WHERE user_id = '${account.id}'::uuid;
    `);

    await expect.poll(async () => {
      const [capacity, retainedActor, releasedActor] = await Promise.all([
        api(creator.page, '/api/real-portrait-capacity'),
        api(creator.page, `/api/real-portrait-actors/${first.actorId}`),
        api(creator.page, `/api/real-portrait-actors/${second.actorId}`),
      ]);
      expect(capacity.status).toBe(200);
      expect(retainedActor.status).toBe(200);
      expect(releasedActor.status).toBe(200);
      return {
        quotaState: capacity.body.capacity.quotaState,
        usage: capacity.body.capacity.usage,
        retained: retainedActor.body.actor,
        released: releasedActor.body.actor,
      };
    }, {
      timeout: 75_000,
      intervals: [500, 1_000, 2_000],
    }).toMatchObject({
      quotaState: {
        graceStatus: 'completed',
        retainedActorIds: [first.actorId],
        activeActorIds: [first.actorId],
      },
      usage: { profiles: 2, active: 1 },
      retained: {
        id: first.actorId,
        planAccessStatus: 'available',
        lifecycleStatus: 'active',
        assets: [{
          id: first.assetId,
          status: 'active',
        }],
      },
      released: {
        id: second.actorId,
        planAccessStatus: 'plan_locked',
        lifecycleStatus: 'evicted',
        assets: [],
      },
    });

    const creditsBeforeLockedAttempt = await readCredits(creator.page);
    const lockedGeneration = await api(creator.page, '/api/ai/video-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: `fullstack-portrait-locked-${marker}`,
        requests: [{
          model: 'Seedance 2.0',
          prompt: '套餐锁定后不得使用已释放的真人演员',
          config: {
            mode: 'general',
            aspectRatio: '9:16',
            resolution: '480p',
            durationSeconds: 5,
          },
          references: [],
          realPortrait: { actorId: second.actorId },
        }],
      },
    });
    expect(lockedGeneration.status).toBe(409);
    expect(lockedGeneration.body.code).toBe('REAL_PORTRAIT_REFERENCE_UNAVAILABLE');
    expect(await readCredits(creator.page)).toBe(creditsBeforeLockedAttempt);

    const plansResult = await api(admin.page, '/api/admin/plans');
    expect(plansResult.status).toBe(200);
    const proPlan = plansResult.body.items.find(
      (item: { code: string; kind: string }) => item.code === 'pro' && item.kind === 'main',
    );
    expect(proPlan).toBeTruthy();
    const resetDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)
      .toISOString().slice(0, 10);
    const expiresDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000)
      .toISOString().slice(0, 10);
    const upgraded = await api(
      admin.page,
      `/api/admin/users/${account.id}/subscription`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': `fullstack-portrait-upgrade-${marker}` },
        body: {
          planId: proPlan.id,
          billingCycle: proPlan.billing === 'yearly' ? 'yearly' : 'monthly',
          planResetAt: resetDate,
          planExpiresAt: expiresDate,
          note: '全栈测试：真人演员额度恢复专业版',
          expected: {
            planId: downgraded.body.user.planId,
            billingCycle: downgraded.body.user.billingCycle,
            planCycleStartedAt: downgraded.body.user.planCycleStartedAt,
            planResetAt: downgraded.body.user.planResetAt,
            planExpiresAt: downgraded.body.user.planExpiresAt,
            activeSubscriptionOrderId: downgraded.body.user.activeSubscriptionOrderId,
            mainCredits: downgraded.body.user.mainCredits,
          },
          expectedPlanCredits: proPlan.credits,
        },
      },
    );
    expect(upgraded.status).toBe(200);
    expect(upgraded.body.user).toMatchObject({
      id: account.id,
      planId: proPlan.id,
      planCode: 'pro',
      mainCredits: proPlan.credits,
    });

    await expect.poll(async () => {
      const actor = await api(creator.page, `/api/real-portrait-actors/${second.actorId}`);
      expect(actor.status).toBe(200);
      return actor.body.actor;
    }, {
      timeout: 30_000,
      intervals: [250, 500, 1_000],
    }).toMatchObject({
      id: second.actorId,
      planAccessStatus: 'available',
      lifecycleStatus: 'evicted',
      assets: [],
    });

    const creditsBeforeReactivation = await readCredits(creator.page);
    const stillUnavailable = await api(creator.page, '/api/ai/video-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: `fullstack-portrait-upgraded-before-consent-${marker}`,
        requests: [{
          model: 'Seedance 2.0',
          prompt: '升级后但未重新授权，仍不得使用已清理演员',
          config: {
            mode: 'general',
            aspectRatio: '9:16',
            resolution: '480p',
            durationSeconds: 5,
          },
          references: [],
          realPortrait: { actorId: second.actorId },
        }],
      },
    });
    expect(stillUnavailable.status).toBe(409);
    expect(stillUnavailable.body.code).toBe('REAL_PORTRAIT_REFERENCE_UNAVAILABLE');
    expect(await readCredits(creator.page)).toBe(creditsBeforeReactivation);

    const reactivation = await api(
      creator.page,
      `/api/real-portrait-actors/${second.actorId}/activation-requests`,
      {
        method: 'POST',
        body: {
          purpose: '全栈测试：清理后升级必须由真人本人重新授权',
          commercialUse: true,
          portraitNoticeVersion: 'fullstack-portrait-reconsent-v1',
          sensitiveInfoNoticeVersion: 'fullstack-sensitive-face-reconsent-v1',
        },
      },
    );
    expect(reactivation.status).toBe(200);
    expect(reactivation.body.activation.actor).toMatchObject({
      id: second.actorId,
      planAccessStatus: 'available',
      lifecycleStatus: 'invited',
      authorizationStatus: 'draft',
      assets: [],
    });
    const newInvitationUrl = new URL(String(reactivation.body.activation.invitationUrl));
    const newInviteToken = new URLSearchParams(newInvitationUrl.hash.slice(1)).get('token');
    expect(newInviteToken).toBeTruthy();
    expect(newInviteToken).not.toBe(second.inviteToken);

    const reconsentInvite = await api(
      subjectPage,
      `/api/public/real-portrait-invites/${encodeURIComponent(String(newInviteToken))}`,
    );
    expect(reconsentInvite.status).toBe(200);
    expect(reconsentInvite.body.invite).toMatchObject({
      status: 'pending',
      canStartVerification: false,
      purpose: '全栈测试：清理后升级必须由真人本人重新授权',
      portraitNoticeVersion: 'fullstack-portrait-reconsent-v1',
      sensitiveInfoNoticeVersion: 'fullstack-sensitive-face-reconsent-v1',
    });

    const rematerialized = await completeRealPortraitInvitationForFullstack(
      creator.page,
      subjectPage,
      second.actorId,
      String(newInviteToken),
      `${marker}-reconsent`,
    );
    expect(rematerialized.assetId).not.toBe(second.assetId);

    const reactivatedActor = await api(
      creator.page,
      `/api/real-portrait-actors/${second.actorId}`,
    );
    expect(reactivatedActor.status).toBe(200);
    expect(reactivatedActor.body.actor).toMatchObject({
      id: second.actorId,
      planAccessStatus: 'available',
      lifecycleStatus: 'active',
      authorizationStatus: 'active',
      assets: [{
        id: rematerialized.assetId,
        kind: 'primary',
        status: 'active',
        consistencyStatus: 'passed',
      }],
    });

    const regenerated = await generateWithRealPortraitForFullstack(
      creator.page,
      second.actorId,
      `${marker}-after-reconsent`,
      '重新授权并重新入库后，演员再次完成一段自然转身的视频',
    );
    expect(regenerated.completedTask).toMatchObject({
      status: 'completed',
      creditStatus: 'settled',
      assetId: expect.any(String),
    });
  } finally {
    await Promise.all([
      creator.context.close(),
      admin.context.close(),
      subjectContext.close(),
    ]);
  }
});

test('专业版降级免费版未选择演员时按最近成功生成时间自动保留', async ({ browser }) => {
  test.setTimeout(300_000);
  const marker = randomUUID();
  const account = {
    id: randomUUID(),
    email: `portrait-lru-${marker}@lindyson.test`,
    password: secondaryAccount.password,
  };
  postgres(`
    INSERT INTO users (id, email, password_hash, user_name, plan_id)
    SELECT '${account.id}', '${account.email}', source.password_hash,
           '全栈真人自动保留用户', plan.id
    FROM users source
    JOIN plans plan ON plan.code = 'pro' AND plan.kind = 'main'
    WHERE source.email = '${secondaryAccount.email}'
    LIMIT 1;

    INSERT INTO asset_folders (user_id, name, source, is_system)
    VALUES
      ('${account.id}', 'AI 视频', 'ai-video', true),
      ('${account.id}', 'AI 图片', 'ai-image', true),
      ('${account.id}', '已上传视频', 'uploaded-video', true),
      ('${account.id}', '已上传图片', 'uploaded-image', true),
      ('${account.id}', '已上传音频', 'uploaded-audio', true);
  `);

  const creator = await createAuthenticatedPage(browser, account);
  const admin = await createAuthenticatedPage(browser, primaryAccount);
  const subjectContext = await browser.newContext();
  const subjectPage = await subjectContext.newPage();
  await subjectPage.goto('/');

  try {
    const creditGrant = await api(admin.page, '/api/admin/credits/adjust', {
      method: 'POST',
      headers: { 'Idempotency-Key': `fullstack-portrait-lru-credit-${marker}` },
      body: {
        userId: account.id,
        mainDelta: 0,
        addonDelta: 100,
        note: '全栈测试：验证真人演员最近成功使用自动保留',
      },
    });
    expect(creditGrant.status).toBe(200);

    const recentlyUsed = await activateRealPortraitActorForFullstack(
      creator.page,
      subjectPage,
      `${marker}-recently-used`,
      '较早创建但最近成功生成的演员',
    );
    const neverUsed = await activateRealPortraitActorForFullstack(
      creator.page,
      subjectPage,
      `${marker}-never-used`,
      '较晚创建但从未生成的演员',
    );

    await generateWithRealPortraitForFullstack(
      creator.page,
      recentlyUsed.actorId,
      `${marker}-lru-evidence`,
      '为自动保留排序写入一次真实成功生成时间',
    );
    const usedActorBeforeDowngrade = await api(
      creator.page,
      `/api/real-portrait-actors/${recentlyUsed.actorId}`,
    );
    expect(usedActorBeforeDowngrade.status).toBe(200);
    expect(usedActorBeforeDowngrade.body.actor.lastSuccessfulGenerationAt).toEqual(
      expect.any(String),
    );
    const unusedActorBeforeDowngrade = await api(
      creator.page,
      `/api/real-portrait-actors/${neverUsed.actorId}`,
    );
    expect(unusedActorBeforeDowngrade.status).toBe(200);
    expect(unusedActorBeforeDowngrade.body.actor.lastSuccessfulGenerationAt).toBeNull();

    const usersResult = await api(
      admin.page,
      `/api/admin/users?search=${encodeURIComponent(account.email)}&limit=20`,
    );
    expect(usersResult.status).toBe(200);
    const adminUser = usersResult.body.items.find(
      (item: { email: string }) => item.email === account.email,
    );
    expect(adminUser).toBeTruthy();
    expect(adminUser.planCode).toBe('pro');

    const downgraded = await api(
      admin.page,
      `/api/admin/users/${account.id}/subscription`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': `fullstack-portrait-lru-downgrade-${marker}` },
        body: {
          planId: null,
          billingCycle: null,
          planResetAt: null,
          planExpiresAt: null,
          note: '全栈测试：不提交选择时验证自动保留顺序',
          expected: {
            planId: adminUser.planId,
            billingCycle: adminUser.billingCycle,
            planCycleStartedAt: adminUser.planCycleStartedAt,
            planResetAt: adminUser.planResetAt,
            planExpiresAt: adminUser.planExpiresAt,
            activeSubscriptionOrderId: adminUser.activeSubscriptionOrderId,
            mainCredits: adminUser.mainCredits,
          },
          expectedPlanCredits: 0,
        },
      },
    );
    expect(downgraded.status).toBe(200);

    await expect.poll(async () => {
      const capacity = await api(creator.page, '/api/real-portrait-capacity');
      expect(capacity.status).toBe(200);
      return capacity.body.capacity;
    }, {
      timeout: 30_000,
      intervals: [250, 500, 1_000],
    }).toMatchObject({
      sourcePlanCode: 'free',
      usage: { profiles: 2, active: 2 },
      quotaState: {
        graceStatus: 'active',
        retainedActorIds: [],
        activeActorIds: [],
      },
    });

    // 不调用 quota-selection，只推进宽限期，由真实 worker 执行默认排序和远端清理。
    postgres(`
      UPDATE user_portrait_quota_states
      SET grace_until = now() - interval '1 second'
      WHERE user_id = '${account.id}'::uuid;
    `);

    await expect.poll(async () => {
      const [capacity, usedActor, unusedActor] = await Promise.all([
        api(creator.page, '/api/real-portrait-capacity'),
        api(creator.page, `/api/real-portrait-actors/${recentlyUsed.actorId}`),
        api(creator.page, `/api/real-portrait-actors/${neverUsed.actorId}`),
      ]);
      expect(capacity.status).toBe(200);
      expect(usedActor.status).toBe(200);
      expect(unusedActor.status).toBe(200);
      return {
        quotaState: capacity.body.capacity.quotaState,
        usage: capacity.body.capacity.usage,
        usedActor: usedActor.body.actor,
        unusedActor: unusedActor.body.actor,
      };
    }, {
      timeout: 75_000,
      intervals: [500, 1_000, 2_000],
    }).toMatchObject({
      quotaState: {
        graceStatus: 'completed',
        retainedActorIds: [recentlyUsed.actorId],
        activeActorIds: [recentlyUsed.actorId],
      },
      usage: { profiles: 2, active: 1 },
      usedActor: {
        id: recentlyUsed.actorId,
        planAccessStatus: 'available',
        lifecycleStatus: 'active',
        assets: [{
          id: recentlyUsed.assetId,
          status: 'active',
        }],
      },
      unusedActor: {
        id: neverUsed.actorId,
        planAccessStatus: 'plan_locked',
        lifecycleStatus: 'evicted',
        assets: [],
      },
    });
  } finally {
    await Promise.all([
      creator.context.close(),
      admin.context.close(),
      subjectContext.close(),
    ]);
  }
});

test('真人库全局软上限在并发激活和第二张素材预留时均不超卖', async ({ browser }) => {
  test.setTimeout(300_000);
  const marker = randomUUID();
  const account = {
    id: randomUUID(),
    email: `portrait-capacity-${marker}@lindyson.test`,
    password: secondaryAccount.password,
  };
  postgres(`
    INSERT INTO users (id, email, password_hash, user_name, plan_id)
    SELECT '${account.id}', '${account.email}', source.password_hash,
           '全栈真人容量并发用户', plan.id
    FROM users source
    JOIN plans plan ON plan.code = 'enterprise' AND plan.kind = 'main'
    WHERE source.email = '${secondaryAccount.email}'
    LIMIT 1;
  `);

  const ownerA = await createAuthenticatedPage(browser, account);
  const ownerB = await createAuthenticatedPage(browser, account);
  const subjectContextA = await browser.newContext();
  const subjectContextB = await browser.newContext();
  const subjectPageA = await subjectContextA.newPage();
  const subjectPageB = await subjectContextB.newPage();
  await Promise.all([subjectPageA.goto('/'), subjectPageB.goto('/')]);
  const fillerUserIds = new Set<string>();

  try {
    const created = await Promise.all([
      api(ownerA.page, '/api/real-portrait-actors', {
        method: 'POST',
        body: { alias: '并发容量演员 A' },
      }),
      api(ownerB.page, '/api/real-portrait-actors', {
        method: 'POST',
        body: { alias: '并发容量演员 B' },
      }),
    ]);
    expect(created.every(result => result.status === 200)).toBe(true);
    const actorIds = created.map(result => String(result.body.actor.id));

    const initialCapacity = await api(ownerA.page, '/api/real-portrait-capacity');
    expect(initialCapacity.status).toBe(200);
    const initialGlobal = initialCapacity.body.capacity.global;
    expect(initialGlobal.groupSoftLimit).toBeGreaterThanOrEqual(4);
    expect(initialGlobal.assetSoftLimit).toBeGreaterThanOrEqual(4);
    expect(initialGlobal.groupSoftLimit).toBe(initialGlobal.assetSoftLimit);
    const initialGroups = Number(initialGlobal.groupsUsed) + Number(initialGlobal.groupsReserved);
    const initialAssets = Number(initialGlobal.assetsUsed) + Number(initialGlobal.assetsReserved);
    expect(initialGroups).toBe(initialAssets);
    expect(initialGroups).toBeLessThan(initialGlobal.groupSoftLimit);

    const activationFillerUserId = randomUUID();
    fillerUserIds.add(activationFillerUserId);
    seedRealPortraitCapacityFiller({
      userId: activationFillerUserId,
      email: `portrait-capacity-activation-filler-${marker}@lindyson.test`,
      marker: `${marker}-activation`,
      count: Number(initialGlobal.groupSoftLimit) - initialGroups - 1,
    });

    const beforeConcurrentActivation = await api(
      ownerA.page,
      '/api/real-portrait-capacity',
    );
    expect(beforeConcurrentActivation.status).toBe(200);
    const beforeActivationGlobal = beforeConcurrentActivation.body.capacity.global;
    expect(
      Number(beforeActivationGlobal.groupsUsed) + Number(beforeActivationGlobal.groupsReserved),
    ).toBe(Number(beforeActivationGlobal.groupSoftLimit) - 1);
    expect(
      Number(beforeActivationGlobal.assetsUsed) + Number(beforeActivationGlobal.assetsReserved),
    ).toBe(Number(beforeActivationGlobal.assetSoftLimit) - 1);

    const activationBody = {
      purpose: '全栈测试：并发抢占最后一个真人 Group 与主图 Asset 槽位',
      commercialUse: true,
      portraitNoticeVersion: 'fullstack-capacity-portrait-v1',
      sensitiveInfoNoticeVersion: 'fullstack-capacity-sensitive-v1',
    };
    const activationResults = await Promise.all([
      api(ownerA.page, `/api/real-portrait-actors/${actorIds[0]}/activation-requests`, {
        method: 'POST',
        body: activationBody,
      }),
      api(ownerB.page, `/api/real-portrait-actors/${actorIds[1]}/activation-requests`, {
        method: 'POST',
        body: activationBody,
      }),
    ]);
    expect(activationResults.every(result => result.status === 200)).toBe(true);
    const admittedActivations = activationResults.filter(
      result => Boolean(result.body.activation.invitationUrl),
    );
    const queuedActivations = activationResults.filter(
      result => result.body.activation.invitationUrl === null,
    );
    expect(admittedActivations).toHaveLength(1);
    expect(queuedActivations).toHaveLength(1);
    expect(queuedActivations[0].body.activation.queuePosition).toEqual(expect.any(Number));

    const afterConcurrentActivation = await api(ownerA.page, '/api/real-portrait-capacity');
    expect(afterConcurrentActivation.status).toBe(200);
    const afterActivationGlobal = afterConcurrentActivation.body.capacity.global;
    expect(
      Number(afterActivationGlobal.groupsUsed) + Number(afterActivationGlobal.groupsReserved),
    ).toBe(Number(afterActivationGlobal.groupSoftLimit));
    expect(
      Number(afterActivationGlobal.assetsUsed) + Number(afterActivationGlobal.assetsReserved),
    ).toBe(Number(afterActivationGlobal.assetSoftLimit));
    expect(Number(postgresScalar(`
      SELECT count(*)
      FROM real_portrait_capacity_reservations
      WHERE actor_id = ANY(ARRAY[
        '${actorIds[0]}'::uuid,
        '${actorIds[1]}'::uuid
      ])
        AND status = 'reserved';
    `))).toBe(1);
    expect(Number(postgresScalar(`
      SELECT count(*)
      FROM real_portrait_activation_queue
      WHERE actor_id = ANY(ARRAY[
        '${actorIds[0]}'::uuid,
        '${actorIds[1]}'::uuid
      ])
        AND status = 'waiting';
    `))).toBe(1);

    const cancelled = await Promise.all([
      api(ownerA.page, `/api/real-portrait-actors/${actorIds[0]}/revoke`, {
        method: 'POST',
        body: { reasonCode: 'fullstack-capacity-phase-reset' },
      }),
      api(ownerB.page, `/api/real-portrait-actors/${actorIds[1]}/revoke`, {
        method: 'POST',
        body: { reasonCode: 'fullstack-capacity-phase-reset' },
      }),
    ]);
    expect(cancelled.every(result => result.status === 200)).toBe(true);
    await expect.poll(async () => {
      const capacity = await api(ownerA.page, '/api/real-portrait-capacity');
      expect(capacity.status).toBe(200);
      return {
        groups: Number(capacity.body.capacity.global.groupsUsed)
          + Number(capacity.body.capacity.global.groupsReserved),
        assets: Number(capacity.body.capacity.global.assetsUsed)
          + Number(capacity.body.capacity.global.assetsReserved),
      };
    }, {
      timeout: 10_000,
      intervals: [100, 250, 500],
    }).toEqual({
      groups: Number(beforeActivationGlobal.groupSoftLimit) - 1,
      assets: Number(beforeActivationGlobal.assetSoftLimit) - 1,
    });

    releaseRealPortraitCapacityFiller(activationFillerUserId);
    fillerUserIds.delete(activationFillerUserId);

    const reactivations = await Promise.all([
      api(ownerA.page, `/api/real-portrait-actors/${actorIds[0]}/activation-requests`, {
        method: 'POST',
        body: {
          ...activationBody,
          purpose: '全栈测试：演员 A 重新授权后测试第二张素材容量',
        },
      }),
      api(ownerB.page, `/api/real-portrait-actors/${actorIds[1]}/activation-requests`, {
        method: 'POST',
        body: {
          ...activationBody,
          purpose: '全栈测试：演员 B 重新授权后测试第二张素材容量',
        },
      }),
    ]);
    expect(reactivations.every(result => result.status === 200)).toBe(true);
    expect(reactivations.every(
      result => Boolean(result.body.activation.invitationUrl),
    )).toBe(true);
    const reactivationTokens = reactivations.map(result => {
      const url = new URL(String(result.body.activation.invitationUrl));
      const token = new URLSearchParams(url.hash.slice(1)).get('token');
      expect(token).toBeTruthy();
      return String(token);
    });

    const rematerialized = await Promise.all([
      completeRealPortraitInvitationForFullstack(
        ownerA.page,
        subjectPageA,
        actorIds[0],
        reactivationTokens[0],
        `${marker}-capacity-a`,
      ),
      completeRealPortraitInvitationForFullstack(
        ownerB.page,
        subjectPageB,
        actorIds[1],
        reactivationTokens[1],
        `${marker}-capacity-b`,
      ),
    ]);
    expect(rematerialized).toHaveLength(2);

    const beforeSecondaryFiller = await api(ownerA.page, '/api/real-portrait-capacity');
    expect(beforeSecondaryFiller.status).toBe(200);
    const beforeSecondaryGlobal = beforeSecondaryFiller.body.capacity.global;
    const residentGroups = Number(beforeSecondaryGlobal.groupsUsed)
      + Number(beforeSecondaryGlobal.groupsReserved);
    const residentAssets = Number(beforeSecondaryGlobal.assetsUsed)
      + Number(beforeSecondaryGlobal.assetsReserved);
    expect(residentGroups).toBe(residentAssets);
    expect(residentAssets).toBeLessThan(Number(beforeSecondaryGlobal.assetSoftLimit) - 1);

    const uploadFillerUserId = randomUUID();
    fillerUserIds.add(uploadFillerUserId);
    seedRealPortraitCapacityFiller({
      userId: uploadFillerUserId,
      email: `portrait-capacity-upload-filler-${marker}@lindyson.test`,
      marker: `${marker}-upload`,
      count: Number(beforeSecondaryGlobal.assetSoftLimit) - residentAssets - 1,
    });

    const beforeConcurrentSecondary = await api(
      ownerA.page,
      '/api/real-portrait-capacity',
    );
    expect(beforeConcurrentSecondary.status).toBe(200);
    expect(
      Number(beforeConcurrentSecondary.body.capacity.global.assetsUsed)
        + Number(beforeConcurrentSecondary.body.capacity.global.assetsReserved),
    ).toBe(Number(beforeConcurrentSecondary.body.capacity.global.assetSoftLimit) - 1);

    const secondaryUploadBody = {
      kind: 'secondary',
      mimeType: 'image/jpeg',
      sizeBytes: 1_024,
    };
    const secondaryResults = await Promise.all([
      api(ownerA.page, `/api/real-portrait-actors/${actorIds[0]}/uploads`, {
        method: 'POST',
        body: secondaryUploadBody,
      }),
      api(ownerB.page, `/api/real-portrait-actors/${actorIds[1]}/uploads`, {
        method: 'POST',
        body: secondaryUploadBody,
      }),
    ]);
    const admittedUploads = secondaryResults.filter(result => result.status === 200);
    const rejectedUploads = secondaryResults.filter(result => result.status !== 200);
    expect(admittedUploads).toHaveLength(1);
    expect(admittedUploads[0].body.upload).toMatchObject({
      kind: 'secondary',
      status: 'waiting_upload',
    });
    expect(rejectedUploads).toHaveLength(1);
    expect(rejectedUploads[0]).toMatchObject({
      status: 409,
      body: { code: 'REAL_PORTRAIT_CAPACITY_WAIT' },
    });

    const afterConcurrentSecondary = await api(ownerA.page, '/api/real-portrait-capacity');
    expect(afterConcurrentSecondary.status).toBe(200);
    const afterSecondaryGlobal = afterConcurrentSecondary.body.capacity.global;
    expect(
      Number(afterSecondaryGlobal.assetsUsed) + Number(afterSecondaryGlobal.assetsReserved),
    ).toBe(Number(afterSecondaryGlobal.assetSoftLimit));
    expect(
      Number(afterSecondaryGlobal.groupsUsed) + Number(afterSecondaryGlobal.groupsReserved),
    ).toBeLessThanOrEqual(Number(afterSecondaryGlobal.groupSoftLimit));
    expect(Number(postgresScalar(`
      SELECT count(*)
      FROM real_portrait_upload_sessions
      WHERE actor_id = ANY(ARRAY[
        '${actorIds[0]}'::uuid,
        '${actorIds[1]}'::uuid
      ])
        AND kind = 'secondary'
        AND status = 'waiting_upload'
        AND expires_at > now();
    `))).toBe(1);
    expect(Number(postgresScalar(`
      SELECT count(*)
      FROM real_portrait_capacity_reservations
      WHERE actor_id = ANY(ARRAY[
        '${actorIds[0]}'::uuid,
        '${actorIds[1]}'::uuid
      ])
        AND status = 'reserved'
        AND asset_slots = 2;
    `))).toBe(1);
  } finally {
    for (const fillerUserId of fillerUserIds) {
      releaseRealPortraitCapacityFiller(fillerUserId);
    }
    await Promise.all([
      ownerA.context.close(),
      ownerB.context.close(),
      subjectContextA.close(),
      subjectContextB.close(),
    ]);
  }
});

test('TK 1.0 管理 API 不能绕过终结器开放，受审计切流后回滚不能复活 V6', async ({ browser }) => {
  const adminA = await createAuthenticatedPage(browser, primaryAccount);
  const adminB = await createAuthenticatedPage(browser, primaryAccount);
  try {
    expect(postgresScalar(`
      SELECT (v6_retired_at IS NULL)::text
      FROM tk_prompt_engine_settings
      WHERE singleton_id = 1;
    `)).toBe('true');
    postgres(`
      UPDATE prompt_wizard_settings
      SET available = true, updated_at = now()
      WHERE singleton_id = 1;
      UPDATE tk_prompt_engine_settings
      SET available = false, updated_at = now()
      WHERE singleton_id = 1;
    `);

    const [legacyEnable, rejectedTkEnable] = await Promise.all([
      api(adminA.page, '/api/admin/prompt-wizard-settings', {
        method: 'PATCH',
        headers: { 'Idempotency-Key': `fullstack-v6-concurrent-enable-${randomUUID()}` },
        body: { available: true },
      }),
      api(adminB.page, '/api/admin/tk-prompt-engine-settings', {
        method: 'PATCH',
        headers: { 'Idempotency-Key': `fullstack-tk-concurrent-enable-${randomUUID()}` },
        body: { available: true },
      }),
    ]);

    expect(legacyEnable.status).toBe(200);
    expect(rejectedTkEnable).toMatchObject({
      status: 409,
      body: { code: 'TK_PROMPT_ENABLE_REQUIRES_FINALIZER' },
    });
    expect(postgresScalar(`
      SELECT concat_ws('|',
        tk.available::text,
        (tk.v6_retired_at IS NOT NULL)::text,
        legacy.available::text
      )
      FROM tk_prompt_engine_settings tk
      CROSS JOIN prompt_wizard_settings legacy
      WHERE tk.singleton_id = 1 AND legacy.singleton_id = 1;
    `)).toBe('false|false|true');

    postgres(`
      BEGIN;
      SELECT pg_advisory_xact_lock(hashtextextended('prompt-engine-v1-cutover', 0));
      SELECT singleton_id FROM prompt_wizard_settings WHERE singleton_id = 1 FOR UPDATE;
      SELECT singleton_id FROM tk_prompt_engine_settings WHERE singleton_id = 1 FOR UPDATE;
      UPDATE tk_prompt_engine_settings
      SET available = true,
          v6_retired_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE singleton_id = 1 AND available = false AND v6_retired_at IS NULL;
      UPDATE prompt_wizard_settings
      SET available = false, updated_at = clock_timestamp()
      WHERE singleton_id = 1 AND available = true AND engine_version = 4;
      COMMIT;
    `);
    expect(postgresScalar(`
      SELECT concat_ws('|',
        tk.available::text,
        (tk.v6_retired_at IS NOT NULL)::text,
        legacy.available::text
      )
      FROM tk_prompt_engine_settings tk
      CROSS JOIN prompt_wizard_settings legacy
      WHERE tk.singleton_id = 1 AND legacy.singleton_id = 1;
    `)).toBe('true|true|false');

    const rollbackTk = await api(adminA.page, '/api/admin/tk-prompt-engine-settings', {
      method: 'PATCH',
      headers: { 'Idempotency-Key': `fullstack-tk-rollback-${randomUUID()}` },
      body: { available: false },
    });
    expect(rollbackTk.status).toBe(200);
    expect(rollbackTk.body.settings).toMatchObject({ available: false });

    const rejectedLegacyReopen = await api(adminB.page, '/api/admin/prompt-wizard-settings', {
      method: 'PATCH',
      headers: { 'Idempotency-Key': `fullstack-v6-reopen-${randomUUID()}` },
      body: { available: true },
    });
    expect(rejectedLegacyReopen).toMatchObject({
      status: 409,
      body: { code: 'PROMPT_WIZARD_WRITE_RETIRED' },
    });
    const retiredWrite = await api(adminA.page, '/api/ai/prompt-wizard/runs', {
      method: 'POST',
      body: {},
    });
    expect(retiredWrite).toMatchObject({
      status: 410,
      body: { code: 'PROMPT_WIZARD_WRITE_RETIRED' },
    });
    expect(postgresScalar(`
      SELECT concat_ws('|', available::text, (v6_retired_at IS NOT NULL)::text)
      FROM tk_prompt_engine_settings
      WHERE singleton_id = 1;
    `)).toBe('false|true');
    expect(postgresRollbackScriptFailure(`
      UPDATE tk_prompt_engine_settings
      SET v6_retired_at = NULL
      WHERE singleton_id = 1;
    `)).toContain('v6_retired_at is immutable after cutover');
  } finally {
    await Promise.all([adminA.context.close(), adminB.context.close()]);
  }
});

test('TK 1.0 通过真实 PostgreSQL、Redis、API、worker 与 Fake Provider 生成三案并应用到视频任务', async ({ browser }) => {
  test.setTimeout(180_000);
  const marker = randomUUID();
  const userId = randomUUID();
  const folderId = randomUUID();
  const assetId = randomUUID();
  const objectKey = `fullstack/tk-prompt-engine/${assetId}.png`;
  const isolatedWorkerName = `${composeProject}-tk-prompt-${marker.slice(0, 8)}`;
  const testAccount = {
    email: `tk-prompt-engine-${marker}@lindyson.test`,
    password: primaryAccount.password,
  };
  let isolatedWorkerId = '';
  let mainWorkerStopped = false;
  let admin: Awaited<ReturnType<typeof createAuthenticatedPage>> | undefined;
  let session: Awaited<ReturnType<typeof createAuthenticatedPage>> | undefined;
  let originalPromptEngineState: {
    tkAvailable: boolean;
    tkV6RetiredAt: string | null;
    tkUpdatedBy: string | null;
    tkUpdatedAt: string;
    legacyAvailable: boolean;
    legacyUpdatedAt: string;
  } | undefined;

  postgres(`
    INSERT INTO users (id, email, password_hash, user_name)
    SELECT '${userId}', '${testAccount.email}', password_hash, 'TK Prompt Engine 全栈专用用户'
    FROM users WHERE email = '${primaryAccount.email}';

    INSERT INTO asset_folders (id, user_id, name, source, is_system)
    VALUES ('${folderId}', '${userId}', 'TK Prompt Engine 全栈商品图', 'uploaded-image', false);

    INSERT INTO assets (
      id, user_id, folder_id, name, type, source, object_key, size_bytes,
      deletion_status, thumbnail_status, created_at, updated_at
    ) VALUES (
      '${assetId}', '${userId}', '${folderId}', '全栈商品结构.png', 'image', 'uploaded-image',
      '${objectKey}', 1024, 'active', 'pending', now(), now()
    );
  `);
  writeApiStorageObject(
    objectKey,
    readFileSync('src/imports/alipay-logo.png').toString('base64'),
  );

  try {
    admin = await createAuthenticatedPage(browser, primaryAccount);
    session = await createAuthenticatedPage(browser, testAccount);
    originalPromptEngineState = JSON.parse(postgresScalar(`
      SELECT json_build_object(
        'tkAvailable', tk.available,
        'tkV6RetiredAt', tk.v6_retired_at,
        'tkUpdatedBy', tk.updated_by,
        'tkUpdatedAt', tk.updated_at,
        'legacyAvailable', legacy.available,
        'legacyUpdatedAt', legacy.updated_at
      )::text
      FROM tk_prompt_engine_settings tk
      CROSS JOIN prompt_wizard_settings legacy
      WHERE tk.singleton_id = 1 AND legacy.singleton_id = 1;
    `));

    const seededCredits = await api(admin.page, '/api/admin/credits/adjust', {
      method: 'POST',
      headers: { 'Idempotency-Key': `fullstack-tk-credit-${marker}` },
      body: {
        userId,
        mainDelta: 0,
        addonDelta: 100,
        note: '全栈测试：验证 TK 方案来源创建视频任务',
      },
    });
    expect(seededCredits.status).toBe(200);

    if (!originalPromptEngineState.tkAvailable) {
      // 单跑时执行正式的一次性切流；与前一管理用例共跑时墓碑已存在且 TK
      // 已回滚关闭，测试 setup 只在同一锁顺序下临时重开 TK，绝不清空墓碑。
      postgres(`
        BEGIN;
        SELECT pg_advisory_xact_lock(hashtextextended('prompt-engine-v1-cutover', 0));
        SELECT singleton_id FROM prompt_wizard_settings WHERE singleton_id = 1 FOR UPDATE;
        SELECT singleton_id FROM tk_prompt_engine_settings WHERE singleton_id = 1 FOR UPDATE;
        UPDATE tk_prompt_engine_settings
        SET available = true,
            v6_retired_at = COALESCE(v6_retired_at, clock_timestamp()),
            updated_at = clock_timestamp()
        WHERE singleton_id = 1 AND available = false;
        UPDATE prompt_wizard_settings
        SET available = false, updated_at = clock_timestamp()
        WHERE singleton_id = 1 AND engine_version = 4;
        COMMIT;
      `);
    }
    expect(postgresScalar(`
      SELECT concat_ws('|', tk.available::text,
        (tk.v6_retired_at IS NOT NULL)::text, legacy.available::text)
      FROM tk_prompt_engine_settings tk
      CROSS JOIN prompt_wizard_settings legacy
      WHERE tk.singleton_id = 1 AND legacy.singleton_id = 1;
    `)).toBe('true|true|false');

    // 常规 worker 没有测试 Provider 注入入口；先停掉它，避免它抢占 TK job 后
    // 尝试真实 Ark。隔离 worker 使用同一生产镜像、数据库和 Redis 队列。
    dockerCompose('stop', 'worker');
    mainWorkerStopped = true;
    isolatedWorkerId = dockerComposeOutput(
      'run', '--detach', '--no-deps', '--name', isolatedWorkerName,
      'worker', 'node', '--input-type=module', '--eval', tkPromptFakeWorkerScript(),
    ).trim();
    expect(isolatedWorkerId).not.toBe('');

    const settings = await api(session.page, '/api/ai/tk-prompt-engine/settings');
    expect(settings.status).toBe(200);
    expect(settings.body.settings).toMatchObject({ schemaVersion: 1, available: true });

    const createdRun = await api(session.page, '/api/ai/tk-prompt-engine/runs', {
      method: 'POST',
      body: {
        idempotencyKey: `fullstack-tk-run-${marker}`,
        imageAssetIds: [assetId],
      },
    });
    expect(createdRun.status).toBe(202);
    expect(createdRun.body.run).toMatchObject({
      schemaVersion: 1,
      status: 'analyzing',
      imageAssetIds: [assetId],
    });

    await expect.poll(async () => {
      const current = await api(
        session!.page,
        `/api/ai/tk-prompt-engine/runs/${createdRun.body.run.id}`,
      );
      expect(current.status).toBe(200);
      if (current.body.run.status === 'failed') {
        throw new Error(`TK 事实分析失败：${current.body.run.failureReason ?? '未知原因'}`);
      }
      return current.body.run.status;
    }, { timeout: 45_000, intervals: [250, 500, 1_000] }).toBe('ready');
    const analyzed = await api(
      session.page,
      `/api/ai/tk-prompt-engine/runs/${createdRun.body.run.id}`,
    );
    expect(analyzed.body.run.evidenceProfile).toMatchObject({
      schemaVersion: 1,
      productIdentity: { name: '全栈测试商品', category: '家居用品', confidence: 'high' },
      visibleFacts: [{ factId: 'visible-001', sourceImageAssetIds: [assetId] }],
      demonstrableActions: [{
        actionId: 'action-001',
        supportingFactIds: ['visible-001'],
        sourceImageAssetIds: [assetId],
      }],
    });

    const generationRequest = await api(
      session.page,
      `/api/ai/tk-prompt-engine/runs/${createdRun.body.run.id}/generations`,
      {
        method: 'POST',
        body: {
          idempotencyKey: `fullstack-tk-generation-${marker}`,
          expectedGenerationCredits: Number(settings.body.settings.generationCredits),
          evidenceReview: {
            productName: '全栈测试商品',
            category: '家居用品',
            rejectedVisibleFactIds: [],
            userConfirmedFacts: [],
            forbiddenClaims: ['不得虚构功效、销量或认证'],
          },
          creativeInput: {
            targetMarket: 'United States',
            targetAudience: '重视清晰商品演示的成年用户',
            verifiedOffer: '',
            appearance: { mode: 'auto' },
            availableScenes: ['真实家居台面'],
            availableAssets: ['商品参考图', '双手'],
          },
          videoConfig: {
            model: 'seedance-2.0',
            aspectRatio: '9:16',
            resolution: '480p',
            durationSeconds: 5,
          },
        },
      },
    );
    expect(generationRequest.status).toBe(202);
    expect(generationRequest.body.generation).toMatchObject({
      status: 'queued',
      isFree: true,
      credits: 0,
      creditStatus: 'none',
    });

    await expect.poll(async () => {
      const current = await api(
        session!.page,
        `/api/ai/tk-prompt-engine/generations/${generationRequest.body.generation.id}`,
      );
      expect(current.status).toBe(200);
      if (current.body.generation.status === 'failed') {
        throw new Error(`TK 三方案生成失败：${current.body.generation.failureReason ?? '未知原因'}`);
      }
      return current.body.generation.status;
    }, { timeout: 60_000, intervals: [250, 500, 1_000] }).toBe('completed');
    const completedGeneration = (
      await api(
        session.page,
        `/api/ai/tk-prompt-engine/generations/${generationRequest.body.generation.id}`,
      )
    ).body.generation;
    expect(completedGeneration.options.map((option: { slot: string }) => option.slot)).toEqual([
      'safe', 'native', 'creative',
    ]);
    expect(completedGeneration.options.every((option: {
      status: string;
      plan: { audioMode: string; executionPrompt: string } | null;
    }) => (
      option.status === 'completed'
      && option.plan?.audioMode === 'sound-design-only'
      && option.plan.executionPrompt.includes('@图片1')
    ))).toBe(true);
    expect(postgresScalar(`
      SELECT concat_ws('|', run.status, generation.status,
        count(option.id)::text,
        count(option.id) FILTER (WHERE option.status = 'completed')::text)
      FROM tk_prompt_runs run
      JOIN tk_prompt_generations generation ON generation.run_id = run.id
      JOIN tk_prompt_options option ON option.generation_id = generation.id
      WHERE run.id = '${createdRun.body.run.id}'::uuid
      GROUP BY run.status, generation.status;
    `)).toBe('ready|completed|3|3');

    const resumed = await api(session.page, '/api/ai/tk-prompt-engine/resume');
    expect(resumed.status).toBe(200);
    expect(resumed.body.run.id).toBe(createdRun.body.run.id);
    expect(resumed.body.generation.id).toBe(completedGeneration.id);
    expect(resumed.body.generation.options).toHaveLength(3);

    // TK 链路已完成后恢复常规 worker，继续验证服务端会按持久化原稿、
    // 视频配置和商品图片来源重新校验并写入规范化 tkPromptSource。
    execFileSync('docker', ['rm', '--force', isolatedWorkerId], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    isolatedWorkerId = '';
    dockerCompose('start', 'worker');
    mainWorkerStopped = false;

    const selectedOption = completedGeneration.options.find(
      (option: { slot: string }) => option.slot === 'safe',
    );
    expect(selectedOption?.plan).toBeTruthy();
    const createdVideo = await api(session.page, '/api/ai/video-tasks/batch', {
      method: 'POST',
      body: {
        idempotencyKey: `fullstack-tk-video-${marker}`,
        requests: [{
          model: 'Seedance 2.0',
          prompt: selectedOption.plan.executionPrompt,
          config: {
            mode: 'general',
            aspectRatio: '9:16',
            resolution: '480p',
            durationSeconds: 5,
            generateAudio: false,
          },
          references: [{ assetId, role: 'reference_image' }],
          tkPromptSource: {
            runId: createdRun.body.run.id,
            generationId: completedGeneration.id,
            optionId: selectedOption.id,
            schemaVersion: 1,
            // 必须由服务端以持久化原稿重算，客户端值不能成为真源。
            editBucket: 'material',
          },
        }],
      },
    });
    expect(createdVideo.status, JSON.stringify(createdVideo.body)).toBe(200);
    expect(createdVideo.body.tasks).toHaveLength(1);
    const videoTask = createdVideo.body.tasks[0];
    expect(videoTask).toMatchObject({ status: 'queued', creditStatus: 'held' });
    expect(postgresScalar(`
      SELECT concat_ws('|',
        tk_prompt_source->>'runId',
        tk_prompt_source->>'generationId',
        tk_prompt_source->>'optionId',
        tk_prompt_source->>'schemaVersion',
        tk_prompt_source->>'editBucket')
      FROM generation_tasks WHERE id = '${videoTask.id}'::uuid;
    `)).toBe([
      createdRun.body.run.id,
      completedGeneration.id,
      selectedOption.id,
      '1',
      'none',
    ].join('|'));
  } finally {
    if (isolatedWorkerId) {
      execFileSync('docker', ['rm', '--force', isolatedWorkerId], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      });
    }
    if (mainWorkerStopped) dockerCompose('start', 'worker');
    if (originalPromptEngineState) {
      // v6_retired_at 的不可逆性属于生产业务边界；fullstack teardown 需要恢复
      // grep 单跑前的数据库夹具，故只在一次性测试库会话中临时禁用用户触发器。
      postgres(`
        SET session_replication_role = replica;
        UPDATE tk_prompt_engine_settings
        SET available = ${originalPromptEngineState.tkAvailable},
            v6_retired_at = ${originalPromptEngineState.tkV6RetiredAt
              ? `'${originalPromptEngineState.tkV6RetiredAt}'::timestamptz`
              : 'NULL'},
            updated_by = ${originalPromptEngineState.tkUpdatedBy
              ? `'${originalPromptEngineState.tkUpdatedBy}'::uuid`
              : 'NULL'},
            updated_at = '${originalPromptEngineState.tkUpdatedAt}'::timestamptz
        WHERE singleton_id = 1;
        SET session_replication_role = origin;
        UPDATE prompt_wizard_settings
        SET available = ${originalPromptEngineState.legacyAvailable},
            updated_at = '${originalPromptEngineState.legacyUpdatedAt}'::timestamptz
        WHERE singleton_id = 1;
      `);
    }
    await Promise.all([
      session?.context.close(),
      admin?.context.close(),
    ]);
    removeApiStorageObject(objectKey);
  }
});

function tkPromptFakeWorkerScript() {
  return String.raw`
import { startTkPromptEngineWorker } from '/app/apps/api/dist/worker/tkPromptEngineWorker.js';

const usage = (operation, planId = null) => ({
  operation,
  planId,
  responseId: null,
  model: 'fake-tk-prompt-engine',
  attempts: 1,
  inputTokens: 0,
  outputTokens: 0,
});

const strategies = [{
  slot: 'safe',
  labelZh: '最稳',
  objective: 'conversion',
  styleForm: 'scene',
  style: 'scene',
  videoMode: 'scene_demo',
  hookPatternId: 'pain_strike',
  firstFrameId: 'pain_reveal',
  firstFrame: '首帧呈现真实使用不便',
  openingAction: '操作手部立即指向商品可见结构',
  openingLine: '',
  relevanceBeat: '真实台面中的不便与商品动作连续发生',
  productBridge: '沿同一操作进入商品结构自证',
  buyingMotivationId: 'problem_relief',
  buyingMotivation: '缓解真实使用不便',
  proofMethodId: 'visible_operation',
  proofMethod: '现场完成一次可见操作',
  ctaStrategy: '邀请查看当前商品详情',
  requiredMaterials: [],
  allowedFactIds: ['visible-001'],
}, {
  slot: 'native',
  labelZh: '最原生',
  objective: 'trust',
  styleForm: 'product',
  style: 'product_pov',
  videoMode: 'product_closeup',
  hookPatternId: 'sound_hook',
  firstFrameId: 'sound_sync',
  firstFrame: '商品操作拟音与微距动作同步',
  openingAction: '操作手部按下可见结构并触发卡扣声',
  openingLine: '',
  relevanceBeat: '熟悉的操作声音对应真实使用瞬间',
  productBridge: '音画同步落到结构特写',
  buyingMotivationId: 'confidence',
  buyingMotivation: '通过可见细节建立使用信心',
  proofMethodId: 'structure_closeup',
  proofMethod: '微距展示结构和操作关系',
  ctaStrategy: '邀请用户近看商品细节',
  requiredMaterials: [],
  allowedFactIds: ['visible-001'],
}, {
  slot: 'creative',
  labelZh: '最抓眼',
  objective: 'attention',
  styleForm: 'drama',
  style: 'drama',
  videoMode: 'scene_demo',
  hookPatternId: 'unexpected',
  firstFrameId: 'structure_reveal',
  firstFrame: '首帧直接执行商品关键动作',
  openingAction: '操作手部直接启动并连续完成可见动作',
  openingLine: '',
  relevanceBeat: '意外动作立刻连接真实使用环境',
  productBridge: '继续同一动作完成结构证明',
  buyingMotivationId: 'curiosity',
  buyingMotivation: '通过结构揭晓满足好奇心',
  proofMethodId: 'context_demo',
  proofMethod: '在真实台面完成场景演示',
  ctaStrategy: '邀请查看商品完整结构',
  requiredMaterials: [],
  allowedFactIds: ['visible-001'],
}];

function optionCandidate(factPack) {
  const fact = factPack.facts.find(item => item.factId === 'visible-001');
  const action = factPack.demonstrableActions.find(item => item.actionId === 'action-001');
  if (!fact || !action) throw new Error('Fake TK Provider 缺少稳定事实或动作');
  return {
    title: '商品结构自证',
    whyItFits: '使用图片可见结构和连续操作建立信任',
    coreInformationPoints: [{
      messageId: 'message-001',
      message: fact.text,
      factIds: [fact.factId],
    }],
    primaryActionId: action.actionId,
    beats: [[0, 1, 'start'], [1, 3, 'progress'], [3, 5, 'complete']].map(
      ([startSeconds, endSeconds, actionPhase]) => ({
        startSeconds,
        endSeconds,
        environment: '真实家居台面',
        subject: '商品可见结构与操作手部',
        action: action.text,
        shotSize: '微距特写',
        coreInformationPointIds: ['message-001'],
        actionPhase,
        productImageIndex: 1,
        presenterVisible: false,
        movementId: 'slow_push_in',
        lighting: '柔和真实室内光',
        editingCue: '在商品动作完成点自然切镜',
        soundDesign: '真实商品操作拟音与轻微环境声',
        voiceoverTarget: '',
        voiceoverZh: '',
        factIds: [fact.factId],
      }),
    ),
    assumptions: [],
    requiredMaterials: [],
    warnings: [],
  };
}

const provider = {
  async analyzeFacts({ images }) {
    if (!Array.isArray(images) || images.length !== 1) {
      throw new Error('Fake TK Provider 只接受当前测试的一张商品图');
    }
    return {
      value: {
        productName: '全栈测试商品',
        category: '家居用品',
        confidence: 'high',
        visibleFacts: [{
          text: '商品表面有可按压的可见结构',
          sourceImageIndexes: [0],
          confidence: 'high',
        }],
        internalHypotheses: [],
        demonstrableActions: [{
          actionId: 'action-001',
          text: '操作手部连续按下商品可见结构',
          supportingFactIndexes: [0],
        }],
      },
      usage: usage('facts'),
    };
  },
  async planStrategies() {
    return { value: { strategies }, usage: usage('strategies') };
  },
  async generateOption({ factPack, strategy }) {
    return { value: optionCandidate(factPack), usage: usage('option', strategy.slot) };
  },
  async repairOption({ factPack, strategy }) {
    return { value: optionCandidate(factPack), usage: usage('option-repair', strategy.slot) };
  },
};

const worker = startTkPromptEngineWorker({ provider });
const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
await new Promise(() => undefined);
`;
}

async function activateRealPortraitActorForFullstack(
  creatorPage: Page,
  subjectPage: Page,
  marker: string,
  alias: string,
) {
  const created = await api(creatorPage, '/api/real-portrait-actors', {
    method: 'POST',
    body: { alias },
  });
  expect(created.status).toBe(200);
  const actorId = String(created.body.actor.id);

  const activation = await api(
    creatorPage,
    `/api/real-portrait-actors/${actorId}/activation-requests`,
    {
      method: 'POST',
      body: {
        purpose: `全栈测试：${alias}经本人同意后用于商业 AI 视频生成`,
        commercialUse: true,
        portraitNoticeVersion: 'fullstack-portrait-consent-v1',
        sensitiveInfoNoticeVersion: 'fullstack-sensitive-face-v1',
      },
    },
  );
  expect(activation.status).toBe(200);
  const invitationUrl = new URL(String(activation.body.activation.invitationUrl));
  const inviteToken = new URLSearchParams(invitationUrl.hash.slice(1)).get('token');
  expect(inviteToken).toBeTruthy();

  const activated = await completeRealPortraitInvitationForFullstack(
    creatorPage,
    subjectPage,
    actorId,
    String(inviteToken),
    marker,
  );

  return {
    actorId,
    assetId: activated.assetId,
    inviteToken: String(inviteToken),
    manageUrl: activated.manageUrl,
  };
}

async function completeRealPortraitInvitationForFullstack(
  creatorPage: Page,
  subjectPage: Page,
  actorId: string,
  inviteToken: string,
  marker: string,
) {
  const consent = await api(
    subjectPage,
    `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}`,
    {
      method: 'POST',
      body: {
        accepted: true,
        adultConfirmed: true,
        portraitConsent: true,
        sensitiveFaceConsent: true,
        commercialUseConsent: true,
        authorizationDays: 90,
      },
    },
  );
  expect(consent.status).toBe(200);

  const verification = await api(
    subjectPage,
    `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}/start-verification`,
    { method: 'POST' },
  );
  expect(verification.status).toBe(200);
  const verificationUrl = new URL(String(verification.body.verification.verificationUrl));
  const verificationFragment = new URLSearchParams(verificationUrl.hash.slice(1));
  const callbackUrl = new URL(String(verificationFragment.get('callbackUrl')));
  const bytedToken = verificationFragment.get('bytedToken');
  expect(bytedToken).toBeTruthy();

  callbackUrl.searchParams.set('bytedToken', String(bytedToken));
  callbackUrl.searchParams.set('resultCode', '10000');
  callbackUrl.searchParams.set('algorithmBaseRespCode', '0');
  callbackUrl.searchParams.set('reqMeasureInfoValue', '1');
  callbackUrl.searchParams.set('verify_type', 'real_time');
  const callbackNavigation = await subjectPage.goto(callbackUrl.toString(), {
    waitUntil: 'domcontentloaded',
  });
  expect(callbackNavigation?.status()).toBe(200);
  expect(new URL(subjectPage.url()).pathname).toBe('/portrait-consent/verification-complete');
  await expect(subjectPage.getByRole('heading', { name: '本人认证已完成' })).toBeVisible();

  await expect.poll(async () => {
    const status = await api(
      subjectPage,
      `/api/public/real-portrait-invites/${encodeURIComponent(String(inviteToken))}/status`,
    );
    expect(status.status).toBe(200);
    return status.body.status;
  }, {
    timeout: 10_000,
    intervals: [100, 250, 500],
  }).toBe('awaiting_upload');

  const jpeg = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: { r: 111, g: 132, b: 153 },
    },
  }).jpeg({ quality: 90 }).toBuffer();
  const upload = await api(
    creatorPage,
    `/api/real-portrait-actors/${actorId}/uploads`,
    {
      method: 'POST',
      body: {
        kind: 'primary',
        mimeType: 'image/jpeg',
        sizeBytes: jpeg.byteLength,
      },
    },
  );
  expect(upload.status).toBe(200);
  expect(await uploadSignedBytes(
    creatorPage,
    upload.body.upload.signature,
    jpeg.toString('base64'),
  )).toBe(204);

  const completedUpload = await api(
    creatorPage,
    `/api/real-portrait-uploads/${upload.body.upload.id}/complete`,
    {
      method: 'POST',
      body: {
        mimeType: 'image/jpeg',
        sizeBytes: jpeg.byteLength,
        width: 512,
        height: 512,
        sha256: createHash('sha256').update(jpeg).digest('hex'),
      },
    },
  );
  expect(completedUpload.status).toBe(200);
  const assetId = String(completedUpload.body.asset.id);

  await expect.poll(async () => {
    const actor = await api(creatorPage, `/api/real-portrait-actors/${actorId}`);
    expect(actor.status).toBe(200);
    return actor.body.actor;
  }, {
    timeout: 40_000,
    intervals: [250, 500, 1_000, 2_000],
  }).toMatchObject({
    id: actorId,
    lifecycleStatus: 'active',
    authorizationStatus: 'active',
    assets: [{
      id: assetId,
      kind: 'primary',
      status: 'active',
      consistencyStatus: 'passed',
    }],
  });

  return {
    assetId,
    manageUrl: String(consent.body.manageUrl),
  };
}

async function generateWithRealPortraitForFullstack(
  creatorPage: Page,
  actorId: string,
  marker: string,
  prompt: string,
) {
  const creditsBefore = await readCredits(creatorPage);
  const generated = await api(creatorPage, '/api/ai/video-tasks/batch', {
    method: 'POST',
    body: {
      idempotencyKey: `fullstack-portrait-generation-${marker}`,
      requests: [{
        model: 'Seedance 2.0',
        prompt,
        config: {
          mode: 'general',
          aspectRatio: '9:16',
          resolution: '480p',
          durationSeconds: 5,
          generateAudio: false,
        },
        references: [],
        realPortrait: { actorId },
      }],
    },
  });
  expect(generated.status).toBe(200);
  expect(generated.body.tasks).toHaveLength(1);
  const task = generated.body.tasks[0];
  expect(JSON.stringify(task)).not.toContain('asset://');
  expect(JSON.stringify(task)).not.toContain('fake-group-');
  expect(JSON.stringify(task)).not.toContain('fake-asset-');
  expect(await readCredits(creatorPage)).toBe(creditsBefore - Number(task.credits));

  await expect.poll(
    async () => (await readTask(creatorPage, task.id)).status,
    { timeout: 45_000, intervals: [500, 1_000, 2_000] },
  ).toBe('completed');
  const completedTask = await readTask(creatorPage, task.id);
  expect(completedTask).toMatchObject({
    status: 'completed',
    creditStatus: 'settled',
    assetId: expect.any(String),
  });
  expect(completedTask.config).not.toHaveProperty('realPortrait');
  expect(JSON.stringify(completedTask)).not.toContain('asset://');
  expect(JSON.stringify(completedTask)).not.toContain('fake-group-');
  expect(JSON.stringify(completedTask)).not.toContain('fake-asset-');
  return { task, completedTask };
}

function seedRealPortraitCapacityFiller(input: {
  userId: string;
  email: string;
  marker: string;
  count: number;
}) {
  if (!Number.isSafeInteger(input.count) || input.count < 0 || input.count > 45) {
    throw new Error(`真人容量占位数量无效：${input.count}`);
  }
  postgres(`
    INSERT INTO users (id, email, password_hash, user_name, plan_id)
    SELECT CASE WHEN owner_slot = 1 THEN '${input.userId}'::uuid ELSE gen_random_uuid() END,
           CASE
             WHEN owner_slot = 1 THEN '${input.email}'::text
             ELSE 'portrait-capacity-filler-${input.marker}-' || owner_slot::text || '@lindyson.test'
           END,
           source.password_hash,
           '全栈真人容量占位-${input.marker}', plan.id
    FROM users source
    JOIN plans plan ON plan.code = 'enterprise' AND plan.kind = 'main'
    CROSS JOIN generate_series(
      1,
      GREATEST(1, CEIL(${input.count}::numeric / 10)::integer)
    ) AS owners(owner_slot)
    WHERE source.email = '${secondaryAccount.email}'
    ORDER BY owner_slot;

    INSERT INTO real_portrait_actors (
      id, user_id, alias, plan_access_status, lifecycle_status,
      last_successful_generation_at
    )
    SELECT gen_random_uuid(), owner.id,
           '容量占位-${input.marker}-' || slot::text,
           'available', 'active', now()
    FROM generate_series(1, ${input.count}) AS slots(slot)
    JOIN (
      SELECT id,
             row_number() OVER (ORDER BY email)::integer AS owner_slot,
             count(*) OVER()::integer AS owner_count
      FROM users
      WHERE user_name = '全栈真人容量占位-${input.marker}'
    ) owner
      ON owner.owner_slot = ((slot - 1) % owner.owner_count) + 1;

    INSERT INTO real_portrait_authorizations (
      actor_id, version, status, purpose, commercial_use,
      valid_from, valid_until, portrait_notice_version,
      sensitive_info_notice_version, consented_at,
      controller_name, processor_name, privacy_contact, privacy_policy_url,
      processing_scope, retention_rule
    )
    SELECT actor.id, 1, 'active', '全栈测试容量边界既有真人授权', true,
           now(), now() + interval '90 days',
           'fullstack-capacity-filler-v1', 'fullstack-capacity-sensitive-filler-v1', now(),
           'Lindyson 全栈测试主体', '火山方舟测试替身',
           'privacy@lindyson.test', 'https://lindyson.test/privacy',
           '仅用于全栈容量并发测试', '测试结束后立即释放'
    FROM real_portrait_actors actor
    JOIN users owner ON owner.id = actor.user_id
    WHERE owner.user_name = '全栈真人容量占位-${input.marker}';

    INSERT INTO real_portrait_materializations (
      actor_id, authorization_id, generation, provider_account_key,
      region, project_name, provider_group_id, status,
      activated_at, last_used_at
    )
    SELECT actor.id, portrait_authorization.id, 1, 'fullstack-capacity-filler',
           'cn-beijing', 'default',
           'fullstack-group-${input.marker}-' || actor.id::text,
           'active', now(), now()
    FROM real_portrait_actors actor
    JOIN real_portrait_authorizations portrait_authorization
      ON portrait_authorization.actor_id = actor.id
     AND portrait_authorization.version = 1
    JOIN users owner ON owner.id = actor.user_id
    WHERE owner.user_name = '全栈真人容量占位-${input.marker}';

    INSERT INTO real_portrait_assets (
      actor_id, materialization_id, kind, provider_asset_id,
      status, consistency_status
    )
    SELECT materialization.actor_id, materialization.id, 'primary',
           'fullstack-asset-${input.marker}-' || materialization.actor_id::text,
           'active', 'passed'
    FROM real_portrait_materializations materialization
    JOIN real_portrait_actors actor ON actor.id = materialization.actor_id
    JOIN users owner ON owner.id = actor.user_id
    WHERE owner.user_name = '全栈真人容量占位-${input.marker}';
  `);
}

function releaseRealPortraitCapacityFiller(userId: string) {
  postgres(`
    DELETE FROM real_portrait_assets
    WHERE actor_id IN (
      SELECT actor.id
      FROM real_portrait_actors actor
      JOIN users owner ON owner.id = actor.user_id
      WHERE owner.user_name = (
        SELECT user_name FROM users WHERE id = '${userId}'::uuid
      )
    );
    DELETE FROM real_portrait_materializations
    WHERE actor_id IN (
      SELECT actor.id
      FROM real_portrait_actors actor
      JOIN users owner ON owner.id = actor.user_id
      WHERE owner.user_name = (
        SELECT user_name FROM users WHERE id = '${userId}'::uuid
      )
    );
    DELETE FROM real_portrait_authorizations
    WHERE actor_id IN (
      SELECT actor.id
      FROM real_portrait_actors actor
      JOIN users owner ON owner.id = actor.user_id
      WHERE owner.user_name = (
        SELECT user_name FROM users WHERE id = '${userId}'::uuid
      )
    );
    DELETE FROM real_portrait_actors
    WHERE user_id IN (
      SELECT id
      FROM users
      WHERE user_name = (
        SELECT user_name FROM users WHERE id = '${userId}'::uuid
      )
    );
    DELETE FROM users
    WHERE user_name = (
      SELECT user_name FROM users WHERE id = '${userId}'::uuid
    );
  `);
}

async function createAuthenticatedPage(
  browser: Browser,
  account: { email: string; password: string },
): Promise<{ context: BrowserContext; page: Page }> {
  // 全栈套件串行复用同一个 Docker/Nginx 来源 IP；隔离测试账号的成功登录不应
  // 因其他用例累计的 IP 桶互相污染。仅清理测试库的 IP 维度，账号限流保持原样。
  postgres(`
    DELETE FROM auth_rate_limit_events
    WHERE scope = 'login:ip';
  `);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  const login = await api(page, '/api/auth/login', {
    method: 'POST',
    body: {
      email: account.email,
      password: account.password,
    },
  });
  expect(login.status).toBe(200);
  expect(login.body.user.email).toBe(account.email);
  expect(login.body).not.toHaveProperty('token');
  return { context, page };
}

async function readCredits(page: Page) {
  const result = await api(page, '/api/account/credits');
  expect(result.status).toBe(200);
  return Number(result.body.credits);
}

async function readTask(page: Page, taskId: string) {
  const result = await api(page, `/api/ai/tasks/${taskId}`);
  expect(result.status).toBe(200);
  return result.body.task;
}

async function uploadFullstackImage(page: Page, suffix: string) {
  const base64 = readFileSync('src/imports/alipay-logo.png').toString('base64');
  const sizeBytes = Buffer.from(base64, 'base64').length;
  const signatureResult = await api(page, '/api/assets/upload-signature', {
    method: 'POST',
    body: {
      filename: `${suffix}.png`,
      contentType: 'image/png',
      sizeBytes,
      source: 'uploaded-image',
      folderId: null,
      idempotencyKey: `fullstack-upload-${suffix}`,
    },
  });
  expect(signatureResult.status).toBe(200);
  const signature = signatureResult.body.signature;
  expect(signature).toMatchObject({ driver: 'local', method: 'PUT' });
  expect(await uploadSignedBytes(page, signature, base64)).toBe(204);

  const completed = await api(page, '/api/assets/complete-upload', {
    method: 'POST',
    body: { uploadSessionId: signature.sessionId },
  });
  expect(completed.status).toBe(200);
  await expect.poll(async () => {
    const current = await api(page, `/api/assets/upload-sessions/${signature.sessionId}`);
    if (['failed', 'canceled', 'expired'].includes(current.body.session.status)) {
      throw new Error(`Seedream 参考图上传异常：${JSON.stringify(current.body.session)}`);
    }
    return current.body.session.status;
  }, { timeout: 30_000, intervals: [200, 500, 1_000] }).toBe('completed');
  const finalized = await api(page, `/api/assets/upload-sessions/${signature.sessionId}`);
  expect(finalized.body.session.asset).toMatchObject({ type: 'image', source: 'uploaded-image' });
  return finalized.body.session.asset;
}

async function waitForPromptWizardRun(page: Page, runId: string) {
  await expect.poll(async () => {
    const result = await api(page, `/api/ai/prompt-wizard/runs/${runId}`);
    expect(result.status).toBe(200);
    if (result.body.run.status === 'failed') {
      throw new Error(`提示词向导产品识别失败：${result.body.run.failureReason ?? '未知原因'}`);
    }
    return result.body.run.status;
  }, {
    timeout: 45_000,
    intervals: [250, 500, 1_000],
  }).toBe('ready');
  const result = await api(page, `/api/ai/prompt-wizard/runs/${runId}`);
  expect(result.status).toBe(200);
  return result.body.run;
}

async function waitForPromptWizardUseDirectionSet(page: Page, useDirectionSetId: string) {
  await expect.poll(async () => {
    const result = await api(page, `/api/ai/prompt-wizard/use-direction-sets/${useDirectionSetId}`);
    expect(result.status).toBe(200);
    if (result.body.useDirectionSet.status === 'failed') {
      throw new Error(`提示词使用方向失败：${result.body.useDirectionSet.failureReason ?? '未知原因'}`);
    }
    if (result.body.useDirectionSet.status === 'needs-input') {
      throw new Error(`提示词使用方向需要补充信息：${result.body.useDirectionSet.clarificationQuestion ?? '未知原因'}`);
    }
    return result.body.useDirectionSet.status;
  }, {
    timeout: 45_000,
    intervals: [250, 500, 1_000],
  }).toBe('completed');
  const result = await api(page, `/api/ai/prompt-wizard/use-direction-sets/${useDirectionSetId}`);
  expect(result.status).toBe(200);
  return result.body.useDirectionSet;
}

async function waitForPromptWizardBatch(page: Page, batchId: string) {
  await expect.poll(async () => {
    const result = await api(page, `/api/ai/prompt-wizard/batches/${batchId}`);
    expect(result.status).toBe(200);
    if (result.body.batch.status === 'failed') {
      const workerLogs = dockerComposeOutput('logs', '--tail', '120', 'worker');
      throw new Error(
        `提示词方案批次失败：${result.body.batch.failureReason ?? '未知原因'}\n${workerLogs}`,
      );
    }
    return result.body.batch.status;
  }, {
    // 3.0 首轮双方案及最多两次按索引内容修复共用该等待窗口；全栈环境
    // 为验证中途终止恢复能力把 Fake Provider 单次延迟固定为 8 秒。
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toBe('completed');
  const result = await api(page, `/api/ai/prompt-wizard/batches/${batchId}`);
  expect(result.status).toBe(200);
  return result.body.batch;
}

async function waitForPromptWizardPlanRevision(page: Page, revisionId: string) {
  await expect.poll(async () => {
    const result = await api(page, `/api/ai/prompt-wizard/plan-revisions/${revisionId}`);
    expect(result.status).toBe(200);
    if (result.body.revision.status === 'failed') {
      throw new Error(`提示词单方案微调失败：${result.body.revision.failureReason ?? '未知原因'}`);
    }
    return result.body.revision.status;
  }, {
    timeout: 45_000,
    intervals: [250, 500, 1_000],
  }).toBe('completed');
  const result = await api(page, `/api/ai/prompt-wizard/plan-revisions/${revisionId}`);
  expect(result.status).toBe(200);
  return result.body.revision;
}

function readGenerationTaskClaimEpoch(taskId: string) {
  const rawClaimEpoch = postgresScalar(`
    SELECT claim_epoch::text
    FROM generation_tasks
    WHERE id = '${taskId}'::uuid;
  `);
  const claimEpoch = Number(rawClaimEpoch);
  if (rawClaimEpoch === '' || !Number.isSafeInteger(claimEpoch)) {
    throw new Error(`无法读取生成任务 ${taskId} 的 claim_epoch`);
  }
  return claimEpoch;
}

function readGenerationSubmissionCheckpoint(taskId: string) {
  const raw = postgresScalar(`
    SELECT concat_ws('|',
      task.status,
      task.processing_stage,
      coalesce(task.provider_task_id, '-'),
      coalesce(run.status, '-'),
      coalesce(run.provider_task_id, '-'),
      (task.provider_result IS NOT NULL)::text,
      (task.asset_id IS NOT NULL)::text
    )
    FROM generation_tasks task
    LEFT JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
    WHERE task.id = '${taskId}'::uuid;
  `);
  if (!raw) return null;
  const [
    status,
    processingStage,
    providerTaskId,
    providerRunStatus,
    providerRunTaskId,
    hasProviderResult,
    hasAsset,
  ] = raw.split('|');
  return {
    status,
    processingStage,
    providerTaskId,
    providerRunStatus,
    providerRunTaskId,
    hasProviderResult: hasProviderResult === 'true',
    hasAsset: hasAsset === 'true',
  };
}

function readGenerationSettlementCheckpoint(taskId: string) {
  const raw = postgresScalar(`
    SELECT concat_ws('|',
      task.status,
      task.processing_stage,
      coalesce(run.status, '-'),
      (task.provider_result IS NOT NULL)::text,
      (run.provider_result IS NOT NULL)::text,
      (position('FULLSTACK_SETTLEMENT_FAILURE' IN coalesce(task.settlement_error, '')) > 0)::text,
      (task.asset_id IS NOT NULL)::text
    )
    FROM generation_tasks task
    LEFT JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
    WHERE task.id = '${taskId}'::uuid;
  `);
  if (!raw) return null;
  const [
    status,
    processingStage,
    providerRunStatus,
    hasTaskProviderResult,
    hasProviderRunResult,
    hasSettlementError,
    hasAsset,
  ] = raw.split('|');
  return {
    status,
    processingStage,
    providerRunStatus,
    hasTaskProviderResult: hasTaskProviderResult === 'true',
    hasProviderRunResult: hasProviderRunResult === 'true',
    hasSettlementError: hasSettlementError === 'true',
    hasAsset: hasAsset === 'true',
  };
}

async function fetchStatus(page: Page, path: string) {
  return page.evaluate(async url => {
    const response = await fetch(url, { credentials: 'include' });
    return response.status;
  }, path);
}

async function uploadSignedBytes(
  page: Page,
  signature: { uploadUrl: string; headers: Record<string, string> },
  base64: string,
) {
  return page.evaluate(async ({ signature, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const response = await fetch(signature.uploadUrl, {
      method: 'PUT',
      headers: signature.headers,
      body: bytes,
      credentials: 'include',
    });
    return response.status;
  }, { signature, base64 });
}

function dockerCompose(...args: string[]) {
  execFileSync('docker', ['compose', '-p', composeProject, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
}

function dockerComposeOutput(...args: string[]) {
  return execFileSync('docker', ['compose', '-p', composeProject, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function dockerComposeFailureOutput(...args: string[]) {
  const result = spawnSync('docker', ['compose', '-p', composeProject, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error(`预期 docker compose ${args.join(' ')} 失败，但命令成功`);
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

async function holdPostgresAdvisoryLock(lockKey: string) {
  const applicationName = `fullstack-lock-${lockKey.slice(-24)}`;
  const readyPrefix = 'FULLSTACK_LOCK_READY:';
  const child = spawn('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY', '-e', `PGAPPNAME=${applicationName}`,
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'lindyson', '-d', 'lindyson',
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let resolveReady: ((pid: number) => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const closed = new Promise<void>(resolve => {
    child.once('close', () => resolve());
  });
  child.stdout.on('data', chunk => {
    stdout += String(chunk);
    const match = stdout.match(new RegExp(`${readyPrefix}(\\d+)`));
    if (match?.[1]) resolveReady?.(Number(match[1]));
  });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.once('error', error => rejectReady?.(error));
  child.once('exit', code => {
    if (!stdout.includes(readyPrefix)) {
      rejectReady?.(new Error(`PostgreSQL 锁持有进程提前退出（${code ?? 'unknown'}）：${stderr}`));
    }
  });
  child.stdin.end(`
    BEGIN;
    SELECT pg_advisory_xact_lock(hashtextextended('${lockKey}', 0));
    SELECT '${readyPrefix}' || pg_backend_pid()::text;
    SELECT pg_sleep(600);
    ROLLBACK;
  `);

  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error('PostgreSQL advisory lock 在 10 秒内未就绪')), 10_000);
  });
  try {
    await Promise.race([ready, timeout]);
  } catch (error) {
    postgres(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE application_name = '${applicationName}' AND pid <> pg_backend_pid();
    `);
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      postgres(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE application_name = '${applicationName}' AND pid <> pg_backend_pid();
      `);
      await Promise.race([
        closed,
        new Promise<void>(resolve => setTimeout(() => {
          child.kill('SIGTERM');
          resolve();
        }, 5_000)),
      ]);
    },
  };
}

function parseLastJsonLine(output: string) {
  const line = output.trim().split('\n').reverse().find(candidate => candidate.trim().startsWith('{'));
  if (!line) throw new Error(`命令输出不含 JSON：${output}`);
  return JSON.parse(line) as unknown;
}

function writeApiStorageObject(objectKey: string, base64: string) {
  dockerCompose(
    'exec', '--no-TTY', 'api',
    'node', '--input-type=commonjs', '-e',
    `const fs = require('node:fs');
const path = require('node:path');
const target = path.join('/app/storage', process.argv[1]);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, Buffer.from(process.argv[2], 'base64'));`,
    objectKey,
    base64,
  );
}

function removeApiStorageObject(objectKey: string) {
  dockerCompose(
    'exec', '--no-TTY', 'api',
    'node', '--input-type=commonjs', '-e',
    `const fs = require('node:fs');
const path = require('node:path');
fs.rmSync(path.join('/app/storage', process.argv[1]), { force: true });`,
    objectKey,
  );
}

function postgres(sql: string) {
  dockerCompose(
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'lindyson', '-d', 'lindyson', '-c', sql,
  );
}

function postgresScript(sql: string) {
  execFileSync('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'lindyson', '-d', 'lindyson',
  ], {
    cwd: process.cwd(),
    env: process.env,
    input: `BEGIN;\n${sql}\nCOMMIT;\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

function restorePromptWizardV6SchemaAfterHistoricalMigrationReplay() {
  const migration = readFileSync(
    new URL('../../apps/api/migrations/071_prompt_wizard_v6_three_routes.sql', import.meta.url),
    'utf8',
  );
  const migrationBodyMarker = '-- 新任务只允许引擎 4；历史 2/3 标记保持不可变。';
  const migrationBodyIndex = migration.indexOf(migrationBodyMarker);
  if (migrationBodyIndex < 0) {
    throw new Error('Migration 071 测试恢复起点不存在');
  }

  // 054/055/056/059 的“历史重放”会在当前主库中重建旧约束。测试结束后
  // 只重放 071 已通过门禁后的目标 DDL，避免旧迁移夹具泄漏到后续用例。
  postgresScript(migration.slice(migrationBodyIndex));
}

function postgresDatabase(database: string, sql: string) {
  execFileSync('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'lindyson', '-d', database, '-c', sql,
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function postgresDatabaseMigrationSequence(
  database: string,
  migrations: Array<{ id: string; sql: string }>,
) {
  execFileSync('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'lindyson', '-d', database,
  ], {
    cwd: process.cwd(),
    env: process.env,
    input: [
      `BEGIN;
       CREATE TABLE schema_migrations (
         id text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       );
       COMMIT;\n`,
      ...migrations.map(({ id, sql }) => (
        `BEGIN;\n${sql}\nINSERT INTO schema_migrations (id) VALUES ('${id}');\nCOMMIT;\n`
      )),
    ].join(''),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

function postgresDatabaseScript(database: string, sql: string) {
  execFileSync('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'lindyson', '-d', database,
  ], {
    cwd: process.cwd(),
    env: process.env,
    input: `BEGIN;\n${sql}\nCOMMIT;\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

function postgresDatabaseScriptFailure(database: string, sql: string) {
  const result = spawnSync('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'lindyson', '-d', database,
  ], {
    cwd: process.cwd(),
    env: process.env,
    input: `BEGIN;\n${sql}\nCOMMIT;\n`,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error(`数据库 ${database} 上的预期失败迁移意外成功`);
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function postgresDatabaseScalar(database: string, sql: string) {
  return execFileSync('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'lindyson', '-d', database, '-c', sql,
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  }).trim();
}

function postgresRollbackScript(sql: string) {
  execFileSync('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'lindyson', '-d', 'lindyson',
  ], {
    cwd: process.cwd(),
    env: process.env,
    input: `BEGIN;\n${sql}\nROLLBACK;\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

function postgresRollbackScriptFailure(sql: string) {
  const result = spawnSync('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'lindyson', '-d', 'lindyson',
  ], {
    cwd: process.cwd(),
    env: process.env,
    input: `BEGIN;\n${sql}\nROLLBACK;\n`,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error('主数据库上的预期失败事务意外成功');
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function postgresScalar(sql: string) {
  return execFileSync('docker', [
    'compose', '-p', composeProject,
    'exec', '--no-TTY',
    'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'lindyson', '-d', 'lindyson', '-c', sql,
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  }).trim();
}

function postgresExplainExecutionMs(sql: string) {
  return postgresExplain(sql).executionMs;
}

function postgresExplain(sql: string) {
  const output = postgresScalar(`SET jit = off; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`无法解析 PostgreSQL EXPLAIN JSON：${output}`);
  const plans = JSON.parse(output.slice(start, end + 1)) as Array<Record<string, unknown>>;
  const executionMs = Number(plans[0]?.['Execution Time']);
  if (!Number.isFinite(executionMs)) throw new Error(`EXPLAIN 缺少执行耗时：${output}`);
  const plan = plans[0]?.Plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error(`EXPLAIN 缺少执行计划：${output}`);
  }
  return { executionMs, plan: plan as Record<string, unknown> };
}

function collectExplainIndexNames(plan: Record<string, unknown>) {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record['Index Name'] === 'string') names.add(record['Index Name']);
    Object.values(record).forEach(visit);
  };
  visit(plan);
  return [...names].sort();
}

function assetIds(items: Array<{ id: string }>) {
  return items.map(item => item.id);
}

function intersection(left: string[], right: string[]) {
  const rightIds = new Set(right);
  return left.filter(id => rightIds.has(id)).sort();
}

function readAssetCursorBoundary(assetId: string) {
  const timestamp = postgresScalar(`
    SELECT created_at::text FROM assets WHERE id = '${assetId}'::uuid;
  `);
  if (!timestamp) throw new Error(`无法读取资产 ${assetId} 的分页时间`);
  return { id: assetId, timestamp };
}

function buildAssetCardExplainSql(input: {
  ownerId: string;
  folderId: string;
  order: 'ASC' | 'DESC';
  comparison?: '<' | '>';
  boundary?: { id: string; timestamp: string };
  includeTotalCount?: boolean;
}) {
  const cursorCondition = input.comparison && input.boundary
    ? `AND (created_at, id) ${input.comparison} ('${input.boundary.timestamp.replaceAll("'", "''")}'::timestamptz, '${input.boundary.id}'::uuid)`
    : '';
  return `
    SELECT id, name, type, source, folder_id, object_key, thumbnail_key,
           thumbnail_status, size_bytes, duration_seconds, width, height, views,
           downloaded_at, download_requested_at, created_at, updated_at
           ${input.includeTotalCount ? ', count(*) OVER()::bigint AS __pagination_total_count' : ''}
    FROM assets
    WHERE user_id = '${input.ownerId}'::uuid
      AND deletion_status = 'active'
      AND folder_id = '${input.folderId}'::uuid
      ${cursorCondition}
    ORDER BY created_at ${input.order}, id ${input.order}
    LIMIT 25
  `;
}

// 与 apiCostReporting.readObservedCoverage 保持同一集合式查询形状；单元测试另行防止退回逐日 LATERAL。
function buildCoverageBenchmarkSql(asOf: string) {
  const safeAsOf = asOf.replaceAll("'", "''");
  return `
    WITH limits AS (
      SELECT ('${safeAsOf}'::timestamptz AT TIME ZONE 'Asia/Shanghai')::date AS today
    ), local_usage_days AS (
      SELECT DISTINCT coalesce(
               local_accounting_date,
               (coalesce(completed_at, created_at) AT TIME ZONE 'Asia/Shanghai')::date
             ) AS start_date
      FROM provider_usage_records
      WHERE provider = 'volcengine-ark'
        AND model = ANY(ARRAY[
          'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini'
        ]::text[])
        AND usage_unit = 'tokens' AND currency = 'CNY'
        AND created_at <= '${safeAsOf}'::timestamptz
    ), local_manifest_intervals AS (
      SELECT window_start AS start_date, least(window_end, limits.today) AS end_date
      FROM provider_reconciliation_runs, limits
      WHERE provider = 'volcengine-ark'
        AND local_cutoff <= '${safeAsOf}'::timestamptz
        AND window_start <= limits.today
    ), local_intervals AS (
      SELECT start_date, start_date AS end_date FROM local_usage_days
      UNION
      SELECT start_date, end_date FROM local_manifest_intervals
    ), evidenced_bill_runs AS (
      SELECT sync_run_id AS id FROM provider_bill_sync_run_items
      UNION
      SELECT official_sync_run_id AS id FROM provider_reconciliation_runs
      WHERE official_sync_run_id IS NOT NULL
    ), latest_manifests AS (
      SELECT DISTINCT ON (official_sync_run_id) official_sync_run_id, bill_state
      FROM provider_reconciliation_runs
      WHERE official_sync_run_id IS NOT NULL
      ORDER BY official_sync_run_id, created_at DESC, id DESC
    ), valid_bill_runs AS (
      SELECT runs.id, runs.window_start, least(runs.window_end, limits.today) AS window_end,
             runs.completed_at, runs.is_final,
             coalesce(
               manifests.bill_state,
               CASE WHEN runs.is_final THEN 'final' ELSE 'provisional' END
             ) AS bill_state
      FROM provider_billing_sync_runs runs
      JOIN evidenced_bill_runs evidence ON evidence.id = runs.id
      LEFT JOIN latest_manifests manifests ON manifests.official_sync_run_id = runs.id
      CROSS JOIN limits
      WHERE runs.provider = 'volcengine-ark'
        AND runs.kind = 'bill' AND runs.status = 'success'
        AND runs.completed_at <= '${safeAsOf}'::timestamptz
        AND runs.window_start <= limits.today
    ), official_run_day_candidates AS (
      SELECT days.day::date AS day, runs.id, runs.completed_at,
             runs.is_final, runs.bill_state,
             row_number() OVER (
               PARTITION BY days.day::date
               ORDER BY runs.completed_at DESC, runs.id DESC
             ) AS run_rank
      FROM valid_bill_runs runs
      CROSS JOIN generate_series(
        runs.window_start, runs.window_end, interval '1 day'
      ) days(day)
    ), official_run_days AS (
      SELECT day AS start_date, day AS end_date, is_final, bill_state
      FROM official_run_day_candidates
      WHERE run_rank = 1
    ), official_detail_days AS (
      SELECT DISTINCT details.expense_date AS start_date,
             details.expense_date AS end_date, details.is_final,
             CASE WHEN details.is_final THEN 'final' ELSE 'provisional' END AS bill_state
      FROM provider_bill_details details
      CROSS JOIN limits
      WHERE details.provider = 'volcengine-ark'
        AND details.product = 'ark_bd' AND details.active = true
        AND details.currency = 'CNY'
        AND details.recognized_model = ANY(ARRAY[
          'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini'
        ]::text[])
        AND details.bill_line_type = 'usage'
        AND details.synced_at <= '${safeAsOf}'::timestamptz
        AND details.expense_date <= limits.today
        AND NOT EXISTS (
          SELECT 1
          FROM official_run_days run_days
          WHERE run_days.start_date = details.expense_date
        )
    ), official_intervals AS (
      SELECT * FROM official_run_days
      UNION
      SELECT * FROM official_detail_days
    )
    SELECT (SELECT min(start_date) FROM local_intervals) AS local_start,
           (SELECT max(end_date) FROM local_intervals) AS local_end,
           (SELECT coalesce(
              jsonb_agg(
                jsonb_build_object('start', start_date, 'end', end_date)
                ORDER BY start_date, end_date
              ),
              '[]'::jsonb
            ) FROM local_intervals) AS local_intervals,
           (SELECT min(start_date) FROM official_intervals) AS official_start,
           (SELECT max(end_date) FROM official_intervals) AS official_end,
           (SELECT coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'start', start_date, 'end', end_date,
                  'isFinal', is_final, 'billState', bill_state
                )
                ORDER BY start_date, end_date
              ),
              '[]'::jsonb
            ) FROM official_intervals) AS official_intervals
  `;
}

function removeSettlementFailureTrigger() {
  postgres(`
    DROP TRIGGER IF EXISTS fullstack_reject_generated_asset ON assets;
    DROP FUNCTION IF EXISTS fullstack_reject_generated_asset();
  `);
}

function parseCnyMicros(value: string) {
  expect(value).toMatch(/^-?\d+\.\d{6}$/);
  return BigInt(value.replace('.', ''));
}

async function api(
  page: Page,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include',
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      idempotencyReplayed: response.headers.get('Idempotency-Replayed'),
    };
  }, { path, options });
}

async function timedApi(page: Page, path: string) {
  return page.evaluate(async url => {
    const startedAt = performance.now();
    const response = await fetch(url, { credentials: 'include' });
    await response.arrayBuffer();
    return { status: response.status, elapsedMs: performance.now() - startedAt };
  }, path);
}

function percentile(values: number[], ratio: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
}

test('真人缩略图使用真实存储、归属鉴权、幂等上传和失效删除队列', async ({ browser }) => {
  test.setTimeout(120_000);
  const migration = readFileSync(new URL('../../apps/api/migrations/088_real_portrait_thumbnails.sql', import.meta.url), 'utf8');
  postgresScript(`${migration}\n${migration}`);
  const marker = randomUUID();
  const account = { id: randomUUID(), email: `portrait-thumbnail-${marker}@lindyson.test`, password: secondaryAccount.password };
  postgres(`INSERT INTO users (id, email, password_hash, user_name, plan_id)
    SELECT '${account.id}', '${account.email}', password_hash, '缩略图测试', NULL::uuid
    FROM users WHERE email = '${secondaryAccount.email}';`);
  const creator = await createAuthenticatedPage(browser, account);
  const outsider = await createAuthenticatedPage(browser, primaryAccount);
  const subjectContext = await browser.newContext();
  const subjectPage = await subjectContext.newPage();
  await subjectPage.goto('/');
  try {
    const { actorId, assetId } = await activateRealPortraitActorForFullstack(creator.page, subjectPage, marker, '缩略图演员');
    const url = `/api/real-portrait-actors/${actorId}/assets/${assetId}/thumbnail`;
    const response = await creator.page.request.get(url);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(await sharp(await response.body()).metadata()).toMatchObject({ format: 'webp', width: 160, height: 160 });
    expect(await fetchStatus(outsider.page, url)).toBe(404);
    expect(await fetchStatus(subjectPage, url)).toBe(401);
    const beforeKey = postgresScalar(`SELECT thumbnail_object_key FROM real_portrait_assets WHERE id = '${assetId}'`);
    const upload = JSON.parse(postgresScalar(`SELECT row_to_json(s)::text FROM real_portrait_upload_sessions s WHERE asset_id = '${assetId}'`));
    const replay = await api(creator.page, `/api/real-portrait-uploads/${upload.id}/complete`, {
      method: 'POST', body: { mimeType: upload.mime_type, sizeBytes: Number(upload.size_bytes), width: upload.width, height: upload.height, sha256: upload.sha256 },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.asset).toMatchObject({ id: assetId, thumbnailAvailable: true });
    expect(postgresScalar(`SELECT thumbnail_object_key FROM real_portrait_assets WHERE id = '${assetId}'`)).toBe(beforeKey);

    // 在隔离库中逐项验证拒绝读取及清理；每次恢复状态只用于下一项模拟，不写生产数据。
    const report = parseLastJsonLine(dockerComposeOutput('exec', '--no-TTY', '--workdir', '/app/apps/api', 'api', 'node', '--input-type=module', '-e', `
      import { pool } from './dist/db/pool.js';
      import { readRealPortraitThumbnail, scheduleInvalidRealPortraitThumbnailDeletion } from './dist/domain/realPortraitThumbnails.js';
      const actorId = ${JSON.stringify(actorId)}, assetId = ${JSON.stringify(assetId)}, userId = ${JSON.stringify(account.id)};
      const auth = (await pool.query('SELECT auth.* FROM real_portrait_authorizations auth WHERE actor_id=$1 ORDER BY version DESC LIMIT 1', [actorId])).rows[0];
      const cases = [
        ["UPDATE real_portrait_assets SET status='failed' WHERE id=$1", assetId],
        ["UPDATE real_portrait_assets SET status='deleting' WHERE id=$1", assetId],
        ["UPDATE real_portrait_actors SET lifecycle_status='evicted' WHERE id=$1", actorId],
        ["UPDATE real_portrait_authorizations SET status='revoked', revoked_at=now() WHERE id=$1", auth.id],
        ["UPDATE real_portrait_authorizations SET valid_from=now()-interval '2 days', valid_until=now()-interval '1 day' WHERE id=$1", auth.id],
        ["UPDATE real_portrait_authorizations SET thumbnail_storage_allowed=false WHERE id=$1", auth.id],
        ["UPDATE real_portrait_upload_sessions SET status='expired' WHERE asset_id=$1", assetId],
      ];
      const results=[];
      for (let i=0; i<cases.length; i++) {
        const key = i === 0 ? ${JSON.stringify(beforeKey)} : 'real-portrait-thumbnails/test-' + assetId + '-' + i;
        await pool.query('UPDATE real_portrait_assets SET thumbnail_object_key=$2, thumbnail_ready=true WHERE id=$1', [assetId,key]);
        await pool.query(cases[i][0], [cases[i][1]]);
        let status=200;
        try { await readRealPortraitThumbnail(userId,actorId,assetId); } catch (error) { status=error.statusCode; }
        await scheduleInvalidRealPortraitThumbnailDeletion();
        const cleared=(await pool.query('SELECT thumbnail_object_key IS NULL AND NOT thumbnail_ready AS cleared FROM real_portrait_assets WHERE id=$1',[assetId])).rows[0].cleared;
        const queued=(await pool.query('SELECT count(*)::int AS count FROM object_deletion_outbox WHERE object_key=$1',[key])).rows[0].count;
        results.push({status,cleared,queued});
        await pool.query("UPDATE real_portrait_assets SET status='active' WHERE id=$1",[assetId]);
        await pool.query("UPDATE real_portrait_upload_sessions SET status='active' WHERE asset_id=$1",[assetId]);
        await pool.query("UPDATE real_portrait_actors SET lifecycle_status='active' WHERE id=$1",[actorId]);
        await pool.query("UPDATE real_portrait_authorizations SET status='active', revoked_at=NULL, valid_from=$2, valid_until=$3, thumbnail_storage_allowed=true WHERE id=$1",[auth.id,auth.valid_from,auth.valid_until]);
      }
      console.log(JSON.stringify({ results }));
      await pool.end();
    `));
    expect(report).toEqual({ results: Array.from({ length: 7 }, () => ({ status: 404, cleared: true, queued: 1 })) });
    await expect.poll(() => postgresScalar(`SELECT status FROM object_deletion_outbox WHERE object_key = '${beforeKey}'`), { timeout: 30_000 }).toBe('completed');
  } finally {
    await creator.context.close();
    await outsider.context.close();
    await subjectContext.close();
  }
});
