# 历史清理与发布闭环说明（2026-04-16）

## 1. 目标

本次操作目标：

1. 清理仓库历史中的敏感文件（患者数据与部署压缩包）。
2. 完成安全修复代码提交与远端同步。
3. 复跑关键门禁，确认系统达到上线标准。

---

## 2. 清理范围

从 Git 历史中移除以下路径：

- `2026lishshuju/`
- `hemodialysis-system-v1.0.0-deploy.zip`

---

## 3. 操作记录

### 3.1 回滚与备份

- 创建回滚标签：`safety/pre-history-cleanup-2026-04-16`
- 创建回滚分支：`backup/pre-history-cleanup-2026-04-16`
- 创建镜像备份：
  - `E:\dialysis-room-managemen-mirror-backup.git`

### 3.2 历史重写

- 使用 `git-filter-repo` 执行历史重写（保留其余历史，反向排除敏感路径）。
- 历史重写后恢复 `origin` 远程配置。

### 3.3 强制推送

- 已执行：
  - `git push origin --force --all`
  - `git push origin --force --tags`
- 远端 `master` 已更新为历史清理后的提交链。

---

## 4. 安全修复变更摘要

本轮已合入并推送的修复包括：

1. 敏感文件治理：
   - 删除仓库中的患者 Excel 文件与部署 zip。
   - `.gitignore` 增加敏感目录与压缩包规则，避免再次提交。
2. 配置安全：
   - `backend/.env.example` 中数据库密码改为占位符。
3. JWT 加固：
   - `jwt.verify` 固定 `HS256` 算法。
   - `jwt.sign` 显式指定 `HS256`。
4. Redis 降级补偿：
   - Redis 不可用时使用进程内缓存 fallback 维持黑名单能力。
5. 审计日志脱敏：
   - 对密码、token 等敏感字段进行写入前脱敏。
6. 种子脚本安全：
   - 移除硬编码默认密码，改为 `SEED_DEFAULT_PASSWORD` 环境变量。
7. 密码策略（按当前业务要求）：
   - 保持“至少 6 位，仅字母数字”。

---

## 5. 验证结果

### 5.1 历史清理验证

以下命令均无匹配结果，说明敏感路径已从历史中移除：

- `git log --all -- 2026lishshuju`
- `git log --all -- hemodialysis-system-v1.0.0-deploy.zip`
- `git rev-list --objects --all | Select-String "2026lishshuju|hemodialysis-system-v1.0.0-deploy.zip"`

### 5.2 门禁验证

后端：

- `npm run test:auth-chain` 通过
- `npm run test:rbac-matrix` 通过
- `npm run test:smoke-readiness` 通过

前端：

- `npm run lint` 通过
- `npm run build` 通过

---

## 6. 最终结论

当前仓库已完成：

1. 敏感历史清理；
2. 安全修复合入并推送；
3. 上线门禁复核通过。

结论：**可上线**。

---

## 7. 回滚信息（保留）

如需恢复到历史清理前状态，可使用：

- 标签：`safety/pre-history-cleanup-2026-04-16`
- 分支：`backup/pre-history-cleanup-2026-04-16`

> 注意：若执行回滚并强推，将恢复包含历史敏感对象的提交链，仅用于受控应急场景。
