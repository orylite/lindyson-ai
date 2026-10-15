import { createMcpHandler, fromJsonSchema, McpServer, type Tool } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import {
  endpointContracts,
  idempotencyKeySchema,
  isoDateTimeSchema,
  uuidSchema,
} from '@lindyson/api-contracts';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import {
  createGenerationTasksBatch,
  getGenerationTask,
  sanitizeGenerationConfig,
} from '../domain/generationService.js';
import { getGenerationCredits, listConsumptionSettings } from '../domain/consumption.js';
import { hasSeedanceVideoInput } from '../domain/seedancePricing.js';
import { SEEDANCE_MODEL_CAPABILITIES } from '../domain/seedanceModels.js';
import { getUserProfile } from '../domain/users.js';
import { reconcileSubscription } from '../domain/subscriptionLifecycle.js';
import { prepareOwnedAssetDownload } from '../domain/assetDownloadService.js';
import {
  isVideoModelCapabilityAvailable,
  toUserGenerationTask,
} from '../routes/generationRoutes.js';
import { enqueueGenerationTask } from '../queues/generationQueue.js';
import { getMcpImport, importChatGptFiles } from './fileImports.js';
import {
  enforceMcpRateLimit,
  hashSecret,
  mcpError,
  mcpResourceUrl,
  requireMcpScope,
  type McpIdentity,
  type McpScope,
} from './security.js';

const empty = z.object({}).strict();
const idInput = z.object({ id: uuidSchema }).strict();
const pageInput = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().max(300).optional(),
    kind: z.enum(['image', 'video', 'audio']).optional(),
  })
  .strict();
const videoRequest = endpointContracts.generationBatchCreate.body.shape.requests.element
  .innerType()
  .omit({ realPortrait: true, promptWizardSource: true, tkPromptSource: true });
const imageRequest = endpointContracts.imageGenerationBatchCreate.body.shape.requests.element;
const requestArray = (kind: 'image' | 'video') =>
  z
    .array(kind === 'image' ? imageRequest : videoRequest)
    .min(1)
    .max(4);
export const mcpImageInput = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    maxCredits: z.number().int().nonnegative(),
    requests: requestArray('image'),
  })
  .strict();
export const mcpVideoInput = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    maxCredits: z.number().int().nonnegative(),
    requests: requestArray('video'),
  })
  .strict();
const estimateInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), requests: requestArray('image') }).strict(),
  z.object({ kind: z.literal('video'), requests: requestArray('video') }).strict(),
]);
const fileSchema = z
  .object({
    download_url: z.string().url().max(8192),
    file_id: z.string().min(1).max(256),
    mime_type: z.string().max(100).optional(),
    file_name: z.string().max(255).optional(),
  })
  .strict();
export const mcpImportInput = z
  .object({ idempotencyKey: idempotencyKeySchema, files: z.array(fileSchema).min(1).max(4) })
  .strict();

