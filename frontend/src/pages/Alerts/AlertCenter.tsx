import { useState } from 'react';
import { Card, Button, Select, Input, Modal, Form, message } from 'antd';
import { SearchOutlined, CheckOutlined } from '@ant-design/icons';
import PageShell from '../../components/PageShell/PageShell';

interface AlertItem {
  key: string;
  level: 'critical' | 'high' | 'medium' | 'info';
  category: 'lab' | 'ktv' | 'infection' | 'vascular' | 'uf' | 'nurse_ratio' | 'dry_weight';
  patient: string;
  title: string;
  desc: string;
  time: string;
  status: 'active' | 'acknowledged' | 'resolved';
  handler?: string;
}

const ALERT_DATA: AlertItem[] = [
  { key: '1', level: 'critical', category: 'lab',       patient: '赵丽萍', title: '危急值 — 血清钾 K⁺ 严重偏高',         desc: 'K⁺ = 6.8 mmol/L（危急值上限 6.5 mmol/L），超出 4.6%，存在心律失常风险',           time: '2026-03-19 09:42',  status: 'active' },
  { key: '2', level: 'high',     category: 'ktv',       patient: '王建军', title: 'Kt/V 不达标 — 透析充分性不足',          desc: 'spKt/V = 1.05（标准 ≥1.2），URR = 58%（标准 ≥65%）。本月连续 3 次不达标。',  time: '2026-03-15',        status: 'active' },
  { key: '3', level: 'high',     category: 'infection', patient: '李秀珍', title: '传染病复查超期 — 抗HCV到期逾期',        desc: '抗HCV 上次检测：2025-09-12，应于 2026-03-12 前复查，已逾期 7 天',               time: '2026-03-19 00:00',  status: 'active' },
  { key: '4', level: 'medium',   category: 'infection', patient: '陈春梅', title: '传染病复查即将到期 — 25天后需复查',      desc: 'HBsAg/抗HCV/抗HIV/梅毒均将于 2026-04-15 到期，请提前安排检测',                  time: '2026-03-19 08:00',  status: 'active' },
  { key: '5', level: 'medium',   category: 'infection', patient: '孙红梅', title: '传染病复查即将到期 — 20天后需复查',      desc: '上次筛查：2025-10-01，将于 2026-04-08 到期，建议提前安排',                       time: '2026-03-19 08:00',  status: 'active' },
  { key: '6', level: 'high',     category: 'uf',        patient: '赵丽萍', title: '超滤量 > 5% 干体重',                    desc: '超滤 3200 mL / 干体重 52kg，比例 6.2%（上限 5.0%），超出 1.2%',               time: '2026-03-17 14:30',  status: 'acknowledged', handler: '陈燕' },
  { key: '7', level: 'medium',   category: 'vascular',  patient: '陈春梅', title: '血管通路评估到期 — AVF 需评估',          desc: '上次评估：2025-11-20，已超过 2 个月，规程要求每 8-12 周评估一次',                time: '2026-03-01 08:00',  status: 'active' },
  { key: '8', level: 'info',     category: 'dry_weight', patient: '刘明远', title: '干体重评估超期提醒',                    desc: '距上次干体重调整已 18 天（超过 2 周），请安排重新评估',                          time: '2026-03-05 08:00',  status: 'resolved', handler: '任计阁' },
];

const LEVEL_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  critical: { label: '危急值', icon: '⚡', color: '#BE123C', bg: '#FFF1F2', border: '#F43F5E' },
  high:     { label: '高优先级', icon: '🔴', color: '#C2410C', bg: '#FFFBEB', border: '#F59E0B' },
  medium:   { label: '中优先级', icon: '🟡', color: '#1D4ED8', bg: '#EEF2FF', border: '#6366F1' },
  info:     { label: '信息提示', icon: 'ℹ️',  color: '#059669', bg: '#ECFDF5', border: '#10B981' },
};

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  active:       { label: '未处理', color: '#BE123C', bg: '#FFF1F2' },
  acknowledged: { label: '已知晓', color: '#D97706', bg: '#FFFBEB' },
  resolved:     { label: '已处理', color: '#059669', bg: '#ECFDF5' },
};

