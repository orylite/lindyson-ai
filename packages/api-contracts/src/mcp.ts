import { z } from 'zod';
import {
  isoDateTimeSchema,
  nullableIsoDateTimeSchema,
  okResponseSchema,
  uuidParamsSchema,
} from './primitives.js';

export const mcpConnectionSchema = z.object({
  id: z.string().uuid(),
  clientName: z.string().default('MCP 客户端'),
  scopes: z.array(z.string()),
  createdAt: isoDateTimeSchema,
  lastUsedAt: nullableIsoDateTimeSchema,
  revokedAt: nullableIsoDateTimeSchema,
  active: z.boolean(),
});
export const mcpEndpointContracts = {
  mcpConnections: {
    method: 'GET',
    path: '/api/account/mcp',
    successStatus: 200,
    response: z.object({
      enabled: z.boolean(),
      url: z.string().url().nullable(),
      connections: z.array(mcpConnectionSchema),
    }),
  },
  mcpConnectionRevoke: {
    method: 'DELETE',
    path: '/api/account/mcp/:id',
    successStatus: 200,
    params: uuidParamsSchema,
    response: okResponseSchema,
  },
  mcpInteraction: {
    method: 'GET',
    path: '/api/mcp/interaction/:id',
    successStatus: 200,
    params: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).strict(),
    response: z.object({
      id: z.string(),
      clientName: z.string().default('MCP 客户端'),
      loginRequired: z.boolean(),
      email: z.string().nullable(),
      scopes: z.array(z.string()),
      csrfToken: z.string().nullable(),
    }),
  },
  mcpInteractionSubmit: {
    method: 'POST',
    path: '/api/mcp/interaction/:id',
    successStatus: 200,
    params: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).strict(),
    body: z.object({ allow: z.boolean(), csrfToken: z.string().min(1).max(128) }).strict(),
    response: z.object({ redirectUrl: z.string().url() }),
  },
} as const;
