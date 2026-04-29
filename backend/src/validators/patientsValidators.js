function hasOwn(body, key) {
  return Object.prototype.hasOwnProperty.call(body || {}, key);
}

const CUSTOM_SCHEDULE_NOTE_PREFIX = '[自定排班] ';

function isValidCustomScheduleNotes(notes) {
  if (!notes || typeof notes !== 'string' || !notes.startsWith(CUSTOM_SCHEDULE_NOTE_PREFIX)) return false;
  try {
    const raw = JSON.parse(notes.slice(CUSTOM_SCHEDULE_NOTE_PREFIX.length));
    const isWeek = (week) => (
      Array.isArray(week?.weekdays)
      && week.weekdays.some((d) => Number.isInteger(Number(d)) && Number(d) >= 0 && Number(d) <= 6)
      && ['morning', 'afternoon', 'evening'].includes(String(week?.shift))
    );
    return isWeek(raw.week1) && isWeek(raw.week2);
  } catch (_) {
    return false;
  }
}

function validateCreatePatientRequiredFields(body) {
  const payload = body || {};
  const {
    name,
    gender,
    dob,
    dialysis_start_date,
    primary_diagnosis,
    patient_identifier,
  } = payload;
  if (!name || !gender || !dob || !dialysis_start_date || !primary_diagnosis || !String(patient_identifier || '').trim()) {
    return { ok: false, message: '姓名、患者真实ID、性别、出生日期、开始透析日期、诊断为必填项' };
  }
  return { ok: true };
}

function normalizeCreateScheduleFields(body) {
  const payload = body || {};
  const scheduleNotes = typeof payload.dialysis_schedule_notes === 'string'
    ? payload.dialysis_schedule_notes.trim() || null
    : null;

  const anchorStr = payload.dialysis_schedule_anchor_date != null && String(payload.dialysis_schedule_anchor_date).trim()
    ? String(payload.dialysis_schedule_anchor_date).trim().slice(0, 10)
    : null;

  if (payload.dialysis_schedule_code === 'qod' && !anchorStr) {
    return { ok: false, message: '选择隔日透析时请填写隔日锚点日期' };
  }
  if (payload.dialysis_schedule_code === 'custom_cycle' && !isValidCustomScheduleNotes(scheduleNotes)) {
    return { ok: false, message: '自定排班方案不完整，请选择两周内的透析日和时段' };
  }

  return {
    ok: true,
    value: {
      scheduleNotes,
      scheduleAnchorDate: payload.dialysis_schedule_code === 'qod' ? anchorStr : null,
    },
  };
}

function normalizeUpdateScheduleFields(body, existingPatient) {
  const payload = body || {};
  const existing = existingPatient || {};

  const hasDialysisCodeKey = hasOwn(payload, 'dialysis_schedule_code');
  const dialysisCodeVal = hasDialysisCodeKey
    ? (typeof payload.dialysis_schedule_code === 'string' ? payload.dialysis_schedule_code.trim() || null : null)
    : null;

  const hasDialysisNotesKey = hasOwn(payload, 'dialysis_schedule_notes');
  const dialysisNotesVal = hasDialysisNotesKey
    ? (typeof payload.dialysis_schedule_notes === 'string' ? payload.dialysis_schedule_notes.trim() || null : null)
    : null;

  const hasDialysisStartKey = hasOwn(payload, 'dialysis_start_date');
  const dialysisStartVal = hasDialysisStartKey
    ? (
        payload.dialysis_start_date != null && String(payload.dialysis_start_date).trim()
          ? String(payload.dialysis_start_date).trim().slice(0, 10)
          : null
      )
    : null;

  const nextDialysisCode = hasDialysisCodeKey ? dialysisCodeVal : existing.dialysis_schedule_code;
  const hasAnchorKey = hasOwn(payload, 'dialysis_schedule_anchor_date');
  let nextAnchor = existing.dialysis_schedule_anchor_date;
  if (hasDialysisCodeKey && dialysisCodeVal !== 'qod') {
    nextAnchor = null;
  } else if (hasAnchorKey) {
    const raw = payload.dialysis_schedule_anchor_date;
    nextAnchor = raw != null && String(raw).trim()
      ? String(raw).trim().slice(0, 10)
      : null;
  }

  if (nextDialysisCode === 'qod' && !nextAnchor) {
    return { ok: false, message: '选择隔日透析时请填写隔日锚点日期' };
  }
  const nextNotes = hasDialysisNotesKey ? dialysisNotesVal : existing.dialysis_schedule_notes;
  if (nextDialysisCode === 'custom_cycle' && !isValidCustomScheduleNotes(nextNotes)) {
    return { ok: false, message: '自定排班方案不完整，请选择两周内的透析日和时段' };
  }

  return {
    ok: true,
    value: {
      hasDialysisCodeKey,
      dialysisCodeVal,
      hasDialysisNotesKey,
      dialysisNotesVal,
      hasDialysisStartKey,
      dialysisStartVal,
      nextAnchor,
    },
  };
}

function parseUpdateProfileDryWeight(body) {
  const payload = body || {};
  if (!hasOwn(payload, 'profile_dry_weight')) {
    return { ok: true, value: null };
  }

  const rawDw = payload.profile_dry_weight;
  if (rawDw === null || rawDw === undefined || rawDw === '') {
    return { ok: false, message: '干体重为必填项', statusCode: 400 };
  }
  const dw = parseFloat(String(rawDw));
  if (!Number.isFinite(dw) || dw < 20 || dw > 200) {
    return { ok: false, message: '干体重须在 20–200 kg 范围内', statusCode: 400 };
  }

  const rawDate = payload.profile_dry_weight_date;
  const dwd =
    rawDate != null && String(rawDate).trim()
      ? String(rawDate).trim().slice(0, 10)
      : null;
  if (!dwd) {
    return { ok: false, message: '干体重评估日期为必填项', statusCode: 400 };
  }

  const dwr =
    payload.profile_dry_weight_reason != null && String(payload.profile_dry_weight_reason).trim()
      ? String(payload.profile_dry_weight_reason).trim().slice(0, 2000)
      : null;

  return {
    ok: true,
    value: { dw, dwd, dwr },
  };
}

module.exports = {
  validateCreatePatientRequiredFields,
  normalizeCreateScheduleFields,
  normalizeUpdateScheduleFields,
  parseUpdateProfileDryWeight,
};
