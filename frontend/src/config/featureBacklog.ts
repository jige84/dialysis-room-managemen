/**
 * 与「全站 UI 微调」分离的待办功能占位，便于产品评审后拆任务。
 * 未实现前不得当作已上线能力对外承诺。
 */
export const PENDING_FEATURE_BACKLOG = [
  { id: 'admin-users', title: '用户管理页（替换 App 内联占位）', dependsOn: '后端 RBAC /users API' },
  { id: 'patient-new', title: '新建/编辑患者档案路由', dependsOn: '患者档案 API' },
  { id: 'dialysis-list', title: '透析历史列表独立路由', dependsOn: '透析记录 API' },
  { id: 'ai-assistant', title: 'AI 辅助分析页', dependsOn: '模型与合规策略' },
] as const;
