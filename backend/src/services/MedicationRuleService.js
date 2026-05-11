/**
 * 用药规则引擎：重复用药、相互作用、禁忌（基于 medication_rules 表）
 */
const { pool } = require('../config/database');

const ANTICOAGULANT_LABELS = {
  heparin: '肝素',
  lmwh: '低分子肝素',
  enoxaparin: '依诺肝素',
  bemiparin: '贝米肝素',
  nafamostat: '甲磺酸萘莫司他',
  citrate: '枸橼酸',
  none: '',
};

/**
 * @param {string} patientId
 * @param {object} options
 * @param {string} [options.anticoagulantKey] — prescriptions 表枚举或前端 key
 */
async function evaluateForPrescription(patientId, { anticoagulantKey = 'heparin' } = {}) {
  const { rows: rules } = await pool.query(
    `SELECT r.id, r.rule_type, r.severity, r.drug_pattern_a, r.drug_pattern_b, r.message_zh,
            r.citation_id, gc.code AS citation_code, gc.excerpt_text AS citation_excerpt
     FROM medication_rules r
     LEFT JOIN guideline_citations gc ON gc.id = r.citation_id
     WHERE r.is_active = true`,
  );

  const { rows: orders } = await pool.query(
    `SELECT drug_name, dose, route
     FROM long_term_orders
     WHERE patient_id = $1 AND status = 'active'
       AND valid_from <= CURRENT_DATE
       AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)`,
    [patientId],
  );

  const acLabel = ANTICOAGULANT_LABELS[anticoagulantKey] || '';
  const orderDrugItems = orders
    .map((o) => ({
      text: `${o.drug_name || ''}`.trim(),
      source: 'order',
    }))
    .filter((x) => x.text);
  const prescriptionDrugItems = acLabel
    ? [{ text: acLabel, source: 'prescription' }]
    : [];
  const drugItems = [...orderDrugItems, ...prescriptionDrugItems];

  const issues = [];

  for (let i = 0; i < drugItems.length; i++) {
    for (let j = i + 1; j < drugItems.length; j++) {
      const a = drugItems[i].text;
      const b = drugItems[j].text;
      const sourceA = drugItems[i].source;
      const sourceB = drugItems[j].source;
      for (const rule of rules) {
        if (rule.rule_type === 'duplicate') {
          // 处方抗凝方案与同名长期医嘱在本系统中常为同一治疗方案描述，不应触发“重复用药”误报。
          // duplicate 仅在长期医嘱之间判定，interaction/contraindication 仍保留跨来源判定。
          if (sourceA !== 'order' || sourceB !== 'order') continue;
          if (
            rule.drug_pattern_b &&
            a.includes(rule.drug_pattern_a) &&
            b.includes(rule.drug_pattern_b) &&
            rule.drug_pattern_a === rule.drug_pattern_b
          ) {
            issues.push({
              rule_id: rule.id,
              rule_type: rule.rule_type,
              severity: rule.severity,
              message: rule.message_zh,
              citation_code: rule.citation_code,
              citation_excerpt: rule.citation_excerpt,
              pair: [a, b],
            });
          }
        } else if (rule.rule_type === 'interaction' || rule.rule_type === 'contraindication') {
          const m1 = a.includes(rule.drug_pattern_a) && b.includes(rule.drug_pattern_b);
          const m2 = a.includes(rule.drug_pattern_b) && b.includes(rule.drug_pattern_a);
          if (m1 || m2) {
            issues.push({
              rule_id: rule.id,
              rule_type: rule.rule_type,
              severity: rule.severity,
              message: rule.message_zh,
              citation_code: rule.citation_code,
              citation_excerpt: rule.citation_excerpt,
              pair: [a, b],
            });
          }
        }
      }
    }
  }

  // 去重（同 rule + 同 pair）
  const seen = new Set();
  const unique = issues.filter((x) => {
    const k = `${x.rule_id}|${x.pair.join('|')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const hasBlock = unique.some((i) => i.severity === 'block');

  return { issues: unique, has_block: hasBlock };
}

/**
 * 方案级提示与可溯源条文（规则优先）
 */
async function buildMedicationGuidancePlan(patientId, { anticoagulantKey = 'heparin' } = {}) {
  const evalResult = await evaluateForPrescription(patientId, { anticoagulantKey });
  const { rows: labs } = await pool.query(
    `SELECT test_type, value, unit, test_date, is_abnormal
     FROM lab_results
     WHERE patient_id = $1
     ORDER BY test_date DESC
     LIMIT 15`,
    [patientId],
  );

  const points = [];
  if (evalResult.issues.length > 0) {
    points.push({
      kind: 'rule',
      text: `当前处方与医嘱组合检出 ${evalResult.issues.length} 条规则提示，请结合临床逐条确认。`,
      citation_ids: [...new Set(evalResult.issues.map((i) => i.citation_code).filter(Boolean))],
    });
  }

  const ca = labs.find((l) => l.test_type === 'ca');
  const p = labs.find((l) => l.test_type === 'p');
  if ((ca && ca.is_abnormal) || (p && p.is_abnormal)) {
    const { rows: gc } = await pool.query(
      `SELECT code, excerpt_text FROM guideline_citations WHERE code = 'kdigo-ckd-mbd-lab' LIMIT 1`,
    );
    if (gc[0]) {
      points.push({
        kind: 'lab',
        text: '检验提示钙/磷相关指标异常，CKD-MBD 管理需结合活性维生素D与磷结合剂等调整（目标区间以本院参考为准）。',
        citation_ids: [gc[0].code],
        citation_excerpt: gc[0].excerpt_text,
      });
    }
  }

  const { rows: ktvRef } = await pool.query(
    `SELECT code, excerpt_text FROM guideline_citations WHERE code = 'sop-2021-ch11-ktv' LIMIT 1`,
  );
  if (ktvRef[0]) {
    points.push({
      kind: 'general',
      text: '透析充分性以 spKt/V 与 URR 为参考，需结合处方与患者依从性综合评估。',
      citation_ids: [ktvRef[0].code],
      citation_excerpt: ktvRef[0].excerpt_text,
    });
  }

  return {
    plan_points: points,
    rule_issues: evalResult.issues,
    recent_labs_summary: labs.slice(0, 5),
  };
}

/**
 * 评估「新增一条医嘱药品」与现有医嘱 + 处方抗凝的相互作用
 * @param {string} patientId
 * @param {string} newDrugName
 * @param {string} [anticoagulantKey]
 */
async function evaluateForOrderDraft(patientId, newDrugName, anticoagulantKey = 'heparin') {
  const drug = (newDrugName || '').trim();
  const { rows: rules } = await pool.query(
    `SELECT r.id, r.rule_type, r.severity, r.drug_pattern_a, r.drug_pattern_b, r.message_zh,
            gc.code AS citation_code, gc.excerpt_text AS citation_excerpt
     FROM medication_rules r
     LEFT JOIN guideline_citations gc ON gc.id = r.citation_id
     WHERE r.is_active = true`,
  );

  const { rows: orders } = await pool.query(
    `SELECT drug_name FROM long_term_orders
     WHERE patient_id = $1 AND status = 'active'
       AND valid_from <= CURRENT_DATE
       AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)`,
    [patientId],
  );

  const acLabel = ANTICOAGULANT_LABELS[anticoagulantKey] || '';
  const drugStrings = [...orders.map((o) => o.drug_name || ''), ...(acLabel ? [acLabel] : []), ...(drug ? [drug] : [])].filter(
    Boolean,
  );

  const issues = [];
  for (let i = 0; i < drugStrings.length; i++) {
    for (let j = i + 1; j < drugStrings.length; j++) {
      const a = drugStrings[i];
      const b = drugStrings[j];
      for (const rule of rules) {
        if (rule.rule_type === 'duplicate' && rule.drug_pattern_a === rule.drug_pattern_b) {
          if (a.includes(rule.drug_pattern_a) && b.includes(rule.drug_pattern_b)) {
            issues.push({
              rule_id: rule.id,
              rule_type: rule.rule_type,
              severity: rule.severity,
              message: rule.message_zh,
              citation_code: rule.citation_code,
              citation_excerpt: rule.citation_excerpt,
              pair: [a, b],
            });
          }
        } else if (rule.rule_type === 'interaction' || rule.rule_type === 'contraindication') {
          const m1 = a.includes(rule.drug_pattern_a) && b.includes(rule.drug_pattern_b);
          const m2 = a.includes(rule.drug_pattern_b) && b.includes(rule.drug_pattern_a);
          if (m1 || m2) {
            issues.push({
              rule_id: rule.id,
              rule_type: rule.rule_type,
              severity: rule.severity,
              message: rule.message_zh,
              citation_code: rule.citation_code,
              citation_excerpt: rule.citation_excerpt,
              pair: [a, b],
            });
          }
        }
      }
    }
  }

  const seen = new Set();
  const unique = issues.filter((x) => {
    const k = `${x.rule_id}|${x.pair.join('|')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    issues: unique,
    has_block: unique.some((i) => i.severity === 'block'),
  };
}

module.exports = {
  evaluateForPrescription,
  evaluateForOrderDraft,
  buildMedicationGuidancePlan,
  ANTICOAGULANT_LABELS,
};
