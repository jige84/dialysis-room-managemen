/**
 * 透析路由入参校验（仅做格式/必填检查，不做业务查询）
 * 目标：让 routes 保持薄层，便于后续继续拆到 services/repositories。
 */

function validatePrepareQuery(query) {
  const patientId = query?.patientId;
  const date = query?.date;
  if (!patientId) return { ok: false, message: '请提供 patientId 参数' };
  return { ok: true, value: { patientId, date } };
}

function validateYearMonthQuery(query) {
  const year = query?.year;
  const month = query?.month;
  if (!year || !month) return { ok: false, message: '请提供 year 和 month 参数' };
  return { ok: true, value: { year, month } };
}

function validateCreateDialysisPayload(body) {
  const patientId = body?.patient_id;
  const sessionDate = body?.session_date;
  const shift = body?.shift;
  if (!patientId || !sessionDate || !shift) {
    return { ok: false, message: '患者、透析日期、班次为必填项' };
  }
  return { ok: true, value: body || {} };
}

function validateDialysisNotePayload(body) {
  const note = body?.note;
  if (!note || typeof note !== 'string' || !note.trim()) {
    return { ok: false, message: '备注内容不能为空' };
  }
  return { ok: true, value: { note: note.trim() } };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateSessionDraftQuery(query) {
  const patientId = query?.patient_id ?? query?.patientId;
  const date = query?.date ?? query?.session_date;
  if (!patientId || typeof patientId !== 'string' || !UUID_RE.test(patientId.trim())) {
    return { ok: false, message: 'patient_id 须为有效 UUID' };
  }
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return { ok: false, message: 'date 须为 YYYY-MM-DD' };
  }
  return { ok: true, value: { patient_id: patientId.trim(), session_date: date.trim() } };
}

function validateSessionDraftPutBody(body) {
  const patientId = body?.patient_id;
  const sessionDate = body?.session_date;
  const payload = body?.payload;
  if (!patientId || typeof patientId !== 'string' || !UUID_RE.test(patientId.trim())) {
    return { ok: false, message: 'patient_id 须为有效 UUID' };
  }
  if (!sessionDate || typeof sessionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate.trim())) {
    return { ok: false, message: 'session_date 须为 YYYY-MM-DD' };
  }
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload 须为 JSON 对象' };
  }
  return {
    ok: true,
    value: {
      patient_id: patientId.trim(),
      session_date: sessionDate.trim(),
      payload,
    },
  };
}

module.exports = {
  validatePrepareQuery,
  validateYearMonthQuery,
  validateCreateDialysisPayload,
  validateDialysisNotePayload,
  validateSessionDraftQuery,
  validateSessionDraftPutBody,
};

