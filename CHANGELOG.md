# 更新日志

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [未发布]

### 新增

- 后台「流量来源」首版：推广链接带 `utm_source`（或短参数 `from`）即可在注册时把来源绑定到用户，新表 `user_acquisitions`（迁移 091）；没有参数时按来源站点域名归类，直接访问记 `direct`，仅邀约链接记 `referral`。用户管理页新增「来源」列与筛选，用户详情显示来源明细，仪表盘新增「注册来源分布」（本月注册数、付费数、收入）。来源在浏览器本地保存 30 天、first-touch 优先，隐私政策已同步说明。
- 首页「开始创作 / 登录」跳转到 `/login` 时保留查询参数；此前从首页进入会丢失邀约码 `?ref=`。

### 待办

- e2e「用户管理按 userId 隔离历史订单和积分流水」在 GitHub runner 上稳定失败（翻页时序），已在 CI 隔离，本机正常；待根据 CI 上传的 trace 定位。

## [0.1.0] - 2026-10-16

首个开源版本。

### 新增

- 首个开源版本：Vite + React 前端、Fastify API 与 BullMQ worker、api-contracts 契约包、89 个数据库迁移、Playwright 端到端与 Docker 全栈测试、MCP 服务端与 OAuth 2.1 接入。

### 安全

- API 增加全局限流（`@fastify/rate-limit`，默认每个来源 IP 每分钟 600 次，`RATE_LIMIT_MAX` 可调、0 关闭），作为所有路由的兜底。
- 站点地图提交脚本的 XML 实体解码改为最后替换 `&amp;`，避免二次解码。
- 动态客户端注册 `/oauth/reg` 按来源 IP 限流（每分钟 10 次）；未产生授权的注册记录 24 小时后自动清理。
- 限流键哈希、本地存储 URL 签名、分页游标签名改用从 `JWT_SECRET` 以 HKDF 派生的用途隔离密钥；**升级后旧的分页游标和本地存储签名链接会失效**（都是短期令牌），会话不受影响。
- 新增"退出所有设备"（`POST /api/auth/logout-all`），递增 `auth_version` 使所有会话失效。
- 密码长度上限从 32 位放宽到 128 位。
- 生产构建缺少 `publicCompliance.local.json` 时打印警告。

- `TRUST_PROXY` 支持跳数和 IP/CIDR 列表，生产环境应只信任反向代理地址；**注意**：此前 `TRUST_PROXY=1` 等价于 `true`，现在表示信任最近 1 跳。
- `docker-compose.yml` 改为单机生产栈（含前端 nginx 反代，API 默认 `TRUST_PROXY=1`，API 端口只绑定 `127.0.0.1`）；全栈测试的 mock 与第二站点入口拆到 `docker-compose.fullstack.yml`。
- API 镜像改为以非 root 用户 `node` 运行。
- 升级含已知漏洞的间接依赖（fast-jwt、tar、nanoid、postcss 等），CI 增加 `npm audit --audit-level=high` 门禁。

### 变更

- 运营主体、备案与法律联系信息改为读取 `publicCompliance.local.json`，仓库只保留占位模板。
- 站点地址、客服二维码、Seedream 教程媒体目录改为 `VITE_` 环境变量。
- 火山引擎教程演示媒体与首页母版素材不再随仓库分发。

[未发布]: https://github.com/orylite/lindyson-ai/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/orylite/lindyson-ai/releases/tag/v0.1.0
