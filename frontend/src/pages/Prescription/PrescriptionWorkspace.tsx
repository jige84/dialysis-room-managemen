import { useState } from 'react';
import { Card, Select, Button, InputNumber, Input, Form, Divider, Table, Modal, message, Tag } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import PageShell from '../../components/PageShell/PageShell';

const PATIENTS = [
  {
    value: 'zhang',
    label: '张国华 — 男/56岁/糖尿病肾病/AVF',
    info: '透析龄 4年7月 · 主管医生：任计阁',
    defaults: { frequency: 3, duration: 4.0, mode: 'HD', dialyzer: 'FX80', bloodFlow: 250, dialysateFlow: 500, anticoagulant: 'heparin', heparinFirst: 3000, heparinMaint: 500, na: 138, k: 2.0, ca: 1.5, temp: 36.5, dryWeight: 62.0, preAssessSbp: 140, preAssessDbp: 80, preAssessPulse: 78, preAssessTemp: 36.5, shift: 'pm', machineNo: '5号机' },
  },
  {
    value: 'wang',
    label: '王建军 — 男/71岁/高血压肾病/AVF',
    info: '透析龄 8年3月 · 主管医生：任计阁',
    defaults: { frequency: 3, duration: 4.0, mode: 'HD', dialyzer: 'FX80', bloodFlow: 240, dialysateFlow: 500, anticoagulant: 'heparin', heparinFirst: 3000, heparinMaint: 500, na: 138, k: 2.0, ca: 1.5, temp: 36.5, dryWeight: 60.0, preAssessSbp: 142, preAssessDbp: 82, preAssessPulse: 76, preAssessTemp: 36.6, shift: 'pm', machineNo: '8号机' },
  },
  {
    value: 'liu',
    label: '刘明远 — 男/65岁/多囊肾/LTCC',
    info: '透析龄 6年0月 · 主管医生：任计阁',
    defaults: { frequency: 3, duration: 4.0, mode: 'HD', dialyzer: 'FX80', bloodFlow: 220, dialysateFlow: 500, anticoagulant: 'heparin', heparinFirst: 3000, heparinMaint: 500, na: 140, k: 2.0, ca: 1.5, temp: 36.5, dryWeight: 50.0, preAssessSbp: 145, preAssessDbp: 82, preAssessPulse: 84, preAssessTemp: 36.7, shift: 'pm', machineNo: '7号机' },
  },
  {
    value: 'zhao',
    label: '赵丽萍 — 女/48岁/糖尿病肾病/AVF',
    info: '透析龄 1年9月 · 主管医生：任计阁',
    defaults: { frequency: 3, duration: 4.0, mode: 'HD', dialyzer: 'FX60', bloodFlow: 230, dialysateFlow: 500, anticoagulant: 'lmwh', heparinFirst: 3000, heparinMaint: 500, na: 138, k: 2.0, ca: 1.5, temp: 36.5, dryWeight: 52.0, preAssessSbp: 136, preAssessDbp: 76, preAssessPulse: 82, preAssessTemp: 36.6, shift: 'pm', machineNo: '6号机' },
  },
];

const PRESCRIPTION_HISTORY = [
  { key: '1', date: '2026-01-10', doctor: '任计阁', summary: 'HD · 4h · FX80 · 血流250 · 普通肝素', status: '当前有效' },
  { key: '2', date: '2025-08-20', doctor: '任计阁', summary: 'HD · 4h · FX80 · 血流240 · 普通肝素', status: '历史' },
  { key: '3', date: '2025-03-10', doctor: '任计阁', summary: 'HD · 3.5h · FX60 · 血流220 · 低分子肝素', status: '历史' },
];

