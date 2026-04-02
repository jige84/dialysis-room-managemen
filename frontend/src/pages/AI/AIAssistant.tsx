import { useState } from 'react';
import { Card, Tabs, Form, Select, Input, Button, Typography, Alert, Spin, Space } from 'antd';
import PageShell from '../../components/PageShell/PageShell';
import { usePermission } from '../../utils/permission';
import { aiApi, type AiTextResult } from '../../api/ai';
import { patientsApi, type Patient } from '../../api/patients';

const { TextArea } = Input;
const { Paragraph, Text, Title } = Typography;

interface SimplePatientOption {
  value: string;
  label: string;
}

type TabKey = 'trend' | 'labs' | 'ktv' | 'cvc' | 'nlp' | 'med';

function AiResultView({ result }: { result: AiTextResult | null }) {
  if (!result) return null;
  return (
    <Card
      size="small"
      style={{ marginTop: 16, borderColor: '#DBEAFE' }}
      title={<span style={{ fontWeight: 600, color: '#0369A1' }}>AI 分析结果</span>}
    >
      <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
        {result.content}
      </Paragraph>
      <Alert
        type="info"
        showIcon
        message={
          <span style={{ fontSize: 12 }}>
            {result.ai_disclaimer || '本内容由AI生成，仅供医护人员参考，不构成医疗诊断建议。'}
          </span>
        }
      />
    </Card>
  );
}

export default function AIAssistantPage() {
  const { canUseAI, canPrescribe } = usePermission();
  const [activeKey, setActiveKey] = useState<TabKey>('trend');
  const [patientOptions, setPatientOptions] = useState<SimplePatientOption[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiTextResult | null>(null);

  const [form] = Form.useForm();

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
    if (!canUseAI) return;
    try {
      const values = await form.validateFields();
      setLoading(true);
      let res;
      if (activeKey === 'trend') {
        res = await aiApi.postTrendAnalysis({
          patientId: values.patientId,
          months: values.months,
        });
      } else if (activeKey === 'labs') {
        res = await aiApi.postLabsAnalysis({ patientId: values.patientId });
      } else if (activeKey === 'ktv') {
        res = await aiApi.postKtvRootCause({ dialysisRecordId: values.dialysisRecordId });
      } else if (activeKey === 'cvc') {
        res = await aiApi.postCvcExplanation({ assessmentId: values.assessmentId });
      } else if (activeKey === 'nlp') {
        res = await aiApi.postNlpQuery({ query: values.query });
      } else if (activeKey === 'med') {
        res = await aiApi.postMedicationAdvice({
          patientId: values.patientId,
          summary: values.summary || null,
        });
      }
      if (res) {
        setResult(res.data.data);
      }
    } finally {
      setLoading(false);
    }
  };

  const disabledText = !canUseAI
    ? '当前角色无权使用 AI 分析，仅 admin / doctor 可用'
    : undefined;

  return (
    <PageShell fullWidth>
      <Title level={4} style={{ marginBottom: 8 }}>
        AI 辅助分析工作台
      </Title>
      <Text type="secondary" style={{ fontSize: 12 }}>
        所有分析结果均来自大模型推理，仅供医护人员参考，不构成医疗诊断建议，具体决策请以临床评估为准。
      </Text>

      {!canUseAI && (
        <Alert
          style={{ marginTop: 16, marginBottom: 16 }}
          type="warning"
          showIcon
          message="当前账号无 AI 分析权限"
          description="仅科主任（admin）与医生（doctor）可使用 AI 辅助分析功能。"
        />
      )}

      <Tabs
        style={{ marginTop: 16 }}
        activeKey={activeKey}
        onChange={(k) => {
          setActiveKey(k as TabKey);
          setResult(null);
          form.resetFields();
        }}
        items={[
          { key: 'trend', label: '透析趋势解读' },
          { key: 'labs', label: '检验结果分析' },
          { key: 'ktv', label: 'Kt/V 不达标原因' },
          { key: 'cvc', label: 'CVC 高危评分解读' },
          { key: 'nlp', label: '自然语言查询' },
          { key: 'med', label: '用药建议' },
        ]}
      />

      <Spin spinning={loading}>
        <Card
          style={{ borderColor: '#DBEAFE' }}
          title={<span style={{ fontWeight: 600, color: '#0369A1' }}>填写分析条件</span>}
        >
          <Form
            form={form}
            layout="vertical"
            disabled={!canUseAI}
            onFinish={handleSubmit}
          >
            {activeKey === 'trend' && (
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

            {activeKey === 'labs' && (
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

            {activeKey === 'ktv' && (
              <Form.Item
                label="透析记录 ID"
                name="dialysisRecordId"
                rules={[{ required: true, message: '请输入透析记录ID' }]}
              >
                <Input placeholder="可从透析记录列表中复制 ID" />
              </Form.Item>
            )}

            {activeKey === 'cvc' && (
              <Form.Item
                label="CVC 评分记录 ID"
                name="assessmentId"
                rules={[{ required: true, message: '请输入评分记录ID' }]}
              >
                <Input placeholder="可从血管通路页面中复制评估记录 ID" />
              </Form.Item>
            )}

            {activeKey === 'nlp' && (
              <Form.Item
                label="自然语言问题"
                name="query"
                rules={[{ required: true, message: '请输入要查询的问题' }]}
              >
                <TextArea
                  rows={3}
                  placeholder='例如："张三最近三个月Kt/V趋势" 或 "上月哪些患者超滤量超标"'
                />
              </Form.Item>
            )}

            {activeKey === 'med' && (
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

            <Space style={{ marginTop: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                disabled={!canUseAI}
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
    </PageShell>
  );
}

