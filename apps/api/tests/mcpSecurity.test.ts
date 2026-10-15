import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/db/pool.js', () => ({ pool: { query: vi.fn() } }));
import { seal, unseal } from '../src/mcp/security.js';
import { isChatGptRedirect, isCodexRedirect, mcpClientLabel } from '../src/mcp/oauth.js';
import { assertMcpConfiguration } from '../src/config/env.js';

describe('MCP 授权与暂存密钥', () => {
  it('密文绑定用途与用户，篡改、错误密钥和跨用户均不能解密', () => {
    const text = 'https://files.example/image?secret=temporary';
    const encrypted = seal(text, 'independent-key', 'user-a:file-a');
    expect(encrypted).not.toContain('secret');
    expect(unseal(encrypted, 'independent-key', 'user-a:file-a')).toBe(text);
    expect(() => unseal(encrypted, 'independent-key', 'user-b:file-a')).toThrow();
    expect(() => unseal(encrypted, 'wrong-key', 'user-a:file-a')).toThrow();
    expect(() => unseal('X' + encrypted.slice(1), 'independent-key', 'user-a:file-a')).toThrow();
  });
  it.each([
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/client-123',
  ])('允许精确回调 %s', (value) => expect(isChatGptRedirect(value)).toBe(true));
  it.each([
    'http://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com.evil.test/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector_platform_oauth_redirect?next=evil',
    'https://chatgpt.com/connector/oauth/abc/extra',
    'https://user@chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector_platform_oauth_redirect#x',
  ])('拒绝非精确回调 %s', (value) => expect(isChatGptRedirect(value)).toBe(false));
  it.each([
    'http://127.0.0.1:49152/callback',
    'http://127.0.0.1:65535/callback/server_hash-123',
    'http://[::1]:5555/callback',
  ])('允许 Codex 本机回调 %s', (value) => expect(isCodexRedirect(value)).toBe(true));
  it.each([
    'http://localhost:5555/callback',
    'http://127.1:5555/callback',
    'http://2130706433:5555/callback',
    'http://127.0.0.1.evil.test:5555/callback',
    'http://192.168.1.1:5555/callback',
    'http://0.0.0.0:5555/callback',
    'http://[::ffff:127.0.0.1]:5555/callback',
    'https://127.0.0.1:5555/callback',
    'http://127.0.0.1/callback',
    'http://127.0.0.1:0/callback',
    'http://127.0.0.1:65536/callback',
    'http://127.0.0.1:5555/other/../callback',
    'http://127.0.0.1:5555/callback?next=https://evil.test',
    'http://127.0.0.1:5555/callback#fragment',
    'http://user@127.0.0.1:5555/callback',
    'http://127.0.0.1:5555/callback/server/extra',
  ])('拒绝不受支持的本机回调 %s', (value) => expect(isCodexRedirect(value)).toBe(false));
  it('客户端标签来自回调类型，不接受混合来源', () => {
    expect(mcpClientLabel(['https://chatgpt.com/connector/oauth/client-123'])).toBe('ChatGPT');
    expect(mcpClientLabel(['http://127.0.0.1:5555/callback'])).toBe('Codex');
    expect(mcpClientLabel()).toBe('MCP 客户端');
    expect(mcpClientLabel([
      'https://chatgpt.com/connector/oauth/client-123',
      'http://127.0.0.1:5555/callback',
    ])).toBe('MCP 客户端');
  });
  it('默认关闭时不要求密钥，生产环境禁止 HTTP 或跨源资源', () => {
    expect(() =>
      assertMcpConfiguration({
        MCP_ENABLED: false,
        APP_BASE_URL: 'https://lindyson.com',
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
    for (const url of [
      'http://localhost/mcp',
      'https://other.example/mcp',
      'https://lindyson.com/mcp?x=1',
    ])
      expect(() =>
        assertMcpConfiguration({
          MCP_ENABLED: true,
          MCP_PUBLIC_URL: url,
          APP_BASE_URL: 'https://lindyson.com',
          NODE_ENV: 'production',
        }),
      ).toThrow();
  });
});

it('过期令牌或错误资源受众在读取用户数据前被拒绝', async () => {
  const { authenticateMcp } = await import('../src/mcp/oauth.js');
  const { env } = await import('../src/config/env.js');
  const { pool } = await import('../src/db/pool.js');
  vi.mocked(pool.query).mockClear();
  for (const token of [
    { isExpired: true, aud: env.MCP_PUBLIC_URL, accountId: 'user:1', grantId: 'grant' },
    { isExpired: false, aud: 'https://other.example/mcp', accountId: 'user:1', grantId: 'grant' },
  ]) {
    const provider = { AccessToken: { find: vi.fn().mockResolvedValue(token) } };
    await expect(
      authenticateMcp(provider as never, 'Bearer expired-or-wrong-audience'),
    ).rejects.toMatchObject({ statusCode: 401, code: 'MCP_AUTH_INVALID' });
  }
  expect(pool.query).not.toHaveBeenCalled();
});

it('限流超额返回稳定错误', async () => {
  const { enforceMcpRateLimit } = await import('../src/mcp/security.js');
  const { pool } = await import('../src/db/pool.js');
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ calls: 61 }], rowCount: 1 } as never);
  await expect(enforceMcpRateLimit('query:user', 60)).rejects.toMatchObject({
    statusCode: 429,
    code: 'MCP_RATE_LIMITED',
  });
});
