import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import type { EndpointResponse } from '@lindyson/api-contracts';

type Connections = EndpointResponse<'mcpConnections'>;
const mcpUrl = 'https://www.lindyson.com/mcp';
const connectionId = '00000000-0000-4000-8000-000000000101';

function connection(clientName = 'Codex 测试连接', active = true): Connections['connections'][number] {
  return { id: connectionId, clientName, active, scopes: ['account:read'],
    createdAt: '2026-10-02T10:00:00.000Z', lastUsedAt: null, revokedAt: active ? null : '2026-10-02T11:00:00.000Z' };
}

function user(email: string) {
  return {
    id: email.startsWith('second') ? '00000000-0000-4000-8000-000000000002' : '00000000-0000-4000-8000-000000000001',
    userName: email.startsWith('second') ? '第二位用户' : 'MCP 测试用户', email, role: 'user', status: 'active',
    planCode: 'free', planName: '免费版', billingCycle: 'monthly',
    portraitEntitlements: { enabled: true, profileLimit: 1, activeLimit: 1, assetsPerActor: 1 },
    mainCredits: 100, addonCredits: 0, credits: 100, totalCredits: 100,
    planResetAt: null, planExpiresAt: null, registeredAt: '2026-10-01T00:00:00.000Z', lastActiveAt: '2026-10-02T00:00:00.000Z',
  };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function json(route: Route, body: unknown, status = 200) {
  const response = status >= 400 && body !== null && typeof body === 'object'
    ? { code: `HTTP_${status}`, requestId: `mcp-e2e-${status}`, ...body }
    : body;
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) });
}

async function installMocks(context: BrowserContext) {
  const state = {
    email: 'first@lindyson.test',
    data: { enabled: true, url: mcpUrl, connections: [] } as Connections,
    reads: 0, deletes: 0, failReads: false, failDelete: false,
    nextRead: null as ReturnType<typeof gate> | null,
    nextDelete: null as ReturnType<typeof gate> | null,
  };
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    if (url.pathname === '/api/account/mcp' && request.method() === 'GET') {
      state.reads += 1;
      const body = structuredClone(state.data);
      const pending = state.nextRead;
      state.nextRead = null;
      if (pending) await pending.promise;
      await json(route, state.failReads ? { message: '测试连接服务暂不可用' } : body, state.failReads ? 503 : 200);
      return;
    }
    if (url.pathname === `/api/account/mcp/${connectionId}` && request.method() === 'DELETE') {
      state.deletes += 1;
      const pending = state.nextDelete;
      state.nextDelete = null;
      if (pending) await pending.promise;
      if (state.failDelete) await json(route, { message: '测试撤销失败' }, 503);
      else {
        state.data.connections = state.data.connections.map(item => ({ ...item, active: false, revokedAt: '2026-10-02T11:00:00.000Z' }));
        await json(route, { ok: true });
      }
      return;
    }
    if (url.pathname === '/api/auth/login') {
      state.email = request.postDataJSON().email;
      await json(route, { user: user(state.email) });
      return;
    }
    if (url.pathname === '/api/auth/me') { await json(route, { user: user(state.email) }); return; }
    if (url.pathname === '/api/subscription/plans' || url.pathname === '/api/announcements') {
      await json(route, { items: [] }); return;
    }
    if (url.pathname === '/api/account/feature-flags') {
      await json(route, { flags: { tiktokAccounts: false, tiktokPublish: false } }); return;
    }
    if (url.pathname === '/api/support/summary') {
      await json(route, { unreadTickets: 0, openTickets: 0, asOf: '2026-10-02T00:00:00.000Z' }); return;
    }
    if (url.pathname === '/api/account/credit-ledger') {
      await json(route, { items: [], pagination: { limit: 20, hasPrevious: false, hasNext: false,
        previousCursor: null, nextCursor: null, currentPage: 0, totalPages: 0, totalItems: 0, snapshotCursor: 'empty' } }); return;
    }
    if (url.pathname === '/api/account/dashboard-summary') {
      await json(route, { summary: { totalGenerations: 0, videoGenerations: 0, imageGenerations: 0 },
        trend: [], modelUsage: [], recentProjects: [], timezone: 'Asia/Shanghai' }); return;
    }
    throw new Error(`未配置测试接口：${request.method()} ${url.pathname}`);
  });
  return state;
}

