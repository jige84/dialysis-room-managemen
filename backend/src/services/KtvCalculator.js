/**
 * Kt/V 与 URR 计算服务（Daugirdas II）
 * 主要作用：按规程公式计算单次透析充分性指标，供透析保存与预警使用。
 * 主要功能：输入校验；spKt/V 与 URR；是否达标标记；与肝素/超滤等参数的处理（见实现）。
 */

class KtvCalculator {
  /**
   * 计算 Kt/V 和 URR
   * @param {object} params 计算参数
   * @returns {{ ktv, urr, isKtvReached, isUrrReached, calcUFVolume }}
   */
  calculate({ preBUN, postBUN, ufVolumeMl, postWeightKg, durationHours, isHeparin = true }) {
    if (!preBUN || !postBUN || preBUN <= 0 || postBUN <= 0) {
      return { ktv: null, urr: null, isKtvReached: null, isUrrReached: null };
    }

    const R = postBUN / preBUN;                   // 尿素下降比
    const t = durationHours;                      // 透析时长（小时）
    const UF = (ufVolumeMl || 0) / 1000;          // 超滤量（L）
    const W = postWeightKg;                       // 透析后体重（kg）

    // Daugirdas II 公式
    const ktv = -Math.log(R - 0.008 * t) + (4 - 3.5 * R) * (UF / W);
    const urr = (1 - R) * 100;

    return {
      ktv: Math.round(ktv * 100) / 100,
      urr: Math.round(urr * 100) / 100,
      isKtvReached: ktv >= 1.2,
      isUrrReached: urr >= 65,
    };
  }

  /**
   * 根据透析前后体重计算超滤量
   */
  calcUFVolume(preWeightKg, postWeightKg) {
    if (!preWeightKg || !postWeightKg) return 0;
    return Math.round((preWeightKg - postWeightKg) * 1000);
  }

  /**
   * 计算超滤量占干体重的百分比（预警用）
   */
  calcUFPercent(ufVolumeMl, dryWeightKg) {
    if (!dryWeightKg || !ufVolumeMl) return 0;
    return Math.round((ufVolumeMl / (dryWeightKg * 1000)) * 10000) / 100;
  }
}

module.exports = new KtvCalculator();
