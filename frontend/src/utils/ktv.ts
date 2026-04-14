/**
 * Kt/V 与 URR 纯计算工具
 * 主要作用：集中透析充分性公式，避免页面内重复实现导致口径漂移。
 * 主要功能：Daugirdas II 计算、URR 计算、输入边界校验。
 */

export function calcSpKtv(
  preBun: number,
  postBun: number,
  durationHours: number,
  ufVolumeL: number,
  postWeightKg: number,
): number | null {
  if (!preBun || !postBun || postBun >= preBun) return null;
  if (durationHours < 1 || durationHours > 8) return null;
  if (postWeightKg < 20 || postWeightKg > 200) return null;
  if (ufVolumeL < 0 || ufVolumeL > 10) return null;

  const r = postBun / preBun;
  const ktv = -Math.log(r - 0.008 * durationHours) + (4 - 3.5 * r) * (ufVolumeL / postWeightKg);
  return Math.round(ktv * 100) / 100;
}

export function calcUrr(preBun: number, postBun: number): number | null {
  if (!preBun || !postBun || postBun >= preBun) return null;
  return Math.round((1 - postBun / preBun) * 100);
}

