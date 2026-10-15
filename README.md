# Lindyson AI

面向电商与短视频团队的 AI 内容创作工作台：用火山引擎方舟的 Seedance 生成商品视频、Seedream 生成和编辑商品图，沉淀数字资产，管理积分与订阅，并通过 MCP 让 ChatGPT、Codex 等客户端直接调用生成能力。

> English: Lindyson AI is an AI video and image generation workspace for e-commerce teams, built on Volcengine Ark (Seedance / Seedream). It ships a React front end, a Fastify API with a BullMQ worker, PostgreSQL, Redis, credit-based billing, an admin console, and an MCP server with OAuth. Chinese is the primary language of the UI and docs.

## 功能

- **AI Studio**：文生视频、图生视频、参考素材复用、商品图生成与交互式编辑，提示词向导把商品信息转成分镜脚本。
- **数字资产**：上传、文件夹、缩略图、批量操作，图片与视频统一管理。
- **积分与订阅**：套餐、加购包、积分流水、订单与发票，支付通过 Jeepay 网关接入。
- **管理后台**：用户、订单、工单、公告、支付通道、供应商用量与成本报表。
- **MCP 接入**：标准 MCP 服务端加 OAuth 2.1 动态注册与 PKCE，ChatGPT 与 Codex 可直接导入素材并发起生成，见 [MCP_CHATGPT.md](MCP_CHATGPT.md)。
- **真人演员库**：真人肖像授权、活体校验与撤回流程，敏感信息加密存储。

## 架构

```
浏览器 ──▶ 前端（Vite + React，静态文件，由 nginx / OpenResty 托管）
             │  /api/、/mcp
             ▼
          API（Fastify，apps/api）──▶ PostgreSQL 16
             │                     ──▶ Redis 7（BullMQ 队列）
             ▼
          worker（apps/api/src/worker）──▶ 火山引擎方舟（Seedance / Seedream）
                                      ──▶ 对象存储（火山 TOS 或本地磁盘）
```

| 目录 | 内容 |
|---|---|
| `src/` | 前端。`index.html` → `src/landing.tsx` 是落地页；`app.html` → `src/main.tsx` 是登录后的工作台与后台 |
| `apps/api/` | API、worker、数据库迁移（`migrations/`）、运维工具（`src/tools/`） |
| `packages/api-contracts/` | 前后端共享的 zod 契约 |
| `tests/` | Playwright 端到端测试与 Docker 全栈测试 |
| `scripts/` | 全栈测试编排、公开合规配置校验、百度收录提交 |

## 快速开始

前置条件：Node.js 22 或更新、Docker。没有火山引擎账号也能跑通全流程，`ENABLE_FAKE_PROVIDER=true` 时 worker 会用假供应商生成占位结果。

```bash
npm i
cp .env.example .env
```

按 `.env.example` 的注释填写 `.env`。本地最小配置：`JWT_SECRET` 随便设一个长随机串，`STORAGE_DRIVER=local`，`ENABLE_FAKE_PROVIDER=true`，其余留空。

启动 PostgreSQL 和 Redis（也可以用自己的实例，改 `DATABASE_URL` 和 `REDIS_URL`）：

```bash
docker compose up -d postgres redis
```

初始化数据库并创建管理员（管理员邮箱和密码取自 `BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_PASSWORD`）：

```bash
npm run db:migrate && npm run db:bootstrap-admin
```

分别在三个终端启动 API、worker 和前端：

```bash
npm run dev:api
```

```bash
npm run dev:worker
```

```bash
npm run dev
```

前端在 `http://localhost:5173`，API 在 `http://localhost:4300`，开发服务器会把 `/api/` 代理到 API。

## 配置

所有服务端配置都走环境变量，完整清单和说明见 [.env.example](.env.example)。几个要点：

- **供应商**：`ARK_API_KEY` 与各模型 ID 用于视频和图片生成；`TOS_*` 用于对象存储，本地开发可用 `STORAGE_DRIVER=local`。
- **安全**：`JWT_SECRET`、`MCP_OAUTH_SECRET`、`MCP_FILE_ENCRYPTION_KEY`、`REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY`、`PAYMENT_CONFIG_ENCRYPTION_KEY` 必须是强随机值；生产环境会拒绝已知的弱默认值。
- **反向代理**：API 只应监听本机，公网经反向代理进入。`TRUST_PROXY` 填反向代理的地址或 CIDR（例如 `127.0.0.1,::1`）或跳数；不要在 API 端口可直连时设为 `true`，否则客户端可伪造来源 IP 绕过限流。
- **前端构建期变量**（`VITE_` 前缀，可写在 `.env.local`）：`VITE_PUBLIC_SITE_URL` 是正式站点地址，用于 canonical 和社交分享；`VITE_SUPPORT_QR_URL` 是客服二维码图片地址，留空则不显示。`VITE_SEEDREAM_TUTORIAL_MEDIA_BASE_URL` 指向 Seedream 教程演示媒体所在目录，这些媒体是火山引擎官方素材，不随仓库分发，留空则弹窗只显示文字与官方链接。
- **运营主体与备案公示**：页脚和法律文案读取 `src/app/data/publicCompliance.json`。仓库里的是占位模板，正式站点把真实信息写到同目录的 `publicCompliance.local.json`（已被 git 忽略），构建时自动替换；`npm run check:public-compliance` 校验该文件是否完整。
- `public/robots.txt` 与 `public/sitemap.xml` 里的域名需要按自己的站点修改。

