# 更新日志

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [未发布]

### 待办

- e2e「用户管理按 userId 隔离历史订单和积分流水」在 GitHub runner 上稳定失败（翻页时序），已在 CI 隔离，本机正常；待根据 CI 上传的 trace 定位。

### 新增

- 首个开源版本：Vite + React 前端、Fastify API 与 BullMQ worker、api-contracts 契约包、89 个数据库迁移、Playwright 端到端与 Docker 全栈测试、MCP 服务端与 OAuth 2.1 接入。

### 安全

- `TRUST_PROXY` 支持跳数和 IP/CIDR 列表，生产环境应只信任反向代理地址；**注意**：此前 `TRUST_PROXY=1` 等价于 `true`，现在表示信任最近 1 跳。
- `docker-compose.yml` 改为单机生产栈（含前端 nginx 反代，API 默认 `TRUST_PROXY=1`，API 端口只绑定 `127.0.0.1`）；全栈测试的 mock 与第二站点入口拆到 `docker-compose.fullstack.yml`。
- API 镜像改为以非 root 用户 `node` 运行。
- 升级含已知漏洞的间接依赖（fast-jwt、tar、nanoid、postcss 等），CI 增加 `npm audit --audit-level=high` 门禁。

### 变更

- 运营主体、备案与法律联系信息改为读取 `publicCompliance.local.json`，仓库只保留占位模板。
- 站点地址、客服二维码、Seedream 教程媒体目录改为 `VITE_` 环境变量。
- 火山引擎教程演示媒体与首页母版素材不再随仓库分发。
