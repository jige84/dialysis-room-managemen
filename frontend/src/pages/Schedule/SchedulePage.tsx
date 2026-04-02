/**
 * 周排班管理页
 * 主要作用：展示本周患者与护士排班，并支持护士长调整当班护士。
 * 主要功能：周视图切换；从后端加载周排班；展示护患比；调整护士排班。
 */
import { useEffect, useState } from 'react';
import { Card, Button, Select, Modal, Form, Input, DatePicker, message, Tooltip, Spin } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import { scheduleApi, type ShiftKey, type WeekScheduleResponse } from '../../api/schedule';
import { usePermission } from '../..//utils/permission';

const SHIFT_CONFIG: { key: ShiftKey; label: string }[] = [
  { key: 'am', label: '上午班 (06:00-12:00)' },
  { key: 'pm', label: '下午班 (12:00-18:00)' },
  { key: 'eve', label: '晚班 (18:00-00:00)' },
];
const DAYS_OF_WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const CHIP_COLORS = [
  { bg: '#DBEAFE', color: '#1E40AF' },
  { bg: '#EDE9FE', color: '#5B21B6' },
  { bg: '#DCFCE7', color: '#15803D' },
  { bg: '#FEF9C3', color: '#854D0E' },
  { bg: '#FCE7F3', color: '#9D174D' },
];

const SHIFT_LABEL_CN: Record<string, string> = { am: '早', pm: '中', eve: '晚' };

/** 从 weekData 汇总护士排班表 */
function buildNurseGrid(wd: WeekScheduleResponse | null) {
  if (!wd) return { names: [] as string[], grid: {} as Record<string, Record<string, string>> };
  const nurseSet = new Map<string, string>();
  const grid: Record<string, Record<string, string>> = {};

  for (const shift of wd.shifts) {
    for (const day of wd.days) {
      const cell = wd.cells[shift]?.[day.date];
      if (!cell) continue;
      for (const n of cell.nurses) {
        if (!nurseSet.has(n.nurseId)) nurseSet.set(n.nurseId, n.name);
        if (!grid[n.name]) grid[n.name] = {};
        const prev = grid[n.name][day.label];
        const label = SHIFT_LABEL_CN[shift] || shift;
        grid[n.name][day.label] = prev ? `${prev}/${label}` : label;
      }
    }
  }

  for (const [, name] of nurseSet) {
    if (!grid[name]) grid[name] = {};
    for (const day of wd.days) {
      if (!grid[name][day.label]) grid[name][day.label] = '休';
    }
  }

  return { names: [...nurseSet.values()], grid };
}

