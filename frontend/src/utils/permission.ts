/**
 * 前端权限能力 Hook（与后端 RBAC 对齐，用于 UI 显隐，非安全边界）
 * 主要作用：根据 `authStore` 当前用户角色返回一组布尔能力（开医嘱、导出、AI、CQI 等）。
 * 主要功能：`usePermission()` 供页面与按钮判断；服务端仍须对每个 API 做鉴权校验。
 */
import { useAuthStore } from '../stores/authStore';
import type { SidebarMenuKey } from '../constants/sidebarModules';
import type { AiAssistantFeaturePermissionKey } from '../constants/aiAssistantFeatures';
import { hasAiAssistantFeature, isMenuKeyAllowed } from './menuAccess';

export const usePermission = () => {
  const role = useAuthStore((s) => s.user?.role);
  const menuPermissions = useAuthStore((s) => s.user?.menu_permissions);

  /** 临床 AI 与知识库/指南等：仅按管理员配置的 menu_permissions（与后端 menuPermission 中间件一致），不再绑定固定角色 */
  const canUseAiModule = (key: SidebarMenuKey) => isMenuKeyAllowed(key, menuPermissions);

  return {
    canWrite:       !!role && ['admin', 'head_nurse', 'nurse', 'doctor'].includes(role),
    canManageUsers: role === 'admin',
    canSchedule:    !!role && ['admin', 'head_nurse'].includes(role),
    canExportData:  !!role && ['admin', 'head_nurse'].includes(role),
    canViewReports: !!role && ['admin', 'head_nurse', 'quality', 'qc'].includes(role),
    canPrescribe:   !!role && ['admin', 'doctor'].includes(role),
    /** 患者维度等临床 AI（助手页、血管通路内嵌 AI）；与侧栏「AI 分析助手」一致 */
    canUseAI:       canUseAiModule('/ai/assistant'),
    canUseAiAssistant: canUseAiModule('/ai/assistant'),
    /** 与 users.menu_permissions 中 ai_feat:* 一致 */
    canUseAiAssistantFeature: (featureKey: AiAssistantFeaturePermissionKey) =>
      hasAiAssistantFeature(menuPermissions, featureKey),
    canUseAiGuidelines: canUseAiModule('/ai/guidelines'),
    canUseAiKnowledge: canUseAiModule('/ai/knowledge'),
    /** 质控月报 AI 解读：须侧栏「质控上报报表」或「AI 分析助手」之一（与后端 /ai/qc-monthly-insight 一致） */
    canUseQcMonthlyInsight:
      isMenuKeyAllowed('/reports', menuPermissions) ||
      isMenuKeyAllowed('/ai/assistant', menuPermissions),
    /** 与后端 CQI 写入一致：仅 admin、护士长（质控/ qc 只读） */
    canEditCqi:     !!role && ['admin', 'head_nurse'].includes(role),
    /** 质控月报提交：与 reports qc-upload/submit 一致 */
    canSubmitMonthlyQc: !!role && ['admin', 'head_nurse'].includes(role),
    /** 质控月报科主任确认：与 reports confirm 一致，仅 admin */
    canConfirmMonthlyQc: role === 'admin',
    canReportDefect: !!role && ['admin', 'doctor', 'head_nurse', 'nurse'].includes(role),
    canManageMedicalSites: role === 'admin',
    canEnterDialysis: !!role && ['admin', 'head_nurse', 'nurse'].includes(role),
    isReadOnly:     role === 'qc' || role === 'quality',
  };
};

