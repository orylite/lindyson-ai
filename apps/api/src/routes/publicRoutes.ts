import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { toIsoDateTime, toInt } from '../domain/serialization.js';

export async function registerPublicRoutes(app: FastifyInstance) {
  app.get('/api/subscription/plans', async () => {
    const result = await pool.query(
      `SELECT * FROM plans
       WHERE status = 'active'
       ORDER BY kind, monthly_price ASC, created_at ASC`,
    );

    return {
      items: result.rows.map(row => ({
        id: row.id,
        code: row.code,
        name: row.name,
        nameEn: row.name_en,
        kind: row.kind,
        billing: row.billing,
        description: row.description,
        monthlyPrice: toInt(row.monthly_price),
        yearlyPrice: toInt(row.yearly_price),
        credits: toInt(row.credits),
        assetRetentionDays: toInt(row.asset_retention_days),
        portraitEntitlements: {
          enabled: Boolean(row.portrait_enabled),
          profileLimit: row.portrait_profile_limit === null ? null : toInt(row.portrait_profile_limit),
          activeLimit: toInt(row.portrait_active_limit),
          assetsPerActor: toInt(row.portrait_assets_per_actor),
        },
        storage: row.storage_label,
        tiktokAccounts: row.tiktok_accounts,
        recommendation: row.recommendation,
        iconKey: row.icon_key,
        ctaLabel: row.cta_label,
        status: row.status,
        landingVisible: Boolean(row.landing_visible),
        features: row.features ?? [],
      })),
    };
  });

  app.get('/api/announcements', async () => {
    const result = await pool.query(
      `SELECT * FROM announcements
       ORDER BY pinned DESC, published_at DESC
       LIMIT 5`,
    );

    return {
      items: result.rows.map(row => ({
        id: row.id,
        title: row.title,
        content: row.content,
        pinned: Boolean(row.pinned),
        publishedAt: toIsoDateTime(row.published_at),
      })),
    };
  });
}
