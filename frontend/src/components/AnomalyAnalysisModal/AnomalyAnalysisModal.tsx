/**
 * 异常分析 Modal：调用 /api/ai/anomaly-analysis
 * 保存资料摘要：阅读结果后由用户确认，调用 /api/ai/anomaly-analysis/save-kb（服务端按类型重新检索并整理总结，不提交 AI 正文）
 */
import { useEffect, useState } from 'react';
import { Modal, Spin, Typography, Alert, List, Button, Space, message } from 'antd';
import { usePermission } from '../../utils/permission';
import { aiApi, type AnomalyAnalysisResult, type AiKbSaveResult } from '../../api/ai';
import type { AnomalyType } from '../../utils/anomalyAnalysis';
import { formatKbSaveOverviewLine } from '../../utils/kbSaveOverview';

const { Paragraph, Text } = Typography;

export interface AnomalyAnalysisModalProps {
  open: boolean;
  onClose: () => void;
  /** 服务端按此 ID 拉取该患者近 3 个月结构化数据，不可与其他患者混用 */
  patientId: string;
  anomalyType: AnomalyType;
  contextId?: string;
  /** 展示用（如患者姓名），不参与分析请求 */
  patientLabel?: string;
}

function kbSaveHint(kb: AiKbSaveResult | undefined) {
  if (!kb || kb.skipped) return null;
  const overviewLine = formatKbSaveOverviewLine(kb.overview);
  if (kb.reason === 'no_kb_chunks') {
    return (
      <Alert
        type="info"
        style={{ marginTop: 12 }}
        message="本次未命中本地资料片段，未写入知识库"
        description={
          overviewLine ? (
            <span style={{ fontSize: 12 }}>{overviewLine}</span>
          ) : (
            '本地资料库中无匹配片段，无法整理入库。'
          )
        }
      />
    );
  }
  if (kb.error === 'persist_failed' || kb.error === 'summary_failed' || kb.error === 'summary_empty') {
    return (
      <Alert
        type="warning"
        style={{ marginTop: 12 }}
        message="保存到本地知识库失败"
        description="整理总结或写入失败，请稍后重试或联系管理员。"
      />
    );
  }
  if (kb.duplicate) {
    return (
      <Alert
        type="info"
        style={{ marginTop: 12 }}
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
        style={{ marginTop: 12 }}
        message="已保存整理总结到本地知识库"
        description={
          overviewLine ? (
            <span style={{ fontSize: 12 }}>{overviewLine}</span>
          ) : (
            '入库正文为检索资料的整理总结，非上方 AI 解读。'
          )
        }
      />
    );
  }
  return null;
}

