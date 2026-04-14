# lab_results 去重与唯一策略（上线收口）

## 目标
- 清理历史重复数据（同 `patient_id + test_type + test_date`）。
- 可选启用数据库唯一守护，阻止后续再次写入同日同项目重复记录。

## 脚本
- 文件：`backend/scripts/lab-results-dedupe-and-guard.js`
- 默认行为：`dry-run`，只检查不修改。

## 常用命令
- 仅盘点（推荐先执行）：
  - `npm --prefix backend run labs:dedupe:dry-run`
- 执行数据清洗：
  - `npm --prefix backend run labs:dedupe:apply`
- 启用唯一守护（可选）：
  - `npm --prefix backend run labs:guard:add`
- 回滚唯一守护：
  - `npm --prefix backend run labs:guard:drop`

## 推荐上线顺序
1. 低峰期执行 `labs:dedupe:dry-run`，确认重复规模与示例。
2. 业务确认后执行 `labs:dedupe:apply`。
3. 再次执行 `labs:dedupe:dry-run`，确认冗余为 0。
4. 如需从源头阻断重复，执行 `labs:guard:add`。

## 风险说明
- 清洗会删除重复组中的旧记录，仅保留最新记录（按 `created_at DESC, id DESC`）。
- 启用唯一守护后，同患者同项目同日期的重复写入将被数据库拒绝。
