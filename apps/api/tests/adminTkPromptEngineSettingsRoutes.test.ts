import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  requireAdmin: vi.fn(),
  readTkPromptEngineSettings: vi.fn(),
  readTkPromptEngineV6WritesRetired: vi.fn(),
  readPromptWizardSettings: vi.fn(),
  updateTkPromptEngineSettingsWithClient: vi.fn(),
  updatePromptWizardSettingsWithClient: vi.fn(),
  runAdminIdempotentAction: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/auth/session.js', () => ({ requireAdmin: mocks.requireAdmin }));

vi.mock('../src/domain/adminIdempotency.js', () => ({
  resolveAdminIdempotencyKey: vi.fn(({ headerKey }: { headerKey?: string | string[] }) => (
    Array.isArray(headerKey) ? headerKey[0] : headerKey
  )),
  runAdminIdempotentAction: mocks.runAdminIdempotentAction,
}));

vi.mock('../src/domain/promptWizardService.js', () => ({
  readPromptWizardSettings: mocks.readPromptWizardSettings,
  updatePromptWizardSettingsWithClient: mocks.updatePromptWizardSettingsWithClient,
}));

vi.mock('../src/domain/tkPromptEngineRepository.js', () => ({
  readTkPromptEngineSettings: mocks.readTkPromptEngineSettings,
  readTkPromptEngineV6WritesRetired: mocks.readTkPromptEngineV6WritesRetired,
  updateTkPromptEngineSettingsWithClient: mocks.updateTkPromptEngineSettingsWithClient,
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台 TK Prompt Engine 设置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.clientQuery }));
    mocks.runAdminIdempotentAction.mockImplementation(async input => mocks.withTransaction(
      async (client: DbClient) => ({
        response: await input.execute(client, 'action-1'),
        statusCode: input.successStatus ?? 200,
        reused: false,
        actionId: 'action-1',
      }),
    ));
    mocks.readTkPromptEngineSettings.mockResolvedValue({
      schemaVersion: 1,
      generationCredits: 2,
      available: false,
      updatedAt: '2026-08-17T00:00:00.000Z',
    });
    mocks.readTkPromptEngineV6WritesRetired.mockResolvedValue(false);
    mocks.readPromptWizardSettings.mockResolvedValue({
      generationCredits: 4,
      available: true,
      engineVersion: 4,
      updatedAt: '2026-08-17T00:00:00.000Z',
    });
    mocks.updatePromptWizardSettingsWithClient.mockResolvedValue({
      generationCredits: 4,
      available: false,
      engineVersion: 4,
      updatedAt: '2026-08-17T01:00:00.000Z',
    });
    mocks.updateTkPromptEngineSettingsWithClient.mockImplementation(async input => ({
      schemaVersion: 1,
      generationCredits: input.generationCredits ?? 2,
      available: input.available ?? false,
      updatedAt: '2026-08-17T01:00:00.000Z',
    }));
    mocks.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('拒绝管理 API 直接首次开放，要求走受审计终结器且不产生副作用', async () => {
    const response = await patchSettings({ available: true }, 'tk-prompt-available');

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ message: expect.stringContaining('受审计终结器') });
    expect(mocks.runAdminIdempotentAction).not.toHaveBeenCalled();
    expect(mocks.updateTkPromptEngineSettingsWithClient).not.toHaveBeenCalled();
    expect(mocks.updatePromptWizardSettingsWithClient).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it('仅修改整批积分时走积分消耗审计', async () => {
    const response = await patchSettings({ generationCredits: 5 }, 'tk-prompt-credits');

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().settings).toMatchObject({ generationCredits: 5, available: false });
    expect(auditArguments()).toEqual(expect.arrayContaining([
      'admin-1',
      '积分消耗',
      '修改TK提示词引擎积分',
      'tk-prompt-engine',
      'medium',
      '整批生成积分 2 → 5',
    ]));
  });

  it('同时修改价格和首次开放时整单拒绝，不部分写入价格', async () => {
    const response = await patchSettings(
      { generationCredits: 4, available: true },
      'tk-prompt-combined',
    );

    expect(response.statusCode, response.body).toBe(409);
    expect(mocks.runAdminIdempotentAction).not.toHaveBeenCalled();
    expect(mocks.updateTkPromptEngineSettingsWithClient).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it('TK 已开放后仍允许管理 API 前向关闭并写功能开关审计', async () => {
    mocks.readTkPromptEngineSettings.mockResolvedValueOnce({
      schemaVersion: 1,
      generationCredits: 2,
      available: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    });
    mocks.updateTkPromptEngineSettingsWithClient.mockResolvedValueOnce({
      schemaVersion: 1,
      generationCredits: 2,
      available: false,
      updatedAt: '2026-08-17T01:00:00.000Z',
    });

    const response = await patchSettings({ available: false }, 'tk-prompt-disable');

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().settings).toMatchObject({ available: false });
    expect(mocks.updateTkPromptEngineSettingsWithClient).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.any(Object),
      updatedBy: 'admin-1',
      available: false,
    }));
    expectCutoverLockOrder();
    expect(auditArguments()).toEqual(expect.arrayContaining([
      'admin-1',
      '功能开关',
      '修改TK提示词引擎开关',
      'tk-prompt-engine',
      'medium',
      '功能状态 开启 → 关闭',
    ]));
  });

  it('空 PATCH 在进入事务前由共享合同拒绝', async () => {
    const response = await patchSettings({}, 'tk-prompt-empty');

    expect(response.statusCode).toBe(500);
    expect(mocks.runAdminIdempotentAction).not.toHaveBeenCalled();
    expect(mocks.updateTkPromptEngineSettingsWithClient).not.toHaveBeenCalled();
  });
});

async function patchSettings(payload: Record<string, unknown>, idempotencyKey: string) {
  const app = fastify({ logger: false });
  await app.register(registerAdminRoutes);
  try {
    return await app.inject({
      method: 'PATCH',
      url: '/api/admin/tk-prompt-engine-settings',
      headers: { 'idempotency-key': idempotencyKey },
      payload,
    });
  } finally {
    await app.close();
  }
}

function auditArguments() {
  const call = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'));
  if (!call) throw new Error('未写入 TK Prompt Engine 审计日志');
  const values = call[1] as unknown[];
  return [values[0], values[1], values[2], values[3], values[4], values[6]];
}

function expectCutoverLockOrder() {
  const sql = mocks.clientQuery.mock.calls.map(([statement]) => String(statement));
  const advisoryIndex = sql.findIndex(statement => statement.includes('pg_advisory_xact_lock'));
  const oldSettingsIndex = sql.findIndex(statement => (
    statement.includes('FROM prompt_wizard_settings') && statement.includes('FOR UPDATE')
  ));
  const tkSettingsIndex = sql.findIndex(statement => (
    statement.includes('FROM tk_prompt_engine_settings') && statement.includes('FOR UPDATE')
  ));
  expect(advisoryIndex).toBeGreaterThanOrEqual(0);
  expect(oldSettingsIndex).toBeGreaterThan(advisoryIndex);
  expect(tkSettingsIndex).toBeGreaterThan(oldSettingsIndex);
}
