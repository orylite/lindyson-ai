# 仓库协作指南

## 项目结构与模块组织

本仓库由 Vite + React + TypeScript 前端和 `apps/api` Fastify API/worker 组成。前端有两个入口：首页 `index.html` → `src/landing.tsx`（只加载落地页、动效和图标，样式为 `src/styles/landing.css`，套餐接口按需加载），其余页面 `app.html` → `src/main.tsx`；登录、工作台和后台都走 `app.html`，首页的“开始创作 / 登录”按钮整页跳转到 `/login` 并保留查询参数（邀约码 `?ref=` 与推广参数 `utm_*` / `from` 都要带过去）。注册来源在 `src/app/state/attribution.ts` 采集（localStorage，30 天，first-touch），注册时随 `attribution` 字段提交，服务端 `apps/api/src/domain/userAcquisition.ts` 按 `packages/api-contracts/src/acquisition.ts` 的白名单归类写入 `user_acquisitions`。落地页新增的 Tailwind 类所在文件必须在 `landing.css` 的 `@source` 列表里，否则首页样式会缺失。应用根组件与路由在 `src/app/App.tsx`。构建会为文本资源额外生成 `.gz`，供 OpenResty `gzip_static` 使用。用户端页面位于 `src/app/components/`，管理后台位于 `src/app/admin/`，共享状态与业务规则位于 `src/app/state/`，生产数据类型与映射位于 `src/app/data/` 和 `src/app/api/`，测试夹具统一位于 `src/test/factories/`。后端路由、领域服务、队列和迁移分别位于 `apps/api/src/routes/`、`apps/api/src/domain/`、`apps/api/src/worker/` 和 `apps/api/migrations/`。通用 UI 组件统一从 `src/app/ui/` 导出。产品规则与接口边界见 `MCP_CHATGPT.md` 和 `docs/`。

## 构建、测试与开发命令

- `npm i`：安装依赖。
- `npm run dev`：启动本地 Vite 服务。
- `npm run typecheck`：执行 TypeScript 类型检查。
- `npm run test:unit`：运行 Vitest 单元测试。
- `npm run test:e2e`：运行 Playwright 端到端测试。
- `npm run build`：生产构建。
- `npm run check`：依次运行前端类型检查、单元测试、端到端测试、前端构建、API 检查和 API 构建。
- `npm run test:fullstack`：使用独立 Docker 环境验证真实 PostgreSQL、Redis、API、worker 和浏览器链路。

普通 UI 小改至少运行 `npm run build`；涉及计费、积分、路由、后台流程或共享状态时优先运行 `npm run check`。

## 编码风格与命名规范

使用 React 函数组件、TypeScript 和 2 空格缩进。组件文件使用 PascalCase，例如 `AssetPreviewModal.tsx`；数据与工具文件使用语义化小写命名，例如 `billing.ts`。图标优先使用 `lucide-react`。新增界面优先复用 `src/app/ui/` 的 `Button`、`Card`、`Badge`、`Input`、`PageHeader` 等组件。所有 `.md` 文件使用简体中文。

## 测试规范

单元测试使用 Vitest，端到端测试使用 Playwright。业务规则优先写单元测试，关键用户路径写 E2E，例如登录注册、AI Studio 积分扣减、数字资产批量操作、后台订单与发票流程。测试文件命名应贴近目标模块，例如 `credits.test.ts`。

## 提交与拉取请求规范

采用简洁 Conventional Commits，例如 `feat: add announcement management`、`fix: enforce pinned announcement limit`。PR 应包含变更摘要、影响页面、验证命令、手动测试路径；UI 改动需附截图或录屏。

## 安全与部署说明

不要提交 API Key、Token、真实账号凭据或任何生产机器的地址、端口、路径和容器名。生产部署脚本、反代配置和机器信息都在独立的私有运维仓库里，本仓库只保留可公开的代码、`docker-compose.yml` 自托管示例和文档。

- 正式站点专用内容不进仓库：运营主体与备案信息写在 `src/app/data/publicCompliance.local.json`（git 忽略，模板是同目录的 `publicCompliance.json`），站点地址和客服二维码通过 `.env.local` 里的 `VITE_PUBLIC_SITE_URL`、`VITE_SUPPORT_QR_URL` 提供。
- 涉及任何服务器的同步、构建或重启前，必须先询问是否执行、执行到哪台，并等待明确确认；每次确认只对当次有效。
- `docker-compose.hk.yml` 是生产 compose，已被 git 忽略；修改它时同步更新运维仓库里的副本。
