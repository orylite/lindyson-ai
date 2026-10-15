import { pool, withTransaction, type DbClient } from './pool.js';

async function run() {
  await withTransaction(async client => {
    await insertPlanDefault(client, {
      code: 'free',
      name: '免费版',
      nameEn: 'Free',
      kind: 'main',
      billing: 'both',
      description: '适合体验基础创作功能',
      monthlyPrice: 0,
      yearlyPrice: 0,
      credits: 0,
      assetRetentionDays: 7,
      portraitEnabled: true,
      portraitProfileLimit: 1,
      portraitActiveLimit: 1,
      portraitAssetsPerActor: 1,
      storage: '基础存储',
      tiktokAccounts: '0',
      iconKey: 'zap',
      ctaLabel: '免费使用',
      status: 'active',
      landingVisible: true,
      features: [],
    });

    await insertPlanDefault(client, {
      code: 'pro',
      name: '专业版',
      nameEn: 'Pro',
      kind: 'main',
      billing: 'both',
      description: '适合稳定产出短视频和素材',
      monthlyPrice: 2900,
      yearlyPrice: 22800,
      credits: 10000,
      assetRetentionDays: 30,
      portraitEnabled: true,
      portraitProfileLimit: 5,
      portraitActiveLimit: 3,
      portraitAssetsPerActor: 2,
      storage: '高阶存储',
      tiktokAccounts: '5 个账号',
      recommendation: 'popular',
      iconKey: 'sparkles',
      ctaLabel: '升级专业版',
      status: 'active',
      landingVisible: true,
      features: [
        { text: 'Seedance 视频生成', enabled: true },
        { text: 'Seedream 5.0 Pro 图片生成（待管理员开放）', enabled: false },
        { text: 'TikTok 发布工作区（待接入）', enabled: false },
      ],
    });

    await insertPlanDefault(client, {
      code: 'enterprise',
      name: '企业版',
      nameEn: 'Enterprise',
      kind: 'main',
      billing: 'both',
      description: '适合团队和批量内容生产',
      monthlyPrice: 9900,
      yearlyPrice: 99000,
      credits: 50000,
      assetRetentionDays: 90,
      portraitEnabled: true,
      portraitProfileLimit: null,
      portraitActiveLimit: 10,
      portraitAssetsPerActor: 2,
      storage: '团队存储',
      tiktokAccounts: '20 个账号',
      recommendation: 'enterprise',
      iconKey: 'building-2',
      ctaLabel: '联系开通',
      status: 'active',
      landingVisible: true,
      features: [
        { text: '团队素材管理', enabled: true },
        { text: '更高生成额度', enabled: true },
        { text: '运营支持', enabled: true },
      ],
    });

    await insertPlanDefault(client, {
      code: 'addon-30000',
      name: '30000 积分加购包',
      nameEn: '30000 Credits Pack',
      kind: 'addon',
      billing: 'one-time',
      description: '一次性补充积分，不改变套餐周期',
      monthlyPrice: 5900,
      yearlyPrice: 0,
      credits: 30000,
      assetRetentionDays: 0,
      portraitEnabled: false,
      portraitProfileLimit: 0,
      portraitActiveLimit: 0,
      portraitAssetsPerActor: 0,
      storage: '不改变存储额度',
      tiktokAccounts: '不改变账号额度',
      ctaLabel: '购买加购包',
      status: 'active',
      landingVisible: false,
      features: [
        { text: '一次性到账', enabled: true },
        { text: '主套餐积分用完后继续使用', enabled: true },
      ],
    });

    await seedConsumptionSettings(client);
    await seedFeatureFlags(client);
  });

  console.log('基础套餐、积分消耗配置和功能开关已写入；未写入开发 Mock 或管理员账号。');
}

async function insertPlanDefault(client: DbClient, plan: {
  code: string;
  name: string;
  nameEn: string;
  kind: 'main' | 'addon';
  billing: 'monthly' | 'yearly' | 'both' | 'one-time';
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  credits: number;
  assetRetentionDays: number;
  portraitEnabled: boolean;
  portraitProfileLimit: number | null;
  portraitActiveLimit: number;
  portraitAssetsPerActor: number;
  storage: string;
  tiktokAccounts: string;
  recommendation?: 'popular' | 'enterprise';
  iconKey?: 'zap' | 'sparkles' | 'crown' | 'gem' | 'rocket' | 'building-2' | null;
  ctaLabel: string;
  status: 'active' | 'disabled' | 'draft';
  landingVisible: boolean;
  features: Array<{ text: string; enabled: boolean }>;
}) {
  assertSeedPlanRetention(plan);
  const result = await client.query<{ id: string }>(
    `INSERT INTO plans (
       code, name, name_en, kind, billing, description, monthly_price,
       yearly_price, credits, storage_label, tiktok_accounts,
       recommendation, icon_key, cta_label, status, landing_visible, features,
       asset_retention_days, portrait_enabled, portrait_profile_limit,
       portrait_active_limit, portrait_assets_per_actor
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
     )
     ON CONFLICT (code) DO NOTHING
     RETURNING id`,
    [
      plan.code,
      plan.name,
      plan.nameEn,
      plan.kind,
      plan.billing,
      plan.description,
      plan.monthlyPrice,
      plan.yearlyPrice,
      plan.credits,
      plan.storage,
      plan.tiktokAccounts,
      plan.recommendation ?? null,
      plan.kind === 'main' ? plan.iconKey ?? 'sparkles' : null,
      plan.ctaLabel,
      plan.status,
      plan.kind === 'main' ? plan.landingVisible : false,
      JSON.stringify(plan.features),
      plan.kind === 'main' ? plan.assetRetentionDays : 0,
      plan.kind === 'main' ? plan.portraitEnabled : false,
      plan.kind === 'main' ? plan.portraitProfileLimit : 0,
      plan.kind === 'main' ? plan.portraitActiveLimit : 0,
      plan.kind === 'main' ? plan.portraitAssetsPerActor : 0,
    ],
  );

  return result.rows[0]!;
}

