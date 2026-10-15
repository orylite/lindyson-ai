import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  expect,
  test,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';

const origin = 'http://com.localhost:8080';
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const scopes = 'account:read assets:read assets:write generation:write generation:read';
const local = (url: string) => url.replace(origin, 'http://127.0.0.1:8080');
const sql = (query: string) =>
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      process.env.FULLSTACK_COMPOSE_PROJECT ?? 'lindyson-integration',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'lindyson',
      '-d',
      'lindyson',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  ).trim();
const client = () =>
  playwrightRequest.newContext({
    baseURL: 'http://127.0.0.1:8080',
    extraHTTPHeaders: { Host: 'com.localhost:8080' },
  });
async function login(api: APIRequestContext, secondary = false) {
  const result = await api.post('/api/auth/login', {
    data: {
      email: secondary ? 'integration-owner-b@lindyson.test' : 'integration-admin@lindyson.test',
      password: secondary ? 'IntegrationOwnerB2026!' : 'IntegrationAdmin2026!',
    },
  });
  expect(result.status(), await result.text()).toBe(200);
  return (await result.json()).user;
}
async function register(api: APIRequestContext, callback = redirect) {
  const response = await api.post('/oauth/reg', {
    data: {
      client_name: 'Lindyson 集成验收',
      application_type: callback === redirect ? 'web' : 'native',
      redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).client_id as string;
}
async function authorize(
  api: APIRequestContext,
  clientId: string,
  options: { deny?: boolean; firstLogin?: boolean; scope?: string; callback?: string } = {},
) {
  const callbackUri = options.callback ?? redirect;
  const verifier = randomBytes(32).toString('base64url');
  const state = randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUri,
    response_type: 'code',
    scope: options.scope ?? scopes,
    resource: `${origin}/mcp`,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
    prompt: 'consent',
  });
  const start = await api.get(`/oauth/auth?${params}`, { maxRedirects: 0 });
  expect(start.status(), await start.text()).toBe(303);
  const consent = new URL(start.headers().location!);
  expect(consent.pathname).toBe('/mcp/authorize');
  const path = `/api/mcp/interaction/${consent.searchParams.get('interaction')}`;
  let details = await (await api.get(path)).json();
  if (options.firstLogin) {
    expect(details.loginRequired).toBe(true);
    await login(api);
    details = await (await api.get(path)).json();
  }
  expect(details.loginRequired, JSON.stringify(details)).toBe(false);
  expect(details.clientName).toBe(options.callback ? 'Codex' : 'ChatGPT');
  const invalidCsrf = await api.post(path, { data: { allow: true, csrfToken: 'invalid' } });
  expect(invalidCsrf.status()).toBe(403);
  const submit = await api.post(path, {
    data: { allow: !options.deny, csrfToken: details.csrfToken },
  });
  expect(submit.status(), await submit.text()).toBe(200);
  const resume = await api.get(local((await submit.json()).redirectUrl), { maxRedirects: 0 });
  expect(resume.status(), await resume.text()).toBe(303);
  const callback = new URL(resume.headers().location!);
  expect(callback.origin).toBe(new URL(callbackUri).origin);
  expect(callback.pathname).toBe(new URL(callbackUri).pathname);
  expect(callback.searchParams.get('iss')).toBe(`${origin}/oauth`);
  expect(callback.searchParams.get('state')).toBe(state);
  if (options.deny) {
    expect(callback.searchParams.get('error')).toBe('access_denied');
    return null;
  }
  expect(callback.searchParams.get('error'), callback.href).toBeNull();
  const token = await api.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: clientId,
      code: callback.searchParams.get('code')!,
      redirect_uri: callbackUri,
      code_verifier: verifier,
      resource: `${origin}/mcp`,
    },
  });
  expect(token.status(), await token.text()).toBe(200);
  const body = await token.json();
  expect(body.expires_in).toBe(900);
  expect(body.refresh_token).toBeTruthy();
  return body as { access_token: string; refresh_token: string };
}
async function rpc(api: APIRequestContext, token: string, method: string, params: unknown) {
  const response = await api.post('/mcp', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    data: { jsonrpc: '2.0', id: randomUUID(), method, params },
  });
  expect(response.status(), await response.text()).toBe(200);
  const text = await response.text();
  const body = response.headers()['content-type']?.includes('text/event-stream')
    ? JSON.parse(
        text
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .at(-1)!
          .slice(6),
      )
    : JSON.parse(text);
  expect(body.error, JSON.stringify(body)).toBeUndefined();
  return body.result;
}
const call = (api: APIRequestContext, token: string, name: string, args: unknown = {}) =>
  rpc(api, token, 'tools/call', { name, arguments: args });
