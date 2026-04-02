/**
 * CVC 感染高危评分（6 因素加权规则）
 * 来源：medical-domain-rules §4.1
 * 主要作用：根据 6 个临床因子计算导管相关感染风险分值与等级，供血管通路路由调用。
 */

// 来源：medical-domain-rules §4.1 CVC 感染高危评分维度
const FACTOR_WEIGHTS = {
  diabetes_mellitus:      2,  // 糖尿病
  immunosuppressed:       2,  // 免疫抑制
  recent_hospitalization: 1,  // 近期住院
  catheter_days_over90:   2,  // 留管 > 90 天
  previous_crbsi:         3,  // 既往 CRBSI
  poor_hygiene:           1,  // 卫生依从性差
};

const FACTOR_LABELS = {
  diabetes_mellitus:      '糖尿病',
  immunosuppressed:       '免疫抑制',
  recent_hospitalization: '近期住院',
  catheter_days_over90:   '留管 > 90 天',
  previous_crbsi:         '既往 CRBSI',
  poor_hygiene:           '卫生依从性差',
};

class CVCRiskScoring {
  /**
   * 计算 CVC 感染高危评分
   * 来源：medical-domain-rules §4.1
   * @param {object} factors 各评分因素（boolean 值，key 为 FACTOR_WEIGHTS 中的字段名）
   * @returns {{ total_score, risk_grade, risk_label, score_summary }}
   */
  calculate(factors) {
    let total_score = 0;
    const score_summary = [];

    for (const [key, weight] of Object.entries(FACTOR_WEIGHTS)) {
      if (factors[key]) {
        total_score += weight;
        score_summary.push({ factor: key, label: FACTOR_LABELS[key], score: weight });
      }
    }

    // 风险等级阈值：来源 medical-domain-rules §4.1
    const risk_grade = total_score >= 6 ? 3 : total_score >= 3 ? 2 : 1;
    const risk_label = ['', '低风险', '中等风险', '高风险'][risk_grade];

    return { total_score, risk_grade, risk_label, score_summary };
  }

  /**
   * 根据患者信息自动预填部分评分因素（客观可判断的项目）
   * @param {object} patient 患者基本信息（comorbidities、immunosuppressed 字段）
   * @param {object} access  血管通路信息（access_type、established_date）
   * @returns {object} 预填的因素对象
   */
  autoFillFactors(patient, access) {
    const hasDiabetes = (patient.comorbidities || []).includes('diabetes') ||
                        (patient.diagnosis || '').includes('糖尿病');
    const isImmunosuppressed = patient.immunosuppressed === true;

    const catheterDays = access.established_date
      ? Math.floor((Date.now() - new Date(access.established_date)) / 86400000)
      : 0;

    return {
      diabetes_mellitus:      hasDiabetes,
      immunosuppressed:       isImmunosuppressed,
      recent_hospitalization: false,     // 需护士手动勾选
      catheter_days_over90:   catheterDays > 90,
      previous_crbsi:         false,     // 需护士手动勾选
      poor_hygiene:           false,     // 需护士手动勾选
    };
  }

  /** 返回所有因素的 key/label/weight，供前端渲染用 */
  getFactorDefinitions() {
    return Object.entries(FACTOR_WEIGHTS).map(([key, weight]) => ({
      key,
      label: FACTOR_LABELS[key],
      weight,
    }));
  }
}

module.exports = new CVCRiskScoring();
