import fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  requireAdmin: vi.fn(),
  readPromptWizardSettings: vi.fn(),
  readTkPromptEngineSettings: vi.fn(),
  readTkPromptEngineV6WritesRetired: vi.fn(),
  runAdminIdempotentAction: vi.fn(),
  updatePromptWizardSettingsWithClient: vi.fn(),
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
  updateTkPromptEngineSettingsWithClient: vi.fn(),
}));

import { registerAdminRoutes } from '../src/routes/adminRoutes.js';

describe('后台提示词向导设置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.clientQuery }));
    mocks.runAdminIdempotentAction.mockImplementation(async input => mocks.withTransaction(async (client: DbClient) => ({
      response: await input.execute(client, 'action-1'),
      statusCode: input.successStatus ?? 200,
      reused: false,
      actionId: 'action-1',
    })));
    mocks.readPromptWizardSettings.mockResolvedValue({
      generationCredits: 1,
      available: true,
      engineVersion: 3,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    mocks.readTkPromptEngineSettings.mockResolvedValue({
      schemaVersion: 1,
      generationCredits: 4,
      available: false,
      updatedAt: '2026-08-17T00:00:00.000Z',
    });
    mocks.readTkPromptEngineV6WritesRetired.mockResolvedValue(false);
    mocks.updatePromptWizardSettingsWithClient.mockImplementation(async input => ({
      generationCredits: input.generationCredits ?? 1,
      available: input.available ?? true,
      engineVersion: 3,
      updatedAt: '2026-07-20T01:00:00.000Z',
    }));
    mocks.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('仅修改开关时归入功能开关审计', async () => {
    const response = await patchPromptWizardSettings({ available: false }, 'prompt-wizard-available');

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().promptWizard).toMatchObject({ generationCredits: 1, available: false });
    expect(mocks.updatePromptWizardSettingsWithClient).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: 'admin-1',
      available: false,
    }));
    expectCutoverLockOrder();
    expect(auditArguments()).toEqual(expect.arrayContaining([
      'admin-1',
      '功能开关',
      '修改提示词向导开关',
      'prompt-wizard',
      'medium',
      '功能状态 开启 → 关闭',
    ]));
  });

  it('仅修改积分时归入积分消耗审计', async () => {
    const response = await patchPromptWizardSettings({ generationCredits: 3 }, 'prompt-wizard-credits');

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().promptWizard).toMatchObject({ generationCredits: 3, available: true });
    expect(mocks.updatePromptWizardSettingsWithClient).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: 'admin-1',
      generationCredits: 3,
    }));
    expect(auditArguments()).toEqual(expect.arrayContaining([
      'admin-1',
      '积分消耗',
      '修改提示词向导积分',
      'prompt-wizard',
      'medium',
      '方案生成积分 1 → 3',
    ]));
  });

  it('同时修改两项时归入组合设置审计', async () => {
    const response = await patchPromptWizardSettings(
      { generationCredits: 2, available: false },
      'prompt-wizard-combined',
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().promptWizard).toMatchObject({ generationCredits: 2, available: false });
    expect(auditArguments()).toEqual(expect.arrayContaining([
      'admin-1',
      '提示词向导设置',
      '修改提示词向导设置',
      'prompt-wizard',
      'medium',
      '方案生成积分 1 → 2；功能状态 开启 → 关闭',
    ]));
  });

  it('拒绝通过管理接口提交已退役的引擎版本字段', async () => {
    const response = await patchPromptWizardSettings({ engineVersion: 2 }, 'prompt-wizard-engine-v2');

    expect(response.statusCode, response.body).toBe(500);
    expect(mocks.updatePromptWizardSettingsWithClient).not.toHaveBeenCalled();
    expect(mocks.runAdminIdempotentAction).not.toHaveBeenCalled();
  });

  it('TK 1.0 已切流后拒绝重新开启旧 V6 写入口', async () => {
    mocks.readTkPromptEngineSettings.mockResolvedValue({
      schemaVersion: 1,
      generationCredits: 4,
      available: false,
      updatedAt: '2026-08-17T00:00:00.000Z',
    });
    mocks.readTkPromptEngineV6WritesRetired.mockResolvedValue(true);

    const response = await patchPromptWizardSettings(
      { available: true },
      'prompt-wizard-reopen-after-tk-cutover',
    );

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PROMPT_WIZARD_WRITE_RETIRED' });
    expect(mocks.updatePromptWizardSettingsWithClient).not.toHaveBeenCalled();
    expectCutoverLockOrder();
  });
});

async function patchPromptWizardSettings(payload: Record<string, unknown>, idempotencyKey: string) {
  const app = fastify({ logger: false });
  await app.register(registerAdminRoutes);
  try {
    return await app.inject({
      method: 'PATCH',
      url: '/api/admin/prompt-wizard-settings',
      headers: { 'idempotency-key': idempotencyKey },
      payload,
    });
  } finally {
    await app.close();
  }
}

function auditArguments() {
  const call = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_logs'));
  if (!call) throw new Error('未写入提示词向导审计日志');
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