export function createMcpNodeHandler(identity: McpIdentity) {
  const handler = createMcpHandler(() => createLindysonMcpServer(identity), {
    legacy: 'stateless',
  });
  const nodeHandler = toNodeHandler(handler);
  return async (...args: Parameters<typeof nodeHandler>) => {
    try {
      await nodeHandler(...args);
    } finally {
      await handler.close();
    }
  };
}
export function createLindysonMcpServer(identity: McpIdentity) {
  const toolDefinitions: Tool[] = [];
  const server = new McpServer(
    { name: 'lindyson', version: '1.0.0' },
    {
      instructions:
        '使用 Lindyson 本人账号创作。生成会消耗积分：先估价并向用户说明，再提交，重试使用同一幂等键。附件必须先导入并等待完成，再用资产 ID 生成。任务异步运行，请按 pollAfterSeconds 查询。',
    },
  );
  function tool<Schema extends z.ZodTypeAny>(
    name: string,
    description: string,
    scope: McpScope,
    input: Schema,
    run: (payload: z.output<Schema>) => Promise<Record<string, unknown>>,
    write = false,
    file = false,
    additionalScopes: McpScope[] = [],
  ) {
    const requiredScopes = [scope, ...additionalScopes];
    const securitySchemes = [{ type: 'oauth2', scopes: requiredScopes }];
    // 与 SDK 输入描述的归一化一致：联合对象仍需显式声明顶层 object，保留各分支约束。
    const inputSchema = {
      type: 'object',
      ...zodToJsonSchema(input, { $refStrategy: 'none' }),
    } as Tool['inputSchema'];
    const outputSchema = { type: 'object' as const, additionalProperties: true };
    const metadata = {
      description,
      annotations: {
        readOnlyHint: !write,
        destructiveHint: false,
        idempotentHint: !write || name.startsWith('generate_') || file,
        openWorldHint: write,
      },
      securitySchemes,
      _meta: {
        securitySchemes,
        ...(file ? { 'openai/fileParams': ['files'] } : {}),
      },
    };
    toolDefinitions.push({ name, ...metadata, inputSchema, outputSchema });
    server.registerTool(
      name,
      {
        ...metadata,
        inputSchema: fromJsonSchema(inputSchema as Record<string, unknown>),
        outputSchema: fromJsonSchema<Record<string, unknown>>(outputSchema),
      },
      async (payload) => {
        try {
          requiredScopes.forEach((required) => requireMcpScope(identity, required));
          await enforceMcpRateLimit(
            `tool:${identity.userId}:${scope === 'generation:write' ? 'generate' : 'read'}`,
            scope === 'generation:write'
              ? env.MCP_GENERATE_RATE_PER_MINUTE
              : env.MCP_READ_RATE_PER_MINUTE,
          );
          const result = await run(input.parse(payload));
          return {
            content: [{ type: 'text' as const, text: summarizeToolResult(name, result) }],
            structuredContent: result,
          };
        } catch (error) {
          const known = error as {
            code?: string;
            statusCode?: number;
            message?: string;
            exposeMessage?: boolean;
          };
          const code =
            typeof known.code === 'string' &&
            /^(MCP_|GENERATION_|UPLOAD_|ASSET_|SEEDREAM_|SEEDANCE_)/.test(known.code)
              ? known.code
              : 'MCP_TOOL_FAILED';
          const message =
            error instanceof z.ZodError
              ? '请求参数不正确'
              : known.statusCode && known.statusCode < 500
                ? known.message
                : '操作暂时失败，请稍后重试';
          console.info(
            JSON.stringify({
              event: 'mcp-tool-failed',
              tool: name,
              code,
              statusCode: known.statusCode ?? 500,
            }),
          );
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({ code, message }) }],
            ...([401, 403].includes(known.statusCode ?? 0)
              ? {
                  _meta: {
                    'mcp/www_authenticate': [
                      `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', mcpResourceUrl()).href}", error="${known.statusCode === 403 ? 'insufficient_scope' : 'invalid_token'}", error_description="Reauthorize Lindyson", scope="${requiredScopes.join(' ')}"`,
                    ],
                  },
                }
              : {}),
          };
        }
      },
    );
  }
  tool(
    'list_models',
    '查询当前开放模型、可用参数和积分价格。生成前必须查询，不猜测模型参数。',
    'account:read',
    empty,
    async () => {
      const prices = await listConsumptionSettings(pool);
      return {
        videoModels: SEEDANCE_MODEL_CAPABILITIES.filter((item) =>
          isVideoModelCapabilityAvailable(prices, item),
        ),
        prices: prices.filter((item) => item.available && item.credits > 0),
        imageRequestSchema: zodToJsonSchema(imageRequest, { $refStrategy: 'none' }),
        videoRequestSchema: zodToJsonSchema(videoRequest, { $refStrategy: 'none' }),
      };
    },
  );
  tool('get_account', '查询当前连接账号的可用积分和套餐。', 'account:read', empty, async () => {
    await reconcileSubscription(identity.userId);
    const user = await getUserProfile(pool, identity.userId);
    if (!user) throw mcpError('MCP_ACCOUNT_NOT_FOUND', '账号不存在', 404);
    return {
      userName: user.userName,
      credits: user.credits,
      mainCredits: user.mainCredits,
      addonCredits: user.addonCredits,
      planCode: user.planCode,
    };
  });
  tool(
    'list_assets',
    '分页查询本人素材，使用返回的资产 ID 作为生成参考。',
    'assets:read',
    pageInput,
    async (payload) => {
      const cursor = decodeCursor(payload.cursor);
      const result = await pool.query<{
        id: string;
        name: string;
        type: string;
        source: string;
        created_at: Date;
        duration_seconds: number | null;
        width: number | null;
        height: number | null;
      }>(
        `SELECT id,name,type,source,created_at,duration_seconds,width,height FROM assets WHERE user_id=$1 AND deletion_status='active'
       AND ($2::text IS NULL OR type=$2) AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))
       ORDER BY created_at DESC,id DESC LIMIT $5`,
        [
          identity.userId,
          payload.kind ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          payload.limit + 1,
        ],
      );
      return pageResult(result.rows, payload.limit, (row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        source: row.source,
        durationSeconds: row.duration_seconds,
        width: row.width,
        height: row.height,
      }));
    },
  );
  tool(
    'import_files',
    '将用户在 ChatGPT 中选定的附件保存到其 Lindyson 素材库。异步返回导入 ID；重复提交使用同一幂等键。',
    'assets:write',
    mcpImportInput,
    (payload) => importChatGptFiles(identity, payload.idempotencyKey, payload.files),
    true,
    true,
  );
  tool(
    'get_import',
    '查询本人附件导入进度；仅 completed 状态的 assetId 可用于生成。',
    'assets:write',
    idInput,
    (payload) => getMcpImport(identity.userId, payload.id),
  );
  tool(
    'estimate_generation',
    '检查生成参数与本人参考素材并估算积分；不会创建生成任务或预扣积分。',
    'account:read',
    estimateInput,
    async (payload) => {
      const costs = [];
      for (const request of payload.requests) {
        const config = await sanitizeGenerationConfig(pool, {
          ...request,
          kind: payload.kind,
          userId: identity.userId,
        });
        const credits = await getGenerationCredits(pool, {
          kind: payload.kind,
          model: request.model,
          durationSeconds: Number(config.durationSeconds ?? config.duration) || undefined,
          resolution: typeof config.resolution === 'string' ? config.resolution : undefined,
          hasReferenceVideo: hasSeedanceVideoInput(config),
        });
        if (credits <= 0) throw mcpError('GENERATION_MODEL_UNAVAILABLE', '当前模型或配置暂不开放');
        costs.push(credits);
      }
      return {
        credits: costs,
        totalCredits: costs.reduce((a, b) => a + b, 0),
        notice: '提交时按最新价格计算；请将本次允许的积分上限传为 maxCredits。',
      };
    },
  );
  for (const kind of ['image', 'video'] as const)
    tool(
      `generate_${kind}`,
      `提交${kind === 'image' ? '图片' : '视频'}生成，会预扣 Lindyson 积分。先估价，传入允许的 maxCredits 和稳定幂等键。返回任务 ID 后查询进度。`,
      'generation:write',
      kind === 'image' ? mcpImageInput : mcpVideoInput,
      async (payload) => {
        const tasks = await createGenerationTasksBatch({
          userId: identity.userId,
          mcpConnectionId: identity.connectionId,
          idempotencyKey: `mcp-generation-${hashSecret(payload.idempotencyKey)}`,
          maxCredits: payload.maxCredits,
          requests: payload.requests.map((request) => ({ ...request, kind })),
        });
        await Promise.all(
          tasks.map((task) =>
            enqueueGenerationTask(task.id, task.attempt, task.claimEpoch).catch(() => {
              console.error(
                JSON.stringify({ event: 'mcp-generation-enqueue-deferred', taskId: task.id }),
              );
            }),
          ),
        );
        return { tasks: tasks.map(toUserGenerationTask), pollAfterSeconds: 10 };
      },
      true,
    );
  tool(
    'list_tasks',
    '分页查询本人图片和视频生成任务。',
    'generation:read',
    pageInput,
    async (payload) => {
      const cursor = decodeCursor(payload.cursor);
      const result = await pool.query<{
        id: string;
        kind: string;
        status: string;
        model: string;
        created_at: Date;
      }>(
        `SELECT id,kind,status,model,created_at FROM generation_tasks WHERE user_id=$1 AND ($2::text IS NULL OR kind=$2)
       AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`,
        [
          identity.userId,
          payload.kind ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          payload.limit + 1,
        ],
      );
      return pageResult(result.rows, payload.limit, (row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        model: row.model,
        createdAt: new Date(row.created_at).toISOString(),
      }));
    },
  );
  tool(
    'get_task',
    '查询本人生成任务、积分状态和成品资产 ID。未完成时稍后继续查询。',
    'generation:read',
    idInput,
    async (payload) => {
      const task = await getGenerationTask(pool, payload.id, identity.userId);
      if (!task) throw mcpError('MCP_TASK_NOT_FOUND', '任务不存在', 404);
      return { task: toUserGenerationTask(task), pollAfterSeconds: 10 };
    },
  );
  tool(
    'get_result',
    '获取本人生成成品及短期下载链接；链接过期后重新调用。',
    'generation:read',
    idInput,
    async (payload) => {
      const task = await getGenerationTask(pool, payload.id, identity.userId);
      if (!task) throw mcpError('MCP_TASK_NOT_FOUND', '任务不存在', 404);
      if (!task.assetId) return { taskId: task.id, status: task.status, pollAfterSeconds: 10 };
      const issuedAt = Date.now();
      const download = await prepareOwnedAssetDownload(task.assetId, identity.userId);
      return {
        taskId: task.id,
        status: task.status,
        assetId: task.assetId,
        filename: download.filename,
        url: download.url,
        expiresAt: new Date(
          issuedAt + Math.min(env.TOS_READ_URL_EXPIRES_SECONDS, 300) * 1000,
        ).toISOString(),
        libraryUrl: new URL('/app/digital-assets', env.APP_BASE_URL).href,
      };
    },
    true,
    false,
    ['assets:read'],
  );
  // SDK 2.2 的默认列表会丢弃扩展主字段；用公开低层接口发布同一份描述，调用仍由 SDK 校验和执行。
  server.server.setRequestHandler('tools/list', () => ({ tools: toolDefinitions }));
  return server;
}

