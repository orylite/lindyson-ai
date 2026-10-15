import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync,readdirSync,readFileSync,statSync,writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants as zlibConstants,gzipSync } from 'node:zlib'
import { defineConfig,loadEnv,type Plugin } from 'vite'
import { DEFAULT_PAGE_METADATA } from './src/app/data/capabilities'
import { LANDING_CONTENT,createLandingSeo } from './src/app/data/landingContent'
import { PUBLIC_COMPLIANCE,type PublicComplianceConfig } from './src/app/data/publicCompliance'
import { renderLandingSnapshot,serializeLandingStructuredData,type LandingSnapshotOptions } from './src/app/seo/landingSnapshot'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const localPublicCompliancePath = path.resolve(rootDir, 'src/app/data/publicCompliance.local.json')
const buildId = process.env.APP_RELEASE_ID?.trim() || String(Date.now())
const builtAt = new Date().toISOString()

function escapeHtml(value: string) {
  return value
    .split('&').join('&amp;')
    .split('"').join('&quot;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
}

/** 读取正式站点的公示配置；不存在 publicCompliance.local.json 时回退到仓库模板。 */
function loadPublicCompliance(): PublicComplianceConfig {
  if (!existsSync(localPublicCompliancePath)) {
    if (process.env.NODE_ENV === 'production' || process.argv.includes('build')) {
      console.warn('[lindyson] 未找到 src/app/data/publicCompliance.local.json，页脚与法律文案将使用占位模板；正式站点请先创建该文件。')
    }
    return PUBLIC_COMPLIANCE
  }
  return JSON.parse(readFileSync(localPublicCompliancePath, 'utf8')) as PublicComplianceConfig
}

function productMetadata(snapshot: Required<LandingSnapshotOptions>): Plugin {
  const { content } = snapshot
  return {
      name: 'product-metadata',
      transformIndexHtml(html) {
        return html
          .split('__LINDYSON_PAGE_TITLE__').join(escapeHtml(DEFAULT_PAGE_METADATA.title))
          .split('__LINDYSON_PAGE_DESCRIPTION__').join(escapeHtml(DEFAULT_PAGE_METADATA.description))
          .split('__LINDYSON_CANONICAL_URL__').join(escapeHtml(content.seo.canonicalUrl))
          .split('__LINDYSON_SOCIAL_IMAGE_URL__').join(escapeHtml(content.seo.socialImageUrl))
          .split('__LINDYSON_STRUCTURED_DATA__').join(serializeLandingStructuredData(snapshot))
          .split('__LINDYSON_LANDING_SNAPSHOT__').join(renderLandingSnapshot(snapshot))
      },
    }
  }

  function appVersionManifest(): Plugin {
    return {
      name: 'app-version-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: `${JSON.stringify({ buildId, builtAt }, null, 2)}\n`,
        })
      },
    }
  }

  function dualHtmlShell(): Plugin {
    const rewriteDocumentRequest = (request: { method?: string;url?: string;headers: { accept?: string } }) => {
      if (!request.url || !['GET','HEAD'].includes(request.method ?? 'GET')) return;
      if (!request.headers.accept?.includes('text/html')) return;
      const url = new URL(request.url,'http://localhost');
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/app.html') return;
      if (url.pathname.startsWith('/api/') || url.pathname.split('/').pop()?.includes('.')) return;
      request.url = `/app.html${url.search}`;
    };

    return {
      name: 'dual-html-shell',
      configureServer(server) {
        server.middlewares.use((request,_response,next) => {
          rewriteDocumentRequest(request);
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request,_response,next) => {
          rewriteDocumentRequest(request);
          next();
        });
      },
    };
  }

  const PRECOMPRESS_EXTENSIONS = new Set(['.js','.css','.html','.json','.svg','.xml','.txt'])

  /** 构建后为文本资源生成最高压缩级别的 .gz，供 OpenResty gzip_static 直接返回，省去每次请求的实时压缩。 */
  function precompressAssets(): Plugin {
    let outDir = ''
    return {
      name: 'precompress-assets',
      apply: 'build',
      configResolved(config) {
        outDir = path.resolve(config.root, config.build.outDir)
      },
      closeBundle() {
        const walk = (dir: string) => {
          for (const name of readdirSync(dir)) {
            const file = path.join(dir, name)
            const stat = statSync(file)
            if (stat.isDirectory()) {
              walk(file)
              continue
            }
            if (stat.size < 1024 || !PRECOMPRESS_EXTENSIONS.has(path.extname(name))) continue
            const source = readFileSync(file)
            const compressed = gzipSync(source, { level: zlibConstants.Z_BEST_COMPRESSION })
            if (compressed.length < source.length) writeFileSync(`${file}.gz`, compressed)
          }
        }
        walk(outDir)
      },
    }
  }

  export default defineConfig(({ mode }) => {
    // 静态快照在 Node 里渲染，读不到浏览器侧的 import.meta.env，这里用 loadEnv 取同一套 VITE_ 变量。
    const env = loadEnv(mode, rootDir, 'VITE_')
    const snapshot: Required<LandingSnapshotOptions> = {
      content: { ...LANDING_CONTENT, seo: createLandingSeo(env.VITE_PUBLIC_SITE_URL ?? '') },
      compliance: loadPublicCompliance(),
    }

    return {
    define: {
      __LINDYSON_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [
      productMetadata(snapshot),
      appVersionManifest(),
      dualHtmlShell(),
      react(),
      tailwindcss(),
      precompressAssets(),
    ],
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(rootDir, './src') },
        // 存在正式站点配置时，用它替换仓库内的占位模板。别名匹配的是 publicCompliance.ts 里写的
        // 相对导入 './publicCompliance.json'，不是解析后的绝对路径。
        ...(existsSync(localPublicCompliancePath)
          ? [{ find: /^\.\/publicCompliance\.json$/, replacement: localPublicCompliancePath }]
          : []),
      ],
    },
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(rootDir, 'index.html'),
          app: path.resolve(rootDir, 'app.html'),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/')

            if (!normalizedId.includes('/node_modules/')) return undefined
            if (
              normalizedId.includes('/node_modules/react/') ||
              normalizedId.includes('/node_modules/react-dom/') ||
              normalizedId.includes('/node_modules/scheduler/')
            ) {
              return 'react-vendor'
            }
            if (
              normalizedId.includes('/node_modules/recharts/') ||
              normalizedId.includes('/node_modules/recharts-scale/') ||
              normalizedId.includes('/node_modules/react-smooth/') ||
              normalizedId.includes('/node_modules/lodash/') ||
              normalizedId.includes('/node_modules/decimal.js-light/') ||
              normalizedId.includes('/node_modules/fast-equals/') ||
              normalizedId.includes('/node_modules/eventemitter3/') ||
              normalizedId.includes('/node_modules/d3-') ||
              normalizedId.includes('/node_modules/victory-vendor/')
            ) {
              return 'charts'
            }
            // 首页只需要 React、动效和图标，动效单独成包，避免连带加载 zod、React Query 等工作台依赖。
            if (
              normalizedId.includes('/node_modules/motion/') ||
              normalizedId.includes('/node_modules/motion-dom/') ||
              normalizedId.includes('/node_modules/motion-utils/') ||
              normalizedId.includes('/node_modules/framer-motion/')
            ) {
              return 'motion'
            }
            if (normalizedId.includes('/node_modules/lucide-react/')) {
              return 'icons'
            }
            if (normalizedId.includes('/node_modules/sonner/')) {
              return 'feedback'
            }

            return 'vendor'
          },
        },
      },
    },
    server: {
      proxy: {
        '^/mcp$': { target: 'http://127.0.0.1:4300', changeOrigin: false },
        '/oauth': { target: 'http://127.0.0.1:4300', changeOrigin: false },
        '/.well-known/oauth-': { target: 'http://127.0.0.1:4300', changeOrigin: false },
        '/api': {
          target: 'http://127.0.0.1:4300',
          changeOrigin: true,
        },
      },
    },
  }
})
