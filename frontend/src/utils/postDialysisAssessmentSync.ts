/**
 * 透析后评估（透后血压/脉搏/体重）在「处方工作台」与「透析记录录入」之间的本地同步。
 * 任一侧填写后写入 localStorage，另一侧只读展示，避免重复录入。
 */

export const POST_DIALYSIS_SYNC_EVENT = 'hd-post-dialysis-sync';

export type PostDialysisFilledBy = 'doctor' | 'nurse';

export interface PostDialysisSyncPayload {
  patientId: string;
  postSbp: number | null;
  postDbp: number | null;
  postPulse: number | null;
  postWeightKg: number | null;
  filledBy: PostDialysisFilledBy;
  updatedAt: string;
}

export function getPostDialysisSyncStorageKey(patientId: string): string {
  return `hd_post_dialysis_assessment_sync_v1:${patientId}`;
}

export function readPostDialysisSync(patientId: string): PostDialysisSyncPayload | null {
  if (!patientId) return null;
  try {
    const raw = localStorage.getItem(getPostDialysisSyncStorageKey(patientId));
    if (!raw) return null;
    const p = JSON.parse(raw) as PostDialysisSyncPayload;
    if (!p || typeof p !== 'object' || p.patientId !== patientId) return null;
    if (p.filledBy !== 'doctor' && p.filledBy !== 'nurse') return null;
    return p;
  } catch {
    return null;
  }
}

export function writePostDialysisSync(payload: PostDialysisSyncPayload): void {
  try {
    localStorage.setItem(getPostDialysisSyncStorageKey(payload.patientId), JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(POST_DIALYSIS_SYNC_EVENT, { detail: payload }));
  } catch {
    /* quota */
  }
}
