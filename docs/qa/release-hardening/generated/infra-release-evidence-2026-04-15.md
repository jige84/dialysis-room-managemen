# 生产基础设施上线证据（2026-04-15）

## 1. Redis 策略（JWT 黑名单）

- 结论：生产环境将 Redis 作为必配组件；连接异常记为 `P1` 运维告警。
- 代码证据：
  - `backend/src/config/redis.js`：黑名单使用 `blacklist:<token>`；Redis 不可用会降级并告警日志。
  - `backend/src/middleware/auth.js`：鉴权链路调用 `cache.isBlacklisted(token)`。
  - `backend/src/routes/auth.js`：登出与改密调用 `cache.blacklistToken(...)`。
- 上线检查：
  - `.env` 中 `REDIS_HOST/REDIS_PORT/REDIS_PASSWORD` 已配置生产值。
  - 预发布执行 `npm run test:auth-chain` 结果为通过（吊销后 401）。

## 2. HTTPS / 安全头策略

- 结论：应用层已开启安全头；HTTPS 强制跳转由网关层负责。
- 代码证据（应用层）：
  - `backend/src/server.js`：`helmet()` 启用 CSP 与 HSTS（`maxAge=31536000`）。
  - `backend/src/server.js`：登录限流与全局限流已启用。
- 网关层（Nginx/反向代理）要求：
  1. 80 端口仅做 301 跳转到 443。
  2. 443 证书有效期不少于 30 天且自动续期正常。
  3. 向后端透传 `X-Forwarded-Proto`，并固定受信代理来源。

## 3. CORS 生产配置

- 结论：`NODE_ENV=production` 时，应用仅允许 `CORS_ORIGINS` 白名单域名访问。
- 代码证据：
  - `backend/src/server.js` 第 50-79 行：`CORS_ORIGINS` 解析与白名单校验。
- 上线检查：
  - 生产 `.env` 中 `NODE_ENV=production`。
  - 生产 `.env` 中 `CORS_ORIGINS=https://<frontend-domain>`（可多个逗号分隔）。

## 4. 本轮联调证据

- 后端：`npm run test:smoke-readiness`、`node scripts/smoke-five-modules.js`、`npm run test:auth-chain`、`npm run test:rbac-matrix` 全部通过。
- 前端：`npm run lint`、`npm run build` 通过。
- 数据层：`npm run migrate`、`npm run audit:migrations`、`npm run db:drill` 通过。