export default function SchedulePage() {
  const [currentWeek, setCurrentWeek] = useState(dayjs().startOf('week'));
  const [weekData, setWeekData] = useState<WeekScheduleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [weeklyPlan, setWeeklyPlan] = useState<string>('');
  const [form] = Form.useForm();
  const { canSchedule } = usePermission();

  const weekLabel = `${currentWeek.format('YYYY年M月D日')} — ${currentWeek.add(6, 'day').format('M月D日')}`;

  const loadWeek = async (weekStart: dayjs.Dayjs) => {
    try {
      setLoading(true);
      const startDate = weekStart.format('YYYY-MM-DD');
      const data = await scheduleApi.getWeek(startDate);
      setWeekData(data);
    } catch {
      message.error('加载周排班失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWeek(currentWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWeek.format('YYYY-MM-DD')]);

  const nonCompliantCount = weekData
    ? weekData.shifts.reduce((sum, shift) => {
        const cellsByDate = weekData.cells[shift];
        const count = Object.values(cellsByDate || {}).filter(
          (cell) => !cell.compliant && cell.patients.length > 0,
        ).length;
        return sum + count;
      }, 0)
    : 0;

  const today = dayjs();
  const todayDateStr = today.format('YYYY-MM-DD');

  const todayStats = weekData
    ? weekData.shifts.reduce(
        (acc, shift) => {
          const cell = weekData.cells[shift]?.[todayDateStr];
          if (!cell) return acc;
          acc.shifts += 1;
          acc.patients += cell.patients.length;
          acc.nurses += cell.nurses.length;
          return acc;
        },
        { shifts: 0, patients: 0, nurses: 0 },
      )
    : { shifts: 0, patients: 0, nurses: 0 };

  const handleChangeWeek = (delta: number) => {
    setCurrentWeek((d) => d.add(delta, 'week'));
  };

  const handleOpenModal = () => {
    if (!canSchedule) return;
    setShowModal(true);
  };

  const handleSaveNurseSchedule = async () => {
    try {
      const values = await form.validateFields();
      const date: string = values.date.format('YYYY-MM-DD');
      const shift: ShiftKey = values.shift;
      const nurseIds: string[] = values.nurses || [];
      await scheduleApi.adjustNurses({ date, shift, nurseIds });
      message.success('护士排班已更新');
      setShowModal(false);
      form.resetFields();
      loadWeek(currentWeek);
    } catch (e: unknown) {
      const maybeValidationError = e as { errorFields?: unknown };
      if (maybeValidationError?.errorFields) {
        return;
      }
      message.error('保存护士排班失败，请稍后重试');
    }
  };

  return (
    <PageShell fullWidth>
      {/* 概览统计 */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="hd-stat-card teal">
          <div className="hd-stat-icon">📅</div>
          <div className="hd-stat-label">今日排班班次</div>
          <div className="hd-stat-value num">{todayStats.shifts}</div>
          <div className="hd-stat-meta">本日有排班的班次</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-icon">👩‍⚕️</div>
          <div className="hd-stat-label">今日当班护士</div>
          <div className="hd-stat-value num">{todayStats.nurses}</div>
          <div className="hd-stat-meta">按护士排班统计</div>
        </div>
        <div className="hd-stat-card amber">
          <div className="hd-stat-icon">💉</div>
          <div className="hd-stat-label">今日安排患者</div>
          <div className="hd-stat-value num">{todayStats.patients}</div>
          <div className="hd-stat-meta">所有班次合计</div>
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
            <Button icon={<LeftOutlined />} size="small" onClick={() => handleChangeWeek(-1)} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>📅 {weekLabel}</span>
            <Button icon={<RightOutlined />} size="small" onClick={() => handleChangeWeek(1)} />
            <Button size="small" onClick={() => setCurrentWeek(dayjs().startOf('week'))}>本周</Button>
          </div>
        }
        extra={
          canSchedule && (
            <Button type="primary" onClick={handleOpenModal}>
              ＋ 调整排班（护士）
            </Button>
          )
        }
      >
        <Spin spinning={loading}>
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
              {SHIFT_CONFIG.map((shiftCfg) => {
                const shiftKey = shiftCfg.key;
                return (
                  <tr key={shiftCfg.key}>
                    <td style={{ padding: '12px 14px', borderBottom: '1px solid #DBEAFE', borderRight: '1px solid #DBEAFE', background: '#F0F7FF', fontWeight: 600, fontSize: 12.5, color: '#0369A1', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {shiftCfg.label}
                    </td>
                    {DAYS_OF_WEEK.map((day, idx) => {
                      const date = currentWeek.add(idx, 'day').format('YYYY-MM-DD');
                      const cell = weekData?.cells[shiftKey]?.[date];
                      const isToday = currentWeek.add(idx, 'day').isSame(dayjs(), 'day');
                      return (
                        <td key={day} style={{ padding: 8, borderBottom: '1px solid #DBEAFE', borderRight: '1px solid #DBEAFE', background: isToday ? '#F0F9FF' : 'transparent', verticalAlign: 'top' }}>
                          {cell && cell.patients.length > 0 ? (
                            <div>
                              <div className="flex items-center gap-4" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                                {cell.ratio !== '—' && (
                                  <span style={{ background: cell.compliant ? '#ECFDF5' : '#FFF1F2', color: cell.compliant ? '#059669' : '#BE123C', padding: '1px 6px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                                    {cell.ratio}
                                  </span>
                                )}
                                {cell.nurses.length > 0 && (
                                  <span style={{ fontSize: 11, color: '#7B92BC' }}>
                                    {cell.nurses.map((n) => n.name).join('·')}
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {cell.patients.slice(0, 4).map((p, i) => {
                                  const c = CHIP_COLORS[i % CHIP_COLORS.length];
                                  return (
                                    <Tooltip
                                      key={p.patientId}
                                      title={`${p.name} · ${p.machineNo || '未分配机器'}`}
                                    >
                                      <span style={{ background: c.bg, color: c.color, padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 500 }}>
                                        {p.name.charAt(0)}
                                      </span>
                                    </Tooltip>
                                  );
                                })}
                                {cell.patients.length > 4 && (
                                  <Tooltip title={cell.patients.slice(4).map(p => p.name).join('、')}>
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
        </Spin>
      </Card>

      {/* 护患比不合规提示 */}
      {nonCompliantCount > 0 && (
        <div className="hd-alert-item warning" style={{ marginBottom: 20 }}>
          <span className="hd-alert-icon">⚠️</span>
          <div className="hd-alert-content">
            <div className="hd-alert-title">本周 {nonCompliantCount} 个班次护患比超标（&gt; 1:5）</div>
            <div className="hd-alert-desc">请合理分配护士与患者，确保护患比 ≤ 1:5</div>
          </div>
          {canSchedule && (
            <Button size="small" type="default" onClick={handleOpenModal}>
              调整护士排班
            </Button>
          )}
        </div>
      )}

      {/* 调整排班弹窗 */}
      <Modal
        title="调整护士排班"
        open={showModal}
        onOk={handleSaveNurseSchedule}
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
              <Select
                options={[
                  { value: 'am', label: '上午班' },
                  { value: 'pm', label: '下午班' },
                  { value: 'eve', label: '晚班' },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item label="当班护士（输入用户ID）" name="nurses">
            <Select
              mode="tags"
              placeholder="请输入或粘贴护士用户ID，按回车确认"
            />
          </Form.Item>
          <Form.Item label="排班说明" name="notes">
            <Input.TextArea rows={2} placeholder="如：调班原因、特殊安排等…" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 护士排班表（基于 API 数据动态生成） */}
      {(() => {
        const { names: nurseNames, grid: nurseGrid } = buildNurseGrid(weekData);
        if (nurseNames.length === 0) return null;
        return (
          <Card
            style={{ border: '1px solid #DBEAFE', marginTop: 24, marginBottom: 16 }}
            styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
            title={<span style={{ fontWeight: 600, color: '#0D1B3E' }}>血透护士排班表</span>}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 10px', border: '1px solid #DBEAFE', background: '#F8FAFC', width: 80 }}>序号</th>
                    <th style={{ padding: '8px 10px', border: '1px solid #DBEAFE', background: '#F8FAFC', width: 100 }}>姓名</th>
                    {DAYS_OF_WEEK.map((d) => (
                      <th key={d} style={{ padding: '8px 10px', border: '1px solid #DBEAFE', background: '#F8FAFC', textAlign: 'center' }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {nurseNames.map((name, idx) => (
                    <tr key={name}>
                      <td style={{ padding: '6px 10px', border: '1px solid #E2E8F0', textAlign: 'center' }}>{idx + 1}</td>
                      <td style={{ padding: '6px 10px', border: '1px solid #E2E8F0' }}>{name}</td>
                      {DAYS_OF_WEEK.map((d) => {
                        const val = nurseGrid[name]?.[d] ?? '';
                        const isRest = val === '休';
                        const isNight = val.includes('晚');
                        return (
                          <td key={d} style={{
                            padding: '6px 8px', border: '1px solid #E2E8F0', textAlign: 'center',
                            color: isRest ? '#94A3B8' : isNight ? '#C026D3' : '#0F172A',
                            background: isRest ? '#F9FAFB' : isNight ? '#FEF3FF' : 'white',
                          }}>
                            {val || '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}

      {/* 本周科室计划及时间安排（静态示意） */}
      <Card
        style={{ border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF', borderBottom: '1px solid #DBEAFE' } }}
        title={<span style={{ fontWeight: 600, color: '#0D1B3E' }}>本周科室计划及时间安排</span>}
      >
        <div style={{ marginBottom: 8, color: '#64748B', fontSize: 12 }}>
          说明：用于记录本周护理文书整理、透析记录单检查、感染监控记录、质控学习讨论等安排，目前仅前端本地保存，
          后续可接入后端按周持久化。
        </div>
        <div style={{ marginBottom: 8, color: '#0F172A', fontSize: 12, fontWeight: 500 }}>
          本周区间：{currentWeek.format('YYYY年M月D日')} — {currentWeek.add(6, 'day').format('M月D日')}
        </div>
        <Input.TextArea
          rows={6}
          value={weeklyPlan}
          onChange={(e) => setWeeklyPlan(e.target.value)}
          placeholder={
            '示例：\n' +
            '周一：护理由文书质控，检查 3.16–3.22 透析记录单问题（要求：无漏项、错项，完整有责任人）...\n' +
            '周二：完成 3.23–3.29 透析记录单核对，各班次负责到位...\n' +
            '周三：科内感染监控质控，检查院感登记完整情况...\n' +
            '周五：本月质控学习与讨论，例如：Kt/V 不达标病例分析（主持：杨晨）...'
          }
        />
      </Card>
    </PageShell>
  );
}
