/**
 * 质控月报查看与确认页
 * 对接 reportsApi 拉取真实月度五项上报指标，支持护士长确认与 Excel 导出、AI 辅助解读。
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Select,
  Button,
  message,
  Modal,
  Spin,
  Empty,
  Drawer,
  Input,
  Typography,
  Collapse,
  Checkbox,
  Space,
  InputNumber,
  Row,
  Col,
  Flex,
  Tag,
  Statistic,
  Descriptions,
  Divider,
  theme,
} from 'antd';
import {
  FileExcelOutlined,
  FilePdfOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import reportsApi, {
  type QCReport,
  type QcRoutinePayload,
  type MonthlyWorkloadPayload,
} from '../../api/reports';
import { aiApi, type QcMonthlyInsightResult } from '../../api/ai';
import { usePermission } from '../../utils/permission';
import { formatKbSaveOverviewLine } from '../../utils/kbSaveOverview';

const { Paragraph, Text } = Typography;

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = dayjs().subtract(11 - i, 'month');
  return { value: d.format('YYYY-MM'), label: d.format('YYYY年MM月') };
});

const STATUS_TAG: Record<string, { label: string; color: 'default' | 'warning' | 'success' }> = {
  draft: { label: '草稿', color: 'default' },
  submitted: { label: '已提交，待审批', color: 'warning' },
  confirmed: { label: '已确认上报', color: 'success' },
};

function pct(n: number, d: number): string {
  if (d === 0) return '0.000%';
  return (n / d * 100).toFixed(3) + '%';
}

function perThousand(n: number, d: number): string {
  if (d === 0) return '0.000‰';
  return (n / d * 1000).toFixed(3) + '‰';
}

export default function QCReportPage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const {
    canSubmitMonthlyQc,
    canConfirmMonthlyQc,
    canUseQcMonthlyInsight,
    canEditCqi,
  } = usePermission();
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format('YYYY-MM'));
  const [report, setReport] = useState<QCReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [insightOpen, setInsightOpen] = useState(false);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightResult, setInsightResult] = useState<QcMonthlyInsightResult | null>(null);
  const [insightQuestion, setInsightQuestion] = useState('');
  const [insightSaveKb, setInsightSaveKb] = useState(false);

  const [routine, setRoutine] = useState<QcRoutinePayload | null>(null);
  const [routineLoading, setRoutineLoading] = useState(false);

  const [workload, setWorkload] = useState<MonthlyWorkloadPayload | null>(null);
  const [workloadLoading, setWorkloadLoading] = useState(false);

  const [spotRatio, setSpotRatio] = useState<number | null>(null);
  const [sundayRatio, setSundayRatio] = useState<number | null>(null);
  const [qcNotes, setQcNotes] = useState('');
  const [savingSupplement, setSavingSupplement] = useState(false);
  const [showDirectorConfirm, setShowDirectorConfirm] = useState(false);
  const [confirmingDirector, setConfirmingDirector] = useState(false);
  const [initializingDraft, setInitializingDraft] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const fetchReport = useCallback(async () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    setLoading(true);
    try {
      const res = await reportsApi.getQCUpload(y, m);
      const row = res.data.data ?? null;
      setReport(row);
      if (row) {
        setSpotRatio(
          row.spot_check_ratio != null && row.spot_check_ratio !== ''
            ? Number(row.spot_check_ratio)
            : null,
        );
        setSundayRatio(
          row.sunday_ratio != null && row.sunday_ratio !== ''
            ? Number(row.sunday_ratio)
            : null,
        );
        setQcNotes(row.notes ?? '');
      } else {
        setSpotRatio(null);
        setSundayRatio(null);
        setQcNotes('');
      }
    } catch {
      message.error('加载质控报表失败');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  const handleInitDraft = async () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    setInitializingDraft(true);
    try {
      await reportsApi.initQCUpload(y, m);
      message.success('质控月报草稿已初始化');
      await fetchReport();
    } catch {
      message.error('初始化草稿失败');
    } finally {
      setInitializingDraft(false);
    }
  };

  const fetchRoutine = useCallback(async () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    setRoutineLoading(true);
    try {
      const res = await reportsApi.getQcRoutine(y, m);
      setRoutine(res.data.data ?? null);
    } catch {
      setRoutine(null);
      message.error('加载科室内部质控指标失败');
    } finally {
      setRoutineLoading(false);
    }
  }, [selectedMonth]);

  const fetchWorkload = useCallback(async () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    setWorkloadLoading(true);
    try {
      const res = await reportsApi.getMonthlyWorkload(y, m);
      setWorkload(res.data.data ?? null);
    } catch {
      setWorkload(null);
      message.error('加载月度工作量失败');
    } finally {
      setWorkloadLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => { fetchReport(); }, [fetchReport]);
  useEffect(() => { fetchRoutine(); }, [fetchRoutine]);
  useEffect(() => { fetchWorkload(); }, [fetchWorkload]);

  const handleSubmit = async () => {
    if (!report) return;
    setSubmitting(true);
    try {
      await reportsApi.submit(report.report_year, report.report_month);
      setShowConfirm(false);
      message.success('质控报表已提交审核');
      fetchReport();
    } catch {
      message.error('提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = async () => {
    if (!report) return;
    setExportingExcel(true);
    try {
      await reportsApi.exportExcel(report.report_year, report.report_month);
    } catch {
      message.error('导出 Excel 失败');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    if (!report) return;
    setExportingPdf(true);
    try {
      await reportsApi.exportPdf(report.report_year, report.report_month);
    } catch {
      message.error('导出 PDF 失败');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleSaveSupplement = async () => {
    if (!report) return;
    setSavingSupplement(true);
    try {
      await reportsApi.patchQCUpload(report.report_year, report.report_month, {
        notes: qcNotes.trim() || null,
        spot_check_ratio: spotRatio,
        sunday_ratio: sundayRatio,
      });
      message.success('补充项已保存');
      fetchReport();
    } catch {
      message.error('保存失败');
    } finally {
      setSavingSupplement(false);
    }
  };

  const handleDirectorConfirm = async () => {
    if (!report) return;
    setConfirmingDirector(true);
    try {
      await reportsApi.confirm(report.report_year, report.report_month);
      setShowDirectorConfirm(false);
      message.success('科主任已确认上报');
      fetchReport();
    } catch {
      message.error('确认失败');
    } finally {
      setConfirmingDirector(false);
    }
  };

  const openInsight = () => {
    setInsightResult(null);
    setInsightQuestion('');
    setInsightSaveKb(false);
    setInsightOpen(true);
  };

  const runInsight = async () => {
    if (!report) return;
    setInsightLoading(true);
    setInsightResult(null);
    try {
      const res = await aiApi.postQcMonthlyInsight({
        year: report.report_year,
        month: report.report_month,
        historyMonths: 6,
        userQuestion: insightQuestion.trim() || undefined,
        saveToKnowledgeBase: insightSaveKb,
      });
      const payload = res.data.data ?? null;
      setInsightResult(payload);
      const kb = payload?.kb_save;
      if (insightSaveKb && kb && !kb.skipped) {
        const line = formatKbSaveOverviewLine(kb.overview);
        if (kb.saved) {
          message.success(line ? `保存成功。${line}` : '已保存资料片段到本地知识库');
        } else if (kb.duplicate) {
          message.info(line ? `未重复入库。${line}` : '未重复入库');
        } else if (kb.reason === 'no_kb_chunks') {
          message.warning('本次未命中资料片段，未写入知识库');
        } else if (kb.error === 'persist_failed') {
          message.error('保存到知识库失败');
        }
      }
    } catch {
      /* 拦截器已提示 */
    } finally {
      setInsightLoading(false);
    }
  };

  const goCqiDraft = () => {
    if (!report || !insightResult?.content) return;
    const plain = insightResult.content.replace(/\n{3,}/g, '\n\n').trim();
    const title = `${report.report_year}年${report.report_month}月 质控持续改进`;
    navigate('/cqi', {
      state: {
        cqiDraft: {
          title,
          problem_found: plain.slice(0, 3500),
          measures: '（请结合 AI 解读摘要与科室讨论，补充具体改进措施与分工）',
        },
      },
    });
    setInsightOpen(false);
  };

  const r = report;
  const statusTag = r ? STATUS_TAG[r.status] ?? STATUS_TAG.draft : STATUS_TAG.draft;

  const indicators = r ? [
    {
      index: '① 护患比',
      denominator: `当班透析次数：${r.total_patient_sessions}`,
      numerator: `当班护士次数：${r.total_nurse_sessions}`,
      value: `1:${r.nurse_patient_ratio}`,
      target: '≤ 1:5',
      compliant: parseFloat(r.nurse_patient_ratio) <= 5,
      formula: `${r.total_patient_sessions} ÷ ${r.total_nurse_sessions} = ${r.nurse_patient_ratio}`,
    },
    {
      index: '② 体外循环凝血发生率',
      denominator: `透析总次数：${r.total_sessions}`,
      numerator: `完全凝血次数：${r.circuit_clotting_count}`,
      value: pct(r.circuit_clotting_count, r.total_sessions),
      target: '< 0.5%',
      compliant: r.total_sessions > 0 ? r.circuit_clotting_count / r.total_sessions < 0.005 : true,
      formula: `${r.circuit_clotting_count} ÷ ${r.total_sessions} = ${r.circuit_clotting_rate}`,
    },
    {
      index: '③ 漏血发生率',
      denominator: `透析总次数：${r.total_sessions}`,
      numerator: `漏血事件次数：${r.membrane_rupture_count}`,
      value: pct(r.membrane_rupture_count, r.total_sessions),
      target: '< 0.1%',
      compliant: r.total_sessions > 0 ? r.membrane_rupture_count / r.total_sessions < 0.001 : true,
      formula: `${r.membrane_rupture_count} ÷ ${r.total_sessions} = ${r.membrane_rupture_rate}`,
    },
    {
      index: '④ 穿刺损伤发生率',
      denominator: `内瘘透析次数：${r.avf_sessions}`,
      numerator: `穿刺损伤次数：${r.puncture_injury_count}`,
      value: pct(r.puncture_injury_count, r.avf_sessions),
      target: '< 1%',
      compliant: r.avf_sessions > 0 ? r.puncture_injury_count / r.avf_sessions < 0.01 : true,
      formula: `${r.puncture_injury_count} ÷ ${r.avf_sessions} = ${r.puncture_injury_rate}`,
    },
    {
      index: '⑤ CRBSI 发生率',
      denominator: `导管使用天数：${r.cvc_catheter_days}天`,
      numerator: `确诊CRBSI：${r.crbsi_count}例`,
      value: perThousand(r.crbsi_count, r.cvc_catheter_days),
      target: '< 1‰',
      compliant: r.cvc_catheter_days > 0 ? r.crbsi_count / r.cvc_catheter_days * 1000 < 1 : true,
      formula: `${r.crbsi_count} ÷ ${r.cvc_catheter_days} × 1000 = ${r.crbsi_rate}`,
    },
  ] : [];

  const sectionCardStyles = {
    header: { borderBottom: `1px solid ${token.colorBorderSecondary}` },
    body: { padding: token.paddingLG },
  } as const;

  return (
    <PageShell fullWidth>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <Card
          variant="borderless"
          style={{
            marginBottom: token.marginLG,
            background: token.colorFillAlter,
            borderRadius: token.borderRadiusLG,
          }}
          styles={{ body: { padding: `${token.paddingMD}px ${token.paddingLG}px` } }}
        >
          <Flex vertical gap="middle">
            <Flex wrap="wrap" gap="middle" align="center" justify="space-between">
              <Flex wrap="wrap" gap="large" align="center">
                <div>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                    上报月份
                  </Text>
                  <Select
                    value={selectedMonth}
                    onChange={setSelectedMonth}
                    options={MONTHS}
                    style={{ minWidth: 168 }}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                    当前报告
                  </Text>
                  <Flex align="center" gap="small" wrap="wrap">
                    <Text strong style={{ fontSize: 16 }}>
                      {dayjs(selectedMonth).format('YYYY年MM月')} 质控月报
                    </Text>
                    {r && <Tag>{`透析 ${r.total_sessions} 次`}</Tag>}
                    {r && (
                      <Tag color={statusTag.color} icon={r.status === 'confirmed' ? <CheckCircleOutlined /> : undefined}>
                        {statusTag.label}
                      </Tag>
                    )}
                  </Flex>
                </div>
              </Flex>
              <Space wrap>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    void fetchReport();
                    void fetchRoutine();
                    void fetchWorkload();
                  }}
                >
                  刷新
                </Button>
                <Button icon={<FileExcelOutlined />} onClick={() => void handleExport()} disabled={!r} loading={exportingExcel}>
                  导出 Excel
                </Button>
                <Button icon={<FilePdfOutlined />} onClick={() => void handleExportPdf()} disabled={!r} loading={exportingPdf}>
                  导出 PDF
                </Button>
                {canUseQcMonthlyInsight && (
                  <Button icon={<RobotOutlined />} onClick={openInsight} disabled={!r}>
                    AI 辅助解读
                  </Button>
                )}
                {canSubmitMonthlyQc && (
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    onClick={() => setShowConfirm(true)}
                    disabled={!r || r.status !== 'draft'}
                  >
                    {r?.status === 'draft' ? '护士长确认上报' : '已提交'}
                  </Button>
                )}
                {canConfirmMonthlyQc && r?.status === 'submitted' && (
                  <Button type="primary" danger ghost onClick={() => setShowDirectorConfirm(true)}>
                    科主任确认上报
                  </Button>
                )}
              </Space>
            </Flex>
          </Flex>
        </Card>

        {r && canSubmitMonthlyQc && r.status !== 'confirmed' && (
          <Card
            title="补充填报"
            style={{ marginBottom: token.marginLG, borderRadius: token.borderRadiusLG }}
            styles={sectionCardStyles}
            extra={
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={savingSupplement}
                onClick={() => void handleSaveSupplement()}
              >
                保存
              </Button>
            }
          >
            <Paragraph type="secondary" style={{ marginBottom: token.marginMD, fontSize: 13 }}>
              时点调查护患比、某周日时点护患比；草稿或待审批时可改，科主任确认后锁定。
            </Paragraph>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  时点调查护患比（1:X 中的 X）
                </Text>
                <InputNumber
                  min={0}
                  max={99.99}
                  step={0.1}
                  style={{ width: '100%' }}
                  placeholder="例：4.5 表示 1:4.5"
                  value={spotRatio ?? undefined}
                  onChange={(v) => setSpotRatio(v ?? null)}
                />
              </Col>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  某周日时点护患比（1:X 中的 X）
                </Text>
                <InputNumber
                  min={0}
                  max={99.99}
                  step={0.1}
                  style={{ width: '100%' }}
                  value={sundayRatio ?? undefined}
                  onChange={(v) => setSundayRatio(v ?? null)}
                />
              </Col>
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  备注（选填）
                </Text>
                <Input.TextArea
                  rows={2}
                  value={qcNotes}
                  onChange={(e) => setQcNotes(e.target.value)}
                  placeholder="本月质控说明"
                />
              </Col>
            </Row>
          </Card>
        )}

        <Spin spinning={loading}>
          {!r && !loading ? (
            <Card style={{ borderRadius: token.borderRadiusLG }}>
              <Empty
                description="本月尚未初始化质控月报"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                {canSubmitMonthlyQc && (
                  <Button type="primary" loading={initializingDraft} onClick={() => void handleInitDraft()}>
                    初始化草稿
                  </Button>
                )}
              </Empty>
            </Card>
          ) : (
            r && (
              <Card
                title="质控中心五项月度上报指标"
                style={{ marginBottom: token.marginLG, borderRadius: token.borderRadiusLG }}
                styles={sectionCardStyles}
              >
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  {indicators.map((q) => (
                    <div
                      key={q.index}
                      style={{
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: token.borderRadiusLG,
                        overflow: 'hidden',
                        background: token.colorBgContainer,
                      }}
                    >
                      <Flex
                        wrap="wrap"
                        align="center"
                        justify="space-between"
                        gap="small"
                        style={{
                          padding: `${token.paddingSM}px ${token.paddingMD}px`,
                          background: token.colorFillQuaternary,
                          borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        }}
                      >
                        <Flex align="center" gap="small" wrap="wrap">
                          <Text strong>{q.index}</Text>
                          <Tag color={q.compliant ? 'success' : 'error'}>
                            {q.compliant ? '达标' : '未达标'}
                          </Tag>
                        </Flex>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                          目标 {q.target}
                        </Text>
                      </Flex>
                      <Row gutter={[16, 16]} style={{ padding: token.paddingMD }}>
                        <Col xs={24} sm={8} md={6}>
                          <Statistic
                            title={<span style={{ fontSize: 12 }}>上报值</span>}
                            value={q.value}
                            valueStyle={{
                              fontSize: 22,
                              fontWeight: 600,
                              color: q.compliant ? token.colorSuccess : token.colorError,
                              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                            }}
                          />
                        </Col>
                        <Col xs={24} sm={16} md={18}>
                          <Descriptions
                            column={{ xs: 1, sm: 1, md: 3 }}
                            size="small"
                            labelStyle={{ color: token.colorTextSecondary, width: 72 }}
                          >
                            <Descriptions.Item label="分子">{q.numerator}</Descriptions.Item>
                            <Descriptions.Item label="分母">{q.denominator}</Descriptions.Item>
                            <Descriptions.Item label="计算">{q.formula}</Descriptions.Item>
                          </Descriptions>
                        </Col>
                      </Row>
                    </div>
                  ))}
                </Space>
              </Card>
            )
          )}
        </Spin>

        <Spin spinning={workloadLoading}>
          <Card
            title="月度工作量（实时汇总）"
            style={{ marginBottom: token.marginLG, borderRadius: token.borderRadiusLG }}
            styles={sectionCardStyles}
          >
            <Paragraph type="secondary" style={{ marginBottom: token.marginMD, fontSize: 13 }}>
              由透析记录聚合：人次、机时、护患比、穿刺困难、凝血与漏血等。
            </Paragraph>
            {!workload && !workloadLoading ? (
              <Empty description="暂无工作量数据" />
            ) : workload ? (
              <>
                <Row gutter={[16, 16]}>
                  <Col xs={12} sm={8} md={6}>
                    <Statistic title="总透析人次" value={workload.total_dialysis_sessions} />
                  </Col>
                  <Col xs={12} sm={8} md={6}>
                    <Statistic title="内瘘透析人次" value={workload.avf_sessions} />
                  </Col>
                  <Col xs={12} sm={8} md={6}>
                    <Statistic title="总机时（分钟）" value={workload.total_duration_minutes} />
                  </Col>
                  <Col xs={12} sm={8} md={6}>
                    <Statistic title="平均单次时长（分钟）" value={workload.avg_duration_minutes} />
                  </Col>
                </Row>
                <Divider style={{ margin: `${token.marginMD}px 0` }} />
                <Descriptions
                  column={{ xs: 1, sm: 1, md: 2 }}
                  size="small"
                  labelStyle={{ width: 200 }}
                >
                  <Descriptions.Item label="平均护患比（上报口径）">
                    {`1:${workload.nurse_patient_ratio}（患者 ${workload.total_patient_sessions_for_ratio} 次 / 护士 ${workload.total_nurse_sessions_for_ratio} 人次）`}
                  </Descriptions.Item>
                  <Descriptions.Item label="穿刺困难（占内瘘场次）">
                    {`${workload.puncture_difficult_count} / ${(workload.puncture_difficult_rate * 100).toFixed(3)}%`}
                  </Descriptions.Item>
                  <Descriptions.Item label="完全凝血（发生率）">
                    {`${workload.circuit_clot_complete_count} / ${(workload.circuit_clot_complete_rate * 100).toFixed(3)}%`}
                  </Descriptions.Item>
                  <Descriptions.Item label="Ⅱ级及以上凝血例数">
                    {workload.coagulation_grade_2_plus_count}
                  </Descriptions.Item>
                  <Descriptions.Item label="漏血（发生率）">
                    {`${workload.membrane_rupture_count} / ${(workload.membrane_rupture_rate * 100).toFixed(3)}%`}
                  </Descriptions.Item>
                </Descriptions>
              </>
            ) : null}
          </Card>
        </Spin>

        <Spin spinning={routineLoading}>
          <Card
            title="科室内部质控指标（实时汇总）"
            style={{ marginBottom: token.marginLG, borderRadius: token.borderRadiusLG }}
            styles={sectionCardStyles}
          >
            <Paragraph type="secondary" style={{ marginBottom: token.marginMD, fontSize: 13 }}>
              由当月透析、检验、生命体征实时计算，不落库；与上方五项上报口径独立。分母为 0 表示本月无相关录入。
            </Paragraph>
            {!routine && !routineLoading ? (
              <Empty description="暂无内部质控数据" />
            ) : routine ? (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {routine.metrics.map((row) => (
                  <div
                    key={row.key}
                    style={{
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusLG,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        padding: `${token.paddingSM}px ${token.paddingMD}px`,
                        background: token.colorFillQuaternary,
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      }}
                    >
                      <Text strong>{row.label}</Text>
                    </div>
                    <Row gutter={[16, 16]} style={{ padding: token.paddingMD }}>
                      <Col xs={24} sm={8}>
                        <Statistic
                          title={<span style={{ fontSize: 12 }}>达标率</span>}
                          value={
                            row.denominator > 0 && row.rate_percent != null
                              ? `${row.rate_percent.toFixed(3)}%`
                              : '—'
                          }
                          valueStyle={{
                            fontSize: 20,
                            fontWeight: 600,
                            color: token.colorPrimary,
                            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                          }}
                        />
                      </Col>
                      <Col xs={24} sm={16}>
                        <Descriptions column={1} size="small" labelStyle={{ width: 96 }}>
                          <Descriptions.Item label="分子 / 分母">
                            {row.numerator} / {row.denominator}
                          </Descriptions.Item>
                          <Descriptions.Item label="单项目标">{row.target}</Descriptions.Item>
                        </Descriptions>
                      </Col>
                    </Row>
                    <div
                      style={{
                        padding: `0 ${token.paddingMD}px ${token.paddingMD}px`,
                        fontSize: 12,
                        color: token.colorTextSecondary,
                        lineHeight: 1.65,
                      }}
                    >
                      {row.definition}
                    </div>
                  </div>
                ))}
              </Space>
            ) : null}
          </Card>
        </Spin>
      </div>

      {/* 上报确认弹窗 */}
      <Modal
        title="科主任确认质控上报"
        open={showDirectorConfirm}
        onOk={() => void handleDirectorConfirm()}
        confirmLoading={confirmingDirector}
        onCancel={() => setShowDirectorConfirm(false)}
        okText="确认已审阅并批准"
        cancelText="取消"
        width={480}
      >
        <p style={{ lineHeight: 1.8 }}>
          确认本月质控中心五项指标数据及补充项无误，批准向院级/质控中心口径归档。
        </p>
      </Modal>

      <Modal title="确认质控数据上报" open={showConfirm}
        onOk={handleSubmit} confirmLoading={submitting}
        onCancel={() => setShowConfirm(false)}
        okText="确认上报" cancelText="取消" width={480}>
        <div style={{ padding: '8px 0', lineHeight: 1.8 }}>
          <div style={{ marginBottom: 12 }}>
            您即将对 <strong>{dayjs(selectedMonth).format('YYYY年MM月')}</strong> 的质控数据进行确认上报。
          </div>
          <div style={{ padding: 12, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 6, fontSize: 13 }}>
            <div>• 5项质控中心上报指标均已计算完成</div>
            {r && <div>• 本月透析总次数：<strong>{r.total_sessions}次</strong></div>}
          </div>
          <div style={{ marginTop: 12, padding: 10, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 12.5, color: '#92400E' }}>
            ⚠️ 确认后数据将提交给科主任审批。
          </div>
        </div>
      </Modal>

      <Drawer
        title="AI 辅助解读（科室月度聚合）"
        width={560}
        open={insightOpen}
        onClose={() => setInsightOpen(false)}
        destroyOnClose
        extra={
          <Space>
            {canEditCqi && insightResult?.content && (
              <Button type="primary" onClick={goCqiDraft}>
                创建 CQI 草稿
              </Button>
            )}
            <Button type="primary" onClick={runInsight} loading={insightLoading} disabled={!r}>
              生成解读
            </Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          解读仅基于本页已加载的 qc_reports 数值，不重新计算指标；输出供管理讨论与文档草稿，非诊疗建议。
        </Text>
        <Input.TextArea
          rows={3}
          placeholder="可选：本次关注的重点或追问（如：与上月对比）"
          value={insightQuestion}
          onChange={(e) => setInsightQuestion(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <Checkbox checked={insightSaveKb} onChange={(e) => setInsightSaveKb(e.target.checked)}>
          将本次检索到的本地资料片段写入知识库（非上方 AI 解读正文；无命中则不写入）
        </Checkbox>
        <Spin spinning={insightLoading}>
          {insightResult && (
            <>
              {insightResult.evidence && (
                <Collapse
                  style={{ marginTop: 16 }}
                  items={[
                    {
                      key: 'ev',
                      label: '本次引用的系统指标（evidence）',
                      children: (
                        <pre style={{ fontSize: 12, maxHeight: 320, overflow: 'auto', margin: 0 }}>
                          {JSON.stringify(insightResult.evidence, null, 2)}
                        </pre>
                      ),
                    },
                  ]}
                />
              )}
              <Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 16, marginBottom: 12 }}>
                {insightResult.content}
              </Paragraph>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {insightResult.ai_disclaimer}
              </Text>
            </>
          )}
        </Spin>
      </Drawer>
    </PageShell>
  );
}