function assertSeedPlanRetention(plan: {
  code: string;
  kind: 'main' | 'addon';
  assetRetentionDays: number;
  portraitEnabled: boolean;
}) {
  if (!Number.isInteger(plan.assetRetentionDays) || plan.assetRetentionDays < 0 || plan.assetRetentionDays > 3650) {
    throw new Error(`套餐 ${plan.code} 的 assetRetentionDays 必须是 0 到 3650 的整数`);
  }
  if (plan.kind === 'addon' && plan.assetRetentionDays !== 0) {
    throw new Error(`加购包 ${plan.code} 的 assetRetentionDays 必须为 0`);
  }
  if (plan.kind === 'main' && plan.portraitEnabled && plan.assetRetentionDays < 1) {
    throw new Error(`启用真人演员库的主套餐 ${plan.code} 必须设置正整数 assetRetentionDays`);
  }
}

async function seedConsumptionSettings(client: DbClient) {
  const settings = [
    ['video', 'Seedance 2.5', 'Seedance 2.5', 5, '480p', 49, 30, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 10, '480p', 86, 52, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 15, '480p', 86, 52, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 20, '480p', 115, 69, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 25, '480p', 144, 87, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 30, '480p', 172, 104, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 5, '720p', 61, 37, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 10, '720p', 107, 65, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 15, '720p', 122, 74, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 20, '720p', 163, 98, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 25, '720p', 204, 123, false],
    ['video', 'Seedance 2.5', 'Seedance 2.5', 30, '720p', 244, 147, false],
    ['video', 'Seedance 2.0', 'Seedance 2.0', 5, '480p', 32, true],
    ['video', 'Seedance 2.0', 'Seedance 2.0', 5, '720p', 40, true],
    ['video', 'Seedance 2.0', 'Seedance 2.0', 5, '1080p', 60, true],
    ['video', 'Seedance 2.0', 'Seedance 2.0', 10, '480p', 56, true],
    ['video', 'Seedance 2.0', 'Seedance 2.0', 10, '720p', 70, true],
    ['video', 'Seedance 2.0', 'Seedance 2.0', 10, '1080p', 105, true],
    ['video', 'Seedance 2.0', 'Seedance 2.0', 15, '480p', 56, true],
    ['video', 'Seedance 2.0', 'Seedance 2.0', 15, '720p', 80, true],
    ['video', 'Seedance 2.0', 'Seedance 2.0', 15, '1080p', 120, true],
    ['video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 5, '480p', 19, true],
    ['video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 5, '720p', 24, true],
    ['video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 5, '1080p', 36, false],
    ['video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 10, '480p', 34, true],
    ['video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 10, '720p', 42, true],
    ['video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 10, '1080p', 63, false],
    ['video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 15, '480p', 34, true],
    ['video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 15, '720p', 48, true],
    ['video', 'Seedance 2.0 Fast', 'Seedance 2.0 Fast', 15, '1080p', 72, false],
    ['video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 5, '480p', 10, true],
    ['video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 5, '720p', 12, true],
    ['video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 5, '1080p', 18, false],
    ['video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 10, '480p', 17, true],
    ['video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 10, '720p', 21, true],
    ['video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 10, '1080p', 32, false],
    ['video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 15, '480p', 17, true],
    ['video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 15, '720p', 24, true],
    ['video', 'Seedance 2.0 Mini', 'Seedance 2.0 Mini', 15, '1080p', 36, false],
    ['image', 'Seedream 5.0 Pro', 'Seedream 5.0 Pro', 0, '1K', 14, false],
    ['image', 'Seedream 5.0 Pro', 'Seedream 5.0 Pro', 0, '2K', 28, false],
  ];

  for (const setting of settings) {
    const referenceVideoCredits = setting[0] === 'video'
      ? setting.length === 8 ? setting[6] : setting[5]
      : null;
    await client.query(
      `INSERT INTO consumption_settings (
         kind, model, model_label, duration_seconds, resolution, credits,
         reference_video_credits, available
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (kind, model, duration_seconds, resolution) DO NOTHING`,
      [...setting.slice(0, 6), referenceVideoCredits, setting[setting.length - 1]],
    );
  }
}

async function seedFeatureFlags(client: DbClient) {
  const flags = [
    ['tiktokAccounts', false],
    ['tiktokPublish', false],
  ];

  for (const flag of flags) {
    await client.query(
      `INSERT INTO feature_flags (key, enabled)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      flag,
    );
  }
}

run()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
