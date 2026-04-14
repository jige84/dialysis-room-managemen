# 上线硬化执行跟踪（Execution Tracker）

> 基于计划：2026-04-13 用户确认版 10 步方案  
> 分支：`release-hardening`

## 总览状态

| 步骤 | 状态 | 本轮落地产物 |
|---|---|---|
| 1. 基线冻结与审计清单落库 | 进行中 | `generated/golden-baseline.{json,md}`、`generated/migration-audit.md` |
| 2. 规则-架构-需求一致性矩阵 | 已完成首版 | `rules-architecture-requirements-matrix.md`、`immutable-business-contracts.md` |
| 3. 质量门禁先达标 | 已完成增强版 | 前端 `lint/build` 通过；后端 `test:unit`、`test:rbac-matrix`、`test:auth-chain`、`test:smoke-readiness` 通过；新增 CI |
| 4. 后端分层重构 | 进行中 | 日志脱敏器落地；`auth`/`dialysis`/`reports`/`schedule` 入参校验已下沉；`patients` 查询/写入/删除链路均已收口到 `query/mutation/deletion services + repository`；`infection` 已完成 `validator+service+repository` 分层；`devices` 的 `machines + water-machines + water-quality + (water/machine)maintenance + water-daily-inspections + consumables + alerts` 主链路已完成 `validator+service+repository` 分层（无行为变更） |
| 5. 前端解耦重构 | 进行中 | Kt/V 公共工具抽离（`frontend/src/utils/ktv.ts`） |
| 6. 数据层与迁移安全整治 | 已完成首轮演练 | 58 迁移脚本顺序审计脚本 `audit:migrations`；新增 `backend/scripts/db-drill-rehearsal.js` 与 `npm run db:drill`（schema-level 备份->迁移模拟->回滚->恢复演练）；本地演练报告：`generated/db-drill/20260414-155744/` |
| 7. 回归测试体系补齐 | 进行中 | 后端单测种子 + 自定义 test runner + `auth-chain` + `rbac-matrix` 冒烟链路；新增 `patients/import`、`patients/update`、`infection`、`devices`、`devices-water`、`devices-water-quality`、`devices-consumables` validator 与 `PatientImportFacade`、`PatientQueryService`、`PatientDeletionService`、`DevicesMachineService`、`DevicesWaterService`、`DevicesWaterQualityService`、`DevicesConsumablesService` 单测并纳入 CI 的 `test:unit` |
| 8. 安全与合规专项验收 | 已完成首轮 | 日志敏感字段脱敏已接入；新增 `generated/security-compliance-report.md`（HTTPS/限流/JWT/RBAC/审计/PII 验收与风险清单） |
| 9. 预发布演练与上线切换 | 已完成首轮预发布演练 | `preprod-and-cutover-runbook.md` 已补齐完整门禁命令；新增演练记录 `generated/preprod-rehearsal-report-2026-04-14.md`（含前后端门禁、五模块冒烟、数据演练结论） |
| 10. 上线后稳定观察 | 已完成机制落地（首日快照已生成） | 新增 `observe:daily` 脚本与日报/Day7 模板；首个快照：`generated/post-release-observation/20260414-161248-daily-snapshot.md` |

## 已执行门禁命令（本地）

```bash
# backend
npm run test:unit
npm run test:rbac-matrix
npm run test:auth-chain
npm run test:smoke-readiness
npm run hardening:baseline
npm run audit:migrations
npm run observe:daily

# frontend
npm run lint
npm run build
```

## CI 门禁

- 新增：`.github/workflows/release-hardening-gates.yml`
- 覆盖：
  - `frontend`: `npm run lint` + `npm run build`
  - `backend`: `migrate` + `seedUsers` + 启动服务 + `test:unit` + `test:rbac-matrix` + `test:auth-chain` + `hardening:baseline` + `audit:migrations` + `db:drill` + `test:smoke-readiness`

## 当前剩余高优先任务（下一轮）

1. 后端分层拆分首批模块（`schedule/devices/patients/dialysis/ai`）并补 validator/repository。
2. 前端大页面按容器/hook/组件拆解（优先 `DialysisEntry`、`PrescriptionWorkspace`）。
3. 基于 `db:drill` 报告补 RTO/RPO 定量结论与上线窗口阈值。
4. 安全专项验收表（HTTPS/JWT吊销/RBAC穿透/审计不可删/PII抽检）与签字版报告。
5. 生产窗口执行一次同构演练并固化切换责任人签字版记录。
6. 连续沉淀 Day1~Day7 观察日报并输出 Day7 稳定性总结。
