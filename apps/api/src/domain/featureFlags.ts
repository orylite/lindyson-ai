import type { DbClient } from '../db/pool.js';

export interface FeatureFlags {
  tiktokAccounts: boolean;
  tiktokPublish: boolean;
}

export async function readFeatureFlags(client: DbClient): Promise<FeatureFlags> {
  const result = await client.query<{ key: string; enabled: boolean }>('SELECT key, enabled FROM feature_flags');
  const map = new Map(result.rows.map(row => [row.key, Boolean(row.enabled)]));

  return {
    tiktokAccounts: map.get('tiktokAccounts') ?? true,
    tiktokPublish: map.get('tiktokPublish') ?? true,
  };
}
