import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import type { PublicComplianceConfig } from '../../src/app/data/publicCompliance';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Playwright 不经过 Vite 别名，这里按与 vite.config.ts 相同的规则选择配置文件：
// 存在 publicCompliance.local.json 时用它，否则用仓库模板。
export function loadPublicComplianceForTests(): PublicComplianceConfig {
  const localPath = `${repoRoot}src/app/data/publicCompliance.local.json`;
  const templatePath = `${repoRoot}src/app/data/publicCompliance.json`;
  const chosen = existsSync(localPath) ? localPath : templatePath;
  return JSON.parse(readFileSync(chosen, 'utf8')) as PublicComplianceConfig;
}

// e2e 的 webServer 是 `npm run dev`（development 模式），读取同一套 .env / .env.local 里的 VITE_ 变量。
export function loadViteEnvForTests(): Record<string, string> {
  return loadEnv('development', repoRoot, 'VITE_');
}

export function expectedPublicSiteUrl(env = loadViteEnvForTests()): string {
  const trimmed = (env.VITE_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '');
  return `${trimmed || 'https://www.lindyson.com'}/`;
}
