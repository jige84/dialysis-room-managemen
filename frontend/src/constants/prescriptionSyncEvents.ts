/**
 * 处方保存后与透析录入页联动的浏览器事件名（同页/跨页均可触发重新拉取 prepare）
 */
export const HD_PRESCRIPTION_SAVED_EVENT = 'hd-prescription-saved';

export type PrescriptionSavedDetail = {
  patientId: string;
  savedAt: string;
};
