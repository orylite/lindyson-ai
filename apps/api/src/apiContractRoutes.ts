import { apiErrorResponseSchema, getEndpointContract } from '@lindyson/api-contracts';
import type { FastifyInstance, FastifySchema } from 'fastify';

/**
 * 这些路由其传输协议而不是 JSON API 契约管理。新增豁免必须在此显式说明原因。
 */
export const nonJsonApiRouteExemptions = new Map<string, string>([
  ['POST /api/payments/notify', '支付 Provider 回调并返回 text/plain'],
  ['POST /api/payments/refunds/notify', '退款 Provider 回调并返回 text/plain'],
  ['POST /api/providers/ark/callback/:token', '方舟 Provider 回调字段由供应商控制，仅用于唤醒官方查单'],
  ['GET /api/providers/volc/real-portrait-validation/:opaqueNonce', '火山真人 H5 使用浏览器 GET 回跳，处理后返回 303 到无凭证完成页'],
  ['GET /api/assets/:id/download', '返回 302 下载重定向'],
  ['PUT /api/storage/local/*', '对象存储原始字节流上传，成功返回 204'],
  ['GET /api/storage/local/*', '对象存储文件流下载'],
]);

/**
 * 为所有第一方 JSON 路由自动挂载共享 Schema。在注册时就对缺失契约的
 * `/api/**` 路由 fail-fast，因此新路由不能静默绕过响应校验。
 */
export function registerApiContractRouteHook(app: FastifyInstance) {
  app.addHook('onRoute', routeOptions => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    const contractMethods = methods
      .map(method => String(method).toUpperCase())
      // Fastify 会自动为 GET 注册 HEAD；HEAD 不发送 JSON body。
      .filter(method => method !== 'HEAD');

    if (!routeOptions.url.startsWith('/api/') || contractMethods.length === 0) return;

    const contracts = contractMethods.map(method => {
      const routeKey = `${method} ${routeOptions.url}`;
      const contract = getEndpointContract(method, routeOptions.url);
      if (contract) return contract;
      if (nonJsonApiRouteExemptions.has(routeKey)) return null;
      throw new Error(`第一方 JSON 路由缺少共享 API 契约: ${routeKey}`);
    }).filter(contract => contract !== null);

    if (contracts.length === 0) return;
    if (contracts.length !== 1) {
      throw new Error(`同一路由不能挂载多个 JSON API 契约: ${routeOptions.url}`);
    }

    const contract = contracts[0]!;
    const currentSchema = routeOptions.schema ?? {};
    const currentResponse = isRecord(currentSchema.response) ? currentSchema.response : {};
    routeOptions.schema = {
      ...currentSchema,
      ...(contract.body ? { body: contract.body } : {}),
      ...(contract.query ? { querystring: contract.query } : {}),
      ...(contract.params ? { params: contract.params } : {}),
      response: {
        ...currentResponse,
        default: apiErrorResponseSchema,
        [contract.successStatus]: contract.response,
      },
    } satisfies FastifySchema;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
