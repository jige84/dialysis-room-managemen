const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTestType(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  const map = {
    hbsag: 'hbsag',
    hbvdna: 'hbvdna',
    hcv: 'hcvab',
    hcvab: 'hcvab',
    hcvrna: 'hcvrna',
    hiv: 'hiv',
    tp: 'syphilis_tppa',
    syphilis: 'syphilis_tppa',
    syphilis_tppa: 'syphilis_tppa',
    syphilis_rpr: 'syphilis_rpr',
    chest_xray: 'chest_xray',
  };
  return map[s] || s;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function validateLatestBatchPayload(body) {
  const rawIds = Array.isArray(body?.patient_ids) ? body.patient_ids : [];
  if (rawIds.length > 500) {
    return { ok: false, message: 'patient_ids 最多支持 500 个' };
  }
  const patientIds = Array.from(new Set(rawIds.filter(isUuid)));
  return { ok: true, value: patientIds };
}

function normalizeScreeningItemsPayload(body) {
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0) {
    return { ok: false, message: '请提供筛查数据' };
  }
  return { ok: true, value: items };
}

function validateMonitoringPayload(body) {
  const payload = body || {};
  const { patient_id, monitor_year, monitor_month } = payload;
  if (!patient_id || !monitor_year || !monitor_month) {
    return { ok: false, message: '患者ID和月份为必填项' };
  }
  return { ok: true, value: payload };
}

function validateMonitoringBatchPayload(body) {
  const payload = body || {};
  if (!payload.records || !Array.isArray(payload.records)) {
    return { ok: false, message: 'records 字段为数组' };
  }
  return { ok: true, value: payload };
}

function normalizeButtonholeFilters(query) {
  const filters = {
    patient_id: query?.patient_id || null,
    year: query?.year || null,
    month: query?.month || null,
  };
  return { ok: true, value: filters };
}

module.exports = {
  normalizeTestType,
  validateLatestBatchPayload,
  normalizeScreeningItemsPayload,
  validateMonitoringPayload,
  validateMonitoringBatchPayload,
  normalizeButtonholeFilters,
};
