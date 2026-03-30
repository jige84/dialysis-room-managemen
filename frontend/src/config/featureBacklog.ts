/**
 * 产品待实现功能占位清单（常量）
 * 主要作用：集中记录尚未开发的前端能力点，避免与已交付功能混淆。
 * 主要功能：导出 PENDING_FEATURE_BACKLOG 数组，供布局或文档引用；不含运行逻辑。
 */
export const PENDING_FEATURE_BACKLOG = [
  { id: 'admin-users', title: '用户管理页（替换 App 内联占位）', dependsOn: '后端 RBAC /users API' },
  { id: 'patient-new', title: '新建/编辑患者档案路由', dependsOn: '患者档案 API' },
  { id: 'dialysis-list', title: '透析历史列表独立路由', dependsOn: '透析记录 API' },
  { id: 'ai-assistant', title: 'AI 辅助分析页', dependsOn: '模型与合规策略' },
] as const;
