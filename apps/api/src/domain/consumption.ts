import type { DbClient } from '../db/pool.js';
import { toInt, toIsoDateTime } from './serialization.js';
import {
  getSeedanceModelCapability,
  hasExactSeedanceConsumptionCombinations,
  listSeedanceConsumptionCombinations,
} from './seedanceModels.js';
import type { GenerationKind } from './types.js';

export interface GenerationCostInput {
  kind: GenerationKind;
  model: string;
  durationSeconds?: number;
  resolution?: string;
  hasReferenceVideo?: boolean;
}

interface ConsumptionSettingRow {
  id: string;
  kind: string;
  model: string;
  model_label: string;
  duration_seconds: number | string | null;
  resolution: string;
  credits: number | string;
  reference_video_credits: number | string | null;
  available: boolean;
  updated_at: Date | string;
}

export const SEEDANCE_25_CONSUMPTION_MODEL = 'Seedance 2.5';

const seedance25Capability = requireSeedance25Capability();

export const SEEDANCE_25_CONSUMPTION_COMBINATIONS = listSeedanceConsumptionCombinations(
  seedance25Capability,
);

function requireSeedance25Capability() {
  const capability = getSeedanceModelCapability(SEEDANCE_25_CONSUMPTION_MODEL);
  if (!capability) throw new Error('Seedance 2.5 能力表缺失');
  return capability;
}

/** 模型级开放只切换 available，价格仍由逐行配置维护。 */
export async function setVideoModelConsumptionAvailabilityWithClient(
  client: DbClient,
  model: string,
  available: boolean,
) {
  const current = await client.query<ConsumptionSettingRow>(
    `SELECT setting.*
     FROM consumption_settings setting
     WHERE setting.kind = 'video' AND setting.model = $1
     ORDER BY setting.duration_seconds, setting.resolution
     FOR UPDATE OF setting`,
    [model],
  );
  if (current.rows.length === 0) {
    throw Object.assign(new Error(`${model} 尚未配置视频积分，无法批量切换`), {
      statusCode: 409,
      code: 'VIDEO_MODEL_CONSUMPTION_SETTINGS_NOT_FOUND',
    });
  }
  if (available && model === SEEDANCE_25_CONSUMPTION_MODEL && !hasCompleteSeedance25Combinations(current.rows)) {
    throw Object.assign(new Error(`Seedance 2.5 的 ${SEEDANCE_25_CONSUMPTION_COMBINATIONS.length} 个积分组合不完整，已阻止批量开放`), {
      statusCode: 409,
      code: 'SEEDANCE_25_CONSUMPTION_SETTINGS_INCOMPLETE',
    });
  }
  if (available && current.rows.some(row => (
    !isPositiveInteger(row.credits) || !isPositiveInteger(row.reference_video_credits)
  ))) {
    throw Object.assign(new Error(`${model} 存在非正整数积分，已阻止批量开放`), {
      statusCode: 409,
      code: 'VIDEO_MODEL_CONSUMPTION_PRICE_INVALID',
    });
  }

  const previousAvailableCount = current.rows.filter(row => Boolean(row.available)).length;
  const changed = current.rows.some(row => Boolean(row.available) !== available);
  if (!changed) {
    return {
      model,
      available,
      previousAvailableCount,
      changed: false,
      settings: current.rows.map(mapConsumptionSetting),
    };
  }

  const updated = await client.query<ConsumptionSettingRow>(
    `UPDATE consumption_settings setting
     SET available = $2, updated_at = now()
     WHERE setting.kind = 'video' AND setting.model = $1
     RETURNING setting.*`,
    [model, available],
  );
  if (updated.rows.length !== current.rows.length) {
    throw Object.assign(new Error(`${model} 积分组合在批量切换时发生变化，请重试`), {
      statusCode: 409,
      code: 'VIDEO_MODEL_CONSUMPTION_SETTINGS_CHANGED',
    });
  }

  return {
    model,
    available,
    previousAvailableCount,
    changed: true,
    settings: updated.rows
      .sort((left, right) => (
        toInt(left.duration_seconds) - toInt(right.duration_seconds)
        || left.resolution.localeCompare(right.resolution)
      ))
      .map(mapConsumptionSetting),
  };
}

function hasCompleteSeedance25Combinations(rows: ConsumptionSettingRow[]) {
  return hasExactSeedanceConsumptionCombinations(
    seedance25Capability,
    rows.map(row => ({
      durationSeconds: toInt(row.duration_seconds),
      resolution: row.resolution,
    })),
  );
}

function isPositiveInteger(value: unknown) {
  const parsed = toInt(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

export async function getGenerationCredits(client: DbClient, input: GenerationCostInput) {
  if (input.kind === 'image') {
    const result = await client.query<{ credits: number | string }>(
      `SELECT credits FROM consumption_settings
       WHERE kind = 'image' AND model = $1 AND resolution = $2 AND available = true
       LIMIT 1`,
      [input.model, input.resolution ?? null],
    );

    return toInt(result.rows[0]?.credits);
  }

  if (input.model === SEEDANCE_25_CONSUMPTION_MODEL) {
    const result = await client.query<ConsumptionSettingRow>(
      `SELECT * FROM consumption_settings
       WHERE kind = 'video' AND model = $1
       ORDER BY duration_seconds, resolution`,
      [input.model],
    );
    const fullyOpen = hasCompleteSeedance25Combinations(result.rows)
      && result.rows.every(row => (
        row.available
        && isPositiveInteger(row.credits)
        && isPositiveInteger(row.reference_video_credits)
      ));
    if (!fullyOpen) return 0;
    const setting = result.rows.find(row => (
      toInt(row.duration_seconds) === input.durationSeconds
      && row.resolution === input.resolution
    ));
    if (!setting) return 0;
    return toInt(input.hasReferenceVideo ? setting.reference_video_credits : setting.credits);
  }

  const result = await client.query<{ credits: number | string; reference_video_credits: number | string }>(
    `SELECT credits, reference_video_credits FROM consumption_settings
     WHERE kind = 'video'
       AND model = $1
       AND duration_seconds = $2
       AND resolution = $3
       AND available = true
     LIMIT 1`,
    [input.model, input.durationSeconds ?? null, input.resolution ?? null],
  );

  const setting = result.rows[0];
  if (!setting) return 0;
  return toInt(input.hasReferenceVideo ? setting.reference_video_credits : setting.credits);
}

export function mapConsumptionSetting(row: ConsumptionSettingRow) {
  return {
    id: row.id,
    kind: row.kind,
    model: row.model,
    modelLabel: row.model_label,
    durationSeconds: row.duration_seconds === null ? null : toInt(row.duration_seconds),
    resolution: row.resolution,
    credits: toInt(row.credits),
    referenceVideoCredits: row.reference_video_credits === null ? null : toInt(row.reference_video_credits),
    available: Boolean(row.available),
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

export async function listConsumptionSettings(client: DbClient) {
  const result = await client.query<ConsumptionSettingRow>(
    'SELECT * FROM consumption_settings ORDER BY kind, model, duration_seconds, resolution',
  );

  return result.rows.map(mapConsumptionSetting);
}
