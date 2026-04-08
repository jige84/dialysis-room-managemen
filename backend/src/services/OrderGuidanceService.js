/**
 * 长期医嘱开立时的可选指导建议（不写入数据库）
 */
const { pool } = require('../config/database');
const MedicationRuleService = require('./MedicationRuleService');

/**
 * @param {object} params
 * @param {string} params.patientId
 * @param {string} params.drugName
 * @param {string} [params.orderType]
 */
async function buildGuidanceForNewOrder({ patientId, drugName, orderType = 'dialysis_drug' }) {
  const suggestions = [];
  const drug = (drugName || '').trim();
  if (!drug) return { guidance_suggestions: [] };

  const draftEval = await MedicationRuleService.evaluateForOrderDraft(patientId, drug, 'heparin');
  for (const issue of draftEval.issues) {
    suggestions.push({
      id: `rule-${issue.rule_id}-${issue.severity}`,
      text: issue.message,
      citation_code: issue.citation_code,
      citation_excerpt: issue.citation_excerpt,
      severity: issue.severity,
      optional: true,
    });
  }

  const { rows: gcAnticoag } = await pool.query(
    `SELECT code, title, excerpt_text FROM guideline_citations WHERE code = 'sop-2021-anticoag' LIMIT 1`,
  );
  if (gcAnticoag[0] && /肝素|依诺|低分子|枸橼|萘莫司他|抗凝/i.test(drug)) {
    suggestions.push({
      id: 'g-anticoag-general',
      text: '抗凝相关医嘱：请确认与透析处方抗凝方案一致，并关注出血征象与实验室监测。',
      citation_code: gcAnticoag[0].code,
      citation_title: gcAnticoag[0].title,
      citation_excerpt: gcAnticoag[0].excerpt_text,
      optional: true,
    });
  }

  if (orderType === 'interval_drug') {
    suggestions.push({
      id: 'g-interval',
      text: '间期用药：请确认与透析日用药的相互作用及服药时间（可选用或忽略）。',
      optional: true,
    });
  }

  return { guidance_suggestions: suggestions };
}

module.exports = { buildGuidanceForNewOrder };
