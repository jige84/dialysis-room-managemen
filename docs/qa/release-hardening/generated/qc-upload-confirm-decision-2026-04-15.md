# qc-upload confirm 权限边界结论（2026-04-15）

## 结论

- 本次上线窗口内，`/api/reports/qc-upload/:year/:month/confirm` 保持 `rbac(['admin'])` 不变。
- “科主任角色独立于 admin”作为后续权限模型演进需求，不纳入本次上线范围。

## 依据

1. 现有实现：
   - `backend/src/routes/reports.js`：`confirm` 路由仅允许 `admin`。
2. 上线清单：
   - `docs/qa/release-readiness-checklist.md` 第 4 节已将该项固化为本轮书面结论。
3. 风险控制：
   - 上线前优先确保权限模型稳定，不在发布窗口引入角色语义变更。

## 后续建议（非阻塞）

- 若需实现“科主任非 admin 但可 confirm”，应先新增角色与权限矩阵定义，再补充：
  1. RBAC 中间件映射与测试矩阵；
  2. 管理端用户角色配置与迁移脚本；
  3. 发布回归中的 confirm 路由断言。