async function openConnections(page: Page) {
  await page.goto('/app/account-center');
  await page.getByRole('tab', { name: 'MCP 连接' }).click();
  await expect(page.getByRole('heading', { name: '已授权连接' })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新连接', exact: true })).toBeEnabled();
}

async function focusBurst(page: Page) {
  await page.evaluate(() => {
    for (let index = 0; index < 5; index += 1) {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });
}

test('MCP 返回窗口自动发现新授权，连续事件合并且共享在途请求', async ({ page, context }) => {
  const state = await installMocks(context);
  await openConnections(page);
  await expect(page.getByText('暂无连接', { exact: true })).toBeVisible();
  const baseline = state.reads;
  state.data.connections = [connection()];
  const pending = gate();
  state.nextRead = pending;
  await focusBurst(page);
  await expect.poll(() => state.reads).toBe(baseline + 1);
  await focusBurst(page);
  await page.waitForTimeout(350);
  expect(state.reads).toBe(baseline + 1);
  await expect(page.getByRole('button', { name: '刷新中…', exact: true })).toBeDisabled();
  pending.release();
  await expect(page.getByText('Codex 测试连接', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无连接', { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(350);
  expect(state.reads).toBe(baseline + 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => state.reads).toBe(baseline + 2);
});

test('MCP 手动刷新保留图解、旧连接和滚动位置，失败后可重试', async ({ page, context }) => {
  const state = await installMocks(context);
  state.data.connections = [connection()];
  await openConnections(page);
  const refresh = page.getByRole('button', { name: '刷新连接', exact: true });
  await refresh.scrollIntoViewIfNeeded();
  const scrollPositions = () => page.evaluate(() => [document.scrollingElement, ...document.querySelectorAll('main, main *')]
    .filter((element): element is Element => element !== null && element.scrollTop > 0)
    .map(element => element.scrollTop));
  const before = await scrollPositions();
  expect(before.some(value => value > 0)).toBe(true);
  const pending = gate();
  state.nextRead = pending;
  state.failReads = true;
  await refresh.click();
  await expect(page.getByRole('button', { name: '刷新中…', exact: true })).toBeDisabled();
  await expect(page.getByText('Codex 测试连接', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Codex 接入图解' })).toHaveCount(1);
  expect(await scrollPositions()).toEqual(before);
  pending.release();
  await expect(page.getByRole('alert').filter({ hasText: '连接刷新失败' })).toBeVisible();
  await expect(page.getByText('Codex 测试连接', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Codex 接入图解' })).toHaveCount(1);
  state.failReads = false;
  state.data.connections = [connection('已更新的连接')];
  await refresh.click();
  await expect(page.getByText('已更新的连接', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '连接刷新失败' })).toHaveCount(0);
});

test('MCP 首次加载失败可重试恢复', async ({ page, context }) => {
  const state = await installMocks(context);
  state.failReads = true;
  await page.goto('/app/account-center');
  await page.getByRole('tab', { name: 'MCP 连接' }).click();
  await expect(page.getByRole('alert')).toContainText('测试连接服务暂不可用');
  state.failReads = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('暂无连接', { exact: true })).toBeVisible();
});

test('MCP 撤销取消旧查询，撤销期间不刷新且延迟旧响应不能恢复授权', async ({ page, context }) => {
  const state = await installMocks(context);
  state.data.connections = [connection()];
  await openConnections(page);
  let canceledReads = 0;
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/api/account/mcp') canceledReads += 1;
  });
  const stale = gate();
  state.nextRead = stale;
  const baseline = state.reads;
  await page.getByRole('button', { name: '刷新连接', exact: true }).click();
  await expect.poll(() => state.reads).toBe(baseline + 1);
  const deletion = gate();
  state.nextDelete = deletion;
  await page.getByRole('button', { name: '撤销授权', exact: true }).click();
  await expect.poll(() => state.deletes).toBe(1);
  await expect.poll(() => canceledReads).toBe(1);
  await focusBurst(page);
  await page.waitForTimeout(350);
  expect(state.reads).toBe(baseline + 1);
  await expect(page.getByRole('button', { name: '刷新连接', exact: true })).toBeDisabled();
  const finalRead = gate();
  state.nextRead = finalRead;
  deletion.release();
  await expect(page.getByText('已失效', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销授权', exact: true })).toHaveCount(0);
  await expect.poll(() => state.reads).toBe(baseline + 2);
  stale.release();
  finalRead.release();
  await expect(page.getByRole('button', { name: '刷新连接', exact: true })).toBeEnabled();
  await expect(page.getByText('已失效', { exact: true })).toBeVisible();
  await expect(page.getByText('已连接', { exact: true })).toHaveCount(0);
});

test('MCP 撤销失败保留连接并恢复刷新能力', async ({ page, context }) => {
  const state = await installMocks(context);
  state.data.connections = [connection()];
  state.failDelete = true;
  await openConnections(page);
  await page.getByRole('button', { name: '撤销授权', exact: true }).click();
  await expect(page.getByText('测试撤销失败', { exact: true })).toBeVisible();
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销授权', exact: true })).toBeEnabled();
  const before = state.reads;
  await page.getByRole('button', { name: '刷新连接', exact: true }).click();
  await expect.poll(() => state.reads).toBeGreaterThan(before);
});

test('MCP 离开分区取消旧请求和防抖，重新进入读取最新连接', async ({ page, context }) => {
  const state = await installMocks(context);
  await openConnections(page);
  let canceledReads = 0;
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/api/account/mcp') canceledReads += 1;
  });
  const pending = gate();
  state.nextRead = pending;
  const baseline = state.reads;
  await page.getByRole('button', { name: '刷新连接', exact: true }).click();
  await expect.poll(() => state.reads).toBe(baseline + 1);
  await page.getByRole('tab', { name: '账户概览' }).click();
  await expect.poll(() => canceledReads).toBe(1);
  pending.release();
  await focusBurst(page);
  await page.waitForTimeout(350);
  expect(state.reads).toBe(baseline + 1);
  state.data.connections = [connection('重新进入后的连接')];
  await page.getByRole('tab', { name: 'MCP 连接' }).click();
  await expect(page.getByText('重新进入后的连接', { exact: true })).toBeVisible();
  const beforeLeaving = state.reads;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    (Array.from(document.querySelectorAll('[role="tab"]')).find(element => element.textContent?.includes('账户概览')) as HTMLElement).click();
  });
  await expect(page.getByRole('heading', { name: '已授权连接' })).toHaveCount(0);
  await page.waitForTimeout(350);
  expect(state.reads).toBe(beforeLeaving);
});

test('MCP 跨标签切换账号取消旧查询，旧连接不会写入新会话', async ({ page, context }) => {
  const state = await installMocks(context);
  state.data.connections = [connection('第一位用户的连接')];
  await openConnections(page);
  const pending = gate();
  state.nextRead = pending;
  const baseline = state.reads;
  await page.getByRole('button', { name: '刷新连接', exact: true }).click();
  await expect.poll(() => state.reads).toBe(baseline + 1);
  const second = await context.newPage();
  await second.goto('/login');
  state.data.connections = [connection('第二位用户的连接')];
  await second.getByLabel('邮箱', { exact: true }).fill('second@lindyson.test');
  await second.getByLabel('密码', { exact: true }).fill('MockPassword123!');
  await second.getByRole('button', { name: '登录', exact: true }).click();
  await expect(second).toHaveURL(/\/app$/);
  await expect(page).toHaveURL(/\/app$/);
  pending.release();
  await expect(page.getByText('第一位用户的连接', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /第二位用户.*账户中心/ }).click();
  await page.getByRole('tab', { name: 'MCP 连接' }).click();
  await expect(page.getByText('第二位用户的连接', { exact: true })).toBeVisible();
  await expect(page.getByText('第一位用户的连接', { exact: true })).toHaveCount(0);
  await second.close();
});

for (const width of [1440, 390, 320]) {
  test(`MCP 图解复制图标在真实工作台 ${width}px 宽度下居中并能复制`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await installMocks(context);
    await openConnections(page);
    const copy = page.getByRole('button', { name: '复制图解中的 MCP 地址', exact: true });
    await copy.scrollIntoViewIfNeeded();
    const geometry = await copy.evaluate(button => {
      const text = button.parentElement!.querySelector('code')!;
      const textBox = text.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      const iconBox = button.querySelector('svg')!.getBoundingClientRect();
      return {
        productShell: Boolean(button.closest('.product-shell')),
        buttonHeight: buttonBox.height,
        centerDifference: Math.abs(iconBox.y + iconBox.height / 2 - textBox.y - textBox.height / 2),
        textHeight: textBox.height, lineHeight: Number.parseFloat(getComputedStyle(text).lineHeight),
        rightEdge: buttonBox.right, viewport: window.innerWidth,
      };
    });
    expect(geometry.productShell).toBe(true);
    expect(geometry.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.centerDifference).toBeLessThan(1);
    expect(geometry.rightEdge).toBeLessThanOrEqual(geometry.viewport);
    if (width === 320) expect(geometry.textHeight).toBeGreaterThan(geometry.lineHeight * 1.5);
    await copy.click();
    await expect(page.getByText('MCP 地址已复制', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(mcpUrl);
    await page.screenshot({ path: testInfo.outputPath(`mcp-copy-${width}.png`) });
  });
}
