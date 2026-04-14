const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function validateOptionalStartDate(raw) {
  if (raw && !DATE_PARAM_RE.test(String(raw))) {
    return { ok: false, message: 'start_date 须为 YYYY-MM-DD' };
  }
  return { ok: true, value: raw };
}

function validateCreateSlotPayload(body) {
  const payload = body || {};
  const { patient_id, scheduled_date, shift, machine_id } = payload;
  if (!patient_id || !scheduled_date || !shift || !machine_id) {
    return { ok: false, message: 'patient_id、scheduled_date、shift、machine_id 为必填项' };
  }
  if (!isValidUuid(patient_id) || !isValidUuid(machine_id)) {
    return { ok: false, message: 'ID 格式无效', statusCode: 400 };
  }
  return { ok: true, value: payload };
}

function validateScheduleSlotId(id) {
  if (!isValidUuid(id)) {
    return { ok: false, message: '排班ID格式无效', statusCode: 400 };
  }
  return { ok: true };
}

function validateNurseSheetWeekStart(raw) {
  if (!raw || !DATE_PARAM_RE.test(String(raw))) {
    return { ok: false, message: 'week_start 须为 YYYY-MM-DD', statusCode: 400 };
  }
  return { ok: true, value: String(raw) };
}

function validateNurseSheetWeekStartBody(raw) {
  if (!raw || !DATE_PARAM_RE.test(String(raw))) {
    return { ok: false, message: 'week_start_date 须为 YYYY-MM-DD', statusCode: 400 };
  }
  return { ok: true, value: String(raw) };
}

function validateSchedulePatientId(patientId) {
  if (!isValidUuid(patientId)) {
    return { ok: false, message: '患者ID格式无效', statusCode: 400 };
  }
  return { ok: true };
}

function validateScheduleRulePayload(body) {
  const payload = body || {};
  const { patient_id, pattern_type, days, shift, start_date } = payload;
  if (!patient_id || !pattern_type || !Array.isArray(days) || !days.length || !shift || !start_date) {
    return { ok: false, message: 'patient_id、pattern_type、days、shift、start_date 为必填项' };
  }
  return { ok: true, value: payload };
}

function validateNurseAdjustPayload(body) {
  const payload = body || {};
  const { date, shift } = payload;
  if (!date || !shift) {
    return { ok: false, message: 'date 与 shift 为必填项' };
  }
  return { ok: true, value: payload };
}

module.exports = {
  isValidUuid,
  validateOptionalStartDate,
  validateCreateSlotPayload,
  validateScheduleSlotId,
  validateNurseSheetWeekStart,
  validateNurseSheetWeekStartBody,
  validateSchedulePatientId,
  validateScheduleRulePayload,
  validateNurseAdjustPayload,
};

