# Lindyson ChatGPT / Codex MCP 接入说明

## 适用范围

第一版向 Lindyson 注册用户开放本人账号的图片、视频、素材及任务能力。积分、模型开放配置、队列与退款规则复用网站。默认关闭；没有独立套餐、提示词引擎、后台管理工具、Claude 适配或公开目录上架。

账户中心的“MCP 连接”直接展示 ChatGPT 与 Codex 两套接入步骤、共用地址和撤销入口，不再跳转到官方接入说明。ChatGPT 的自定义连接入口仍受账号、开发者模式和工作区管理员策略影响。

## 用户接入

先在 Lindyson 账户中心打开“MCP 连接”，复制共用地址。地址由部署方的 `MCP_PUBLIC_URL` 决定，形如 `https://<你的域名>/mcp`。

### ChatGPT

1. 打开“设置 → 安全与登录”，开启开发者模式，再到“插件”点击加号添加连接。
2. 填写名称 Lindyson 和 MCP 地址，使用 OAuth 登录本人 Lindyson 账号，确认权限及积分消费说明。
3. 在新对话启用 Lindyson。先查询模型和估价；聊天附件先导入，等导入完成取得资产 ID，再提交生成。

### Codex

1. 打开 Codex“插件 → 添加 → 添加 MCP 服务器”。
2. 名称填写 `lindyson`，类型选择“流式 HTTP”（`Streamable HTTP`），URL 填写同一 MCP 地址。Bearer 令牌环境变量、标头及来自环境变量的标头全部留空。
3. 保存后按提示点击“认证 / Authenticate”，使用 Lindyson 账号登录并确认权限；若提示重启服务器，先完成重启。
4. 新建对话，让 Codex 使用 `lindyson` 查询模型和素材，估价后再提交生成。本地图片先上传到网站“数字资产”，再让 Codex 查询并使用资产 ID；不能把本地路径直接传给附件下载工具。

账户中心提供用户提供的 Codex 界面截图，六处编号依次标注添加入口、名称、类型、URL、留空字段、保存与授权，并支持放大查看。编号置于截图两侧的独立留白，以引线连接对应框线，不遮挡原图内容。URL 旁的小图标可直接复制当前地址，并提示复制成功或失败；图标与网址文本块垂直居中，窄屏换行时也保持居中。原图位于 `public/tutorials/codex-mcp-setup.png`；框线由页面叠加，URL 使用服务端返回的当前配置。

安装 Codex CLI 的用户也可以执行：

```sh
codex mcp add lindyson --url https://<你的域名>/mcp
codex mcp login lindyson
```

添加时若已完成 OAuth 授权，可跳过第二条命令。配置由同一 Codex 主机上的桌面端、CLI 和 IDE 扩展共享；远程主机需要在对应主机配置。

两种客户端均异步查询任务，再取得短期结果链接。网站 AI Studio、数字资产和积分明细可核对同一任务。账户中心分别标注 ChatGPT / Codex 连接，支持单独撤销；已受理生成仍按网站规则结算。

授权完成后返回账户中心的“MCP 连接”，窗口获得焦点或页面恢复可见时会自动刷新连接列表；也可以点击“已授权连接”旁的“刷新连接”。刷新时保留说明、图解、旧列表和滚动位置；失败时显示重试提示，可再次点击刷新。撤销成功后连接立即显示为“已失效”，再查询服务端状态。

