# 安全与合规专项验收报告（首轮）

- 生成时间：2026-04-14
- 范围：后端安全控制项（步骤8）
- 证据来源：代码静态检查 + 本地门禁回归（`test:rbac-matrix` / `test:auth-chain` / `test:smoke-readiness`）

## 验收结论总览

| 控制项 | 结论 | 证据 |
|---|---|---|
| HTTPS 安全头与基础防护 | 通过（应用层） | `helmet`、CSP、HSTS 已启用（`backend/src/server.js`） |
| 速率限制（登录 + 全局） | 通过 | 登录限流和全局限流已启用（`backend/src/server.js`） |
| JWT 吊销与过期校验 | 通过（有降级风险） | 登出/改密写黑名单，鉴权时查黑名单与过期（`auth.js`/`middleware/auth.js`） |
| RBAC 权限隔离（含 qc/quality 兼容） | 通过 | `rbac` 中间件与等价角色映射；冒烟 28 项全通过 |
| 审计日志写入 | 通过 | 关键写链路可落 `audit_logs`（`middleware/audit.js`） |
| 审计不可删 | 通过 | `059_audit_logs_immutable_guard.sql` 已落地触发器与权限收敛 |
| PII 加密存储与响应脱敏 | 通过 | AES-256-GCM + API 返回脱敏字段（`encrypt.js`/`PatientQueryService.js`） |
| 日志敏感信息脱敏 | 通过 | logger/errorHandler 接入 `redactForLog`，单测覆盖 |

## 关键证据

1. HTTPS/安全头与限流  
`backend/src/server.js`  
- `55`：`helmet(...)`  
- `84`、`92`：登录限流 `loginLimiter` + `app.use('/api/auth/login', ...)`  
- `95`、`102`：全局限流 `globalLimiter` + `app.use('/api/', ...)`

2. JWT 鉴权与吊销  
`backend/src/routes/auth.js` / `backend/src/middleware/auth.js` / `backend/src/config/redis.js`  
- `auth.js:135`、`auth.js:170`：登出/改密写入黑名单  
- `middleware/auth.js:20`：鉴权检查 `isBlacklisted`  
- `middleware/auth.js:35`、`37`：过期/无效 token 返回 401  
- `redis.js:91`、`95`：黑名单存取封装

3. RBAC 与角色兼容  
`backend/src/middleware/rbac.js`  
- `12-13`：`quality/qc` 等价层级  
- `24-25`：白名单自动扩展 `quality <-> qc`  
- `33`：`rbac(allowedRoles)` 主校验入口

4. PII 与日志脱敏  
`backend/src/utils/encrypt.js` / `backend/src/services/PatientQueryService.js` / `backend/src/utils/logRedactor.js` / `backend/src/utils/logger.js` / `backend/src/middleware/errorHandler.js`  
- `encrypt.js:9`、`13`：`ENCRYPT_KEY` 强约束  
- `PatientQueryService.js:48`、`87`、`90-92`：返回脱敏并剔除密文字段  
- `logRedactor.js:7`、`35`：敏感键规则 + 递归脱敏  
- `logger.js:30`、`errorHandler.js:15-17`：写日志前统一脱敏

5. 审计日志  
`backend/src/middleware/audit.js` / `backend/migrations/021_create_audit_alerts.sql` / `backend/migrations/059_audit_logs_immutable_guard.sql`  
- `audit.js:33`：业务成功写入 `audit_logs`  
- `021_create_audit_alerts.sql:3`：审计表结构已存在  
- `059_audit_logs_immutable_guard.sql:22-46`：已禁止 `UPDATE/DELETE/TRUNCATE` 且 `REVOKE ALL FROM PUBLIC`

## 本轮门禁回归结果（2026-04-14）

1. `npm run test:unit`：41/41 通过。  
2. `npm run test:rbac-matrix`：28 项通过（宽松模式，缺少独立 `head_nurse` 账号时自动跳过该角色断言）。  
3. `npm run test:auth-chain`：通过（登录、鉴权、吊销后401）。  
4. `npm run test:smoke-readiness`：18 项关键链路通过。  
5. `node scripts/smoke-five-modules.js`：20 项通过（`technician`/`nurse` 缺账号场景按脚本设计可选跳过）。  

## 风险与补强建议（不改业务功能）

1. Redis 不可用时当前会降级（黑名单能力变弱）：生产建议设为“Redis 必须可用”并加告警。  
2. HTTPS 强制跳转应在网关/反向代理层强制，并留存配置证据纳入上线清单。  
3. 当前 RBAC 冒烟默认宽松模式（账号不齐时可跳过），CI 可按需开启严格模式（`RBAC_STRICT=true`）。  
