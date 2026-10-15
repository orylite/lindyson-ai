# 贡献指南

感谢你愿意为 Lindyson AI 投入时间。

## 开始之前

- 先搜一下 issue，避免重复。
- 较大的改动（新模块、接口变更、数据库迁移、计费逻辑）请先开 issue 讨论方向，再动手写代码。
- 安全问题走 [SECURITY.md](SECURITY.md)，不要公开提 issue。

## 本地开发

按 [README.md](README.md) 的"本地开发"一节搭环境。常用命令：

| 命令 | 用途 |
|---|---|
| `npm run dev` / `dev:api` / `dev:worker` | 启动前端、API、worker |
| `npm run typecheck` 与 `npm run typecheck:api` | 类型检查 |
| `npm run test:unit` 与 `npm run check:api` | 单元测试 |
| `npm run test:e2e` | 端到端测试（需要 Chrome） |
| `npm run check` | 提交 PR 前跑一遍 |

## 代码规范

- TypeScript、React 函数组件、2 空格缩进。
- 组件文件 PascalCase（`AssetPreviewModal.tsx`），数据与工具文件小写语义化（`billing.ts`）。
- 新界面优先复用 `src/app/ui/` 里的 `Button`、`Card`、`Badge`、`Input`、`PageHeader`。
- 业务规则写单元测试，关键用户路径写 E2E；测试文件名贴近目标模块。
- 数据库迁移放在 `apps/api/migrations/`，编号递增，必须能从空库顺序重放，不要在迁移里塞只对某个环境有效的数据修复。
- 所有 `.md` 使用简体中文。

## 提交与 PR

- 提交信息用 Conventional Commits：`feat: ...`、`fix: ...`、`docs: ...`、`chore: ...`。
- 每个提交加 DCO 签名（`git commit -s`），表示你同意 [Developer Certificate of Origin](https://developercertificate.org/)。
- PR 描述写清：改了什么、影响哪些页面或接口、跑了哪些验证命令、手动测试路径；UI 改动附截图或录屏。
- CI 必须通过；维护者 review 后合并。

## 不要提交的东西

API Key、Token、真实账号、机器地址、备案信息、客户数据。仓库里对应的占位模板和 `.gitignore` 已经为此做了安排，不确定时在 PR 里问。

## 许可

你提交的代码默认按本仓库的 Apache License 2.0 授权。
