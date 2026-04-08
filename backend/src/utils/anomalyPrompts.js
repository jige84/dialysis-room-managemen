/**
 * 按 anomalyType 返回 system / user 提示片段（与 .cursor/skills/hd-anomaly-analysis 对齐）
 */

const STRUCTURE_BLOCK =
  '\n\n【输出格式】须使用 Markdown，按以下标题组织，「分条分析」中每条须写完整，不得中途截断：' +
  '\n### 数据简要概括（1–3 句，仅依据所提供 JSON 中已有数值、日期与项目代码）' +
  '\n### 分条分析' +
  '\n对每一项异常或关注点编号（1. 2. …）。每条**必须**包含三个层次（可用小标题或加粗）：' +
  '\n- **依据**：用**中文可读表述**引用数据（例如「近3个月检验中白蛋白（alb）为…」「本次关联检验项目的数值为…」），**严禁**在正文出现 JSON 内部键名、英文变量名或代码式片段（包括但不限于 labs3m、dialysisSessions3m、focusLab、focusDialysis、focusAlert、focusInfection、infectionScreenings、kbSnippets、evidence 等）。' +
  '\n- **处理建议**：给出可执行的随访与临床管理要点。**用药建议须使用国家规范的药品通用名**（如：重组人促红细胞生成素、铁剂如羧基麦芽糖铁或蔗糖铁静脉补铁、碳酸钙或非钙磷结合剂如碳酸镧/司维拉姆、活性维生素D及其类似物如骨化三醇或帕立骨化醇、降钾树脂等），并结合适应症方向说明；**仅当**资料库片段 [KBn] 中**已写明**剂量或阈值时可摘录该条文，**禁止**自行编造 mg、IU、频次等具体处方；剂量调整须表述为「由主管医师结合指南、化验与透析处方决定」。可写复查节奏、营养与透析充分性等非药物方向。' +
  '\n- **指南/共识与来源**：若与患者情况相关，须引用系统提供的资料库片段编号（如 [KB1]）并概括要点；若无匹配片段，须如实写「本次未命中资料库条目」，可提示结合科室现行《血液净化标准操作规程》等规范，**禁止**编造不存在的文献或指南名称。' +
  '\n### 指南与来源汇总' +
  '\n列出本次分析中引用过的 [KB1]、[KB2]… 及「外部摘要」（若有）与讨论要点的对应关系；若完全未引用资料库，写一句说明即可。' +
  '\n总字数建议约 600–1500 字；完整、精炼，避免重复与空话。';

const BASE_SYSTEM =
  '你是血液透析室的临床决策支持助手，仅基于下方 JSON 中的结构化数据与系统提供的资料库片段进行分析。' +
  '禁止输出确定性诊断结论；使用「提示」「可参考」「需关注」等表述；禁止编造未在数据中出现的数值。' +
  '凡引用指南或共识要点，必须与 [KBn] 或已给出的「外部摘要」对应，不得虚构文献。' +
  '面向医护与患者的正文**不得**出现 JSON 字段名或英文键名（如 labs3m、focusLab 等），一律改写为中文叙述。' +
  STRUCTURE_BLOCK;

/**
 * @param {string} anomalyType
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function getAnomalyAnalysisPrompts(anomalyType) {
  const type = anomalyType || 'default';
  const specific = {
    lab_abnormal:
      '关注异常检验项与参考范围的关系，结合近 3 个月检验趋势说明变化方向（叙述中勿使用 JSON 键名）。',
    lab_critical:
      '按危急值处理流程思路：先说明数据项与严重程度，再提示复测与临床关注；用药用通用名与方向性表述，勿编造剂量。',
    lab_critical_alert:
      '结合关联预警与近 3 个月检验数据，说明与预警文案一致的关注点。',
    ktv_inadequate:
      '结合近 3 个月透析记录中的 Kt/V、透析时长、血流量等，分析可能影响充分性的因素（仅提示）。',
    ktv_inadequate_alert:
      '结合关联预警与透析记录，说明与 Kt/V 相关的数据依据。',
    urr_inadequate:
      '结合 URR 与相关透析参数，说明需关注方向。',
    bun_invalid:
      '若本次焦点透析记录中透后 BUN 不低于透前 BUN，说明数据逻辑矛盾，提示核查录入（仅依据所给数值）。',
    uf_exceed:
      '结合超滤量与体重相关数据，说明容量管理需关注。',
    infection_overdue:
      '结合传染病筛查记录与应复查日期，说明复查节奏关注点。',
    infection_warning:
      '说明即将到期筛查的关注点与随访建议（仅依据数据）。',
    coagulation_severe:
      '结合凝血分级与是否管路凝血，说明质控与观察要点。',
    dialysis_leak:
      '结合是否破膜/漏血，说明记录与感染/安全关注点。',
    cvc_high_risk:
      '若有通路/导管相关数据则引用；否则说明数据不足。',
    vascular_assessment_due:
      '说明内瘘/通路评估随访关注点（基于所给数据）。',
    dry_weight_overdue:
      '说明干体重再评估关注点（基于体重与透析记录）。',
    nurse_ratio:
      '若预警与排班相关，仅作管理提示，不展开非给定数据。',
    default:
      '综合近 3 个月检验与透析记录说明主要关注方向。',
  };

  const userPrompt =
    `异常类型：${type}。\n` +
    `${specific[type] || specific.default}`;

  return {
    systemPrompt: BASE_SYSTEM,
    userPrompt,
  };
}

/**
 * 将模型偶发输出的 JSON 字段名替换为可读中文（界面展示与入库前清洗）
 * @param {string} text
 * @returns {string}
 */
function sanitizeAnomalyAnalysisDisplayText(text) {
  if (!text || typeof text !== 'string') return '';
  let s = text;
  const pairs = [
    [/dialysisSessions3m/gi, '近3个月透析记录'],
    [/infectionScreenings/gi, '传染病筛查记录'],
    [/kbSnippets/gi, '资料库检索片段'],
    [/labs3m\[[^\]]*\]\.test_type/gi, '近3个月检验记录中的相应项目'],
    [/labs3m\[[^\]]*\]/gi, '近3个月检验数据'],
    [/labs3m/gi, '近3个月检验数据'],
    [/focusDialysis/gi, '本次焦点透析记录'],
    [/focusLab/gi, '本次焦点检验'],
    [/focusAlert/gi, '关联预警信息'],
    [/focusInfection/gi, '本次焦点传染病筛查'],
  ];
  for (const [re, rep] of pairs) {
    s = s.replace(re, rep);
  }
  return s;
}

module.exports = {
  getAnomalyAnalysisPrompts,
  BASE_SYSTEM,
  sanitizeAnomalyAnalysisDisplayText,
};
