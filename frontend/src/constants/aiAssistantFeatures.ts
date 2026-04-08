/**
 * AI 分析助手「子功能」权限 key（写入 users.menu_permissions，与后端一致）
 * 规则：仅有 /ai/assistant 且无任一 ai_feat:* → 可使用助手内全部子功能；
 * 若存在任一 ai_feat:* → 仅允许已勾选的子功能（后端接口同步校验）。
 */
export const AI_FEAT_PREFIX = 'ai_feat:' as const;

export type AiAssistantTabKey = 'trend' | 'labs' | 'ktv' | 'cvc' | 'nlp' | 'med';

export type AiAssistantFeaturePermissionKey =
  | 'ai_feat:patient_trend'
  | 'ai_feat:labs_analysis'
  | 'ai_feat:ktv'
  | 'ai_feat:cvc'
  | 'ai_feat:nlp'
  | 'ai_feat:medication'
  | 'ai_feat:anomaly';

export const AI_ASSISTANT_FEATURES: ReadonlyArray<{
  key: AiAssistantFeaturePermissionKey;
  tab: AiAssistantTabKey | 'anomaly';
  label: string;
  /** 说明：自然语言含血管通路页内嵌 AI；异常分析含各业务弹窗 */
  hint?: string;
}> = [
  { key: 'ai_feat:patient_trend', tab: 'trend', label: '透析趋势解读' },
  { key: 'ai_feat:labs_analysis', tab: 'labs', label: '检验结果分析' },
  { key: 'ai_feat:ktv', tab: 'ktv', label: 'Kt/V 不达标原因' },
  { key: 'ai_feat:cvc', tab: 'cvc', label: 'CVC 高危评分解读' },
  {
    key: 'ai_feat:nlp',
    tab: 'nlp',
    label: '自然语言查询',
    hint: '含血管通路页的「AI 解读」',
  },
  { key: 'ai_feat:medication', tab: 'med', label: '用药建议' },
  {
    key: 'ai_feat:anomaly',
    tab: 'anomaly',
    label: '异常指标分析',
    hint: '患者详情、透析录入等处的异常分析弹窗',
  },
];

export const AI_ASSISTANT_FEATURE_KEYS = AI_ASSISTANT_FEATURES.map(f => f.key);
