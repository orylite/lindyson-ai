import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import {
  createTkPromptEngineRepository,
  productionTkPromptCreditCallbacks,
  readTkPromptEngineV6WritesRetired,
  tkPromptEngineRepository,
  tkPromptCreditEventKey,
  tkPromptProviderRequestKey,
  type TkPromptCreditCallbacks,
} from '../src/domain/tkPromptEngineRepository.js';

const userId = '10000000-0000-4000-8000-000000000001';
const runId = '20000000-0000-4000-8000-000000000001';
const generationId = '30000000-0000-4000-8000-000000000001';
const runClaimToken = '50000000-0000-4000-8000-000000000001';
const generationClaimToken = '50000000-0000-4000-8000-000000000002';
const optionClaimToken = '50000000-0000-4000-8000-000000000003';
const replacementClaimToken = '50000000-0000-4000-8000-000000000004';
const imageId = '90000000-0000-4000-8000-000000000001';
const optionIds = {
  safe: '40000000-0000-4000-8000-000000000001',
  native: '40000000-0000-4000-8000-000000000002',
  creative: '40000000-0000-4000-8000-000000000003',
};
const past = '2026-08-16T00:00:00.000Z';
const now = '2026-08-17T00:00:00.000Z';
const future = '2099-08-17T00:00:00.000Z';