const cursorSchema = z.object({ createdAt: isoDateTimeSchema, id: uuidSchema }).strict();
function decodeCursor(value?: string) {
  if (!value) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw mcpError('MCP_CURSOR_INVALID', '分页游标无效');
  }
}
function pageResult<Row extends { id: string; created_at: Date | string }>(
  rows: Row[],
  limit: number,
  map: (row: Row) => unknown,
) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(map),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ id: last.id, createdAt: new Date(last.created_at).toISOString() }),
          ).toString('base64url')
        : null,
  };
}

function summarizeToolResult(name: string, result: Record<string, unknown>) {
  if (name === 'estimate_generation')
    return `本次预计消耗 ${result.totalCredits} 积分，提交时会按最新价格核对 maxCredits。`;
  if (name.startsWith('generate_'))
    return '生成任务已受理并预扣积分，请按任务 ID 查询；断开连接不会取消任务。';
  if (name === 'import_files')
    return '附件导入已受理，请使用导入 ID 查询，完成后再用资产 ID 生成。';
  if (name === 'get_import') return `附件导入状态：${result.status}。`;
  if (name === 'get_result')
    return result.url
      ? '生成结果已就绪，短期下载链接及有效期见结果数据。'
      : '生成结果尚未就绪，请稍后继续查询。';
  return '查询成功，详情见结构化结果。';
}
