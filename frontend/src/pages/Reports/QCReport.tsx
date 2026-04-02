/**
 * 质控月报查看与确认页
 * 对接 reportsApi 拉取真实月度五项上报指标，支持护士长确认与 Excel 导出。
 */
import { useState, useEffect, useCallback } from 'react';
import { Card, Select, Button, message, Modal, Spin, Empty } from 'antd';
import { FileExcelOutlined, CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import reportsApi, { type QCReport } from '../../api/reports';
import { usePermission } from '../../utils/permission';

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = dayjs().subtract(11 - i, 'month');
  return { value: d.format('YYYY-MM'), label: d.format('YYYY年MM月') };
});

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: '草稿', color: '#7B92BC', bg: '#F1F5F9' },
  submitted: { label: '已提交，待审批', color: '#D97706', bg: '#FFFBEB' },
  confirmed: { label: '已确认上报', color: '#059669', bg: '#ECFDF5' },
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
  const { canWrite } = usePermission();
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format('YYYY-MM'));
  const [report, setReport] = useState<QCReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchReport = useCallback(async () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    setLoading(true);
    try {
      const res = await reportsApi.getQCUpload(y, m);
      setReport(res.data.data ?? null);
    } catch {
      message.error('加载质控报表失败');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

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

  const handleExport = () => {
    if (!report) return;
    const url = reportsApi.exportExcel(report.report_year, report.report_month);
    window.open(url, '_blank');
  };

  const r = report;
  const statusCfg = r ? STATUS_MAP[r.status] ?? STATUS_MAP.draft : STATUS_MAP.draft;

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

  return (
    <PageShell fullWidth>
      {/* 月份选择 */}
      <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }} styles={{ body: { padding: '16px 20px' } }}>
        <div className="flex items-center gap-16">
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>选择上报月份</div>
            <Select value={selectedMonth} onChange={setSelectedMonth} options={MONTHS} style={{ width: 160 }} />
          </div>
          <div style={{ flex: 1, padding: '8px 16px', background: '#F0F9FF', borderRadius: 8, border: '1px solid #BAE6FD', fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: '#0369A1' }}>
              {dayjs(selectedMonth).format('YYYY年MM月')} 质控数据报告
            </span>
            {r && (
              <span style={{ marginLeft: 12, color: '#7B92BC' }}>透析总次数：{r.total_sessions}次</span>
            )}
            {r && (
              <span style={{ marginLeft: 12, background: statusCfg.bg, color: statusCfg.color, padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
                {statusCfg.label}
              </span>
            )}
          </div>
          <div className="flex gap-8">
            <Button icon={<ReloadOutlined />} onClick={fetchReport}>刷新</Button>
            <Button icon={<FileExcelOutlined />} onClick={handleExport} disabled={!r}>导出Excel</Button>
            {canWrite && (
              <Button type="primary" icon={<CheckCircleOutlined />}
                onClick={() => setShowConfirm(true)}
                disabled={!r || r.status !== 'draft'}>
                {r?.status === 'draft' ? '护士长确认上报' : '已提交'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Spin spinning={loading}>
        {!r && !loading ? (
          <Empty description="暂无数据" />
        ) : r && (
          <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600 }}>📊 质控中心5项月度上报指标</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {indicators.map(q => (
                <div key={q.index} style={{ border: '1px solid #DBEAFE', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 20px', background: '#FAFCFF', borderBottom: '1px solid #DBEAFE', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontWeight: 600, color: '#0D1B3E' }}>{q.index}</span>
                    <span style={{
                      background: q.compliant ? '#ECFDF5' : '#FFF1F2',
                      color: q.compliant ? '#059669' : '#BE123C',
                      padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    }}>
                      {q.compliant ? '✅ 达标' : '⚠️ 不达标'}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#7B92BC' }}>目标值：{q.target}</span>
                  </div>
                  <div className="grid-4" style={{ padding: 20, gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>上报值</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 28, fontWeight: 700, color: q.compliant ? '#059669' : '#BE123C', lineHeight: 1 }}>
                        {q.value}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>分子</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{q.numerator}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>分母</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{q.denominator}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>计算公式</div>
                      <div style={{ fontSize: 13, fontFamily: 'DM Mono, monospace', color: '#0369A1' }}>{q.formula}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Spin>

      {/* 上报确认弹窗 */}
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
    </PageShell>
  );
}
