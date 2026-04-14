# 预发布演练记录（步骤9首轮）

- 日期：2026-04-14
- 分支：`release-hardening`
- 基线提交：`e420f44`
- 执行环境：本地预发布模拟（Windows + PostgreSQL 16）

## 1. 演练范围

1. 前端构建门禁：`lint + build`
2. 后端门禁：`unit + rbac + auth + smoke-readiness + smoke-five-modules`
3. 数据演练：`backup -> migrate-simulate -> rollback -> restore`（`db:drill`）
4. 基线工件刷新：`hardening:baseline`、`audit:migrations`

## 2. 执行命令与结果

| 模块 | 命令 | 结果 | 备注 |
|---|---|---|---|
| frontend | `npm run lint` | 通过 | 无 eslint error |
| frontend | `npm run build` | 通过 | `vite build` 成功 |
| backend | `npm run test:unit` | 通过 | 41/41 通过 |
| backend | `npm run test:rbac-matrix` | 通过 | 28 项通过 |
| backend | `npm run test:auth-chain` | 通过 | 吊销后访问返回 401 |
| backend | `npm run test:smoke-readiness` | 通过 | 18 项关键链路通过 |
| backend | `npm run test:smoke-five-modules` | 通过 | 20 项通过，`technician` 为可选账号可跳过 |
| backend | `npm run hardening:baseline` | 通过 | 基线 json/md 刷新 |
| backend | `npm run audit:migrations` | 通过 | 迁移审计工件刷新 |
| backend | `npm run db:drill` | 通过 | schema-level 演练通过 |

## 3. 数据演练结论（db:drill）

- 报告目录：`docs/qa/release-hardening/generated/db-drill/20260414-160720/`
- 结果：`passed`
- 关键步骤：
  - 备份：通过（当前环境 `pg_dump` 受限，自动降级 schema-level 逻辑备份）
  - 迁移模拟：通过
  - 回滚恢复：通过
  - 行数校验：通过（10张关键表一致）
- 限制说明：
  - 运行账号 `hd_app` 无 `createdb` 权限，采用同库隔离 schema 演练
  - 当前沙箱环境中 `pg_dump` 不可直接调用，脚本已记录降级证据

## 4. 异常与处置

1. 现象：`smoke-five-modules` 首次执行失败（护士长登录不可用）。  
2. 根因：历史登录失败触发锁定（`login_attempts:yangchen` 缓存键）。  
3. 处置：清理登录失败缓存后复测通过。  
4. 影响评估：仅影响演练账号状态，不影响业务接口实现。

## 5. 上线切换检查结论

1. 代码与接口行为：未引入破坏性变更。  
2. 门禁状态：本轮预发布演练全绿。  
3. 数据回滚能力：已完成首轮演练验证。  
4. Go/No-Go 建议：**Go（可进入生产窗口演练）**。  

## 6. 待办（进入正式上线前）

1. 在生产同构环境复跑一次 `db:drill`（可用 `pg_dump` 实备份链路）。  
2. 完成步骤8中“审计不可删”数据库级防删约束补强。  
3. 补齐步骤10的 7 天稳定性观察日报模板与责任人排班。
