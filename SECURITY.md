# 安全政策

## 报告漏洞

请**不要**在公开 issue、PR 或讨论里披露安全问题。

把漏洞详情发到 **orylite@outlook.com**，邮件标题以 `[Lindyson Security]` 开头，内容尽量包含：

- 受影响的版本或提交；
- 复现步骤、请求示例或 PoC；
- 影响范围和你的评估。

我们会在 **3 个工作日内** 回复确认，在 **30 天内** 给出修复计划或说明。修复发布前请保密；我们会在发布说明中致谢报告者（除非你不希望署名）。

## 支持的版本

只对 `main` 分支最新提交和最近一个 release 提供安全修复。

## 自托管安全提醒

- `JWT_SECRET`、`MCP_OAUTH_SECRET`、`MCP_FILE_ENCRYPTION_KEY`、`REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY`、`PAYMENT_CONFIG_ENCRYPTION_KEY` 必须是强随机值，不要用示例值。
- API 只监听本机回环地址，通过反向代理暴露；`TRUST_PROXY` 只填反向代理的地址/CIDR 或跳数，API 端口可直连时不要设为 `true`。
- 容器镜像以非 root 用户 `node` 运行，不要在部署时改回 root。
- 不用容器直接跑 API 时，把 `HOST` 设为 `127.0.0.1`，不要让 API 端口直接暴露在公网网卡上。
- 支付回调 `/api/payments/notify` 与 `/api/payments/refunds/notify` 只应接受支付网关的来源 IP，在反向代理层加白名单；支付通道的 `apiKey` 泄露即可伪造回调，请纳入定期轮换。
- 用 `docker-compose.yml` 部署时务必设置 `POSTGRES_PASSWORD`；公网只开放 web 的端口，API 端口只绑定本机。
- 不要把 `.env`、`publicCompliance.local.json` 或任何密钥提交到版本库。
