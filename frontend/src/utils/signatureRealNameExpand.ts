import { buildPatientNameInitialsChain, buildRealNameInitialSegments } from './patientNamePinyin';

/** 下拉候选项：value 为完整姓名；label 含首字母链便于核对 */
export type SignatureNameAutocompleteOption = { value: string; label: string };

const AUTOCOMPLETE_DEFAULT_LIMIT = 40;

/**
 * 根据当前输入生成护士/医生签名下拉选项。
 * - 纯字母：按姓名「逐字拼音首字母」串联串做前缀匹配（大小写不敏感），与 buildPatientNameInitialsChain 一致。
 * - 含汉字等非纯字母：按姓名子串包含匹配（便于直接搜汉字）。
 * - 空输入：不返回候选项（不弹层），避免无意义长列表。
 */
export function matchSignatureNamesForAutocomplete(
  input: string,
  candidateRealNames: readonly string[],
  limit = AUTOCOMPLETE_DEFAULT_LIMIT,
): SignatureNameAutocompleteOption[] {
  const raw = String(input ?? '').trim();
  const uniq = [...new Set(candidateRealNames.map((n) => String(n ?? '').trim()).filter(Boolean))];
  if (uniq.length === 0) return [];
  if (!raw) return [];

  if (/^[a-zA-Z]+$/.test(raw)) {
    const q = raw.toLowerCase();
    return uniq
      .filter((name) => buildPatientNameInitialsChain(name).toLowerCase().startsWith(q))
      .slice(0, limit)
      .map((value) => ({
        value,
        label: `${value}（${buildPatientNameInitialsChain(value)}）`,
      }));
  }

  return uniq
    .filter((name) => name.includes(raw))
    .slice(0, limit)
    .map((value) => ({ value, label: value }));
}

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
