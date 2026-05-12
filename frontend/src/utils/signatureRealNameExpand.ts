import { buildRealNameInitialSegments } from './patientNamePinyin';

/**
 * 签名栏纯字母输入 → 按「用户管理中的真实姓名」首字母链展开为汉字片段或全名（大小写不敏感）。
 * 仅当整段输入为 a–z / A–Z 时尝试展开；含汉字或其它字符则原样返回。
 * 多人在相同前缀下展开结果一致时仍展开；展开结果不一致则不替换，保留用户输入。
 */
export function expandSignatureInputWithCandidates(
  rawInput: string,
  candidateRealNames: readonly string[],
): string {
  const trimmed = String(rawInput ?? '').trim();
  if (!trimmed) return trimmed;
  if (!/^[a-zA-Z]+$/.test(trimmed)) return trimmed;
  const q = trimmed.toLowerCase();
  const expansions = new Set<string>();
  const uniqNames = [...new Set(candidateRealNames.map((n) => String(n ?? '').trim()).filter(Boolean))];
  for (const fullName of uniqNames) {
    const segs = buildRealNameInitialSegments(fullName);
    if (segs.length === 0) continue;
    const initials = segs.map((s) => s.initial).join('');
    if (!initials.startsWith(q)) continue;
    if (q.length > initials.length) continue;
    const expanded = segs.slice(0, q.length).map((s) => s.char).join('');
    if (expanded) expansions.add(expanded);
  }
  if (expansions.size === 1) return [...expansions][0]!;
  return trimmed;
}
