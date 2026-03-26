import { useState } from 'react';
import { Card, Select, Button, Table, Divider, message, Modal } from 'antd';
import { FileExcelOutlined, CheckCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = dayjs().subtract(11 - i, 'month');
  return { value: d.format('YYYY-MM'), label: d.format('YYYY年MM月') };
});

const QC_INDICATORS = [
  {
    index: '① 护患比',
    denominator: '当班透析次数：469',
    numerator:   '当班护士次数：75',
    value:        '1:6.24',
    target:       '≤ 1:5（每护 ≤5患）',
    compliant:    true,
    formula:      '469 ÷ 75 = 6.24',
    trend:        [5.8, 6.0, 5.9, 6.1, 6.2, 6.0, 6.3, 6.1, 5.9, 6.2, 6.3, 6.24],
    barWidth:     '85%',
    barClass:     'hd-qc-bar-good',
    detail:       '本月共安排透析469例次，责任护士出勤75班次。日均每护3.9例次，全月符合规程要求。',
  },
  {
    index:        '② 体外循环凝血发生率',
    denominator:  '透析总次数：469',
    numerator:    'Ⅲ级凝血（完全凝血）次数：0',
    value:        '0.000%',
    target:       '< 0.5%',
    compliant:    true,
    formula:      '0 ÷ 469 = 0.000%',
    trend:        [0, 0.2, 0, 0, 0.2, 0, 0, 0, 0, 0, 0, 0],
    barWidth:     '5%',
    barClass:     'hd-qc-bar-good',
    detail:       '本月无体外循环完全凝血（Ⅲ级）事件发生。Ⅰ级凝血（轻度，<20%）2次，Ⅱ级1次，均未影响透析完成。',
  },
  {
    index:        '③ 漏血发生率',
    denominator:  '透析总次数：469',
    numerator:    '漏血事件次数：0',
    value:        '0.000%',
    target:       '< 0.1%',
    compliant:    true,
    formula:      '0 ÷ 469 = 0.000%',
    trend:        [0, 0, 0, 0.2, 0, 0, 0, 0, 0, 0, 0, 0],
    barWidth:     '5%',
    barClass:     'hd-qc-bar-good',
    detail:       '本月无透析器破膜/漏血事件发生。所有透析器均按规程进行预冲检测，未出现肉眼可见漏血情况。',
  },
  {
    index:        '④ 穿刺损伤发生率',
    denominator:  '内瘘(AVF+AVG)透析次数：433',
    numerator:    '穿刺损伤次数：2',
    value:        '0.0046',
    target:       '< 0.01',
    compliant:    true,
    formula:      '2 ÷ 433 = 0.0046（0.46%）',
    trend:        [0, 0, 0.23, 0, 0.46, 0, 0, 0.23, 0, 0, 0.46, 0.46],
    barWidth:     '46%',
    barClass:     'hd-qc-bar-caution',
    detail:       '本月433例内瘘透析中发生穿刺损伤2次（血肿各1例），均为二次穿刺后皮下出血，已处理无严重后果。',
  },
  {
    index:        '⑤ CRBSI 发生率',
    denominator:  '中心静脉导管总使用天数：156天',
    numerator:    '确诊CRBSI例次：0',
    value:        '0.000‰',
    target:       '< 1‰（每千导管日）',
    compliant:    true,
    formula:      '0 ÷ 156 × 1000 = 0.000‰',
    trend:        [0, 0, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0],
    barWidth:     '5%',
    barClass:     'hd-qc-bar-good',
    detail:       '本月共13例使用CVC患者，累计导管使用156日。无CRBSI确诊病例，所有导管护理均按标准操作规程执行。',
  },
];

const DAILY_QC = [
  { key: '1', index: 'Kt/V 达标率',       value: '94.7%', target: '≥ 95%', status: 'caution', detail: 'spKt/V ≥ 1.2 且 URR ≥ 65%，444/469次' },
  { key: '2', index: '肾性贫血控制率',     value: '82.1%', target: '≥ 85%', status: 'caution', detail: 'Hb ≥ 110g/L，本月检测65人中53人达标' },
  { key: '3', index: '白蛋白达标率',       value: '89.2%', target: '≥ 85%', status: 'good',    detail: 'ALB ≥ 35g/L，检测65人中58人达标' },
  { key: '4', index: 'iPTH 达标率',        value: '76.9%', target: '≥ 70%', status: 'good',    detail: '150-600pg/mL范围内，65人中50人达标' },
  { key: '5', index: 'CKD-MBD 钙磷达标',  value: '71.2%', target: '≥ 70%', status: 'good',    detail: '钙磷均在目标范围内，65人中46人双达标' },
  { key: '6', index: '干体重评估完成率',   value: '100%',  target: '≥ 100%', status: 'good',   detail: '本月所有患者均按时完成干体重评估' },
];

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; barClass: string }> = {
  good:    { label: '达标',   color: '#059669', bg: '#ECFDF5', barClass: 'hd-qc-bar-good' },
  caution: { label: '接近阈值', color: '#D97706', bg: '#FFFBEB', barClass: 'hd-qc-bar-caution' },
  bad:     { label: '不达标', color: '#BE123C', bg: '#FFF1F2', barClass: 'hd-qc-bar-bad' },
};