const errorCode = (result: any) => {
  expect(result.isError, JSON.stringify(result)).toBe(true);
  return JSON.parse(result.content[0].text).code;
};

test('ChatGPT OAuth、积分幂等、任务隔离、撤销与账号安全版本', async ({ browser }) => {
  test.setTimeout(240_000);
  const api = await client();
  const other = await client();
  try {
    const unauth = await api.post('/mcp', { data: {} });
    expect(unauth.status()).toBe(401);
    expect(unauth.headers()['www-authenticate']).toContain('oauth-protected-resource/mcp');
    const metadata = await (await api.get('/.well-known/oauth-protected-resource/mcp')).json();
    expect(metadata.resource).toBe(`${origin}/mcp`);
    const bad = await api.post('/oauth/reg', {
      data: { redirect_uris: ['https://chatgpt.com.evil.invalid/callback'] },
    });
    expect(bad.status()).toBe(400);
    const clientId = await register(api);
    let token = (await authorize(api, clientId, { firstLogin: true }))!;
    await authorize(api, clientId, { deny: true });
    const discovery = await rpc(api, token.access_token, 'tools/list', {});
    expect(discovery.tools).toHaveLength(11);
    const toolScopes: Record<string, string[]> = {
      list_models: ['account:read'], get_account: ['account:read'],
      list_assets: ['assets:read'], import_files: ['assets:write'], get_import: ['assets:write'],
      estimate_generation: ['account:read'],
      generate_image: ['generation:write'], generate_video: ['generation:write'],
      list_tasks: ['generation:read'], get_task: ['generation:read'],
      get_result: ['generation:read', 'assets:read'],
    };
    for (const tool of discovery.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.securitySchemes).toEqual([{ type: 'oauth2', scopes: toolScopes[tool.name] }]);
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
    }
    expect(
      discovery.tools.find((item: any) => item.name === 'import_files')._meta['openai/fileParams'],
    ).toEqual(['files']);
    const original = token.access_token;
    const refreshExpiry = Number(
      sql(
        "SELECT floor(extract(epoch FROM max(expires_at))) FROM mcp_oauth_states WHERE kind='RefreshToken';",
      ),
    );
    // 跨越秒边界，确保测试能发现轮换后错误延长的寿命。
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const refreshed = await api.post('/oauth/token', {
      form: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: token.refresh_token,
        resource: `${origin}/mcp`,
      },
    });
    expect(refreshed.status(), await refreshed.text()).toBe(200);
    const next = await refreshed.json();
    expect(next.refresh_token).not.toBe(token.refresh_token);
    token = next;
    const rotatedExpiry = Number(
      sql(
        "SELECT floor(extract(epoch FROM max(expires_at))) FROM mcp_oauth_states WHERE kind='RefreshToken';",
      ),
    );
    expect(rotatedExpiry).toBeLessThanOrEqual(refreshExpiry + 1);
    const models = await call(api, token.access_token, 'list_models');
    expect(models.isError).toBeUndefined();
    const importOutput = execFileSync(
      'docker',
      [
        'compose',
        '-p',
        process.env.FULLSTACK_COMPOSE_PROJECT ?? 'lindyson-integration',
        'exec',
        '-T',
        'api',
        'node',
        '--input-type=module',
      ],
      {
        input: readFileSync(new URL('./mcpImports.runtime.mjs', import.meta.url)),
        encoding: 'utf8',
        timeout: 90_000,
      },
    );
    const imported = JSON.parse(importOutput.trim().split('\n').at(-1)!);
    expect(
      (await call(api, token.access_token, 'get_import', { id: imported.importId }))
        .structuredContent.assetId,
    ).toBe(imported.assetId);
    const ui = await browser.newContext();
    await ui.addCookies(
      (await api.storageState()).cookies.map((cookie) => ({ ...cookie, domain: 'com.localhost' })),
    );
    const page = await ui.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(`${origin}/app/account-center`);
    await page.getByRole('tab', { name: 'MCP 连接', exact: true }).click();
    await expect(page.getByRole('region', { name: 'ChatGPT 接入步骤' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Codex 接入步骤' })).toBeVisible();
    await expect(page.getByRole('link', { name: '查看 ChatGPT 官方接入说明' })).toHaveCount(0);
    await page.getByText('使用 Codex 命令行接入', { exact: true }).click();
    await expect(page.getByText(`codex mcp add lindyson --url ${origin}/mcp`, { exact: false })).toBeVisible();
    await page.screenshot({ path: 'artifacts/mcp/chatgpt-codex-connections.png', fullPage: true });
    await expect(page.getByText(`${origin}/mcp`, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '撤销授权', exact: true })).toHaveCount(1);
    await page.screenshot({ path: 'artifacts/mcp/account-connections.png', fullPage: true });
    const guideImage = page.getByRole('img', { name: 'Codex 添加 MCP 服务器界面，紫色编号 1 至 6 对应下方填写说明' });
    await guideImage.scrollIntoViewIfNeeded();
    await expect.poll(() => guideImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1790);
    const guide = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Codex 接入图解', exact: true }) }).filter({ has: page.getByRole('list', { name: 'Codex 截图标注说明' }) }).last();
    await guide.screenshot({ path: 'artifacts/mcp/codex-setup-guide-desktop.png' });
    await page.getByRole('button', { name: '放大查看', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Codex 接入图解大图' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Codex 接入图解大图' })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.getByRole('complementary', { name: '工作台导航', includeHidden: true }).evaluate((nav) => nav.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await page.getByRole('heading', { name: 'Codex 接入图解', exact: true }).scrollIntoViewIfNeeded();
    await expect.poll(() => guide.evaluate((card) => card.scrollWidth <= card.clientWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/mcp/codex-setup-guide-mobile.png', animations: 'disabled' });
    await page.getByRole('button', { name: '放大查看', exact: true }).click();
    await page.getByRole('button', { name: '关闭大图', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Codex 接入图解大图' })).toHaveCount(0);
    await ui.close();
    const userId = sql("SELECT id FROM users WHERE email='integration-admin@lindyson.test';");
    const seedKey = randomUUID();
    sql(
      `BEGIN; INSERT INTO credit_lots(user_id,bucket,source_type,source_event_key,original_amount,available_amount,held_amount) VALUES ('${userId}','addon','legacy','mcp-${seedKey}',10000,10000,0); UPDATE users SET addon_credits=addon_credits+10000 WHERE id='${userId}'; COMMIT;`,
    );
    sql(
      "UPDATE consumption_settings SET available=true WHERE kind='image' AND model='Seedream 5.0 Pro';",
    );
    const requests = [
      {
        model: 'Seedream 5.0 Pro',
        prompt: 'MCP 集成验收：蓝色背景上的白色纸飞机',
        config: { resolution: '2K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
        references: [{ assetId: imported.assetId, role: 'reference_image' }],
        annotations: [],
      },
    ];
    const estimate = await call(api, token.access_token, 'estimate_generation', {
      kind: 'image',
      requests,
    });
    expect(estimate.isError, JSON.stringify(estimate)).toBeUndefined();
    const credits = estimate.structuredContent.totalCredits;
    expect(credits).toBeGreaterThan(0);
    expect(
      errorCode(
        await call(api, token.access_token, 'generate_image', {
          idempotencyKey: randomUUID(),
          maxCredits: credits - 1,
          requests,
        }),
      ),
    ).toBe('GENERATION_CREDIT_LIMIT_EXCEEDED');
    const before = (await call(api, token.access_token, 'get_account')).structuredContent.credits;
    const payload = { idempotencyKey: randomUUID(), maxCredits: credits, requests };
    const submissions = await Promise.all([
      call(api, token.access_token, 'generate_image', payload),
      call(api, token.access_token, 'generate_image', payload),
    ]);
    expect(submissions[0].isError, JSON.stringify(submissions[0])).toBeUndefined();
    const taskId = submissions[0].structuredContent.tasks[0].id;
    expect(submissions[1].structuredContent.tasks[0].id).toBe(taskId);
    expect(
      errorCode(
        await call(api, token.access_token, 'generate_image', {
          ...payload,
          requests: [{ ...requests[0], prompt: 'changed' }],
        }),
      ),
    ).toBe('GENERATION_IDEMPOTENCY_CONFLICT');
    await expect
      .poll(
        async () =>
          (await call(api, token.access_token, 'get_task', { id: taskId })).structuredContent.task
            .status,
        { timeout: 60_000, intervals: [2000] },
      )
      .toBe('completed');
    const after = (await call(api, token.access_token, 'get_account')).structuredContent.credits;
    expect(before - after).toBe(credits);
    const result = (await call(api, token.access_token, 'get_result', { id: taskId }))
      .structuredContent;
    expect(Date.parse(result.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
    expect((await api.get(local(result.url))).ok()).toBe(true);
    // 图生视频沿用同一素材与网站参数，并验证供应商失败退款。
    const videoRequests = [
      {
        model: 'Seedance 2.0',
        prompt: '参考图片中的蓝色画面逐渐拉远',
        config: { mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
        references: [{ assetId: imported.assetId, role: 'reference_image' }],
      },
    ];
    const videoCost = (
      await call(api, token.access_token, 'estimate_generation', {
        kind: 'video',
        requests: videoRequests,
      })
    ).structuredContent.totalCredits;
    expect(
      errorCode(
        await call(api, token.access_token, 'generate_video', {
          idempotencyKey: payload.idempotencyKey,
          maxCredits: videoCost,
          requests: videoRequests,
        }),
      ),
    ).toBe('GENERATION_IDEMPOTENCY_CONFLICT');
    const video = (
      await call(api, token.access_token, 'generate_video', {
        idempotencyKey: randomUUID(),
        maxCredits: videoCost,
        requests: videoRequests,
      })
    ).structuredContent.tasks[0];
    await expect
      .poll(
        async () =>
          (await call(api, token.access_token, 'get_task', { id: video.id })).structuredContent.task
            .status,
        { timeout: 60_000, intervals: [2000] },
      )
      .toBe('completed');
    const refundBefore = (await call(api, token.access_token, 'get_account')).structuredContent
      .credits;
    const failed = (
      await call(api, token.access_token, 'generate_video', {
        idempotencyKey: randomUUID(),
        maxCredits: videoCost,
        requests: [{ ...videoRequests[0], prompt: '失败：模拟供应商拒绝' }],
      })
    ).structuredContent.tasks[0];
    await expect
      .poll(
        async () =>
          (await call(api, token.access_token, 'get_task', { id: failed.id })).structuredContent
            .task.creditStatus,
        { timeout: 60_000, intervals: [2000] },
      )
      .toBe('refunded');
    expect((await call(api, token.access_token, 'get_account')).structuredContent.credits).toBe(
      refundBefore,
    );
    await login(other, true);
    const otherToken = (await authorize(other, clientId))!;
    expect(errorCode(await call(other, otherToken.access_token, 'get_task', { id: taskId }))).toBe(
      'MCP_TASK_NOT_FOUND',
    );
    const otherAssets = (await call(other, otherToken.access_token, 'list_assets'))
      .structuredContent.items;
    expect(otherAssets.some((item: any) => item.id === result.assetId)).toBe(false);
    const missingRef = [
      { ...requests[0], references: [{ assetId: randomUUID(), role: 'reference_image' }] },
    ];
    expect(
      (
        await call(api, token.access_token, 'estimate_generation', {
          kind: 'image',
          requests: missingRef,
        })
      ).isError,
    ).toBe(true);
    expect(
      errorCode(
        await call(api, token.access_token, 'import_files', {
          idempotencyKey: randomUUID(),
          files: [{ file_id: 'private', download_url: 'https://127.0.0.1/secret' }],
        }),
      ),
    ).toBe('MCP_FILE_HOST_BLOCKED');
    const connections = (await (await api.get('/api/account/mcp')).json()).connections;
    const connection = connections.find((item: any) => item.active);
    expect(connection).toBeTruthy();
    expect((await other.delete(`/api/account/mcp/${connection.id}`)).status()).toBe(404);
    expect((await api.delete(`/api/account/mcp/${connection.id}`)).status()).toBe(200);
    for (const access of [original, token.access_token])
      expect(
        (
          await api.post('/mcp', { headers: { Authorization: `Bearer ${access}` }, data: {} })
        ).status(),
      ).toBe(401);
    expect(
      (
        await api.post('/oauth/token', {
          form: {
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: token.refresh_token,
          },
        })
      ).status(),
    ).toBe(400);
    const limited = (await authorize(api, clientId, { scope: 'account:read' }))!;
    expect(errorCode(await call(api, limited.access_token, 'list_tasks'))).toBe(
      'MCP_SCOPE_REQUIRED',
    );
    expect(
      (
        await api.post('/oauth/token/revocation', {
          form: {
            client_id: clientId,
            token: limited.refresh_token,
            token_type_hint: 'refresh_token',
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await api.post('/mcp', {
          headers: { Authorization: `Bearer ${limited.access_token}` },
          data: {},
        })
      ).status(),
    ).toBe(401);
    const securityToken = (await authorize(api, clientId))!;
    sql(`UPDATE users SET status='frozen' WHERE id='${userId}';`);
    expect(
      (
        await api.post('/mcp', {
          headers: { Authorization: `Bearer ${securityToken.access_token}` },
          data: {},
        })
      ).status(),
    ).toBe(401);
    sql(`UPDATE users SET status='active' WHERE id='${userId}';`);
    sql(`UPDATE users SET auth_version=auth_version+1 WHERE id='${userId}';`);
    expect(
      (
        await api.post('/mcp', {
          headers: { Authorization: `Bearer ${securityToken.access_token}` },
          data: {},
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await api.post('/oauth/token', {
          form: {
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: securityToken.refresh_token,
          },
        })
      ).status(),
    ).toBe(400);
  } finally {
    await api.dispose();
    await other.dispose();
  }
});

test('Codex 本机 OAuth 回调、客户端标识、读取、刷新与撤销', async () => {
  const api = await client();
  const callback = 'http://127.0.0.1:49152/callback';
  try {
    await login(api);
    for (const redirectUris of [
      ['http://192.168.1.1:49152/callback'],
      [callback, redirect],
    ]) {
      const rejected = await api.post('/oauth/reg', { data: { redirect_uris: redirectUris } });
      expect(rejected.status()).toBe(400);
    }
    const id = await register(api, callback);
    const wrongCallback = new URLSearchParams({
      client_id: id,
      redirect_uri: 'http://127.0.0.1:49152/callback/changed',
      response_type: 'code',
      scope: scopes,
      code_challenge: createHash('sha256').update(randomBytes(32)).digest('base64url'),
      code_challenge_method: 'S256',
    });
    expect((await api.get(`/oauth/auth?${wrongCallback}`, { maxRedirects: 0 })).status()).toBe(400);
    const token = (await authorize(api, id, { callback }))!;
    const discovery = await rpc(api, token.access_token, 'tools/list', {});
    expect(discovery.tools).toHaveLength(11);
    expect((await call(api, token.access_token, 'get_account')).isError).not.toBe(true);
    const connections = await (await api.get('/api/account/mcp')).json();
    const connection = connections.connections.find((item: any) => item.clientName === 'Codex' && item.active);
    expect(connection).toBeTruthy();
    const refresh = await api.post('/oauth/token', {
      form: { grant_type: 'refresh_token', client_id: id, refresh_token: token.refresh_token, resource: `${origin}/mcp` },
    });
    expect(refresh.status(), await refresh.text()).toBe(200);
    const refreshed = await refresh.json();
    expect(refreshed.refresh_token).not.toBe(token.refresh_token);
    expect((await api.delete(`/api/account/mcp/${connection.id}`)).status()).toBe(200);
    expect((await api.post('/mcp', {
      headers: { Authorization: `Bearer ${refreshed.access_token}` }, data: {},
    })).status()).toBe(401);
    expect((await api.post('/oauth/token', {
      form: { grant_type: 'refresh_token', client_id: id, refresh_token: refreshed.refresh_token },
    })).status()).toBe(400);
  } finally {
    await api.dispose();
  }
});

test('浏览器从授权页登录后返回确认，显示积分说明并可从账户中心撤销', async ({ browser }) => {
  const api = await client();
  const context = await browser.newContext();
  try {
    const id = await register(api);
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: scopes,
      resource: `${origin}/mcp`,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: randomUUID(),
    });
    const start = await api.get(`/oauth/auth?${params}`, { maxRedirects: 0 });
    expect(start.status()).toBe(303);
    await context.addCookies(
      (await api.storageState()).cookies.map((cookie) => ({ ...cookie, domain: 'com.localhost' })),
    );
    let callbackUrl = '';
    await context.route(`${origin}/oauth/auth/*`, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      callbackUrl = response.headers().location ?? '';
      expect(new URL(callbackUrl).origin).toBe('https://chatgpt.com');
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<p>测试回调已接收</p>',
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(start.headers().location!);
    await page.getByRole('button', { name: '登录 Lindyson', exact: true }).click();
    await page.getByLabel('邮箱', { exact: true }).fill('integration-admin@lindyson.test');
    await page.getByLabel('密码', { exact: true }).fill('IntegrationAdmin2026!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '连接 Lindyson 与 ChatGPT' })).toBeVisible();
    await expect(
      page.getByText('生成图片和视频将消耗你的 Lindyson 积分', { exact: false }),
    ).toBeVisible();
    await page.screenshot({ path: 'artifacts/mcp/authorization.png', fullPage: true });
    await page.getByRole('button', { name: '同意并连接', exact: true }).click();
    await expect(page.getByText('测试回调已接收')).toBeVisible();
    expect(new URL(callbackUrl).searchParams.get('code')).toBeTruthy();
    await page.goto(`${origin}/app/account-center`);
    await page.getByRole('tab', { name: 'MCP 连接', exact: true }).click();
    // 首个测试留下的授权因 auth_version 变更已失效，只有当前授权可撤销。
    const revokes = page.getByRole('button', { name: '撤销授权', exact: true });
    for (let count = await revokes.count(); count > 0; count = await revokes.count()) {
      await revokes.first().click();
      await expect(page.getByText('正在加载 MCP 连接')).not.toBeVisible();
      await expect(revokes).toHaveCount(count - 1);
    }
  } finally {
    await context.close();
    await api.dispose();
  }
});

test('空连接列表在外部授权后自动刷新，手动刷新保留内容且页面撤销立即生效', async ({ browser }) => {
  const api = await client();
  const context = await browser.newContext();
  const verificationId = randomUUID();
  const email = `mcp-refresh-${randomUUID()}@lindyson.test`;
  const verificationCode = '135790';
  const verificationSalt = 'mcp-refresh-registration';
  const verificationHash = createHash('sha256')
    .update(`${verificationSalt}:${verificationCode}`)
    .digest('hex');
  // 每次使用独立账户，避免历史授权记录影响“初次为空”的验收。
  sql(`
    INSERT INTO registration_verification_codes (
      id, email, user_name, code_hash, code_salt, expires_at
    ) VALUES (
      '${verificationId}', '${email}', 'MCP 刷新验收',
      '${verificationHash}', '${verificationSalt}', now() + interval '10 minutes'
    );
  `);
  let releaseRefresh: (() => void) | undefined;
  try {
    const registration = await api.post('/api/auth/register', {
      data: {
        userName: 'MCP 刷新验收',
        email,
        password: 'McpRefresh2026!',
        verificationId,
        verificationCode,
      },
    });
    expect(registration.status(), await registration.text()).toBe(200);
    await context.addCookies(
      (await api.storageState()).cookies.map((cookie) => ({ ...cookie, domain: 'com.localhost' })),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    let connectionReads = 0;
    page.on('request', (request) => {
      if (request.method() === 'GET' && request.url() === `${origin}/api/account/mcp`)
        connectionReads += 1;
    });
    await page.goto(`${origin}/app/account-center`);
    await page.getByRole('tab', { name: 'MCP 连接', exact: true }).click();
    const connectionsCard = page.getByRole('heading', { name: '已授权连接', exact: true })
      .locator('..').locator('..');
    await expect(connectionsCard.getByText('暂无连接', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '刷新连接', exact: true })).toBeEnabled();

    // 授权发生在独立客户端中，原账户页面始终保持打开。
    const callback = 'http://127.0.0.1:49153/callback';
    const clientId = await register(api, callback);
    const token = (await authorize(api, clientId, { callback }))!;
    await expect(connectionsCard.getByText('暂无连接', { exact: true })).toBeVisible();
    const readsBeforeReturn = connectionReads;
    await page.evaluate(() => {
      for (let index = 0; index < 4; index += 1) {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
    await expect(connectionsCard.getByText('Codex', { exact: true })).toBeVisible();
    await expect(connectionsCard.getByText('已连接', { exact: true })).toBeVisible();
    await expect(connectionsCard.getByText('暂无连接', { exact: true })).toHaveCount(0);
    // 超过防抖窗口，确认连续的返回事件没有形成第二次请求。
    await page.waitForTimeout(450);
    expect(connectionReads).toBe(readsBeforeReturn + 1);

    const guideImage = await page.getByRole('img', {
      name: 'Codex 添加 MCP 服务器界面，紫色编号 1 至 6 对应下方填写说明',
    }).elementHandle();
    expect(guideImage).not.toBeNull();
    const holdRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await page.route(`${origin}/api/account/mcp`, async (route) => {
      const response = await route.fetch();
      await holdRefresh;
      await route.fulfill({ response });
    }, { times: 1 });
    const readsBeforeManual = connectionReads;
    await page.getByRole('button', { name: '刷新连接', exact: true }).click();
    await expect(page.getByRole('button', { name: '刷新中…', exact: true })).toBeDisabled();
    await expect(connectionsCard.getByText('已连接', { exact: true })).toBeVisible();
    await expect(page.getByText('正在加载 MCP 连接', { exact: true })).toHaveCount(0);
    expect(await guideImage!.evaluate((image) => image.isConnected)).toBe(true);
    releaseRefresh!();
    await expect(page.getByRole('button', { name: '刷新连接', exact: true })).toBeEnabled();
    expect(connectionReads).toBe(readsBeforeManual + 1);
    expect(await guideImage!.evaluate((image) => image.isConnected)).toBe(true);

    const revokeResponse = page.waitForResponse((response) =>
      response.request().method() === 'DELETE' && response.url().startsWith(`${origin}/api/account/mcp/`),
    );
    const readsBeforeRevoke = connectionReads;
    await connectionsCard.getByRole('button', { name: '撤销授权', exact: true }).click();
    expect((await revokeResponse).status()).toBe(200);
    await expect(connectionsCard.getByText('已失效', { exact: true })).toBeVisible();
    await expect(connectionsCard.getByRole('button', { name: '撤销授权', exact: true })).toHaveCount(0);
    await expect.poll(() => connectionReads).toBe(readsBeforeRevoke + 1);
    await expect(page.getByRole('button', { name: '刷新连接', exact: true })).toBeEnabled();
    expect(await guideImage!.evaluate((image) => image.isConnected)).toBe(true);
    expect((await api.post('/mcp', {
      headers: { Authorization: `Bearer ${token.access_token}` }, data: {},
    })).status()).toBe(401);
    expect((await api.post('/oauth/token', {
      form: { grant_type: 'refresh_token', client_id: clientId, refresh_token: token.refresh_token },
    })).status()).toBe(400);
  } finally {
    releaseRefresh?.();
    await context.close();
    await api.dispose();
  }
});
