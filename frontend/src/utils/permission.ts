import { useAuthStore } from '../stores/authStore';

export const usePermission = () => {
  const role = useAuthStore((s) => s.user?.role);
  return {
    canWrite:       !!role && ['admin', 'head_nurse', 'nurse', 'doctor'].includes(role),
    canManageUsers: role === 'admin',
    canSchedule:    !!role && ['admin', 'head_nurse'].includes(role),
    canExportData:  !!role && ['admin', 'head_nurse'].includes(role),
    canViewReports: !!role && ['admin', 'head_nurse', 'quality', 'qc'].includes(role),
    canPrescribe:   !!role && ['admin', 'doctor'].includes(role),
    canUseAI:       !!role && ['admin', 'doctor'].includes(role),
    canEnterDialysis: !!role && ['admin', 'head_nurse', 'nurse'].includes(role),
    isReadOnly:     role === 'qc' || role === 'quality',
  };
};