export default function PrescriptionWorkspacePage() {
  const [form] = Form.useForm();
  const [selectedPatient, setSelectedPatient] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const patientInfo = PATIENTS.find(p => p.value === selectedPatient);
  const getPatientDefaults = (patientValue: string) => PATIENTS.find(p => p.value === patientValue)?.defaults;

  const handleSave = () => {
    if (!selectedPatient) { message.warning('请先选择患者'); return; }
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    setShowConfirm(false);
    message.success('透析处方已保存，护士下次录入时将自动带入');
  };

  return (
    <PageShell fullWidth>
      {/* 患者选择 */}
      <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={<span style={{ fontWeight: 600 }}>💊 透析处方管理</span>}
        extra={
          <Button icon={<HistoryOutlined />} onClick={() => setShowHistory(true)} disabled={!selectedPatient}>
            处方历史
          </Button>
        }
      >
        <div className="grid-2" style={{ gap: 20, marginBottom: selectedPatient ? 16 : 0 }}>
          <div>
            <div style={{ fontSize: 12, color: '#7B92BC', marginBottom: 6, fontWeight: 500 }}>选择患者</div>
            <Select
              placeholder="请选择患者…"
              value={selectedPatient || undefined}
              onChange={v => {
                setSelectedPatient(v);
                const defaults = getPatientDefaults(v);
                if (defaults) {
                  form.setFieldsValue(defaults);
                }
              }}
              options={PATIENTS.map(p => ({ value: p.value, label: p.label }))}
              style={{ width: '100%' }}
              showSearch
            />
          </div>
          {patientInfo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: '#F0F9FF', borderRadius: 8, border: '1px solid #BAE6FD' }}>
              <div className="hd-avatar hd-avatar-m">张</div>
              <div>
                <div style={{ fontWeight: 700 }}>{PATIENTS.find(p => p.value === selectedPatient)?.label.split(' — ')[0]}</div>
                <div style={{ fontSize: 12, color: '#7B92BC' }}>{patientInfo.info}</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {selectedPatient && (
        <Form form={form} layout="vertical" size="middle"
          initialValues={getPatientDefaults(selectedPatient)}
        >
          {/* 基本处方参数 */}
          <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0369A1' }}>📋 基本透析参数</span>}
          >
            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="透析频次（次/周）" name="frequency">
                <Select options={[{ value: 2, label: '每周2次' }, { value: 3, label: '每周3次' }]} />
              </Form.Item>
              <Form.Item label="标准时长（小时）" name="duration">
                <InputNumber min={2} max={8} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透析方式" name="mode">
                <Select options={[
                  { value: 'HD', label: 'HD（血液透析）' },
                  { value: 'HDF', label: 'HDF（血液透析滤过）' },
                  { value: 'HF', label: 'HF（血液滤过）' },
                ]} />
              </Form.Item>
              <Form.Item label="透析器型号" name="dialyzer">
                <Select options={[
                  { value: 'FX80', label: 'FX80（高通量）' },
                  { value: 'FX60', label: 'FX60（低通量）' },
                  { value: 'Rexeed-21', label: 'Rexeed-21（高通量）' },
                ]} />
              </Form.Item>
            </div>
            <Divider style={{ margin: '8px 0 16px', borderColor: '#DBEAFE' }} />
            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label={<>干体重目标 (kg) <span style={{ color: '#F43F5E' }}>*</span></>} name="dryWeight">
                <InputNumber min={20} max={200} step={0.5} style={{ width: '100%', fontWeight: 600 }} />
              </Form.Item>
              <Form.Item label="血流速 (mL/min)" name="bloodFlow">
                <InputNumber min={100} max={450} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透析液流速 (mL/min)" name="dialysateFlow">
                <Select options={[{ value: 500, label: '500 mL/min' }, { value: 600, label: '600 mL/min' }, { value: 800, label: '800 mL/min' }]} />
              </Form.Item>
              <Form.Item label="抗凝方案" name="anticoagulant">
                <Select options={[
                  { value: 'heparin', label: '普通肝素' },
                  { value: 'lmwh', label: '低分子肝素' },
                  { value: 'none', label: '无抗凝' },
                ]} />
              </Form.Item>
            </div>
            <div className="grid-4" style={{ gap: 16 }}>
              <Form.Item label="肝素首剂 (IU)" name="heparinFirst">
                <InputNumber min={0} max={10000} step={500} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="维持量 (IU/h)" name="heparinMaint">
                <InputNumber min={0} max={2000} step={100} style={{ width: '100%' }} />
              </Form.Item>
            </div>
          </Card>

          {/* 透析液参数 */}
          <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0369A1' }}>🧪 透析液参数</span>}
          >
            <div className="grid-4" style={{ gap: 16 }}>
              <Form.Item label="钠浓度 (mmol/L)" name="na">
                <InputNumber min={130} max={148} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="钾浓度 (mmol/L)" name="k">
                <InputNumber min={0} max={4} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="钙浓度 (mmol/L)" name="ca">
                <InputNumber min={1.0} max={2.0} step={0.25} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="温度 (℃)" name="temp">
                <InputNumber min={35} max={38} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </div>
          </Card>

          {/* 透析前评估（由医生维护） */}
          <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0369A1' }}>📊 透析前评估（医生填写）</span>}
          >
            <div className="grid-4" style={{ gap: 16, marginBottom: 16 }}>
              <Form.Item label="透前收缩压 (mmHg)" name="preAssessSbp">
                <InputNumber min={60} max={250} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透前舒张压 (mmHg)" name="preAssessDbp">
                <InputNumber min={40} max={160} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透前脉搏 (次/分)" name="preAssessPulse">
                <InputNumber min={40} max={200} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="透前体温 (℃)" name="preAssessTemp">
                <InputNumber min={35} max={42} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div className="grid-4" style={{ gap: 16 }}>
              <Form.Item label="班次" name="shift">
                <Select options={[
                  { value: 'am', label: '上午班' },
                  { value: 'pm', label: '下午班' },
                  { value: 'eve', label: '晚班' },
                ]} />
              </Form.Item>
              <Form.Item label="默认机器编号" name="machineNo">
                <Input placeholder="如：5号机" />
              </Form.Item>
            </div>
          </Card>

          {/* 处方备注 */}
          <Card style={{ marginBottom: 20, border: '1px solid #DBEAFE' }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0369A1' }}>📝 处方备注</span>}
          >
            <Form.Item name="notes" noStyle>
              <Input.TextArea rows={3} placeholder="记录特殊处方说明、注意事项等…" />
            </Form.Item>
          </Card>

          <div className="flex justify-between items-center">
            <span style={{ fontSize: 12, color: '#7B92BC' }}>
              * 处方修改将记录审计日志，并在护士录入时自动带入新参数
            </span>
            <div className="flex gap-8">
              <Button onClick={() => form.resetFields()}>重置</Button>
              <Button type="primary" onClick={handleSave}>保存处方</Button>
            </div>
          </div>
        </Form>
      )}

      {/* 处方历史弹窗 */}
      <Modal
        title="处方修改历史"
        open={showHistory}
        onCancel={() => setShowHistory(false)}
        footer={null}
        width={680}
      >
        <Table
          dataSource={PRESCRIPTION_HISTORY}
          size="small"
          pagination={false}
          columns={[
            { title: '修改日期', dataIndex: 'date' },
            { title: '处方医生', dataIndex: 'doctor' },
            { title: '处方摘要', dataIndex: 'summary' },
            {
              title: '状态', dataIndex: 'status',
              render: v => <Tag color={v === '当前有效' ? 'green' : 'default'}>{v}</Tag>,
            },
            { title: '操作', render: () => <Button size="small">查看详情</Button> },
          ]}
        />
      </Modal>

      {/* 保存确认弹窗 */}
      <Modal
        title="确认修改处方"
        open={showConfirm}
        onOk={handleConfirm}
        onCancel={() => setShowConfirm(false)}
        okText="确认保存"
        cancelText="取消"
      >
        <div style={{ padding: '8px 0', fontSize: 14, color: '#0D1B3E', lineHeight: 1.8 }}>
          <div>即将保存对 <strong>{PATIENTS.find(p => p.value === selectedPatient)?.label.split(' — ')[0]}</strong> 的透析处方修改。</div>
          <div style={{ marginTop: 8, padding: 10, background: '#FFF1F2', border: '1px solid #FECDD3', borderRadius: 6, fontSize: 13, color: '#BE123C' }}>
            ⚠️ 处方修改将立即生效，护士在下次透析录入时将使用新处方参数。此操作将记录审计日志。
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
