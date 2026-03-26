/**
 * CVC感染高危评分服务
 * 对应架构文档第6.4节和需求文档第3.5.5节
 */

const SCORE_MAP = {
  factor_a_urokinase: 4,
  factor_b_thrombus:  3,
  factor_c_poor_flow: 2,
  factor_d_long_ncc:  2,
  factor_e_infection: 5,
  factor_f_ncc:       3,
  factor_f_tcc:       2,
  factor_g_femoral:   4,
  factor_g_jugular:   2,
  factor_h_in_situ:   5,
  factor_i_interv:    3,
  factor_j_age70:     2,
  factor_j_diabetes:  2,
};

class CVCRiskScoring {
  /**
   * 计算CVC感染高危评分
   * @param {object} factors 各评分因素（boolean值）
   * @returns {{ totalScore, riskGrade, scoreSummary }}
   */
  calculate(factors) {
    let totalScore = 0;
    const scoreSummary = [];

    for (const [key, score] of Object.entries(SCORE_MAP)) {
      if (factors[key]) {
        totalScore += score;
        scoreSummary.push({ factor: key, score });
      }
    }

    const riskGrade = totalScore > 16 ? 3 : totalScore >= 13 ? 2 : 1;

    return {
      totalScore,
      riskGrade,
      scoreSummary,
      riskLabel: ['', 'Ⅰ度（有可能）', 'Ⅱ度（风险较高）', 'Ⅲ度（随时可能）'][riskGrade],
    };
  }

  /**
   * 溶栓后自动更新评分（加上 factor_a_urokinase）
   */
  afterThrombolysis(currentFactors) {
    return this.calculate({ ...currentFactors, factor_a_urokinase: true });
  }

  /**
   * 根据患者信息自动预填评分因素
   * @param {object} patient 患者基本信息
   * @param {object} access 血管通路信息
   * @returns {object} 自动判断的因素
   */
  autoFillFactors(patient, access) {
    const age = patient.age || 0;
    const hasDiabetes = (patient.comorbidities || []).includes('diabetes');
    const isNCC = access.access_type === 'ncc';
    const isTCC = access.access_type === 'tcc';
    const isFemoral = (access.location || '').includes('股静脉');
    const isJugular = (access.location || '').includes('颈内静脉');

    // 计算NCC留置天数
    const nccDays = isNCC && access.established_date
      ? Math.floor((Date.now() - new Date(access.established_date)) / 86400000)
      : 0;

    return {
      factor_d_long_ncc: isNCC && nccDays > 30,
      factor_f_ncc:      isNCC,
      factor_f_tcc:      isTCC,
      factor_g_femoral:  isFemoral,
      factor_g_jugular:  isJugular && !isFemoral,
      factor_j_age70:    age >= 70,
      factor_j_diabetes: hasDiabetes,
      // 以下需要护士手动勾选
      factor_a_urokinase: false,
      factor_b_thrombus:  false,
      factor_c_poor_flow: false,
      factor_e_infection: false,
      factor_h_in_situ:   false,
      factor_i_interv:    false,
    };
  }
}

module.exports = new CVCRiskScoring();
