import { createServer, type Server } from 'node:http';
import { specTypeSchemas } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  getUserProfile: vi.fn(),
  getGenerationTask: vi.fn(),
}));
vi.mock('../src/db/pool.js', () => ({ pool: { query: mocks.poolQuery } }));
vi.mock('../src/config/env.js', () => ({ env: {
  MCP_PUBLIC_URL: 'https://www.lindyson.com/mcp',
  MCP_READ_RATE_PER_MINUTE: 60,
  MCP_GENERATE_RATE_PER_MINUTE: 6,
} }));
vi.mock('../src/domain/generationService.js', () => ({
  createGenerationTasksBatch: vi.fn(),
  getGenerationTask: mocks.getGenerationTask,
  sanitizeGenerationConfig: vi.fn(),
}));
vi.mock('../src/domain/consumption.js', () => ({
  getGenerationCredits: vi.fn(), listConsumptionSettings: vi.fn(),
}));
vi.mock('../src/domain/users.js', () => ({ getUserProfile: mocks.getUserProfile }));
vi.mock('../src/domain/subscriptionLifecycle.js', () => ({ reconcileSubscription: vi.fn() }));
vi.mock('../src/domain/assetDownloadService.js', () => ({ prepareOwnedAssetDownload: vi.fn() }));
vi.mock('../src/routes/generationRoutes.js', () => ({
  isVideoModelCapabilityAvailable: vi.fn(), toUserGenerationTask: vi.fn(),
}));
vi.mock('../src/queues/generationQueue.js', () => ({ enqueueGenerationTask: vi.fn() }));
vi.mock('../src/mcp/fileImports.js', () => ({ getMcpImport: vi.fn(), importChatGptFiles: vi.fn() }));

import { createMcpNodeHandler } from '../src/mcp/tools.js';
import { MCP_SCOPES, type McpIdentity } from '../src/mcp/security.js';

const expectedScopes = {
  list_models: ['account:read'],
  get_account: ['account:read'],
  list_assets: ['assets:read'],
  import_files: ['assets:write'],
  get_import: ['assets:write'],
  estimate_generation: ['account:read'],
  generate_image: ['generation:write'],
  generate_video: ['generation:write'],
  list_tasks: ['generation:read'],
  get_task: ['generation:read'],
  get_result: ['generation:read', 'assets:read'],
};
const identity: McpIdentity = {
  userId: '00000000-0000-4000-8000-000000000001',
  connectionId: '00000000-0000-4000-8000-000000000002',
  authVersion: 1,
  scopes: [...MCP_SCOPES],
};

describe('MCP 工具的 HTTP 权限描述与调用', () => {
  let httpServer: Server;
  let url: string;
  let requestIdentity: McpIdentity;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.poolQuery.mockResolvedValue({ rows: [{ calls: 1 }] });
    mocks.getUserProfile.mockResolvedValue({
      userName: '测试用户', credits: 100, mainCredits: 80, addonCredits: 20, planCode: 'free',
    });
    requestIdentity = { ...identity, scopes: [...MCP_SCOPES] };
    httpServer = createServer((request, response) => {
      void createMcpNodeHandler(requestIdentity)(request, response).catch(() => {
        response.statusCode = 500;
        response.end();
      });
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('测试 HTTP 服务未启动');
    url = `http://127.0.0.1:${address.port}/mcp`;
  });

  afterEach(async () => {
    httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  });

  async function rpc(method: string, params: Record<string, unknown>, protocol = '2025-06-18') {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': protocol,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = response.headers.get('content-type')?.includes('text/event-stream')
      ? JSON.parse(text.split('\n').filter((line) => line.startsWith('data: ')).at(-1)!.slice(6))
      : JSON.parse(text);
    expect(body.error).toBeUndefined();
    return body.result;
  }

  it.each(['2025-03-26', '2025-06-18', '2025-11-25'])(
    '%s 的实际工具列表发布全部权限主字段和兼容镜像',
    async (protocol) => {
      const result = await rpc('tools/list', {}, protocol);
      expect(specTypeSchemas.ListToolsResult['~standard'].validate(result).issues).toBeUndefined();
      expect(result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(Object.keys(expectedScopes).sort());
      for (const tool of result.tools) {
        const scopes = expectedScopes[tool.name as keyof typeof expectedScopes];
        expect(tool.securitySchemes).toEqual([{ type: 'oauth2', scopes }]);
        expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.outputSchema).toEqual({ type: 'object', additionalProperties: true });
        const write = ['import_files', 'generate_image', 'generate_video', 'get_result'].includes(tool.name);
        expect(tool.annotations).toEqual({
          readOnlyHint: !write,
          destructiveHint: false,
          idempotentHint: !write || tool.name.startsWith('generate_') || tool.name === 'import_files',
          openWorldHint: write,
        });
      }
      const estimator = result.tools.find((tool: { name: string }) => tool.name === 'estimate_generation');
      expect(estimator.inputSchema.anyOf.map((option: { type: string }) => option.type)).toEqual(['object', 'object']);
      const importer = result.tools.find((tool: { name: string }) => tool.name === 'import_files');
      expect(importer._meta['openai/fileParams']).toEqual(['files']);
      expect(importer.inputSchema.properties.files.items.required).toEqual(['download_url', 'file_id']);
    },
  );

  it('工具调用仍经过 SDK 参数校验并正常返回账号结果', async () => {
    const valid = await rpc('tools/call', { name: 'get_account', arguments: {} });
    expect(valid.isError).toBeUndefined();
    expect(valid.structuredContent).toMatchObject({ credits: 100, mainCredits: 80, addonCredits: 20 });
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    const invalid = await rpc('tools/call', { name: 'get_account', arguments: { unknown: true } });
    expect(invalid.isError).toBe(true);
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it('get_result 缺少素材权限时保留完整的补充授权挑战且不读取任务', async () => {
    requestIdentity.scopes = ['generation:read'];
    const result = await rpc('tools/call', { name: 'get_result', arguments: { id: identity.userId } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe('MCP_SCOPE_REQUIRED');
    expect(result._meta['mcp/www_authenticate']).toEqual([
      'Bearer resource_metadata="https://www.lindyson.com/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="Reauthorize Lindyson", scope="generation:read assets:read"',
    ]);
    expect(mocks.getGenerationTask).not.toHaveBeenCalled();
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('调用中授权失效时保留重新登录挑战', async () => {
    mocks.getUserProfile.mockRejectedValueOnce(Object.assign(new Error('请重新授权'), {
      code: 'MCP_AUTH_INVALID', statusCode: 401,
    }));
    const result = await rpc('tools/call', { name: 'get_account', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result._meta['mcp/www_authenticate'][0]).toContain('error="invalid_token"');
    expect(result._meta['mcp/www_authenticate'][0]).toContain('scope="account:read"');
  });
});
