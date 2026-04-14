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

module.exports = {
  validatePrepareQuery,
  validateYearMonthQuery,
  validateCreateDialysisPayload,
  validateDialysisNotePayload,
};