describe('TK Prompt Engine repository', () => {
  it('生产实例接入 TK 专用积分回调并校验整批 allocation 归属与金额', async () => {
    expect(tkPromptEngineRepository).toBeDefined();
    const client = scriptedClient((sql) => {
      if (sql.includes('FROM credit_allocations')) return rows([{ amount: 6 }]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    await expect(productionTkPromptCreditCallbacks.settleWithClient({
      client,
      userId,
      generationId,
      eventKey: tkPromptCreditEventKey(generationId),
      credits: 7,
    })).rejects.toMatchObject({ code: 'TK_PROMPT_CREDIT_ALLOCATION_MISMATCH' });
    expect(client.calls[0]?.sql).toContain('related_tk_prompt_generation_id = $1');
    expect(client.calls[0]?.params).toEqual([
      generationId,
      tkPromptCreditEventKey(generationId),
    ]);
    await expect(productionTkPromptCreditCallbacks.refundWithClient({
      client,
      userId,
      generationId,
      eventKey: 'wrong-event-key',
      credits: 7,
    })).rejects.toMatchObject({ code: 'TK_PROMPT_CREDIT_EVENT_KEY_MISMATCH' });
  });

  it('设置、分析 claim/complete/fail 和 resume 都只读写 TK1 独立表', async () => {
    const settingsClient = scriptedClient((sql, params) => {
      if (sql.startsWith('SELECT schema_version')) {
        return rows([{ schema_version: 1, generation_credits: 7, available: false, updated_at: now }]);
      }
      if (sql.startsWith('UPDATE tk_prompt_engine_settings')) {
        expect(sql).not.toContain('v6_retired_at');
        expect(params).toEqual([8, false, userId]);
        return rows([{ schema_version: 1, generation_credits: 8, available: false, updated_at: now }]);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const settingsRepository = repositoryWith(settingsClient);
    await expect(settingsRepository.getSettings()).resolves.toMatchObject({
      schemaVersion: 1,
      generationCredits: 7,
      available: false,
    });
    await expect(settingsRepository.updateSettings({
      updatedBy: userId,
      generationCredits: 8,
      available: false,
    })).resolves.toMatchObject({ generationCredits: 8, available: false });
    await expect(settingsRepository.updateSettings({
      updatedBy: userId,
      available: true,
    })).rejects.toMatchObject({ code: 'TK_PROMPT_ENABLE_REQUIRES_FINALIZER', statusCode: 409 });

    const retirementClient = scriptedClient((sql) => {
      expect(sql).toContain('v6_retired_at IS NOT NULL');
      return rows([{ v6_retired: true }]);
    });
    await expect(readTkPromptEngineV6WritesRetired(retirementClient)).resolves.toBe(true);

    const analysisClient = scriptedClient((sql) => {
      if (sql.includes('attempt_count = attempt_count + 1')) {
        expect(sql).toContain('attempt_count + 1 = $3');
        return rows([runRow({
          started_at: now,
          attempt_count: 1,
          claim_token: runClaimToken,
        })]);
      }
      if (sql.includes("SET status = 'ready'")) return rows([readyRunRow()]);
      if (sql.includes("SET status = 'failed'")) {
        return rows([runRow({ status: 'failed', failure_reason: 'analysis failed', completed_at: now })]);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const analysisRepository = repositoryWith(analysisClient);
    await expect(analysisRepository.claimRunAnalysis({
      runId,
      staleBefore: new Date(past),
      expectedAttempt: 1,
    })).resolves.toMatchObject({ status: 'analyzing', claimToken: runClaimToken });
    await expect(analysisRepository.completeRunAnalysis({
      runId,
      userId,
      claimToken: runClaimToken,
      evidenceProfile: evidenceProfile(),
    })).resolves.toMatchObject({ status: 'ready' });
    await expect(analysisRepository.failRunAnalysis({
      runId,
      userId,
      claimToken: runClaimToken,
      failureReason: 'analysis failed',
    })).resolves.toMatchObject({ status: 'failed', failureReason: 'analysis failed' });

    const resumeClient = scriptedClient((sql) => {
      if (sql.includes('FROM tk_prompt_runs run')) {
        expect(sql).toContain("generation.status IN ('queued', 'strategizing', 'expanding')");
        return rows([readyRunRow()]);
      }
      if (sql.includes('FROM tk_prompt_generations')) return rows([]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    await expect(repositoryWith(resumeClient).resume(userId)).resolves.toMatchObject({
      run: { id: runId, status: 'ready' },
      generation: null,
    });
  });

  it('读取历史方案时剔除发布字段，保留口播与执行提示词且不改写历史数据', async () => {
    const creative = { ...generationInput().creativeInput, publishLanguage: '日语' };
    const storedPlan = { ...plan(), publishPack: { title: '历史发布标题' } };
    const completed = generationRow({
      status: 'completed',
      creative_input: creative,
      strategy_set: strategySet(),
      completed_at: now,
    });
    const client = scriptedClient(sql => {
      if (sql.includes('FROM tk_prompt_runs run')) return rows([readyRunRow()]);
      if (sql.includes('FROM tk_prompt_generations')) return rows([completed]);
      if (sql.includes('FROM tk_prompt_options')) return rows(TK_SLOTS.map(slot => optionRow(slot, {
        status: 'completed', plan: storedPlan, completed_at: now,
      })));
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const resumed = await repositoryWith(client).resume(userId);
    expect(resumed.generation?.creativeInput).not.toHaveProperty('publishLanguage');
    expect(resumed.generation?.creativeInput.spokenLanguage).toBe('英语');
    for (const option of resumed.generation!.options) {
      expect(option.plan).not.toHaveProperty('publishPack');
      expect(option.plan?.executionPrompt).toBe(storedPlan.executionPrompt);
    }
    expect(creative.publishLanguage).toBe('日语');
    expect(storedPlan.publishPack.title).toBe('历史发布标题');
  });

  it('resume 在更新的失败换批之后仍恢复最近一次成功三案', async () => {
    const completedGenerationId = '30000000-0000-4000-8000-000000000011';
    const failedGenerationId = '30000000-0000-4000-8000-000000000012';
    const completed = generationRow({
      id: completedGenerationId,
      ordinal: 1,
      status: 'completed',
      strategy_set: strategySet(),
      completed_at: now,
    });
    const newerFailed = generationRow({
      id: failedGenerationId,
      ordinal: 2,
      status: 'failed',
      failure_reason: 'provider failed',
      completed_at: now,
    });
    const client = scriptedClient((sql, params) => {
      if (sql.includes('FROM tk_prompt_runs run')) return rows([readyRunRow()]);
      if (sql.includes('FROM tk_prompt_generations')) {
        expect(sql).toContain("WHEN status IN ('queued', 'strategizing', 'expanding') THEN 0");
        expect(sql).toContain("WHEN status = 'completed' THEN 1");
        expect(sql).toContain('END ASC, ordinal DESC');
        expect(newerFailed.ordinal).toBeGreaterThan(completed.ordinal as number);
        return rows([completed]);
      }
      if (sql.includes('FROM tk_prompt_options')) {
        expect(params).toEqual([completedGenerationId]);
        return rows((['safe', 'native', 'creative'] as const).map(slot => optionRow(slot, {
          generation_id: completedGenerationId,
          status: 'completed',
          plan: plan(),
          completed_at: now,
        })));
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });

    const resumed = await repositoryWith(client).resume(userId);
    expect(resumed.generation).toMatchObject({
      id: completedGenerationId,
      status: 'completed',
    });
    expect(resumed.generation?.options).toHaveLength(3);
    expect(resumed.generation?.options.every(option => option.plan !== null)).toBe(true);
  });

  it('resume 始终让 active 批次优先于 completed 与 failed', async () => {
    const activeGenerationId = '30000000-0000-4000-8000-000000000023';
    const client = scriptedClient((sql, params) => {
      if (sql.includes('FROM tk_prompt_runs run')) return rows([readyRunRow()]);
      if (sql.includes('FROM tk_prompt_generations')) {
        expect(sql).toContain("WHEN status IN ('queued', 'strategizing', 'expanding') THEN 0");
        expect(sql).toContain("WHEN status = 'completed' THEN 1");
        return rows([generationRow({
          id: activeGenerationId,
          ordinal: 3,
          status: 'expanding',
          strategy_set: strategySet(),
        })]);
      }
      if (sql.includes('FROM tk_prompt_options')) {
        expect(params).toEqual([activeGenerationId]);
        return rows((['safe', 'native', 'creative'] as const).map(slot => optionRow(slot, {
          generation_id: activeGenerationId,
        })));
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });

    await expect(repositoryWith(client).resume(userId)).resolves.toMatchObject({
      generation: { id: activeGenerationId, status: 'expanding' },
    });
  });

  it('创建 run 使用事务级幂等锁、稳定请求哈希并锁定 1–9 张图片', async () => {
    const client = scriptedClient((sql) => {
      if (sql.includes('pg_advisory_xact_lock')) return rows([]);
      if (sql.includes('FROM tk_prompt_runs') && sql.includes('idempotency_key')) return rows([]);
      if (sql.includes('INSERT INTO tk_prompt_runs')) return rows([runRow()]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const repository = repositoryWith(client);
    const run = await repository.createRun({
      userId,
      idempotencyKey: 'run-idempotency-1',
      imageAssetIds: [imageId],
    });
    expect(run).toMatchObject({ id: runId, status: 'analyzing', imageAssetIds: [imageId] });
    const insert = client.calls.find(call => call.sql.includes('INSERT INTO tk_prompt_runs'))!;
    expect(insert.params?.[2]).toMatch(/^[0-9a-f]{64}$/u);
    await expect(repository.createRun({
      userId,
      idempotencyKey: 'too-many',
      imageAssetIds: Array.from({ length: 10 }, () => imageId),
    })).rejects.toMatchObject({ code: 'TK_PROMPT_IMAGE_COUNT_INVALID' });

    const conflicting = scriptedClient((sql) => {
      if (sql.includes('pg_advisory_xact_lock')) return rows([]);
      if (sql.includes('FROM tk_prompt_runs')) return rows([runRow({ request_hash: 'f'.repeat(64) })]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    await expect(repositoryWith(conflicting).createRun({
      userId,
      idempotencyKey: 'run-idempotency-1',
      imageAssetIds: [imageId],
    })).rejects.toMatchObject({ code: 'TK_PROMPT_RUN_IDEMPOTENCY_CONFLICT' });
  });

  it('首个成功批次免费；后续批次按整批价格规划并在同一事务冻结积分', async () => {
    const holdWithClient = vi.fn(async () => undefined);
    const callbacks = creditCallbacks({ holdWithClient });
    const client = scriptedClient((sql, params) => {
      if (sql.includes('pg_advisory_xact_lock')) return rows([]);
      if (sql.includes('JOIN tk_prompt_runs') && sql.includes('idempotency_key')) return rows([]);
      if (sql.includes('SELECT * FROM tk_prompt_runs')) return rows([readyRunRow()]);
      if (sql.includes('SELECT 1 FROM tk_prompt_generations')) return rows([]);
      if (sql.includes('FROM tk_prompt_engine_settings')) {
        return rows([{ schema_version: 1, generation_credits: 7, available: true, updated_at: now }]);
      }
      if (sql.includes('SELECT id FROM users')) return rows([{ id: userId }]);
      if (sql.includes('FROM credit_lots')) return rows([]);
      if (sql.includes('bool_or(status')) return rows([{ next_ordinal: 2, has_completed: true }]);
      if (sql.includes('INSERT INTO tk_prompt_generations')) {
        expect(params?.slice(8, 13)).toEqual([false, 7, 'held', 5, 2]);
        return rows([generationRow({
          ordinal: 2,
          is_free: false,
          credits: 7,
          credit_status: 'held',
          main_credits_used: 5,
          addon_credits_used: 2,
        })]);
      }
      if (sql.includes('UPDATE tk_prompt_runs')) return rows([]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const planner = vi.fn(async (plannerClient: DbClient, plannerUserId: string) => {
      await plannerClient.query(
        'SELECT id FROM credit_lots WHERE user_id = $1 FOR UPDATE',
        [plannerUserId],
      );
      return [{ mainAmount: 5, addonAmount: 2 }];
    });
    const repository = repositoryWith(client, { callbacks, planner });
    const generation = await repository.createGeneration(generationInput());
    expect(generation).toMatchObject({
      id: generationId,
      isFree: false,
      credits: 7,
      creditStatus: 'held',
    });
    expect(planner).toHaveBeenCalledWith(client, userId, [7]);
    expect(holdWithClient).toHaveBeenCalledWith({
      client,
      userId,
      generationId,
      eventKey: tkPromptCreditEventKey(generationId),
      mainAmount: 5,
      addonAmount: 2,
    });
    const userLockIndex = client.calls.findIndex(call => call.sql.includes('SELECT id FROM users'));
    const lotLockIndex = client.calls.findIndex(call => call.sql.includes('FROM credit_lots'));
    expect(userLockIndex).toBeGreaterThanOrEqual(0);
    expect(lotLockIndex).toBeGreaterThan(userLockIndex);

    const freeClient = scriptedClient((sql, params) => {
      if (sql.includes('pg_advisory_xact_lock')) return rows([]);
      if (sql.includes('JOIN tk_prompt_runs') && sql.includes('idempotency_key')) return rows([]);
      if (sql.includes('SELECT * FROM tk_prompt_runs')) return rows([readyRunRow()]);
      if (sql.includes('SELECT 1 FROM tk_prompt_generations')) return rows([]);
      if (sql.includes('FROM tk_prompt_engine_settings')) {
        return rows([{ schema_version: 1, generation_credits: 7, available: true, updated_at: now }]);
      }
      if (sql.includes('SELECT id FROM users')) return rows([{ id: userId }]);
      if (sql.includes('bool_or(status')) return rows([{ next_ordinal: 3, has_completed: false }]);
      if (sql.includes('INSERT INTO tk_prompt_generations')) {
        expect(params?.slice(8, 13)).toEqual([true, 0, 'none', 0, 0]);
        return rows([generationRow({ ordinal: 3 })]);
      }
      if (sql.includes('UPDATE tk_prompt_runs')) return rows([]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const freePlanner = vi.fn(async () => [{ mainAmount: 7, addonAmount: 0 }]);
    const freeRepository = repositoryWith(freeClient, { callbacks, planner: freePlanner });
    const free = await freeRepository.createGeneration({
      ...generationInput(),
      idempotencyKey: 'generation-free-retry',
    });
    expect(free).toMatchObject({ isFree: true, credits: 0, creditStatus: 'none' });
    expect(freePlanner).not.toHaveBeenCalled();
    expect(holdWithClient).toHaveBeenCalledTimes(1);
  });

  it('策略与三个 option 原子创建，第三案完成时才在同一事务结算整批', async () => {
    const strategies = strategySet();
    const strategyClient = scriptedClient((sql) => {
      if (sql.includes('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({
          status: 'strategizing',
          started_at: now,
          claim_token: generationClaimToken,
        })]);
      }
      if (sql.includes('UPDATE tk_prompt_generations')) {
        return rows([generationRow({ status: 'expanding', strategy_set: strategies })]);
      }
      if (sql.includes('INSERT INTO tk_prompt_options')) {
        return rows(TK_SLOTS.map(slot => optionRow(slot, {
          strategy_blueprint: strategies.find(strategy => strategy.slot === slot),
        })));
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const created = await repositoryWith(strategyClient).saveStrategiesAndCreateOptions({
      generationId,
      userId,
      claimToken: generationClaimToken,
      strategies,
    });
    expect(created.status).toBe('expanding');
    expect(created.options.map(option => option.slot)).toEqual(TK_SLOTS);
    expect(strategyClient.calls.some(call => call.sql.includes('jsonb_array_elements'))).toBe(true);

    const settleWithClient = vi.fn(async () => undefined);
    const completionClient = scriptedClient((sql) => {
      if (sql.includes('SELECT generation_id FROM tk_prompt_options')) {
        return rows([{ generation_id: generationId }]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_options')) {
        return rows([
          optionRow('safe', {
            status: 'completed', plan: plan(), completed_at: now,
          }),
          optionRow('native', {
            status: 'completed', plan: plan(), completed_at: now,
          }),
          optionRow('creative', {
            status: 'processing',
            strategy_blueprint: strategies[2],
            started_at: now,
            claim_token: optionClaimToken,
          }),
        ]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({
          status: 'expanding',
          is_free: false,
          credits: 7,
          credit_status: 'held',
          main_credits_used: 5,
          addon_credits_used: 2,
          strategy_set: strategies,
        })]);
      }
      if (sql.includes("SET status = 'completed', plan")) {
        return rows([optionRow('creative', {
          status: 'completed',
          strategy_blueprint: strategies[2],
          plan: plan(),
          completed_at: now,
        })]);
      }
      if (sql.includes('count(*) AS completed_count')) return rows([{ completed_count: 3 }]);
      if (sql.includes("SET status = 'completed'")) {
        return rows([generationRow({
          status: 'completed',
          is_free: false,
          credits: 7,
          credit_status: 'settled',
          main_credits_used: 5,
          addon_credits_used: 2,
          strategy_set: strategies,
          completed_at: now,
        })]);
      }
      if (sql.includes('UPDATE tk_prompt_runs')) return rows([]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const completion = await repositoryWith(completionClient, {
      callbacks: creditCallbacks({ settleWithClient }),
    }).completeOption({
      optionId: optionIds.creative,
      userId,
      claimToken: optionClaimToken,
      plan: plan(),
    });
    expect(completion.generationCompleted).toBe(true);
    expect(settleWithClient).toHaveBeenCalledWith({
      client: completionClient,
      userId,
      generationId,
      eventKey: tkPromptCreditEventKey(generationId),
      credits: 7,
    });
    const completionGenerationLock = completionClient.calls.findIndex(call => (
      call.sql.includes('SELECT * FROM tk_prompt_generations') && call.sql.includes('FOR UPDATE')
    ));
    const completionOptionsLock = completionClient.calls.findIndex(call => (
      call.sql.includes('SELECT * FROM tk_prompt_options') && call.sql.includes('FOR UPDATE')
    ));
    expect(completionGenerationLock).toBeGreaterThanOrEqual(0);
    expect(completionOptionsLock).toBeGreaterThan(completionGenerationLock);

    const claimClient = scriptedClient((sql) => {
      if (sql.includes("SET status = 'strategizing'")) {
        expect(sql).toContain("status IN ('queued', 'strategizing')");
        expect(sql).toContain('attempt_count + 1 = $3');
        return rows([generationRow({
          status: 'strategizing',
          started_at: now,
          attempt_count: 1,
          claim_token: generationClaimToken,
        })]);
      }
      if (sql.includes("SET status = 'processing'")) {
        expect(sql).toContain("generation.status = 'expanding'");
        expect(sql).toContain('option.attempt_count + 1 = $3');
        return rows([optionRow('safe', {
          status: 'processing',
          strategy_blueprint: strategies[0],
          started_at: now,
          attempt_count: 1,
          claim_token: optionClaimToken,
        })]);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const claimRepository = repositoryWith(claimClient);
    await expect(claimRepository.claimGenerationStrategy({
      generationId,
      staleBefore: new Date(past),
      expectedAttempt: 1,
    })).resolves.toMatchObject({
      status: 'strategizing',
      claimToken: generationClaimToken,
    });
    await expect(claimRepository.claimOption({
      optionId: optionIds.safe,
      staleBefore: new Date(past),
      expectedAttempt: 1,
    })).resolves.toMatchObject({
      status: 'processing',
      slot: 'safe',
      claimToken: optionClaimToken,
    });
  });

  it('任一方案失败会原子终止其余方案并全额退款；TTL 仅清理终态内容', async () => {
    const refundWithClient = vi.fn(async () => undefined);
    const client = scriptedClient((sql) => {
      if (sql.includes('SELECT generation_id FROM tk_prompt_options')) {
        return rows([{ generation_id: generationId }]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_options')) {
        return rows([
          optionRow('safe'),
          optionRow('native', {
            status: 'processing',
            started_at: now,
            claim_token: optionClaimToken,
          }),
          optionRow('creative'),
        ]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({
          status: 'expanding',
          is_free: false,
          credits: 7,
          credit_status: 'held',
          main_credits_used: 7,
          strategy_set: strategySet(),
        })]);
      }
      if (sql.includes('UPDATE tk_prompt_options')) return rows([], 2);
      if (sql.includes('UPDATE tk_prompt_generations')) return rows([], 1);
      if (sql.includes('UPDATE tk_prompt_runs')) return rows([]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    await repositoryWith(client, {
      callbacks: creditCallbacks({ refundWithClient }),
    }).failOption({
      optionId: optionIds.native,
      userId,
      claimToken: optionClaimToken,
      failureReason: 'provider failed',
    });
    expect(refundWithClient).toHaveBeenCalledWith({
      client,
      userId,
      generationId,
      eventKey: tkPromptCreditEventKey(generationId),
      credits: 7,
    });
    expect(client.calls.some(call => (
      call.sql.includes('UPDATE tk_prompt_options')
      && call.sql.includes('content_purged_at IS NULL')
      && call.sql.includes('plan = NULL')
    ))).toBe(true);
    const failureGenerationLock = client.calls.findIndex(call => (
      call.sql.includes('SELECT * FROM tk_prompt_generations') && call.sql.includes('FOR UPDATE')
    ));
    const failureOptionsLock = client.calls.findIndex(call => (
      call.sql.includes('SELECT * FROM tk_prompt_options') && call.sql.includes('FOR UPDATE')
    ));
    expect(failureGenerationLock).toBeGreaterThanOrEqual(0);
    expect(failureOptionsLock).toBeGreaterThan(failureGenerationLock);

    const purgeClient = scriptedClient((sql) => {
      if (sql.includes('UPDATE tk_prompt_generations generation')) {
        expect(sql).toContain("status IN ('completed', 'failed')");
        expect(sql).toContain('FOR UPDATE SKIP LOCKED');
        expect(sql.indexOf('UPDATE tk_prompt_options')).toBeLessThan(sql.indexOf('UPDATE tk_prompt_generations'));
        return rows([{ id: generationId }]);
      }
      if (sql.includes('UPDATE tk_prompt_runs run')) {
        expect(sql).toContain("run.status IN ('ready', 'failed')");
        expect(sql).toContain("status IN ('queued', 'strategizing', 'expanding')");
        expect(sql).toContain('generation.expires_at > now()');
        return rows([{ id: runId }]);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    await expect(repositoryWith(purgeClient).purgeExpired(25)).resolves.toEqual({
      generations: 1,
      runs: 1,
    });
  });

  it('旧 worker 的 claim token 不能覆盖新 attempt 的策略或方案结果', async () => {
    const staleStrategyClient = scriptedClient((sql) => {
      if (sql.includes('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({
          status: 'strategizing',
          started_at: now,
          claim_token: replacementClaimToken,
          attempt_count: 2,
        })]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_options')) return rows([]);
      throw new Error(`旧策略 worker 不应执行写 SQL: ${sql}`);
    });
    await expect(repositoryWith(staleStrategyClient).failGeneration({
      generationId,
      userId,
      claimToken: generationClaimToken,
      failureReason: 'stale strategy failure',
    })).rejects.toMatchObject({ code: 'TK_PROMPT_GENERATION_CLAIM_STALE' });
    expect(staleStrategyClient.calls.every(call => !call.sql.startsWith('UPDATE'))).toBe(true);

    const staleCompletionClient = staleOptionAttemptClient();
    await expect(repositoryWith(staleCompletionClient).completeOption({
      optionId: optionIds.native,
      userId,
      claimToken: optionClaimToken,
      plan: plan(),
    })).rejects.toMatchObject({ code: 'TK_PROMPT_OPTION_CLAIM_STALE' });
    expect(staleCompletionClient.calls.every(call => !call.sql.startsWith('UPDATE'))).toBe(true);

    const staleFailureClient = staleOptionAttemptClient();
    await expect(repositoryWith(staleFailureClient).failOption({
      optionId: optionIds.native,
      userId,
      claimToken: optionClaimToken,
      failureReason: 'stale option failure',
    })).rejects.toMatchObject({ code: 'TK_PROMPT_OPTION_CLAIM_STALE' });
    expect(staleFailureClient.calls.every(call => !call.sql.startsWith('UPDATE'))).toBe(true);
  });

  it('过期活动批次使用 SKIP LOCKED 单次收口并在同一事务全额退款', async () => {
    const refundWithClient = vi.fn(async () => undefined);
    const client = scriptedClient((sql) => {
      if (
        sql.startsWith('SELECT id, user_id FROM tk_prompt_generations')
        && sql.includes('FOR UPDATE SKIP LOCKED')
      ) {
        expect(sql).toContain('expires_at <= clock_timestamp()');
        return rows([{ id: generationId, user_id: userId }]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({
          status: 'expanding',
          is_free: false,
          credits: 7,
          credit_status: 'held',
          main_credits_used: 7,
          strategy_set: strategySet(),
          expires_at: past,
        })]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_options')) {
        return rows([
          optionRow('safe', { status: 'completed', plan: plan(), completed_at: now }),
          optionRow('native', {
            status: 'processing',
            started_at: now,
            claim_token: optionClaimToken,
          }),
          optionRow('creative'),
        ]);
      }
      if (sql.startsWith('UPDATE tk_prompt_options')) {
        expect(sql).toContain('claim_token = NULL');
        return rows([], 3);
      }
      if (sql.startsWith('UPDATE tk_prompt_generations')) {
        expect(sql).toContain("credit_status = CASE WHEN credits > 0 THEN 'refunded'");
        expect(sql).toContain('claim_token = NULL');
        return rows([], 1);
      }
      if (sql.startsWith('UPDATE tk_prompt_runs SET expires_at')) return rows([]);
      if (sql.startsWith('WITH candidates AS')) {
        expect(sql).toContain("status = 'analyzing'");
        expect(sql).toContain('FOR UPDATE SKIP LOCKED');
        expect(sql).toContain('claim_token = NULL');
        expect(sql).toContain('clock_timestamp()');
        return rows([{ id: runId }]);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const repository = repositoryWith(client, {
      callbacks: creditCallbacks({ refundWithClient }),
    });
    await expect(repository.expireActive(20)).resolves.toEqual({
      generations: 1,
      runs: 1,
    });
    expect(refundWithClient).toHaveBeenCalledTimes(1);
    expect(refundWithClient).toHaveBeenCalledWith({
      client,
      userId,
      generationId,
      eventKey: tkPromptCreditEventKey(generationId),
      credits: 7,
    });

    const competingSweeper = scriptedClient((sql) => {
      if (sql.startsWith('SELECT id, user_id FROM tk_prompt_generations')) return rows([]);
      if (sql.startsWith('WITH candidates AS')) return rows([]);
      throw new Error(`竞争 sweeper 不应执行其他 SQL: ${sql}`);
    });
    await expect(repositoryWith(competingSweeper, {
      callbacks: creditCallbacks({ refundWithClient }),
    }).expireActive(20)).resolves.toEqual({ generations: 0, runs: 0 });
    expect(refundWithClient).toHaveBeenCalledTimes(1);
  });

  it('stale claim 未产生 Provider 事实时先撤销旧 claim，再只投递精确下一 attempt', async () => {
    const client = scriptedClient((sql) => {
      if (sql.startsWith('SELECT id FROM tk_prompt_runs')) return rows([]);
      if (sql.startsWith('SELECT id FROM tk_prompt_generations')) return rows([{ id: generationId }]);
      if (sql.startsWith('SELECT DISTINCT generation.id')) return rows([]);
      if (sql.startsWith('SELECT user_id FROM tk_prompt_generations')) return rows([{ user_id: userId }]);
      if (sql.startsWith('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({
          status: 'strategizing',
          started_at: past,
          attempt_count: 1,
          claim_token: generationClaimToken,
        })]);
      }
      if (sql.startsWith('SELECT * FROM tk_prompt_options')) return rows([]);
      if (sql.startsWith('SELECT expires_at > clock_timestamp() AS live')) {
        return rows([{ live: true }]);
      }
      if (sql.startsWith('SELECT 1 FROM tk_prompt_provider_requests')) {
        expect(sql).toContain('job_attempt = $5 AND claim_token = $6');
        return rows([]);
      }
      if (sql.startsWith('UPDATE tk_prompt_generations')) {
        expect(sql).toContain("SET status = 'queued', started_at = NULL, claim_token = NULL");
        return rows([], 1);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    await expect(repositoryWith(client).recoverableWork(new Date(now))).resolves.toEqual({
      runs: [],
      generations: [{ id: generationId, attempt: 2 }],
      options: [],
    });
    const providerCheck = client.calls.findIndex(call => call.sql.includes('tk_prompt_provider_requests'));
    const reset = client.calls.findIndex(call => call.sql.startsWith('UPDATE tk_prompt_generations'));
    expect(reset).toBeGreaterThan(providerCheck);
  });

  it('stale option claim 已有任一 Provider 事实时整批失败退款，绝不重新投递付费调用', async () => {
    const refundWithClient = vi.fn(async () => undefined);
    const client = scriptedClient((sql) => {
      if (sql.startsWith('SELECT id FROM tk_prompt_runs')) return rows([]);
      if (sql.startsWith('SELECT id FROM tk_prompt_generations')) return rows([]);
      if (sql.startsWith('SELECT DISTINCT generation.id')) return rows([{ id: generationId }]);
      if (sql.startsWith('SELECT user_id FROM tk_prompt_generations')) return rows([{ user_id: userId }]);
      if (sql.startsWith('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({
          status: 'expanding',
          is_free: false,
          credits: 7,
          credit_status: 'held',
          main_credits_used: 7,
          strategy_set: strategySet(),
        })]);
      }
      if (sql.startsWith('SELECT * FROM tk_prompt_options')) {
        return rows([
          optionRow('safe', {
            status: 'processing',
            started_at: past,
            attempt_count: 1,
            claim_token: optionClaimToken,
          }),
          optionRow('native'),
          optionRow('creative'),
        ]);
      }
      if (sql.startsWith('SELECT expires_at > clock_timestamp() AS live')) {
        return rows([{ live: true }]);
      }
      if (sql.startsWith('SELECT 1 FROM tk_prompt_provider_requests')) return rows([{ exists: 1 }]);
      if (sql.startsWith('UPDATE tk_prompt_options')) return rows([], 3);
      if (sql.startsWith('UPDATE tk_prompt_generations')) return rows([], 1);
      if (sql.startsWith('UPDATE tk_prompt_runs')) return rows([]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    await expect(repositoryWith(client, {
      callbacks: creditCallbacks({ refundWithClient }),
    }).recoverableWork(new Date(now))).resolves.toEqual({
      runs: [],
      generations: [],
      options: [],
    });
    expect(refundWithClient).toHaveBeenCalledWith({
      client,
      userId,
      generationId,
      eventKey: tkPromptCreditEventKey(generationId),
      credits: 7,
    });
    expect(client.calls.some(call => call.params?.some(param => (
      typeof param === 'string' && param.includes('TK_PROMPT_PROVIDER_ATTEMPT_NOT_REPLAYABLE')
    )))).toBe(true);
    expect(client.calls.some(call => call.sql.includes("SET status = 'queued'"))).toBe(false);
  });

  it('expanding 批次清空 strategy claim 后仍可作为 option 的只读上下文', async () => {
    const client = scriptedClient((sql) => {
      if (sql.includes('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({
          status: 'expanding',
          strategy_set: strategySet(),
          claim_token: null,
        })]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_options')) return rows([]);
      throw new Error(`未处理 SQL: ${sql}`);
    });
    await expect(repositoryWith(client).getGenerationWork(userId, generationId))
      .resolves.toMatchObject({ id: generationId, status: 'expanding' });
  });

  it('三案完成前公共 generation 不暴露内部策略、蓝图或已先完成方案正文', async () => {
    const client = scriptedClient((sql) => {
      if (sql.includes('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({
          status: 'expanding',
          strategy_set: strategySet(),
        })]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_options')) {
        return rows([
          optionRow('safe', { status: 'completed', plan: plan(), completed_at: now }),
          optionRow('native', {
            status: 'processing',
            started_at: now,
            claim_token: optionClaimToken,
          }),
          optionRow('creative'),
        ]);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const generation = await repositoryWith(client).getGeneration(userId, generationId);
    expect(generation.strategySet).toEqual([]);
    expect(generation.options).toHaveLength(3);
    expect(generation.options.every(option => option.strategyBlueprint === null)).toBe(true);
    expect(generation.options.every(option => option.plan === null)).toBe(true);
    expect(generation.options.find(option => option.slot === 'safe')).toMatchObject({
      status: 'processing',
      completedAt: null,
    });
  });

  it('超出请求预算的 started Provider 账本会原子收口为未知成本终态', async () => {
    const staleBefore = new Date('2026-08-17T01:00:00.000Z');
    const client = scriptedClient((sql, params) => {
      if (sql.includes('UPDATE tk_prompt_provider_requests request')) {
        expect(sql).toContain("request_status = 'started'");
        expect(sql).toContain('FOR UPDATE SKIP LOCKED');
        expect(sql).toContain("request_status = 'failed'");
        expect(sql).toContain("error_code = 'TK_PROMPT_PROVIDER_OUTCOME_UNKNOWN'");
        expect(sql).toContain("cost_status = 'unknown'");
        expect(sql).toContain('completed_at = clock_timestamp()');
        expect(params).toEqual([staleBefore, 25]);
        return rows([
          { id: '60000000-0000-4000-8000-000000000010' },
          { id: '60000000-0000-4000-8000-000000000011' },
        ]);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    await expect(repositoryWith(client).expireStartedProviderRequests(staleBefore, 25))
      .resolves.toBe(2);
  });

  it('Provider 请求只允许唯一 started 记录写入一次终态', async () => {
    let terminal = false;
    const client = scriptedClient((sql, params) => {
      if (sql.includes('SELECT * FROM tk_prompt_generations')) {
        expect(sql).toContain("status = 'expanding'");
        expect(sql).toContain('expires_at > clock_timestamp()');
        return rows([generationRow({ status: 'expanding', strategy_set: strategySet() })]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_options')) {
        expect(sql).toContain('claim_token = $4 AND attempt_count = $5');
        return rows([optionRow('safe', {
          status: 'processing',
          started_at: now,
          claim_token: optionClaimToken,
          attempt_count: 1,
        })]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_runs')) return rows([readyRunRow()]);
      if (sql.includes('INSERT INTO tk_prompt_provider_requests')) {
        expect(sql).toContain('job_attempt, claim_token, repair_round');
        expect(params?.[8]).toBe(optionClaimToken);
        return rows([{ id: '60000000-0000-4000-8000-000000000001' }]);
      }
      if (sql.includes('SELECT id, request_key, request_status')) {
        return rows([{
          id: '60000000-0000-4000-8000-000000000001',
          request_key: 'option:1',
          request_status: terminal ? 'succeeded' : 'started',
        }]);
      }
      if (sql.includes('UPDATE tk_prompt_provider_requests')) {
        expect(sql).toContain('input_tokens = $9, cached_input_tokens = $10, output_tokens = $11');
        expect(sql).toContain('cost_cny = $18, cost_status = $19');
        expect(params).toEqual([
          '60000000-0000-4000-8000-000000000001',
          'succeeded',
          'provider-request',
          'provider-response',
          'log-id',
          200,
          null,
          null,
          100,
          0,
          200,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          'unknown',
        ]);
        expect(params).toHaveLength(19);
        terminal = true;
        return rows([], 1);
      }
      throw new Error(`未处理 SQL: ${sql}`);
    });
    const repository = repositoryWith(client);
    const logicalAttempt = {
      runId,
      generationId,
      optionId: optionIds.safe,
      userId,
      stage: 'option' as const,
      action: 'generate-option',
      jobAttempt: 1,
      claimToken: optionClaimToken,
      repairRound: 0 as const,
      transportAttempt: 1,
      provider: 'volcengine-ark',
      model: 'doubao-seed-2-0-lite-260428',
      serviceTier: 'default',
    };
    const requestId = await repository.beginProviderRequest({
      ...logicalAttempt,
      requestKey: tkPromptProviderRequestKey(logicalAttempt),
    });
    const generationLock = client.calls.findIndex(call => call.sql.includes('FROM tk_prompt_generations'));
    const optionLock = client.calls.findIndex(call => call.sql.includes('FROM tk_prompt_options'));
    const runLock = client.calls.findIndex(call => call.sql.includes('FROM tk_prompt_runs'));
    const ledgerInsert = client.calls.findIndex(call => call.sql.includes('INSERT INTO tk_prompt_provider_requests'));
    expect(optionLock).toBeGreaterThan(generationLock);
    expect(runLock).toBeGreaterThan(optionLock);
    expect(ledgerInsert).toBeGreaterThan(runLock);
    const terminalInput = {
      status: 'succeeded' as const,
      providerRequestId: 'provider-request',
      providerResponseId: 'provider-response',
      xTtLogId: 'log-id',
      httpStatus: 200,
      errorCode: null,
      errorClassification: null,
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 200,
      costStatus: 'unknown' as const,
    };
    await expect(repository.completeProviderRequest(requestId, terminalInput)).resolves.toBe(true);
    await expect(repository.completeProviderRequest(requestId, terminalInput)).resolves.toBe(false);
    expect(client.calls.filter(call => call.sql.includes('UPDATE tk_prompt_provider_requests'))).toHaveLength(1);
  });

  it('兄弟方案整批失败清 claim 后，旧 option worker 在付费调用前被 fencing 拒绝', async () => {
    const logicalAttempt = {
      runId,
      generationId,
      optionId: optionIds.native,
      userId,
      stage: 'option' as const,
      action: 'repair-option',
      jobAttempt: 1,
      claimToken: optionClaimToken,
      repairRound: 1 as const,
      transportAttempt: 1,
      provider: 'volcengine-ark',
      model: 'doubao-seed-2-0-lite-260428',
      serviceTier: 'default',
    };
    const client = scriptedClient((sql) => {
      if (sql.includes('SELECT * FROM tk_prompt_generations')) {
        return rows([generationRow({ status: 'expanding', strategy_set: strategySet() })]);
      }
      if (sql.includes('SELECT * FROM tk_prompt_options')) return rows([]);
      throw new Error(`claim 失效后不应读取 run 或写 Provider 账本: ${sql}`);
    });
    await expect(repositoryWith(client).beginProviderRequest({
      ...logicalAttempt,
      requestKey: tkPromptProviderRequestKey(logicalAttempt),
    })).rejects.toMatchObject({ code: 'TK_PROMPT_PROVIDER_CLAIM_STALE' });
    expect(client.calls.some(call => call.sql.includes('tk_prompt_provider_requests'))).toBe(false);
  });
});

const TK_SLOTS = ['safe', 'native', 'creative'] as const;

function repositoryWith(
  client: ReturnType<typeof scriptedClient>,
  options: {
    callbacks?: TkPromptCreditCallbacks;
    planner?: (client: DbClient, userId: string, amounts: number[]) => Promise<Array<{
      mainAmount: number;
      addonAmount: number;
    }>>;
  } = {},
) {
  return createTkPromptEngineRepository({
    reader: client,
    transaction: callback => callback(client),
    creditCallbacks: options.callbacks,
    planCreditsWithClient: options.planner,
  });
}

function scriptedClient(
  handler: (sql: string, params: unknown[] | undefined) => ReturnType<typeof rows>,
) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    async query<T>(text: string, params?: unknown[]) {
      const sql = text.replace(/\s+/gu, ' ').trim();
      calls.push({ sql, params });
      return handler(sql, params) as unknown as {
        rows: T[];
        rowCount: number;
      };
    },
  } as unknown as DbClient & { calls: Array<{ sql: string; params?: unknown[] }> };
}

function staleOptionAttemptClient() {
  return scriptedClient((sql) => {
    if (sql.includes('SELECT generation_id FROM tk_prompt_options')) {
      return rows([{ generation_id: generationId }]);
    }
    if (sql.includes('SELECT * FROM tk_prompt_generations')) {
      return rows([generationRow({
        status: 'expanding',
        strategy_set: strategySet(),
      })]);
    }
    if (sql.includes('SELECT * FROM tk_prompt_options')) {
      return rows([
        optionRow('safe'),
        optionRow('native', {
          status: 'processing',
          started_at: now,
          claim_token: replacementClaimToken,
          attempt_count: 2,
        }),
        optionRow('creative'),
      ]);
    }
    throw new Error(`旧方案 worker 不应执行写 SQL: ${sql}`);
  });
}

function rows<T>(items: T[], rowCount = items.length) {
  return { rows: items, rowCount };
}

function creditCallbacks(overrides: Partial<TkPromptCreditCallbacks> = {}): TkPromptCreditCallbacks {
  return {
    holdWithClient: overrides.holdWithClient ?? vi.fn(async () => undefined),
    settleWithClient: overrides.settleWithClient ?? vi.fn(async () => undefined),
    refundWithClient: overrides.refundWithClient ?? vi.fn(async () => undefined),
  };
}

function generationInput() {
  return {
    userId,
    runId,
    idempotencyKey: 'generation-idempotency-1',
    expectedGenerationCredits: 7,
    confirmedFactPack: {
      schemaVersion: 1,
      factPack: { facts: [{ factId: 'visible-001', text: '白色主体可见' }] },
      evidenceReview: {
        productName: '自动喂食器',
        category: '宠物用品',
        rejectedVisibleFactIds: [],
        userConfirmedFacts: [],
        forbiddenClaims: [],
      },
      evidenceFlags: {},
    },
    creativeInput: {
      targetMarket: 'United States',
      targetAudience: 'Pet owners',
      spokenLanguage: '英语' as const,
      verifiedOffer: '',
      appearance: { mode: 'product_closeup' as const },
      availableScenes: ['home'],
      availableAssets: ['product'],
    },
    videoConfig: {
      model: 'seedance-2.0' as const,
      aspectRatio: '9:16' as const,
      resolution: '720p' as const,
      durationSeconds: 10 as const,
    },
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: runId,
    user_id: userId,
    schema_version: 1,
    idempotency_key: 'run-idempotency-1',
    request_hash: 'a'.repeat(64),
    status: 'analyzing',
    image_asset_ids: [imageId],
    evidence_profile: null,
    failure_reason: null,
    attempt_count: 0,
    claim_token: null,
    content_purged_at: null,
    started_at: null,
    completed_at: null,
    expires_at: future,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function readyRunRow() {
  return runRow({
    status: 'ready',
    evidence_profile: evidenceProfile(),
    completed_at: now,
  });
}

function generationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: generationId,
    run_id: runId,
    user_id: userId,
    schema_version: 1,
    ordinal: 1,
    idempotency_key: 'generation-idempotency-1',
    request_hash: 'b'.repeat(64),
    status: 'queued',
    confirmed_fact_pack: generationInput().confirmedFactPack,
    creative_input: generationInput().creativeInput,
    video_config: generationInput().videoConfig,
    strategy_set: null,
    is_free: true,
    credits: 0,
    credit_status: 'none',
    main_credits_used: 0,
    addon_credits_used: 0,
    failure_reason: null,
    attempt_count: 0,
    claim_token: null,
    content_purged_at: null,
    started_at: null,
    completed_at: null,
    expires_at: future,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function optionRow(slot: typeof TK_SLOTS[number], overrides: Record<string, unknown> = {}) {
  return {
    id: optionIds[slot],
    generation_id: generationId,
    user_id: userId,
    slot,
    status: 'queued',
    strategy_blueprint: strategySet().find(strategy => strategy.slot === slot),
    plan: null,
    failure_reason: null,
    attempt_count: 0,
    claim_token: null,
    content_purged_at: null,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function evidenceProfile() {
  return {
    schemaVersion: 1 as const,
    productIdentity: { name: 'Pet feeder', category: 'Pet supplies', confidence: 'high' as const },
    visibleFacts: [{
      factId: 'visible-001',
      text: 'White body is visible',
      sourceImageAssetIds: [imageId],
      confidence: 'high' as const,
    }],
    inferredContexts: [],
    demonstrableActions: [{
      actionId: 'action-001',
      text: 'show the product',
      supportingFactIds: ['visible-001'],
      sourceImageAssetIds: [imageId],
    }],
    availableMaterials: ['product image'],
    forbiddenClaims: ['unverified performance'],
  };
}

function strategySet() {
  const base = {
    labelZh: '最稳',
    objective: 'conversion' as const,
    styleForm: 'product' as const,
    style: 'unboxing' as const,
    hookPatternId: 'sound_hook' as const,
    firstFrameId: 'sound_sync' as const,
    firstFrame: '首帧展示商品动作',
    openingAction: '手部立即操作商品',
    openingLine: 'See this?',
    relevanceBeat: '展示真实使用问题',
    productBridge: '动作连接商品结构',
    buyingMotivationId: 'problem_relief' as const,
    buyingMotivation: '减少日常不便',
    proofMethodId: 'visible_operation' as const,
    proofMethod: '连续操作证明',
    ctaStrategy: '查看商品详情',
    requiredMaterials: ['product'],
    allowedFactIds: ['visible-001'],
  };
  return [
    { ...base, slot: 'safe' as const, videoMode: 'product_closeup' as const },
    {
      ...base,
      slot: 'native' as const,
      labelZh: '最原生',
      objective: 'trust' as const,
      styleForm: 'scene' as const,
      style: 'scene' as const,
      videoMode: 'scene_demo' as const,
      hookPatternId: 'identity' as const,
      firstFrameId: 'pov_entry' as const,
      buyingMotivationId: 'identity_fit' as const,
      proofMethodId: 'context_demo' as const,
    },
    {
      ...base,
      slot: 'creative' as const,
      labelZh: '最抓眼',
      objective: 'attention' as const,
      styleForm: 'drama' as const,
      style: 'product_pov' as const,
      videoMode: 'product_closeup' as const,
      hookPatternId: 'unexpected' as const,
      firstFrameId: 'structure_reveal' as const,
      buyingMotivationId: 'curiosity' as const,
      proofMethodId: 'structure_closeup' as const,
    },
  ];
}

function plan() {
  return {
    schemaVersion: 1 as const,
    title: 'Product proof',
    whyItFits: 'Visible action supports the idea',
    audioMode: 'voiceover' as const,
    executionPrompt: 'Show @图片1 in one continuous action.',
    beats: [{
      startSeconds: 0,
      endSeconds: 10,
      environment: 'home counter',
      subject: '@图片1 product',
      action: 'operate the visible structure',
      shotSize: 'close-up',
      cameraMovement: 'slow push-in',
      lighting: 'natural indoor light',
      editingCue: 'cut on action',
      soundDesign: 'real handling sound',
      voiceoverTarget: 'See how this works.',
      voiceoverZh: '看看它如何工作。',
      factIds: ['visible-001'],
    }],
    factsUsed: ['visible-001'],
    assumptions: [],
    requiredMaterials: ['product'],
    warnings: [],
  };
}