步骤依据 [OpenAI Docs 的 Codex MCP 配置说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)及 [ChatGPT 接入说明](https://developers.openai.com/plugins/deploy/connect-chatgpt)核对。这些链接仅作运维文档来源，产品页面直接显示操作步骤。

## 接口与权限

固定资源入口为 `POST /mcp`，使用官方 TypeScript SDK v2、Streamable HTTP、无状态请求处理及 `legacy: 'stateless'` 旧协议兼容。客户端断线不取消已受理的后台任务。

| 权限 | 工具 | 行为 |
| --- | --- | --- |
| `account:read` | `list_models`、`get_account`、`estimate_generation` | 查询参数、当前开放价格和余额，估算积分 |
| `assets:read` | `list_assets` | 本人有效素材的游标分页，返回资产 ID |
| `assets:write` | `import_files`、`get_import` | 写入素材库并查询导入进度 |
| `generation:write` | `generate_image`、`generate_video` | 付费提交，单批最多 4 个任务 |
| `generation:read` | `list_tasks`、`get_task`、`get_result` | 本人任务、进度和结果；下载结果另需 `assets:read` |

`get_result` 会沿用网站下载登记，因此标注为写操作。工具输出包含结构化数据；生成工具明确标注消费积分，不提供聊天内播放器。

工具列表同时发布主字段 `securitySchemes` 和一致的 `_meta.securitySchemes` 兼容镜像，权限范围与实际调用校验共用定义；`get_result` 同时要求任务读取和素材读取权限。SDK 2.2 的默认工具列表会丢弃扩展主字段，因此使用其公开低层列表接口返回完整描述，工具调用及参数校验仍由原 SDK 处理。

生成参数来自网站共享契约。通过 `list_models` 返回的请求 JSON Schema 查看准确字段，不另建参数体系。`references` 使用网站资产 ID；禁止外部 URL 或尚未导入完成的文件直接作为生成引用。第一版不允许传真人授权、提示词向导或 TK 来源字段。

生成必须提供 `idempotencyKey` 和 `maxCredits`。相同用户、同一幂等键和相同参数返回原任务；更改生成类型、参数或积分上限会冲突。图片与视频共用生成幂等键空间。服务端在预扣事务内核对最新总积分，超过上限返回 `GENERATION_CREDIT_LIMIT_EXCEEDED`，不扣积分。失败任务沿用既有退款流程。

`import_files` 接受 1–4 个 `files`，元数据使用 `_meta["openai/fileParams"] = ["files"]`。每项必填 `download_url`、`file_id`，可选 `file_name`、`mime_type`，符合[官方文件 API](https://developers.openai.com/plugins/reference#file-apis)。同键重试时文件 ID、顺序、文件名和类型必须相同；临时地址允许更新。可重试失败包括过期、下载失败和超时，沿用同键可刷新源地址并重试。

下载仅允许公网 HTTPS 443，检查全部 DNS 结果，并固定连接到验证后的地址；最多跟随 3 次重定向，每次重新检查。请求不携带 Lindyson 凭据，禁止压缩传输，实测字节数受网站 1 GiB 上限约束。检测内容类型后接入原上传会话和媒体解析 worker，继承网站图片、视频和音频的实际格式限制；声明类型不能替代内容校验。每位用户最多 20 个待处理导入。临时下载目录正常结束即删除，异常退出遗留文件在一小时后清理。

源地址以 AES-256-GCM 加密保存，绑定用户及文件 ID，十分钟后清除，完成或失败立即清除；源地址不进入队列、返回结果或日志。

源文件下载、流式暂存和 TOS 上传共用八分钟截止及 worker 退出信号；取消后关闭文件流并清理临时目录，尚未交接的导入返回可重试的 `MCP_FILE_TIMEOUT`。上传完成后，在同一数据库事务内检查有效租约并交接上传会话，失效旧执行不得继续入队或覆盖新状态。成功交接后的媒体校验由现有上传 worker 继续处理；队列临时不可用时沿用已有恢复机制。取消不能撤销存储端已经完成的写入，遗留对象沿用上传会话清理流程回收。

## OAuth 与账号安全

采用 `oidc-provider` 9.x；OAuth 对象持久化于 PostgreSQL，原始令牌索引经哈希，载荷加密。资源受众固定为 `MCP_PUBLIC_URL`。

- 发现入口：`/.well-known/oauth-protected-resource/mcp`、`/.well-known/oauth-protected-resource`。
- 授权服务器：`/oauth`；元数据为 `/oauth/.well-known/openid-configuration`，并提供 `/.well-known/oauth-authorization-server/oauth` 别名。
- 授权、令牌、动态注册、撤销分别为 `/oauth/auth`、`/oauth/token`、`/oauth/reg`、`/oauth/token/revocation`，客户端应从元数据读取，不硬编码。
- 只允许授权码、PKCE S256 和刷新。ChatGPT 继续使用官方固定 HTTPS 回调及 `/connector/oauth/{id}`。Codex 动态注册只允许 `http://127.0.0.1:<端口>/callback` 或 `http://[::1]:<端口>/callback`，兼容单层回调 ID；注册必须显式包含有效端口。不允许任意域名、内网地址、用户名、查询、片段或混合两种客户端的回调列表。原生客户端按 RFC 8252 支持登录时变更回环端口，但主机与路径必须匹配。
- 访问令牌 15 分钟，刷新令牌轮换，授权总寿命最长 30 天。每次 MCP 请求核对连接、账号冻结状态和 `auth_version`，密码安全版本变更或撤销后失效。
- 网站登录 Cookie 与 MCP Bearer 独立。授权页由网站提供，确认请求绑定交互 Cookie、当前用户及 CSRF 校验。
- 账户管理 API：`GET /api/account/mcp`、`DELETE /api/account/mcp/:id`；授权交互 API：`GET/POST /api/mcp/interaction/:id`，均有共享响应契约。连接及授权详情增加 `clientName`，由已登记回调类型生成，不采用客户端自行声明的名称作为身份依据；旧响应缺失时前端显示“MCP 客户端”。

连接列表沿用 React Query，查询键按网站登录会话隔离，查询请求传递取消信号。焦点与可见性事件经 200ms 防抖合并，并复用进行中的请求，不增加定时轮询。撤销期间暂停刷新、取消旧查询；离开连接分区时清理监听和计时器，并取消无人订阅的查询。退出或切换账号沿用网站会话失效与私有缓存清理，旧请求结果不得写入新账号。

## 配置与本地运行

API 和 worker 必须配置相同密钥与地址。不要在仓库提交真实值。

| 配置 | 默认值 / 要求 |
| --- | --- |
| `MCP_ENABLED` | `false` |
| `MCP_PUBLIC_URL` | 固定 HTTPS 地址，路径严格为 `/mcp`，与 `APP_BASE_URL` 同源；本地开发允许 localhost 的 HTTP |
| `MCP_OAUTH_SECRET` | 至少 32 字符的独立随机密钥，用于 OAuth Cookie、存储和确认校验 |
| `MCP_OAUTH_JWKS_JSON` | 包含私有签名密钥和 `kid` 的 JWKS JSON；建议 RSA 2048 位以上、RS256 |
| `MCP_FILE_ENCRYPTION_KEY` | 独立 32 字节随机数的 64 位十六进制表示 |
| `MCP_READ_RATE_PER_MINUTE` | 每用户查询 60 次/分钟 |
| `MCP_GENERATE_RATE_PER_MINUTE` | 每用户生成提交 6 次/分钟 |
| `MCP_IMPORT_USER_CONCURRENCY` | 每用户同时下载 2 个 |
| `MCP_IMPORT_GLOBAL_CONCURRENCY` | 所有 worker 合计同时下载 4 个，数据库租约协调 |

用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 分别生成两个独立随机密钥。JWKS 可在安全终端用 Node `generateKeyPairSync('rsa', { modulusLength: 2048 })` 生成，导出私钥 JWK，加上 `kid`、`use: 'sig'`、`alg: 'RS256'`，包在 `{ keys: [...] }` 中。私钥只进入受控环境配置。

执行现有数据库迁移、API 与 worker 启动命令即可，无须独立 MCP 服务。迁移 `089_chatgpt_mcp.sql` 新增 OAuth、连接、限流与附件导入表。`mcp-file-imports` 队列只保存导入 ID；API 就绪检查覆盖新表和队列，worker 启停纳入现有生命周期。维护任务每 30 秒清理过期状态、同步上传结果、恢复未入队导入；错误日志使用稳定代码，不记录源 URL 或令牌。

Vite 已代理 MCP/OAuth；Docker 和主站 OpenResty 模板包含入口。反向代理必须保留完整 Host、转发 HTTPS 协议、关闭 MCP 缓冲，并禁止 OAuth/授权交互的访问日志。生产使用 `TRUST_PROXY=true` 时，API 端口必须只允许受信代理访问。主站固定地址提供 OAuth，CN 页面可显示该地址但授权在配置的主站完成。

更换 OAuth 加密密钥会使已有 OAuth 会话不可读取，须先通知用户并撤销旧连接；更换附件密钥前应等待待处理导入清空。不应直接覆盖密钥并继续使用旧密文。

## 验证

- `npm run check`：共享契约、前后端类型、单元测试、浏览器回归及构建。
- `npm run test:fullstack`：独立 Docker 项目内真实 PostgreSQL、Redis、API、worker、浏览器；使用模拟生成供应商，每次生成临时 OAuth 密钥。
- `npm run test:fullstack -- mcp.spec.ts`：定向 MCP 验收。附件测试仅在独立测试进程替换 HTTPS/DNS 网络响应，生产代码没有下载白名单后门；真实文件仍经过下载限额、类型识别、上传会话和媒体 worker。

部署到自己的环境后，建议至少核验：OAuth 发现文档（`/.well-known/oauth-authorization-server`）、动态客户端注册与 PKCE S256、未授权访问 `/mcp` 返回 401、账户中心能看到并撤销连接，以及一次完整的“添加地址 → 登录 → 授权 → 导入图片或选取本人资产 → 图生视频 → 查询 → 下载 → 积分核对 → 撤销”流程。真实 ChatGPT 与 Codex 客户端的行为会随其版本变化，验收时记录账号类型、客户端版本和实际成功的媒体类型。
