# 规则-架构-需求一致性矩阵（Release Hardening）

> 更新时间：2026-04-13  
> 目的：把 `.cursor/rules`、`.cursor/skills`、架构文档 V1.1、需求文档 V3.0 映射成“不可变业务契约”与“允许重构范围”，作为上线前重构与回归判定依据。

## 1. 不可变条目（必须保持行为不变）

| ID | 条目 | 规则/文档依据 | 当前实现锚点 | 验收方式 |
|---|---|---|---|---|
| IMM-01 | API 统一响应结构固定为 `{ code, data, message }` | 架构文档 V1.1 §4.1（line 679-684） | `backend/src/utils/response.js` | 抽测核心接口响应字段；回归快照比对 |
| IMM-02 | RBAC 五角色边界保持不变（admin/doctor/nurse/head_nurse/qc），并兼容 `qc/quality` | 需求 V3.0 §2.1（line 90-99）；安全规则 `security-rbac-rules.mdc` | `backend/src/middleware/rbac.js` | 5角色接口矩阵抽测（允许/拒绝） |
| IMM-03 | Kt/V、URR 公式与阈值保持不变：`spKt/V >= 1.2` 且 `URR >= 65` | 需求 V3.0 §3.2.6（line 278-293）；架构 V1.1 §6.3（line 1375-1404）；医疗规则 `medical-domain-rules.mdc` | `backend/src/services/KtvCalculator.js`、`frontend/src/utils/ktv.ts` | 单元测试 + 边界值回归 |
| IMM-04 | 超滤警戒阈值保持不变：`UF% > 5` 触发警示 | 需求 V3.0 §3.7（line 595）；医疗规则 `medical-domain-rules.mdc` | `backend/src/routes/dialysis.js`、`frontend/src/pages/Dialysis/DialysisEntry.tsx` | 边界样例（4.9/5.0/5.1） |
| IMM-05 | 质控中心上报 5 指标口径不变（护患比、凝血、漏血、穿刺损伤、CRBSI‰） | 需求 V3.0 §3.9.1（line 674-724）；架构 V1.1 §6.5（line 1432-1494）；`hd-qc-reports/SKILL.md` | `backend/src/routes/reports.js`、`backend/src/services/QcRoutineMetricsService.js` | 用 2026 样例口径对照 |
| IMM-06 | 传染病筛查周期和隔离联动规则保持不变（阳性只进对应分区） | 需求 V3.0 §3.4.1-3.4.2（line 328-347） | `backend/src/routes/infection.js`、`backend/src/routes/schedule.js` | 分区排班约束回归 |
| IMM-07 | 预警阈值与优先级语义不变（危急值/KtV/UF/CVC等） | 需求 V3.0 §3.7（line 588-603）；架构 V1.1 §7.1（line 1501-1572） | `backend/src/services/AlertEngine.js`、`backend/src/routes/alerts.js` | 规则样本触发测试 |
| IMM-08 | 审计日志“写操作可追踪且不可删”原则不变 | 需求 V3.0 §4.2（line 879）；安全规则 `security-rbac-rules.mdc` | `backend/src/middleware/audit.js`、`backend/src/routes/users.js` | 写操作审计抽检 + 删除阻断检查 |
| IMM-09 | 敏感数据保护原则不变（PII 加密存储 + 响应脱敏 + 日志不落敏感信息） | 需求 V3.0 §4.2（line 877-883）；安全规则 `security-rbac-rules.mdc` | `backend/src/utils/encrypt.js`、`backend/src/utils/logRedactor.js`、`backend/src/utils/logger.js` | 字段抽检（DB/接口/日志） |
| IMM-10 | 对外 URL 与业务语义保持兼容，不做破坏性 API 变更 | 架构文档 API 章节；本次发布约束 | `backend/src/routes/*.js` | `golden-baseline` 路由对照 |

## 2. 允许重构条目（可改实现，不改行为）

| ID | 条目 | 边界约束 |
|---|---|---|
| REF-01 | 后端按 `routes -> validators -> services -> repositories` 拆层 | 入参/出参、状态码、权限语义必须等价 |
| REF-02 | 前端大页面拆分为“容器 + hooks + 展示组件 + 纯工具” | 页面交互流程与判定结果不变 |
| REF-03 | 重复公式/阈值实现收敛为单一实现源 | 收敛后需通过历史样本回归 |
| REF-04 | 错误模型与日志结构统一（业务错误/系统错误） | 返回结构仍是 `{ code, data, message }` |
| REF-05 | 目录命名、文件组织、注释与代码风格整改 | 不改接口语义与数据库口径 |
| REF-06 | 测试框架与测试夹具补齐 | 不引入对生产逻辑的行为变更 |
| REF-07 | CI 流水线与门禁增强 | 只增强质量门禁，不改变业务规则 |

## 3. 冲突处理优先级

当规则/技能/文档出现表述差异时，按以下优先级落判：

1. 需求文档 V3.0（业务口径最终依据）
2. 架构文档 V1.1（实现与接口约束）
3. `.cursor/rules/*.mdc`（工程与安全硬约束）
4. `.cursor/skills/*/SKILL.md`（实现范式与参考样例）

## 4. 变更准入规则

- 凡触达 `IMM-*` 的改动，必须附：  
  - 受影响条目编号  
  - 回归证据（测试或对照数据）  
  - 风险说明与回滚点
- 任一 `IMM-*` 回归失败，禁止进入上线切换步骤。

