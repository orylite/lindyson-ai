import { endpointContracts } from '@lindyson/api-contracts';
import { apiRequest, jsonBody } from './client';

export const getMcpConnections = (signal?: AbortSignal) =>
  apiRequest('/api/account/mcp', endpointContracts.mcpConnections.response, { signal });
export const revokeMcpConnection = (id: string) =>
  apiRequest(
    `/api/account/mcp/${encodeURIComponent(id)}`,
    endpointContracts.mcpConnectionRevoke.response,
    { method: 'DELETE' },
  );
export const getMcpInteraction = (id: string) =>
  apiRequest(
    `/api/mcp/interaction/${encodeURIComponent(id)}`,
    endpointContracts.mcpInteraction.response,
  );
export const submitMcpInteraction = (id: string, allow: boolean, csrfToken: string) =>
  apiRequest(
    `/api/mcp/interaction/${encodeURIComponent(id)}`,
    endpointContracts.mcpInteractionSubmit.response,
    { method: 'POST', body: jsonBody({ allow, csrfToken }) },
  );

export const MCP_SCOPE_LABELS: Record<string, string> = {
  'account:read': '查看账号、可用积分和模型价格',
  'assets:read': '读取本人素材及生成结果',
  'assets:write': '将所选聊天附件保存到本人素材库',
  'generation:write': '创建图片和视频，消耗 Lindyson 积分',
  'generation:read': '查看本人生成任务和进度',
};
