/**
 * 按 anomalyType 装配近 3 个月结构化证据（无 PII）
 */
const { pool } = require('../config/database');

const MONTHS = 3;

/** @type {readonly string[]} */
const VALID_ANOMALY_TYPES = [
  'lab_abnormal',
  'lab_critical',
  'ktv_inadequate',
  'urr_inadequate',
  'bun_invalid',
  'uf_exceed',
  'infection_overdue',
  'infection_warning',
  'vascular_assessment_due',
  'dry_weight_overdue',
  'cvc_high_risk',
  'nurse_ratio',
  'lab_critical_alert',
  'ktv_inadequate_alert',
  'coagulation_severe',
  'dialysis_leak',
  'default',
];

function isValidAnomalyType(t) {
  return VALID_ANOMALY_TYPES.includes(t);
}

async function safeQuery(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * 近 3 个月检验（按类型可过滤）
 */
async function fetchLabs3m(patientId, { testTypes = null } = {}) {
  let sql = `
    SELECT id, test_date, test_type, value, unit,
           reference_low, reference_high, is_abnormal, is_critical
    FROM lab_results
    WHERE patient_id = $1
      AND test_date >= (CURRENT_DATE - ($2::int * INTERVAL '1 month'))
    `;
  const params = [patientId, MONTHS];
  if (testTypes?.length) {
    sql += ` AND test_type = ANY($3::varchar[])`;
    params.push(testTypes);
  }
  sql += ' ORDER BY test_date DESC, test_type LIMIT 200';
  return safeQuery(sql, params);
}

async function fetchDialysis3m(patientId) {
  const sql = `
    SELECT id, session_date, shift, ktv, urr, pre_bun, post_bun,
           pre_weight, post_weight, uf_volume,
           coagulation_grade, is_circuit_clotted, is_membrane_ruptured,
           actual_duration, blood_flow_rate
    FROM dialysis_records
    WHERE patient_id = $1
      AND session_date >= (CURRENT_DATE - ($2::int * INTERVAL '1 month'))
    ORDER BY session_date DESC
    LIMIT 120
  `;
  return safeQuery(sql, [patientId, MONTHS]);
}

async function fetchLabRowById(labId) {
  if (!labId) return null;
  const { rows } = await pool.query(
    `SELECT id, patient_id, test_date, test_type, value, unit,
            reference_low, reference_high, is_abnormal, is_critical
     FROM lab_results WHERE id = $1`,
    [labId],
  );
  return rows[0] || null;
}

async function fetchDialysisRowById(recordId) {
  if (!recordId) return null;
  const { rows } = await pool.query(
    `SELECT id, patient_id, session_date, shift, ktv, urr, pre_bun, post_bun,
            pre_weight, post_weight, uf_volume,
            coagulation_grade, is_circuit_clotted, is_membrane_ruptured,
            actual_duration, blood_flow_rate
     FROM dialysis_records WHERE id = $1`,
    [recordId],
  );
  return rows[0] || null;
}

async function fetchAlertById(alertId) {
  if (!alertId) return null;
  const { rows } = await pool.query(
    `SELECT id, patient_id, alert_type, severity, title, message,
            related_record_id, related_table, created_at
     FROM alerts WHERE id = $1`,
    [alertId],
  );
  return rows[0] || null;
}

async function fetchInfectionSummary(patientId) {
  const { rows } = await pool.query(
    `SELECT id, test_date, test_type, result, value, is_positive, next_due_date
     FROM infection_screenings
     WHERE patient_id = $1
     ORDER BY test_date DESC
     LIMIT 50`,
    [patientId],
  );
  return rows;
}

async function fetchInfectionRowById(id) {
  if (!id) return null;
  const { rows } = await pool.query(
    `SELECT id, patient_id, test_date, test_type, result, value, is_positive, next_due_date
     FROM infection_screenings WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** 送入大模型前移除行内患者标识（已在校验阶段使用 patient_id） */
function omitPatientId(row) {
  if (!row || typeof row !== 'object') return row;
  const { patient_id: _pid, ...rest } = row;
  return rest;
}

/**
 * 构建 evidence 与上下文 payload
 */
async function buildAnomalyEvidencePayload({
  patientId,
  anomalyType,
  contextId = null,
}) {
  const type = isValidAnomalyType(anomalyType) ? anomalyType : 'default';

  const labs = await fetchLabs3m(patientId);
  const sessions = await fetchDialysis3m(patientId);
  const infection = ['infection_overdue', 'infection_warning'].includes(type)
    ? await fetchInfectionSummary(patientId)
    : [];

  let focusLab = null;
  let focusDialysis = null;
  let focusAlert = null;
  let focusInfection = null;

  if (contextId) {
    if (type.includes('lab') || type === 'lab_critical_alert') {
      focusLab = await fetchLabRowById(contextId);
      if (focusLab && String(focusLab.patient_id) !== String(patientId)) {
        focusLab = null;
      }
    }
    if (
      type.includes('ktv') ||
      type.includes('urr') ||
      type === 'bun_invalid' ||
      type === 'uf_exceed' ||
      type === 'coagulation_severe' ||
      type === 'dialysis_leak'
    ) {
      focusDialysis = await fetchDialysisRowById(contextId);
      if (focusDialysis && String(focusDialysis.patient_id) !== String(patientId)) {
        focusDialysis = null;
      }
    }
    if (type.endsWith('_alert') || type === 'nurse_ratio') {
      focusAlert = await fetchAlertById(contextId);
      if (focusAlert && String(focusAlert.patient_id) !== String(patientId)) {
        focusAlert = null;
      }
    }
    if (type === 'infection_overdue' || type === 'infection_warning') {
      focusInfection = await fetchInfectionRowById(contextId);
      if (focusInfection && String(focusInfection.patient_id) !== String(patientId)) {
        focusInfection = null;
      }
    }
  }

  const tablesTouched = ['lab_results', 'dialysis_records'];
  if (infection.length) tablesTouched.push('infection_screenings');

  const evidence = {
    tables: tablesTouched,
    patientId,
    anomalyType: type,
    months: MONTHS,
    recordCounts: {
      lab_results: labs.length,
      dialysis_records: sessions.length,
    },
    focusLabId: focusLab?.id || null,
    focusDialysisId: focusDialysis?.id || null,
    focusAlertId: focusAlert?.id || null,
  };

  return {
    anomalyType: type,
    evidence,
    context: {
      labs3m: labs,
      dialysisSessions3m: sessions,
      infectionScreenings: infection,
      focusLab: omitPatientId(focusLab),
      focusDialysis: omitPatientId(focusDialysis),
      focusAlert: focusAlert ? omitPatientId(focusAlert) : null,
      focusInfection: omitPatientId(focusInfection),
    },
  };
}

module.exports = {
  VALID_ANOMALY_TYPES,
  isValidAnomalyType,
  buildAnomalyEvidencePayload,
  fetchLabs3m,
  fetchDialysis3m,
};