function shortId(id: string) {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export default function AnomalyAnalysisModal({
  open,
  onClose,
  patientId,
  anomalyType,
  contextId,
  patientLabel,
}: AnomalyAnalysisModalProps) {
  const { canUseAiAssistantFeature } = usePermission();
  const canAnomalyAi = canUseAiAssistantFeature('ai_feat:anomaly');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<AnomalyAnalysisResult | null>(null);
  const [saveKbLoading, setSaveKbLoading] = useState(false);
  const [kbManual, setKbManual] = useState<AiKbSaveResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setData(null);
    setKbManual(null);
    setLoading(false);
    setSaveKbLoading(false);
  }, [open, patientId, anomalyType, contextId]);

  const runAnalysis = async () => {
    if (!patientId) return;
    setLoading(true);
    setErr(null);
    setData(null);
    setKbManual(null);
    try {
      const res = await aiApi.postAnomalyAnalysis({
        patientId,
        anomalyType,
        contextId,
      });
      setData(res.data.data ?? null);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : '';
      setErr(msg || '分析请求失败');
    } finally {
      setLoading(false);
    }
  };

  const saveToKb = async () => {
    if (!patientId) return;
    setSaveKbLoading(true);
    setKbManual(null);
    try {
      const res = await aiApi.postAnomalyAnalysisSaveKb({
        patientId,
        anomalyType,
      });
      const kb = res.data.data?.kb_save ?? null;
      setKbManual(kb);
      const line = formatKbSaveOverviewLine(kb?.overview);
      if (kb?.saved) {
        message.success(line ? `保存成功。${line}` : '保存成功');
      } else if (kb?.duplicate) {
        message.info(line ? `未重复入库。${line}` : '未重复入库：正文已存在');
      } else if (kb?.reason === 'no_kb_chunks') {
        message.warning('本次未命中资料片段，未写入知识库');
      } else if (kb?.error === 'persist_failed') {
        message.error('保存失败，请稍后重试');
      }
    } catch {
      setKbManual({ skipped: false, saved: false, error: 'persist_failed' });
      // 全局 request 拦截器已提示具体错误，此处仅更新状态
    } finally {
      setSaveKbLoading(false);
    }
  };

  const evidence = data?.evidence;
  const evidencePatientMismatch =
    Boolean(data && evidence?.patientId && evidence.patientId !== patientId);

  return (
    <Modal
      title="异常分析（AI 辅助）"
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      {!canAnomalyAi ? (
        <Alert
          type="warning"
          showIcon
          message="未开放异常指标分析 AI"
          description="请管理员在「用户管理」中为账号勾选「AI 分析助手」下的「异常指标分析」分项。"
        />
      ) : null}

      {canAnomalyAi && !data && !loading ? (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            type="info"
            showIcon
            message="分析范围说明"
            description={
              <span>
                本次分析仅使用系统内患者 ID <Text code>{shortId(patientId)}</Text>
                {patientLabel ? (
                  <>
                    {' '}
                    对应患者「<strong>{patientLabel}</strong>」
                  </>
                ) : null}
                的近 3 个月检验与透析等结构化数据；不会与其他患者记录混合。
              </span>
            }
          />
          {err ? (
            <Alert
              type="warning"
              message={err}
              description="若未配置 QWEN_API_KEY，将无法使用 AI 分析；临床操作不依赖本功能。"
            />
          ) : (
            <Text type="secondary">
              点击下方「开始分析」生成解读。阅读正文后，若需将内容纳入本地知识库检索，可在生成完成后点击「保存到本地知识库」。
            </Text>
          )}
          <Button type="primary" onClick={runAnalysis} disabled={!patientId}>
            开始分析
          </Button>
        </Space>
      ) : null}

      {canAnomalyAi && loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin tip="正在生成分析…" />
        </div>
      ) : null}

      {canAnomalyAi && !loading && data ? (
        <>
          {evidencePatientMismatch ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message="数据范围不一致"
              description="返回依据中的患者标识与当前窗口不一致，请勿依赖本结果，请关闭后重试。"
            />
          ) : null}
          {kbSaveHint(kbManual ?? undefined)}
          <Paragraph style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{data.content}</Paragraph>
          <Alert type="info" style={{ marginTop: 12 }} message={data.ai_disclaimer} />
          {evidence?.recordCounts ? (
            <div style={{ marginTop: 16 }}>
              <Text type="secondary">数据依据（近 {evidence.months ?? 3} 个月统计）</Text>
              <List
                size="small"
                bordered
                style={{ marginTop: 8 }}
                dataSource={[
                  `检验记录条数：${evidence.recordCounts.lab_results ?? 0}`,
                  `透析记录条数：${evidence.recordCounts.dialysis_records ?? 0}`,
                  evidence.focusLabId ? `焦点检验 ID：${evidence.focusLabId}` : null,
                  evidence.focusDialysisId ? `焦点透析记录 ID：${evidence.focusDialysisId}` : null,
                  evidence.focusAlertId ? `关联预警 ID：${evidence.focusAlertId}` : null,
                ].filter(Boolean) as string[]}
                renderItem={(item) => <List.Item style={{ padding: '6px 12px' }}>{item}</List.Item>}
              />
            </div>
          ) : null}
          {data.kb_chunks_used && data.kb_chunks_used.length > 0 ? (
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              已引用资料库片段 {data.kb_chunks_used.length} 条
            </Text>
          ) : null}
          <Space style={{ marginTop: 16 }} wrap>
            <Button
              type="primary"
              loading={saveKbLoading}
              disabled={evidencePatientMismatch}
              onClick={() => void saveToKb()}
            >
              保存整理总结到本地知识库
            </Button>
            <Button
              onClick={() => {
                setData(null);
                setKbManual(null);
              }}
            >
              重新分析
            </Button>
          </Space>
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            入库为当前异常类型下检索资料的整理总结，非上方 AI 解读正文；无片段时不写入。
          </Text>
        </>
      ) : null}
    </Modal>
  );
}
