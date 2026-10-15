import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const mcpKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });

const project = 'lindyson-integration';
const compose = ['compose', '-p', project];
const playwrightArgs = process.argv.slice(2);
// Compose 项目名固定，因此锁也必须位于不受 TMPDIR/TMP/TEMP 影响的固定宿主路径。
// 这样从不同终端或 Codex 任务启动时仍竞争同一个原子目录锁。
const lockDirectory = join('/tmp', `${project}-fullstack.lock`);
const lockOwnerPath = join(lockDirectory, 'owner.json');
const env = {
  ...process.env,
  FULLSTACK_COMPOSE_PROJECT: project,
  // 单机栈 + 测试叠加（mock 供应商、CN 第二入口）；spec 里的 docker compose 调用继承此变量。
  COMPOSE_FILE: 'docker-compose.yml:docker-compose.fullstack.yml',
  WEB_IMAGE: `${project}-frontend:local`,
  WEB_HTTP_PORT: '8080',
  WEB_CN_HTTP_PORT: '8081',
  // 全栈浏览器经 web 容器访问 API；独立宿主端口避免与并行的发布候选栈争用 4300。
  API_HOST_PORT: process.env.FULLSTACK_API_HOST_PORT ?? '14300',
  NODE_ENV: 'test',
  JWT_SECRET: 'Integration-R5L9hKx7-mQ2pV8z-N4cT6wY1sD3fG0jB',
  CORS_ORIGIN: [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://com.localhost:8080',
    'http://cn.localhost:8081',
  ].join(','),
  PUBLIC_BASE_URL: 'http://com.localhost:8080',
  APP_BASE_URL: 'http://com.localhost:8080',
  BOOTSTRAP_ADMIN_EMAIL: 'integration-admin@lindyson.test',
  BOOTSTRAP_ADMIN_PASSWORD: 'IntegrationAdmin2026!',
  ENABLE_FAKE_PROVIDER: 'true',
  MCP_ENABLED: 'true',
  MCP_PUBLIC_URL: 'http://com.localhost:8080/mcp',
  MCP_OAUTH_SECRET: randomBytes(32).toString('hex'),
  MCP_OAUTH_JWKS_JSON: JSON.stringify({ keys: [{ ...mcpKey, kid: 'fullstack', use: 'sig', alg: 'RS256' }] }),
  MCP_FILE_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  MCP_READ_RATE_PER_MINUTE: '600',
  MCP_GENERATE_RATE_PER_MINUTE: '60',
  REAL_PORTRAIT_PROVIDER_MODE: 'fake',
  REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY: 'Fullstack-Real-Portrait-Token-Key-2026!',
  REAL_PORTRAIT_CONTROLLER_NAME: 'Lindyson 全栈测试主体',
  REAL_PORTRAIT_PROCESSOR_NAME: '火山方舟测试替身',
  REAL_PORTRAIT_PRIVACY_CONTACT: 'privacy@lindyson.test',
  REAL_PORTRAIT_PRIVACY_POLICY_URL: 'https://lindyson.test/privacy',
  // 留出窗口，让测试可以在 providerTaskId 持久化后强制终止 Worker。
  FAKE_PROVIDER_DELAY_MS: '8000',
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 执行失败，退出码 ${result.status ?? 'unknown'}`);
  }
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readLockOwner() {
  try {
    return JSON.parse(readFileSync(lockOwnerPath, 'utf8'));
  } catch {
    return null;
  }
}

function acquireFullstackLock() {
  try {
    mkdirSync(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const owner = readLockOwner();
    const ownerRunning = Boolean(owner && isProcessRunning(Number(owner.pid)));
    throw new Error(
      ownerRunning
        ? `已有 fullstack 测试正在运行（PID ${owner.pid}，开始于 ${owner.startedAt ?? '未知时间'}），本次不会清理其 Docker 测试环境。`
        : `发现未释放的 fullstack 运行锁（${lockDirectory}）。为避免误删其他实例的 Docker 环境，本次拒绝自动接管；请先确认没有 fullstack 进程，再人工移除该锁。`,
    );
  }
  try {
    writeFileSync(lockOwnerPath, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cwd: process.cwd(),
    }), { mode: 0o600 });
  } catch (error) {
    rmSync(lockDirectory, { recursive: true, force: true });
    throw error;
  }
}

function releaseFullstackLock() {
  const owner = readLockOwner();
  if (Number(owner?.pid) !== process.pid) return;
  rmSync(lockDirectory, { recursive: true, force: true });
}

async function waitForSites() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const responses = await Promise.all([
        fetch('http://127.0.0.1:8080/api/ready'),
        fetch('http://127.0.0.1:8081/api/ready'),
      ]);
      if (responses.every(response => response.ok)) return;
    } catch {
      // 双入口或 API 容器仍在启动。
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error('全链路测试的 COM/CN 双入口在 120 秒内未就绪');
}

acquireFullstackLock();
try {
  run('docker', [...compose, 'down', '--volumes', '--remove-orphans']);
  run('docker', [...compose, 'up', '--detach', '--build']);
  await waitForSites();
  run('docker', [
    ...compose,
    'run', '--rm', '--no-deps',
    'migrate',
    'npm', '--workspace', 'apps/api', 'run', 'db:seed:prod',
  ]);
  run('docker', [
    ...compose,
    'run', '--rm', '--no-deps',
    '-e', `BOOTSTRAP_ADMIN_EMAIL=${env.BOOTSTRAP_ADMIN_EMAIL}`,
    '-e', `BOOTSTRAP_ADMIN_PASSWORD=${env.BOOTSTRAP_ADMIN_PASSWORD}`,
    'migrate',
    'npm', '--workspace', 'apps/api', 'run', 'db:bootstrap-admin:prod',
  ]);
  run('docker', [
    ...compose,
    'run', '--rm', '--no-deps',
    '-e', 'BOOTSTRAP_ADMIN_EMAIL=integration-owner-b@lindyson.test',
    '-e', 'BOOTSTRAP_ADMIN_PASSWORD=IntegrationOwnerB2026!',
    'migrate',
    'npm', '--workspace', 'apps/api', 'run', 'db:bootstrap-admin:prod',
  ]);
  run('npx', [
    'playwright', 'test', '--config', 'playwright.fullstack.config.ts', ...playwrightArgs,
  ]);
} finally {
  try {
    run('docker', [...compose, 'down', '--volumes', '--remove-orphans']);
  } finally {
    releaseFullstackLock();
  }
}