## 开发命令

| 命令 | 作用 |
|---|---|
| `npm run typecheck` / `npm run typecheck:api` | 前端 / API 类型检查 |
| `npm run test:unit` | 前端与契约包单元测试（Vitest） |
| `npm run check:api` | API 类型检查与单元测试 |
| `npm run test:e2e` | Playwright 端到端测试（走 mock API） |
| `npm run test:fullstack` | 用 `docker-compose.yml` 加 `docker-compose.fullstack.yml` 起一套真实 PostgreSQL、Redis、API、worker 与浏览器链路 |
| `npm run build` / `npm run build:api` | 生产构建；前端构建会为文本资源额外生成 `.gz` |
| `npm run check` | 以上全部，发布前跑一遍 |

## 单机部署

一台 2 核 4G 的机器就够跑：PostgreSQL、Redis、API、worker、前端 nginx 全在一个 `docker compose` 里。

```bash
git clone <本仓库地址> lindyson && cd lindyson
```

```bash
cp .env.example .env
```

编辑 `.env`，至少填这些：

| 变量 | 填什么 |
|---|---|
| `JWT_SECRET`、`MCP_OAUTH_SECRET`、`MCP_FILE_ENCRYPTION_KEY`、`REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY`、`PAYMENT_CONFIG_ENCRYPTION_KEY` | 各自生成一个长随机串，不要复用 |
| `POSTGRES_PASSWORD` | 数据库口令 |
| `PUBLIC_BASE_URL`、`APP_BASE_URL`、`CORS_ORIGIN` | 都填你的站点地址，例如 `https://ai.example.com` |
| `VITE_PUBLIC_SITE_URL` | 同上，用于前端构建 |
| `ARK_API_KEY`、`TOS_*` | 火山引擎方舟与对象存储；先试用可以 `ENABLE_FAKE_PROVIDER=true` 且 `STORAGE_DRIVER=local` |
| `BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_PASSWORD` | 第一个管理员账号 |

把运营主体和备案信息写到 `src/app/data/publicCompliance.local.json`（复制同目录模板改），然后启动：

```bash
docker compose up -d --build
```

创建管理员：

```bash
docker compose run --rm --no-deps migrate npm --workspace apps/api run db:bootstrap-admin:prod
```

浏览器打开 `http://你的服务器` 即可。`docker compose up` 会自动跑数据库迁移；升级版本时 `git pull` 后再执行一次 `docker compose up -d --build`。

**HTTPS**：最省事的是在前面放一个 Caddy，`Caddyfile` 两行：

```
ai.example.com {
    reverse_proxy 127.0.0.1:80
}
```

把 `.env` 里的 `WEB_HTTP_PORT` 改成只给 Caddy 用的内网端口（例如 `8080`），`reverse_proxy` 指向它即可；这时 API 的 `TRUST_PROXY` 要改成 `2`（Caddy 和 web 两跳）。

**不用 Docker**：API 与 worker 是同一份代码，`npm run build:api` 后分别用 `node dist/server.js` 和 `node dist/worker/generationWorker.js` 启动，迁移用 `node dist/db/migrate.js`；前端 `npm run build` 后把 `dist/` 交给任意静态服务器，并把 `/api/`、`/mcp`、`/oauth/`、`/.well-known/oauth-*` 反代到 API，参考 `infra/nginx/default.conf`。

## 第三方资源与许可

随仓库分发的第三方资源清单见 [NOTICE](NOTICE)，细节见 [ATTRIBUTIONS.md](ATTRIBUTIONS.md) 和 `public/fonts/说明.md`。首页商品图与视频均为 AI 生成，来源记录在 `src/imports/landing-masters/PROVENANCE.md`；母版文件不在仓库里。

本项目以 Apache-2.0 许可证开源。"Lindyson" 名称与标识不随代码授权，基于本项目发布的服务请使用自己的品牌。