export default function QCReportPage() {
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format('YYYY-MM'));
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleExport = () => {
    message.success('质控报表已导出为Excel，请检查下载文件夹');
  };

  const handleConfirm = () => {
    setShowConfirm(false);
    setConfirmed(true);
    message.success('质控报表已确认上报，等待科主任审批');
  };

  return (
    <div>
      {/* 月份选择 + 操作 */}
      <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }} styles={{ body: { padding: '16px 20px' } }}>
        <div className="flex items-center gap-16">
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>选择上报月份</div>
            <Select
              value={selectedMonth}
              onChange={setSelectedMonth}
              options={MONTHS}
              style={{ width: 160 }}
            />
          </div>
          <div style={{ flex: 1, padding: '8px 16px', background: '#F0F9FF', borderRadius: 8, border: '1px solid #BAE6FD', fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: '#0369A1' }}>
              {dayjs(selectedMonth).format('YYYY年MM月')} 质控数据报告
            </span>
            <span style={{ marginLeft: 12, color: '#7B92BC' }}>
              统计期间：{dayjs(selectedMonth).startOf('month').format('YYYY-MM-DD')} 至 {dayjs(selectedMonth).endOf('month').format('YYYY-MM-DD')} ·
              透析总次数：469次
            </span>
            {confirmed && (
              <span style={{ marginLeft: 12, background: '#ECFDF5', color: '#059669', padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
                ✅ 已上报，待审批
              </span>
            )}
          </div>
          <div className="flex gap-8">
            <Button icon={<FileExcelOutlined />} onClick={handleExport}>导出Excel</Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={() => setShowConfirm(true)}
              disabled={confirmed}
            >
              {confirmed ? '已提交上报' : '护士长确认上报'}
            </Button>
          </div>
        </div>
      </Card>

      {/* 5项质控中心上报指标 */}
      <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={<span style={{ fontWeight: 600 }}>📊 质控中心5项月度上报指标</span>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {QC_INDICATORS.map(q => (
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
                <div style={{ gridColumn: 'span 4' }}>
                  <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 4 }}>本月说明</div>
                  <div style={{ fontSize: 13, color: '#3D5280', lineHeight: 1.6 }}>{q.detail}</div>
                  <div style={{ marginTop: 8 }}>
                    <div className="hd-qc-bar-wrap">
                      <div className={`hd-qc-bar ${q.barClass}`} style={{ width: q.barWidth }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 6项日常质控指标 */}
      <Card style={{ border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={<span style={{ fontWeight: 600 }}>📈 6项日常质控指标</span>}
      >
        <div className="grid-3" style={{ gap: 16 }}>
          {DAILY_QC.map(q => {
            const s = STATUS_CFG[q.status];
            const barW = q.value.replace('%', '');
            return (
              <div key={q.key} className="hd-qc-card">
                <div className="hd-qc-index">{q.index}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <span className="hd-qc-value" style={{ color: s.color }}>{q.value}</span>
                  <span style={{ background: s.bg, color: s.color, padding: '1px 7px', borderRadius: 20, fontSize: 11.5, fontWeight: 500 }}>{s.label}</span>
                </div>
                <div className="hd-qc-formula">目标：{q.target}</div>
                <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 8 }}>{q.detail}</div>
                <div className="hd-qc-bar-wrap">
                  <div className={`hd-qc-bar ${s.barClass}`} style={{ width: `${Math.min(100, parseFloat(barW))}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 上报确认弹窗 */}
      <Modal
        title="确认质控数据上报"
        open={showConfirm}
        onOk={handleConfirm}
        onCancel={() => setShowConfirm(false)}
        okText="确认上报"
        cancelText="取消"
        width={480}
      >
        <div style={{ padding: '8px 0', lineHeight: 1.8 }}>
          <div style={{ marginBottom: 12 }}>
            您即将对 <strong>{dayjs(selectedMonth).format('YYYY年MM月')}</strong> 的质控数据进行确认上报。
          </div>
          <div style={{ padding: 12, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 6, fontSize: 13 }}>
            <div>• 5项质控中心上报指标均已计算完成</div>
            <div>• 本月透析总次数：<strong>469次</strong></div>
            <div>• 护士长签名：<strong>（护士长确认）</strong></div>
          </div>
          <div style={{ marginTop: 12, padding: 10, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 12.5, color: '#92400E' }}>
            ⚠️ 确认后数据将提交给科主任审批，审批通过后将上报至质控中心。
          </div>
        </div>
      </Modal>
    </div>
  );
}