const CATEGORY_LABEL: Record<string, string> = {
  lab: '检验危急值', ktv: 'Kt/V不达标', infection: '传染病复查',
  vascular: '血管通路', uf: '超滤量', nurse_ratio: '护患比', dry_weight: '干体重',
};

export default function AlertCenterPage() {
  const [levelFilter, setLevelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [handleModal, setHandleModal] = useState<AlertItem | null>(null);
  const [handleForm] = Form.useForm();

  const filtered = ALERT_DATA.filter(a => {
    if (search && !a.patient.includes(search) && !a.title.includes(search)) return false;
    if (levelFilter && a.level !== levelFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    if (categoryFilter && a.category !== categoryFilter) return false;
    return true;
  });

  const criticals = filtered.filter(a => a.level === 'critical');
  const highs     = filtered.filter(a => a.level === 'high');
  const mediums   = filtered.filter(a => a.level === 'medium');
  const infos     = filtered.filter(a => a.level === 'info');

  const handleAck = (a: AlertItem) => {
    setHandleModal(a);
  };

  const confirmHandle = () => {
    handleForm.validateFields().then(() => {
      setHandleModal(null);
      handleForm.resetFields();
      message.success('预警已处理，已记录处理记录');
    });
  };

  const countActive = ALERT_DATA.filter(a => a.status === 'active').length;

  return (
    <PageShell fullWidth>
      {/* 概览数据 */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card red">
          <div className="hd-stat-icon">⚡</div>
          <div className="hd-stat-label">危急值（需立即处理）</div>
          <div className="hd-stat-value num" style={{ color: '#BE123C' }}>{ALERT_DATA.filter(a => a.level === 'critical' && a.status === 'active').length}</div>
          <div className="hd-stat-meta">今日新增</div>
        </div>
        <div className="hd-stat-card amber">
          <div className="hd-stat-icon">🔴</div>
          <div className="hd-stat-label">高优先级（今日处理）</div>
          <div className="hd-stat-value num" style={{ color: '#C2410C' }}>{ALERT_DATA.filter(a => a.level === 'high' && a.status === 'active').length}</div>
          <div className="hd-stat-meta">包括Kt/V/传染病超期</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">🟡</div>
          <div className="hd-stat-label">中优先级（近期处理）</div>
          <div className="hd-stat-value num" style={{ color: '#1D4ED8' }}>{ALERT_DATA.filter(a => a.level === 'medium' && a.status === 'active').length}</div>
          <div className="hd-stat-meta">即将到期提醒</div>
        </div>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">✅</div>
          <div className="hd-stat-label">未处理总数</div>
          <div className="hd-stat-value num">{countActive}</div>
          <div className="hd-stat-meta">需关注处理</div>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex gap-8 items-center" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#7B92BC' }} />}
          placeholder="搜索患者姓名 / 预警内容…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 240, borderColor: '#DBEAFE' }}
          allowClear
        />
        <Select placeholder="全部级别" value={levelFilter || undefined} onChange={v => setLevelFilter(v || '')} style={{ width: 130 }} allowClear
          options={[{ value: 'critical', label: '⚡ 危急值' }, { value: 'high', label: '🔴 高优先级' }, { value: 'medium', label: '🟡 中优先级' }, { value: 'info', label: 'ℹ️ 信息提示' }]}
        />
        <Select placeholder="全部类别" value={categoryFilter || undefined} onChange={v => setCategoryFilter(v || '')} style={{ width: 140 }} allowClear
          options={Object.entries(CATEGORY_LABEL).map(([k, v]) => ({ value: k, label: v }))}
        />
        <div className="flex gap-4">
          {['', 'active', 'acknowledged', 'resolved'].map(s => (
            <Button
              key={s}
              size="small"
              type={statusFilter === s ? 'primary' : 'default'}
              onClick={() => setStatusFilter(s)}
            >
              {s === '' ? '全部' : STATUS_LABEL[s]?.label}
            </Button>
          ))}
        </div>
      </div>

      {/* 双栏分级展示 */}
      <div className="grid-2" style={{ gap: 20 }}>
        {/* 左栏：危急值 + 高优先级 */}
        <div>
          {[...criticals, ...highs].length === 0 ? (
            <Card style={{ border: '1px solid #DBEAFE', textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
              <div style={{ color: '#7B92BC' }}>暂无危急值或高优先级预警</div>
            </Card>
          ) : (
            <Card title={<span style={{ fontWeight: 600, color: '#BE123C' }}>⚡ 危急值 & 高优先级</span>}
              style={{ border: '1px solid #FECDD3' }}
              styles={{ header: { background: '#FFF1F2', borderBottom: '1px solid #FECDD3' } }}>
              {[...criticals, ...highs].map(a => (
                <AlertCard key={a.key} alert={a} onHandle={handleAck} />
              ))}
            </Card>
          )}
        </div>

        {/* 右栏：中优先级 + 信息提示 */}
        <div>
          {[...mediums, ...infos].length === 0 ? (
            <Card style={{ border: '1px solid #DBEAFE', textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
              <div style={{ color: '#7B92BC' }}>暂无中优先级或信息提醒</div>
            </Card>
          ) : (
            <Card title={<span style={{ fontWeight: 600, color: '#1D4ED8' }}>🟡 中优先级 & 信息提示</span>}
              style={{ border: '1px solid #C7D2FE' }}
              styles={{ header: { background: '#EEF2FF', borderBottom: '1px solid #C7D2FE' } }}>
              {[...mediums, ...infos].map(a => (
                <AlertCard key={a.key} alert={a} onHandle={handleAck} />
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* 处理弹窗 */}
      <Modal
        title="处理预警"
        open={!!handleModal}
        onOk={confirmHandle}
        onCancel={() => { setHandleModal(null); handleForm.resetFields(); }}
        okText="确认处理"
        cancelText="取消"
        width={480}
      >
        {handleModal && (
          <div>
            <div style={{ marginBottom: 16, padding: 14, background: LEVEL_CONFIG[handleModal.level]?.bg, border: `1.5px solid ${LEVEL_CONFIG[handleModal.level]?.border}`, borderRadius: 8 }}>
              <div style={{ fontWeight: 600, color: LEVEL_CONFIG[handleModal.level]?.color, marginBottom: 4 }}>
                {LEVEL_CONFIG[handleModal.level]?.icon} {handleModal.title}
              </div>
              <div style={{ fontSize: 12.5, color: '#3D5280' }}>{handleModal.desc}</div>
            </div>
            <Form form={handleForm} layout="vertical">
              <Form.Item label="处理措施" name="action" rules={[{ required: true, message: '请填写处理措施' }]}>
                <Input.TextArea rows={3} placeholder="请描述您的处理措施…" />
              </Form.Item>
              <Form.Item label="处理状态" name="status" initialValue="resolved" rules={[{ required: true }]}>
                <Select options={[{ value: 'acknowledged', label: '已知晓，继续观察' }, { value: 'resolved', label: '已处理，问题解决' }]} />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}

function AlertCard({ alert, onHandle }: { alert: AlertItem; onHandle: (a: AlertItem) => void }) {
  const cfg = LEVEL_CONFIG[alert.level];
  const sCfg = STATUS_LABEL[alert.status];

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: 14, borderRadius: 6, marginBottom: 10,
      background: cfg.bg, borderLeft: `4px solid ${cfg.border}`,
      opacity: alert.status === 'resolved' ? 0.6 : 1,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-6" style={{ marginBottom: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0D1B3E' }}>{alert.title}</span>
          <span style={{ background: sCfg.bg, color: sCfg.color, padding: '1px 7px', borderRadius: 20, fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
            {sCfg.label}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: '#3D5280', marginBottom: 3 }}>{alert.desc}</div>
        <div style={{ fontSize: 11.5, color: '#7B92BC' }}>
          ⏱ {alert.time}
          {alert.handler && <span style={{ marginLeft: 8 }}>· 处理人：{alert.handler}</span>}
        </div>
      </div>
      {alert.status === 'active' && (
        <Button size="small" icon={<CheckOutlined />} onClick={() => onHandle(alert)} style={{ flexShrink: 0 }}>
          处理
        </Button>
      )}
    </div>
  );
}
