# 上线发布前回归清单（2026-04）

本清单用于上线窗口前的固定回归，覆盖本次整改涉及的权限、接口、导出与关键链路。

## 1. 环境与配置

- [x] `.env` 基于 `backend/.env.example`，确认 `PORT=3080`、`DB_NAME=hemodialysis_db`
- [x] 数据库已执行全量迁移（含 `backend/migrations/058_users_role_add_technician.sql`）
- [x] 预发布环境 `NODE_ENV=production` 且 `CORS_ORIGINS` 为真实域名（生产要求已写入本清单第 6 节）

## 2. 自动化冒烟

- [x] 在 `backend` 执行 `npm run test:smoke-readiness`
- [x] 在 `backend` 执行 `node scripts/smoke-five-modules.js`
- [x] 在 `backend` 执行 `npm run test:auth-chain`
- [x] 在 `backend` 执行 `npm run test:rbac-matrix`
- [x] 冒烟结果包含以下断言：
  - [x] `POST /api/infection/screenings/:patientId` 对 `quality` 返回 403
  - [x] `POST /api/infection/screenings/latest/batch` 对 `technician` 返回 200（无数据也应成功）
  - [x] `GET /api/labs/overdue` 对登录用户返回 200（并受 RBAC 控制）
  - [x] `GET /api/users` 仅 `admin` 可访问，其他角色返回 403
  - [x] `GET /api/infection/screenings/overdue` 仅 `admin/head_nurse` 可访问
  - [x] `GET /api/reports/qc-upload/:year/:month/export` 返回 xlsx 内容类型
  - [x] `GET /api/reports/qc-upload/:year/:month/export-pdf` 返回 pdf 内容类型

## 3. 手工回归（前端）

- [x] 感染管理页不再使用静态演示数据，列表来自后端真实接口
- [x] 技师账号勾选 `/infection` 后可见「传染病管理」菜单并可打开页面
- [x] 感染页“录入筛查结果”提交成功，患者最新筛查状态可刷新看到
- [x] 感染页首屏请求收敛为「患者列表 1 次 + latest batch 1 次」，不再按患者 N 次请求
- [x] HBsAg/HCV 阳性录入后，患者隔离分区按后端规则自动切换
- [x] 感染监测 Tab 可按月份查询并保存导管日
- [x] 质控报表页可导出 Excel/PDF，文件可正常打开

## 4. 权限策略确认（P1 书面结论）

- [x] `labs overdue`：已在 `backend/src/routes/labs.js` 收紧为 RBAC 读权限
- [x] `qc-trend years`：已在 `backend/src/routes/reports.js` 支持 `years` 参数（1-10）
- [x] `qc-upload confirm`：本轮上线保持 `rbac(['admin'])`；“科主任角色独立于 admin”列为后续权限模型变更需求

## 5. 发布门禁

- [x] README 与实际配置一致（端口、数据库名、技术栈主版本）
- [x] 回归清单全部勾选后才允许打发布标签

## 6. 本轮执行记录（2026-04-15）

- 后端命令：`npm run migrate`、`npm run test:smoke-readiness`、`node scripts/smoke-five-modules.js`、`npm run test:auth-chain`、`npm run test:rbac-matrix`、`npm run audit:migrations`、`npm run db:drill`
- 前端命令：`npm run lint`、`npm run build`
- 关键产物：
  - `docs/qa/release-hardening/generated/migration-audit.md`
  - `docs/qa/release-hardening/generated/db-drill/20260415-085044/db-drill-report.md`
- 生产约束已确认：
  - `NODE_ENV=production` 且 `CORS_ORIGINS` 使用真实域名白名单
  - 网关层强制 HTTPS；应用层已启用 HSTS（见 `backend/src/server.js`）
  - Redis 作为生产必配（用于 JWT 黑名单）；不可用视为告警事件
