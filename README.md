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

前置条件：Node.js 26、Docker。没有火山引擎账号也能跑通全流程，`ENABLE_FAKE_PROVIDER=true` 时 worker 会用假供应商生成占位结果。

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
- **反向代理**：API 只应监听本机，公网经反向代理进入。`TRUST_PROXY=true` 时请确保代理会覆盖 `X-Forwarded-For`，否则客户端可伪造来源 IP。
- **前端构建期变量**（`VITE_` 前缀，可写在 `.env.local`）：`VITE_PUBLIC_SITE_URL` 是正式站点地址，用于 canonical 和社交分享；`VITE_SUPPORT_QR_URL` 是客服二维码图片地址，留空则不显示。
- **运营主体与备案公示**：页脚和法律文案读取 `src/app/data/publicCompliance.json`。仓库里的是占位模板，正式站点把真实信息写到同目录的 `publicCompliance.local.json`（已被 git 忽略），构建时自动替换；`npm run check:public-compliance` 校验该文件是否完整。
- `public/robots.txt` 与 `public/sitemap.xml` 里的域名需要按自己的站点修改。

## 开发命令

| 命令 | 作用 |
|---|---|
| `npm run typecheck` / `npm run typecheck:api` | 前端 / API 类型检查 |
| `npm run test:unit` | 前端与契约包单元测试（Vitest） |
| `npm run check:api` | API 类型检查与单元测试 |
| `npm run test:e2e` | Playwright 端到端测试（走 mock API） |
| `npm run test:fullstack` | 独立 Docker 环境里的真实 PostgreSQL、Redis、API、worker 与浏览器链路 |
| `npm run build` / `npm run build:api` | 生产构建；前端构建会为文本资源额外生成 `.gz` |
| `npm run check` | 以上全部，发布前跑一遍 |

## 部署

- API 与 worker 用同一镜像：`docker build -f apps/api/Dockerfile .`，再以 `node dist/server.js` 和 `node dist/worker/generationWorker.js` 两种命令启动；迁移用 `node dist/db/migrate.js`。
- 前端是纯静态文件，`APP_RELEASE_ID=<版本号> npm run build` 后把 `dist/` 交给任意静态服务器；`version.json` 里的 `buildId` 与版本号一致，前端用它检测新版本。
- `docker-compose.yml` 是本地与全栈测试用的参考编排，包含假供应商与 mock Seedream 服务，不是生产配置。生产部署的反向代理、证书、备份与机器信息不在本仓库。

## 第三方资源与许可

字体、教程媒体、素材来源与许可见 [ATTRIBUTIONS.md](ATTRIBUTIONS.md) 和 `public/fonts/说明.md`。首页商品图与视频均为 AI 生成，来源记录在 `src/imports/landing-masters/PROVENANCE.md`。

本项目以 Apache-2.0 许可证开源。"Lindyson" 名称与标识不随代码授权，基于本项目发布的服务请使用自己的品牌。
