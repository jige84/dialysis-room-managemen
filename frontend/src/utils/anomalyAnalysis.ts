/**
 * 前端 anomalyType 与展示文案
 */

export type AnomalyType =
  | 'lab_abnormal'
  | 'lab_critical'
  | 'ktv_inadequate'
  | 'urr_inadequate'
  | 'bun_invalid'
  | 'uf_exceed'
  | 'infection_overdue'
  | 'infection_warning'
  | 'vascular_assessment_due'
  | 'dry_weight_overdue'
  | 'cvc_high_risk'
  | 'nurse_ratio'
  | 'lab_critical_alert'
  | 'ktv_inadequate_alert'
  | 'coagulation_severe'
  | 'dialysis_leak'
  | 'default';

/** 预警 alert_type → anomalyType */
export function alertTypeToAnomaly(alertType: string): AnomalyType {
  const m: Record<string, AnomalyType> = {
    lab_critical: 'lab_critical_alert',
    ktv_inadequate: 'ktv_inadequate_alert',
    infection_overdue: 'infection_overdue',
    infection_warning: 'infection_warning',
    vascular_assessment_due: 'vascular_assessment_due',
    uf_exceed: 'uf_exceed',
    nurse_ratio: 'nurse_ratio',
    dry_weight_overdue: 'dry_weight_overdue',
    cvc_high_risk: 'cvc_high_risk',
  };
  return m[alertType] ?? 'default';
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
