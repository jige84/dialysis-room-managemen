import { useState } from 'react';
import { Card, Button, Select, Modal, Form, Input, DatePicker, message, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';

const SHIFTS = ['上午班 (06:00-12:00)', '下午班 (12:00-18:00)', '晚班 (18:00-00:00)'];
const DAYS_OF_WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 周视图数据
const WEEK_SCHEDULE: Record<string, Record<string, { patients: string[]; nurses: string[]; ratio: string; compliant: boolean }>> = {
  '上午班': {
    '周一': { patients: ['张国华', '李秀珍', '赵丽萍', '刘明远', '孙红梅', '陈春梅', '王社香', '高月英'], nurses: ['杨晨', '李梅'], ratio: '1:4.0', compliant: true },
    '周二': { patients: ['王建军', '张永志', '刘红', '陈明'],                          nurses: ['张颖'],       ratio: '1:4.0', compliant: true },
    '周三': { patients: ['张国华', '李秀珍', '赵丽萍', '刘明远', '孙红梅', '陈春梅', '王社香', '高月英'], nurses: ['杨晨', '李梅'], ratio: '1:4.0', compliant: true },
    '周四': { patients: ['王建军', '张永志', '刘红', '陈明'],                          nurses: ['张颖'],       ratio: '1:4.0', compliant: true },
    '周五': { patients: ['张国华', '李秀珍', '赵丽萍', '刘明远', '孙红梅', '陈春梅', '王社香', '高月英'], nurses: ['杨晨', '李梅'], ratio: '1:4.0', compliant: true },
    '周六': { patients: [],                                                           nurses: [],            ratio: '—',    compliant: true },
    '周日': { patients: [],                                                           nurses: [],            ratio: '—',    compliant: true },
  },
  '下午班': {
    '周一': { patients: ['张国华', '陈春梅', '王建军', '赵丽萍', '刘明远', '孙红梅', '高月英', '马永芳', '宁德志', '吴敏'], nurses: ['陈燕', '王芳', '张颖'], ratio: '1:3.3', compliant: true },
    '周二': { patients: ['张国华', '李秀珍', '王社香', '高月英', '赵丽萍'],              nurses: ['陈燕', '刘娜'], ratio: '1:2.5', compliant: true },
    '周三': { patients: ['张国华', '陈春梅', '王建军', '赵丽萍', '刘明远', '孙红梅', '高月英', '马永芳', '宁德志', '吴敏'], nurses: ['陈燕', '王芳', '张颖'], ratio: '1:3.3', compliant: true },
    '周四': { patients: ['张国华', '李秀珍', '王社香', '高月英', '赵丽萍'],              nurses: ['陈燕', '刘娜'], ratio: '1:2.5', compliant: true },
    '周五': { patients: ['张国华', '陈春梅', '王建军', '赵丽萍', '刘明远', '孙红梅', '高月英', '马永芳', '宁德志', '吴敏'], nurses: ['陈燕', '王芳', '张颖'], ratio: '1:3.3', compliant: true },
    '周六': { patients: [],  nurses: [],  ratio: '—',    compliant: true },
    '周日': { patients: [],  nurses: [],  ratio: '—',    compliant: true },
  },
  '晚班': {
    '周一': { patients: ['孙红梅', '李秀珍', '陈明', '赵丽萍', '刘明远', '宁德志', '张永志', '周海', '王敏'], nurses: ['刘娜', '赵丽'], ratio: '1:4.5', compliant: true },
    '周二': { patients: ['赵丽萍', '王建军', '陈春梅', '高月英', '马永芳', '吴敏'],        nurses: ['赵丽'],       ratio: '1:6.0', compliant: false },
    '周三': { patients: ['孙红梅', '李秀珍', '陈明', '赵丽萍', '刘明远', '宁德志', '张永志', '周海', '王敏'], nurses: ['刘娜', '赵丽'], ratio: '1:4.5', compliant: true },
    '周四': { patients: ['赵丽萍', '王建军', '陈春梅', '高月英', '马永芳', '吴敏'],        nurses: ['赵丽'],       ratio: '1:6.0', compliant: false },
    '周五': { patients: ['孙红梅', '李秀珍', '陈明', '赵丽萍', '刘明远', '宁德志', '张永志', '周海', '王敏'], nurses: ['刘娜', '赵丽'], ratio: '1:4.5', compliant: true },
    '周六': { patients: [],  nurses: [],  ratio: '—',    compliant: true },
    '周日': { patients: [],  nurses: [],  ratio: '—',    compliant: true },
  },
};

const CHIP_COLORS = [
  { bg: '#DBEAFE', color: '#1E40AF' },
  { bg: '#EDE9FE', color: '#5B21B6' },
  { bg: '#DCFCE7', color: '#15803D' },
  { bg: '#FEF9C3', color: '#854D0E' },
  { bg: '#FCE7F3', color: '#9D174D' },
];

export default function SchedulePage() {
  const [currentWeek, setCurrentWeek] = useState(dayjs().startOf('week'));
  const [showModal, setShowModal] = useState(false);
  const [form] = Form.useForm();

  const weekLabel = `${currentWeek.format('YYYY年M月D日')} — ${currentWeek.add(6, 'day').format('M月D日')}`;

  const nonCompliantCount = Object.values(WEEK_SCHEDULE).reduce((sum, shift) =>
    sum + Object.values(shift).filter(day => !day.compliant && day.patients.length > 0).length, 0);

  return (
    <PageShell fullWidth>
      {/* 概览统计 */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">📅</div>
          <div className="hd-stat-label">今日排班班次</div>
          <div className="hd-stat-value num">3</div>
          <div className="hd-stat-meta">上午 / 下午 / 晚班</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">👩‍⚕️</div>
          <div className="hd-stat-label">今日当班护士</div>
          <div className="hd-stat-value num">7</div>
          <div className="hd-stat-meta">杨晨、陈燕等</div>
        </div>
        <div className="hd-stat-card amber">
          <div className="hd-stat-icon">💉</div>
          <div className="hd-stat-label">今日安排患者</div>
          <div className="hd-stat-value num">27</div>
          <div className="hd-stat-meta">3班次合计</div>
        </div>
        {nonCompliantCount > 0 ? (
          <div className="hd-stat-card red">
            <div className="hd-stat-icon">⚠️</div>
            <div className="hd-stat-label">护患比超标班次</div>
            <div className="hd-stat-value num" style={{ color: '#BE123C' }}>{nonCompliantCount}</div>
            <div className="hd-stat-meta">护患比 &gt; 1:5</div>
          </div>
        ) : (
          <div className="hd-stat-card teal">
            <div className="hd-stat-icon">✅</div>
            <div className="hd-stat-label">护患比合规班次</div>
            <div className="hd-stat-value num">本周全部</div>
            <div className="hd-stat-meta">均符合规程要求</div>
          </div>
        )}
      </div>

      {/* 周视图导航 */}
      <Card style={{ border: '1px solid #DBEAFE', marginBottom: 20 }}
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={
          <div className="flex items-center gap-12">
            <Button icon={<LeftOutlined />} size="small" onClick={() => setCurrentWeek(d => d.subtract(1, 'week'))} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>📅 {weekLabel}</span>
            <Button icon={<RightOutlined />} size="small" onClick={() => setCurrentWeek(d => d.add(1, 'week'))} />
            <Button size="small" onClick={() => setCurrentWeek(dayjs().startOf('week'))}>本周</Button>
          </div>
        }
        extra={
          <Button type="primary" onClick={() => setShowModal(true)}>＋ 调整排班</Button>
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 100, padding: '10px 14px', background: '#F8FAFC', fontWeight: 600, fontSize: 12.5, color: '#3D5280', borderBottom: '2px solid #DBEAFE', borderRight: '1px solid #DBEAFE', textAlign: 'left' }}>
                  班次
                </th>
                {DAYS_OF_WEEK.map((day, i) => {
                  const date = currentWeek.add(i, 'day');
                  const isToday = date.isSame(dayjs(), 'day');
                  return (
                    <th key={day} style={{ padding: '10px 8px', background: isToday ? '#E0F2FE' : '#F8FAFC', fontWeight: 600, fontSize: 12.5, color: isToday ? '#0369A1' : '#3D5280', borderBottom: '2px solid #DBEAFE', borderRight: '1px solid #DBEAFE', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {day}
                      <div style={{ fontSize: 11, fontWeight: 400, color: isToday ? '#0369A1' : '#7B92BC' }}>{date.format('M/D')}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {SHIFTS.map(shift => {
                const shiftKey = shift.split(' ')[0] as keyof typeof WEEK_SCHEDULE;
                return (
                  <tr key={shift}>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid #DBEAFE', borderRight: '1px solid #DBEAFE', background: '#F0F7FF', fontWeight: 600, fontSize: 12.5, color: '#0369A1', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {shift}
                    </td>
                    {DAYS_OF_WEEK.map(day => {
                      const cell = WEEK_SCHEDULE[shiftKey]?.[day];
                      if (!cell) return <td key={day} style={{ padding: 10, borderBottom: '1px solid #DBEAFE', borderRight: '1px solid #DBEAFE' }} />;
                      const isToday = currentWeek.add(DAYS_OF_WEEK.indexOf(day), 'day').isSame(dayjs(), 'day');
                      return (
                        <td key={day} style={{ padding: 8, borderBottom: '1px solid #DBEAFE', borderRight: '1px solid #DBEAFE', background: isToday ? '#F0F9FF' : 'transparent', verticalAlign: 'top' }}>
                          {cell.patients.length > 0 ? (
                            <div>
                              <div className="flex items-center gap-4" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                                <span style={{ background: cell.compliant ? '#ECFDF5' : '#FFF1F2', color: cell.compliant ? '#059669' : '#BE123C', padding: '1px 6px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                                  {cell.ratio}
                                </span>
                                <span style={{ fontSize: 11, color: '#7B92BC' }}>{cell.nurses.join('·')}</span>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {cell.patients.slice(0, 4).map((p, i) => {
                                  const c = CHIP_COLORS[i % CHIP_COLORS.length];
                                  return (
                                    <span key={p} style={{ background: c.bg, color: c.color, padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 500 }}>
                                      {p.charAt(0)}
                                    </span>
                                  );
                                })}
                                {cell.patients.length > 4 && (
                                  <Tooltip title={cell.patients.slice(4).join('、')}>
                                    <span style={{ background: '#F1F5F9', color: '#64748B', padding: '2px 6px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                                      +{cell.patients.length - 4}
                                    </span>
                                  </Tooltip>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: '#7B92BC', marginTop: 4 }}>共{cell.patients.length}人</div>
                            </div>
                          ) : (
                            <div style={{ color: '#BFDBFE', fontSize: 12, padding: '4px 0' }}>—</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 护患比不合规提示 */}
      {nonCompliantCount > 0 && (
        <div className="hd-alert-item warning" style={{ marginBottom: 20 }}>
          <span className="hd-alert-icon">⚠️</span>
          <div className="hd-alert-content">
            <div className="hd-alert-title">本周 {nonCompliantCount} 个班次护患比超标（&gt; 1:5）</div>
            <div className="hd-alert-desc">周二/周四晚班：1:6.0（仅1名护士，6名患者），请及时调整排班</div>
          </div>
          <Button size="small" type="default" onClick={() => setShowModal(true)}>调整排班</Button>
        </div>
      )}

      {/* 调整排班弹窗 */}
      <Modal
        title="调整排班"
        open={showModal}
        onOk={() => form.validateFields().then(() => { setShowModal(false); form.resetFields(); message.success('排班已调整，相关护士将收到通知'); })}
        onCancel={() => { setShowModal(false); form.resetFields(); }}
        okText="保存排班"
        cancelText="取消"
        width={540}
      >
        <Form form={form} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <div className="grid-2" style={{ gap: 16 }}>
            <Form.Item label="调整日期" name="date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="班次" name="shift" rules={[{ required: true }]}>
              <Select options={[{ value: 'am', label: '上午班' }, { value: 'pm', label: '下午班' }, { value: 'eve', label: '晚班' }]} />
            </Form.Item>
          </div>
          <Form.Item label="当班护士" name="nurses" rules={[{ required: true }]}>
            <Select mode="multiple" placeholder="选择当班护士" options={['杨晨','陈燕','李梅','王芳','张颖','刘娜','赵丽'].map(n => ({ value: n, label: n }))} />
          </Form.Item>
          <Form.Item label="排班说明" name="notes">
            <Input.TextArea rows={2} placeholder="如：调班原因、特殊安排等…" />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}
