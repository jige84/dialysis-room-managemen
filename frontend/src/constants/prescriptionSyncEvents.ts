/**
 * 处方保存后与透析录入页联动的浏览器事件名（同页/跨页均可触发重新拉取 prepare）
 */
export const HD_PRESCRIPTION_SAVED_EVENT = 'hd-prescription-saved';

export type PrescriptionSavedDetail = {
  patientId: string;
  savedAt: string;
};

/**
 * 长期医嘱开立/停止等变更后与透析录入页联动（重新拉取 prepare 中的 ordersToday）
 */
export const HD_LONG_TERM_ORDER_SAVED_EVENT = 'hd-long-term-order-saved';

export type LongTermOrderSavedDetail = {
  patientId: string;
  savedAt: string;
};
