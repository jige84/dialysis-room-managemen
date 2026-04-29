/**
 * 临床 AI 助手页
 * 主要作用：在合规权限下提供患者上下文检索、大模型问答、知识库引用与可选入库能力。
 * 主要功能：Tabs 组织场景；患者选择；调用 `aiApi` / `patientsApi`；展示检索摘要与回答。
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Tabs,
  Form,
  Select,
  Input,
  Button,
  Typography,
  Alert,
  Spin,
  Space,
  Checkbox,
  Tag,
  message,
} from 'antd';
import PageShell from '../../components/PageShell/PageShell';
import { usePermission } from '../../utils/permission';
import { useAuthStore } from '../../stores/authStore';
import { hasAiAssistantFeature } from '../../utils/menuAccess';
import type { AiAssistantFeaturePermissionKey } from '../../constants/aiAssistantFeatures';
import { aiApi, type AiTextResult, type AiKbSaveResult, type AiRetrievalSummary } from '../../api/ai';
import { patientsApi, type Patient } from '../../api/patients';
import { formatKbSaveOverviewLine } from '../../utils/kbSaveOverview';

const { TextArea } = Input;
const { Paragraph, Text, Title } = Typography;

interface SimplePatientOption {
  value: string;
  label: string;
}

type TabKey = 'trend' | 'labs' | 'ktv' | 'cvc' | 'nlp' | 'med';

const TAB_TO_FEAT: Record<TabKey, AiAssistantFeaturePermissionKey> = {
  trend: 'ai_feat:patient_trend',
  labs: 'ai_feat:labs_analysis',
  ktv: 'ai_feat:ktv',
  cvc: 'ai_feat:cvc',
  nlp: 'ai_feat:nlp',
  med: 'ai_feat:medication',
};

const NLP_QUICK_QUESTIONS = [
  '透析患者血小板偏低一般见于什么',
  '近30天超滤超标患者有哪些',
  '请分析患者近3个月Kt/V趋势并给出复查建议',
];

function kbSaveMessage(kb: AiKbSaveResult | undefined) {
  if (!kb || kb.skipped) return null;
  const overviewLine = formatKbSaveOverviewLine(kb.overview);
  if (kb.reason === 'no_kb_chunks') {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="本次未命中本地资料库片段，未写入知识库"
        description={
          overviewLine ? (
            <span style={{ fontSize: 12 }}>{overviewLine}</span>
          ) : (
            '入库前会先由 AI 整理总结检索资料；无片段时无法入库。'
          )
        }
      />
    );
  }
  if (kb.error === 'persist_failed' || kb.error === 'summary_failed' || kb.error === 'summary_empty') {
    return (
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="保存到本地知识库失败"
        description="整理总结或写入失败，请稍后重试或联系管理员。"
      />
    );
  }
  if (kb.duplicate) {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="未重复入库"
        description={
          overviewLine ? (
            <span style={{ fontSize: 12 }}>正文已存在。{overviewLine}</span>
          ) : (
            '已存在相同正文的资料，未重复写入。'
          )
        }
      />
    );
  }
  if (kb.saved) {
    return (
      <Alert
        type="success"
        showIcon
        style={{ marginBottom: 12 }}
        message="已保存整理总结到本地知识库"
        description={
          overviewLine ? (
            <span style={{ fontSize: 12 }}>{overviewLine}</span>
          ) : (
            '按摘要正文去重；入库内容为检索资料的整理总结，非上方 AI 回答。'
          )
        }
      />
    );
  }
  return null;
}

function formatRetrieval(r?: AiRetrievalSummary) {
  if (!r) return null;
  const parts: string[] = [];
  parts.push(`本地知识库片段 ${r.kb_chunk_count} 条`);
  if (r.medical_site_names?.length) {
    parts.push(`专业网站引用 ${r.medical_site_names.join('、')}`);
  }
  if ((r.web_excerpt_count ?? 0) > 0) {
    parts.push(`网站公开摘要 ${r.web_excerpt_count} 条`);
  }
  if (r.medical_site_excerpt_names?.length) {
    parts.push(`摘要来源 ${r.medical_site_excerpt_names.join('、')}`);
  }
  if (r.query_mode) {
    parts.push(`查询模式 ${r.query_mode}`);
  }
  if (r.used_web_fallback) parts.push('已尝试联网补全（若配置）');
  return parts.join('；');
}

function AiResultView({ result }: { result: AiTextResult | null }) {
  if (!result) return null;
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(result.content || '');
      message.success('已复制到剪贴板');
    } catch {
      message.error('复制失败');
    }
  };
  const refLine = formatRetrieval(result.retrieval);
  return (
    <Card
      size="small"
      style={{ marginTop: 16, borderColor: '#DBEAFE' }}
      title={
        <Space wrap>
          <span style={{ fontWeight: 600, color: '#0369A1' }}>AI 分析结果</span>
          <Tag color="orange">AI 生成</Tag>
          <Tag>{result.model || 'qwen3-max'}</Tag>
          {result.query_execution?.query_mode && <Tag color="blue">{result.query_execution.query_mode}</Tag>}
          {result.generated_at && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {new Date(result.generated_at).toLocaleString('zh-CN', { hour12: false })}
            </Text>
          )}
        </Space>
      }
      extra={
        <Button size="small" onClick={copyAll}>
          复制到剪贴板
        </Button>
      }
    >
      {kbSaveMessage(result.kb_save)}
      {refLine && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message="本次分析参考来源摘要"
          description={refLine}
        />
      )}
      {result.query_execution?.summary && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="结构化查询摘要"
          description={result.query_execution.summary}
        />
      )}
      <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
        {result.content}
      </Paragraph>
      <Alert
        type="info"
        showIcon
        message={
          <span style={{ fontSize: 12 }}>
            {result.ai_disclaimer ||
              '本内容由通义千问（qwen3-max）辅助生成，仅供医护人员参考，不构成医疗诊断建议。'}
          </span>
        }
      />
    </Card>
  );
}

export default function AIAssistantPage() {
  const { canUseAiAssistant, canPrescribe, canUseQcMonthlyInsight } = usePermission();
  const menuPermissions = useAuthStore(s => s.user?.menu_permissions);
  const userRole = useAuthStore(s => s.user?.role);
  const [activeKey, setActiveKey] = useState<TabKey>('trend');
  const [patientOptions, setPatientOptions] = useState<SimplePatientOption[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiTextResult | null>(null);

  const [form] = Form.useForm();

  const tabAllowed = (k: TabKey) => hasAiAssistantFeature(menuPermissions, TAB_TO_FEAT[k], userRole);

  const tabItems = useMemo(() => {
    const base: { key: TabKey; label: string }[] = [
      { key: 'trend', label: '透析趋势解读' },
      { key: 'labs', label: '检验结果分析' },
      { key: 'ktv', label: 'Kt/V 不达标原因' },
      { key: 'cvc', label: 'CVC 高危评分解读' },
      { key: 'nlp', label: '自然语言查询' },
    ];
    if (canPrescribe) base.push({ key: 'med', label: '用药建议' });
    return base.filter(it => hasAiAssistantFeature(menuPermissions, TAB_TO_FEAT[it.key], userRole));
  }, [menuPermissions, canPrescribe, userRole]);

  const effectiveTabKey: TabKey =
    tabItems.length === 0
      ? 'trend'
      : tabItems.some(t => t.key === activeKey)
        ? activeKey
        : tabItems[0].key;

  useEffect(() => {
    const keys = tabItems.map(t => t.key);
    if (keys.length === 0) return;
    if (!canPrescribe && activeKey === 'med') {
      setActiveKey(keys[0]);
      setResult(null);
      form.resetFields();
      return;
    }
    if (!keys.includes(activeKey)) {
      setActiveKey(keys[0]);
      setResult(null);
      form.resetFields();
    }
  }, [tabItems, activeKey, canPrescribe, form]);

  const handleSearchPatients = async (keyword: string) => {
    if (!keyword.trim()) return;
    setLoadingPatients(true);
    try {
      const { data } = await patientsApi.searchByKeyword(keyword);
      const page = data.data;
      setPatientOptions(
        page.list.map((p: Patient) => ({
          value: p.id,
          label: `${p.name} · ${p.gender === 'M' ? '男' : '女'} · ${p.age ?? '—'}岁`,
        })),
      );
    } finally {
      setLoadingPatients(false);
    }
  };

  const handleSubmit = async () => {
    if (!canUseAiAssistant || !tabAllowed(effectiveTabKey)) return;
    try {
      const values = await form.validateFields();
      setLoading(true);
      let res;
      const saveToKnowledgeBase = Boolean(values.saveToKnowledgeBase);
      if (effectiveTabKey === 'trend') {
        res = await aiApi.postTrendAnalysis({
          patientId: values.patientId,
          months: values.months,
          saveToKnowledgeBase,
        });
      } else if (effectiveTabKey === 'labs') {
        res = await aiApi.postLabsAnalysis({ patientId: values.patientId, saveToKnowledgeBase });
      } else if (effectiveTabKey === 'ktv') {
        res = await aiApi.postKtvRootCause({
          dialysisRecordId: values.dialysisRecordId,
          saveToKnowledgeBase,
        });
      } else if (effectiveTabKey === 'cvc') {
        res = await aiApi.postCvcExplanation({ assessmentId: values.assessmentId, saveToKnowledgeBase });
      } else if (effectiveTabKey === 'nlp') {
        const nlpPatientId = typeof values.nlpPatientId === 'string' ? values.nlpPatientId.trim() : '';
        const normalizedQuery =
          nlpPatientId && !String(values.query || '').includes(nlpPatientId)
            ? `患者ID ${nlpPatientId}，${String(values.query || '').trim()}`
            : String(values.query || '').trim();
        res = await aiApi.postNlpQuery({ query: normalizedQuery, saveToKnowledgeBase });
      } else if (effectiveTabKey === 'med') {
        res = await aiApi.postMedicationAdvice({
          patientId: values.patientId,
          summary: values.summary || null,
          saveToKnowledgeBase,
        });
      }
      if (res) {
        const payload = res.data.data;
        setResult(payload);
        const kb = payload?.kb_save;
        if (saveToKnowledgeBase && kb && !kb.skipped) {
          const line = formatKbSaveOverviewLine(kb.overview);
          if (kb.saved) {
            message.success(line ? `保存成功。${line}` : '已保存资料片段到本地知识库');
          } else if (kb.duplicate) {
            message.info(line ? `未重复入库。${line}` : '未重复入库：正文已存在');
          } else if (kb.reason === 'no_kb_chunks') {
            message.warning('本次未命中资料片段，未写入知识库');
          } else if (kb.error === 'persist_failed' || kb.error === 'summary_failed' || kb.error === 'summary_empty') {
            message.error('保存到知识库失败：整理总结或写入未成功');
          }
        }
      }
    } catch {
      // 错误文案已由 axios 拦截器提示
    } finally {
      setLoading(false);
    }
  };

  const disabledText = !canUseAiAssistant
    ? canUseQcMonthlyInsight
      ? '当前账号无「患者维度」AI 权限；请使用「质控上报报表」页的「AI 辅助解读」（科室聚合月报），或请管理员在「用户管理」中勾选侧栏「AI 分析助手」。'
      : '管理员未在「用户管理」中为本账号勾选侧栏「AI 分析助手」模块，或侧栏白名单未包含该项。'
    : undefined;

  return (
    <PageShell fullWidth>
      <Title level={4} style={{ marginBottom: 8 }}>
        AI 辅助分析工作台
      </Title>
      <Text type="secondary" style={{ fontSize: 12 }}>
        所有分析结果均来自大模型推理，仅供医护人员参考，不构成医疗诊断建议，具体决策请以临床评估为准。
      </Text>

      {!canUseAiAssistant && (
        <Alert
          style={{ marginTop: 16, marginBottom: 16 }}
          type="warning"
          showIcon
          message="当前账号无患者维度 AI 分析权限"
          description={
            canUseQcMonthlyInsight
              ? '无本页权限时，可使用「质控上报报表」中的「AI 辅助解读」（基于已生成的月度聚合指标，无患者标识）。患者维度 AI 须在「用户管理」中勾选「AI 分析助手」。'
              : '请在「用户管理」中为本账号勾选侧栏「AI 分析助手」；修改后请重新登录或刷新后再试。'
          }
        />
      )}

      {canUseAiAssistant && tabItems.length === 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message="未开放任何助手子功能"
          description="管理员已在「用户管理」中限制 AI 分析助手分项，当前账号无可用的分析页签。请联系管理员调整分项勾选。"
        />
      )}

      {tabItems.length > 0 ? (
        <Tabs
          style={{ marginTop: 16 }}
          activeKey={tabItems.some(t => t.key === activeKey) ? activeKey : tabItems[0].key}
          onChange={(k) => {
            const key = k as TabKey;
            setActiveKey(key);
            setResult(null);
            form.resetFields();
          }}
          items={tabItems}
        />
      ) : null}

      {tabItems.length > 0 ? (
      <Spin spinning={loading} tip="AI 正在深度分析，请稍候（约15-60秒）…">
        <Card
          style={{ borderColor: '#DBEAFE' }}
          title={<span style={{ fontWeight: 600, color: '#0369A1' }}>填写分析条件</span>}
        >
          <Form
            form={form}
            layout="vertical"
            disabled={!canUseAiAssistant || !tabAllowed(effectiveTabKey)}
            onFinish={handleSubmit}
          >
            {effectiveTabKey === 'trend' && (
              <>
                <Form.Item
                  label="患者"
                  name="patientId"
                  rules={[{ required: true, message: '请选择患者' }]}
                >
                  <Select
                    showSearch
                    placeholder="输入姓名搜索患者"
                    filterOption={false}
                    notFoundContent={loadingPatients ? '搜索中…' : null}
                    onSearch={handleSearchPatients}
                    options={patientOptions}
                  />
                </Form.Item>
                <Form.Item label="时间范围" name="months" initialValue={3}>
                  <Select
                    options={[
                      { value: 1, label: '近 1 个月' },
                      { value: 3, label: '近 3 个月' },
                      { value: 6, label: '近 6 个月' },
                    ]}
                  />
                </Form.Item>
              </>
            )}

            {effectiveTabKey === 'labs' && (
              <Form.Item
                label="患者"
                name="patientId"
                rules={[{ required: true, message: '请选择患者' }]}
              >
                <Select
                  showSearch
                  placeholder="输入姓名搜索患者"
                  filterOption={false}
                  notFoundContent={loadingPatients ? '搜索中…' : null}
                  onSearch={handleSearchPatients}
                  options={patientOptions}
                />
              </Form.Item>
            )}

            {effectiveTabKey === 'ktv' && (
              <Form.Item
                label="透析记录 ID"
                name="dialysisRecordId"
                rules={[{ required: true, message: '请输入透析记录ID' }]}
              >
                <Input placeholder="可从透析记录列表中复制 ID" />
              </Form.Item>
            )}

            {effectiveTabKey === 'cvc' && (
              <Form.Item
                label="CVC 评分记录 ID"
                name="assessmentId"
                rules={[{ required: true, message: '请输入评分记录ID' }]}
              >
                <Input placeholder="可从血管通路页面中复制评估记录 ID" />
              </Form.Item>
            )}

            {effectiveTabKey === 'nlp' && (
              <>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="自然语言智能模式"
                  description="支持两类：1）结构化查询（患者趋势、超滤超标名单）；2）通用医学问答（无患者数据时也可回答）。"
                />
                <Form.Item label="患者（可选）" name="nlpPatientId">
                  <Select
                    showSearch
                    placeholder="可先选患者，系统会自动补全患者 ID 到问题中"
                    filterOption={false}
                    notFoundContent={loadingPatients ? '搜索中…' : null}
                    onSearch={handleSearchPatients}
                    options={patientOptions}
                    allowClear
                  />
                </Form.Item>
                <Form.Item
                  label="自然语言问题"
                  name="query"
                  rules={[{ required: true, message: '请输入要查询的问题' }]}
                >
                  <TextArea
                    rows={3}
                    placeholder="例如：透析患者血小板偏低一般见于什么；近30天超滤超标患者有哪些；请分析患者近3个月Kt/V趋势。"
                  />
                </Form.Item>
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>快捷问题：</Text>
                  <Space wrap style={{ marginTop: 6 }}>
                    {NLP_QUICK_QUESTIONS.map((q) => (
                      <Button
                        key={q}
                        size="small"
                        onClick={() => form.setFieldValue('query', q)}
                      >
                        {q}
                      </Button>
                    ))}
                  </Space>
                </div>
              </>
            )}

            {effectiveTabKey === 'med' && (
              <>
                {!canPrescribe && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="用药建议仅供医生/Admin 使用"
                    description="当前账号无处方权限，建议由有处方权的医生在其账号下使用该功能。"
                  />
                )}
                <Form.Item
                  label="患者"
                  name="patientId"
                  rules={[{ required: true, message: '请选择患者' }]}
                >
                  <Select
                    showSearch
                    placeholder="输入姓名搜索患者"
                    filterOption={false}
                    notFoundContent={loadingPatients ? '搜索中…' : null}
                    onSearch={handleSearchPatients}
                    options={patientOptions}
                  />
                </Form.Item>
                <Form.Item
                  label="当前用药与情况摘要（可选）"
                  name="summary"
                >
                  <TextArea
                    rows={3}
                    placeholder="可简单描述目前透析相关用药、血压控制、并存疾病等，便于 AI 提供更有针对性的参考建议。"
                  />
                </Form.Item>
              </>
            )}

            <Form.Item
              name="saveToKnowledgeBase"
              valuePropName="checked"
              initialValue={false}
              style={{ marginBottom: 8 }}
            >
              <Checkbox disabled={!canUseAiAssistant || !tabAllowed(effectiveTabKey)}>
                将本次检索到的本地资料先整理总结后保存到知识库（非 AI 回答；无命中片段时不写入；正文相同则去重）
              </Checkbox>
            </Form.Item>

            <Space style={{ marginTop: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                disabled={!canUseAiAssistant || !tabAllowed(effectiveTabKey)}
              >
                生成 AI 分析
              </Button>
              <Button
                onClick={() => {
                  form.resetFields();
                  setResult(null);
                }}
              >
                重置
              </Button>
              {disabledText && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {disabledText}
                </Text>
              )}
            </Space>
          </Form>
        </Card>

        <AiResultView result={result} />
      </Spin>
      ) : null}
    </PageShell>
  );
}
