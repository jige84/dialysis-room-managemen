/**
 * 血透护士排班空白表：与周患者排班日期对齐，支持服务端保存（按自然周锚定）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { Alert, Button, Card, Space, Spin, message } from 'antd';
import {
  scheduleApi,
  createEmptyNurseSheetRows,
  normalizeNurseSheetRowsClient,
  type NurseScheduleSheetRow,
  type ScheduleCell,
  type ShiftKey,
  type WeekScheduleResponse,
} from '../../api/schedule';
import styles from './NurseScheduleBlankTemplate.module.css';

const SHIFT_ROW_LABEL: Record<ShiftKey, string> = {
  am: '上午班',
  pm: '下午班',
  eve: '晚班',
};

function StaffingMiniCell({ cell }: { cell: ScheduleCell }) {
  const pc = cell.patients.length;
  const nc =
    typeof cell.staffingNurseCount === 'number' && cell.staffingNurseCount >= 0
      ? cell.staffingNurseCount
      : cell.nurses.length;
  const ratioRaw = cell.ratio?.trim() || '—';
  let stateClass = styles.stateOk;
  let stateText = '合规';
  if (pc === 0 && nc === 0) {
    stateClass = styles.stateEmpty;
    stateText = '空班';
  } else if (nc === 0 && pc > 0) {
    stateClass = styles.stateNoNurse;
    stateText = '缺护士';
  } else if (!cell.compliant) {
    stateClass = styles.stateBad;
    stateText = '超标';
  }
  return (
    <div className={styles.staffingCompact}>
      <span className={styles.staffingNums}>
        {pc}患{nc}护
      </span>
      <span className={styles.staffingSep}>·</span>
      <span className={styles.staffingRatio}>{ratioRaw === '—' ? '—' : ratioRaw}</span>
      <span className={styles.staffingSep}>·</span>
      <span className={stateClass}>{stateText}</span>
    </div>
  );
}

function PatientScheduleStaffingReference(props: {
  weekSchedule: WeekScheduleResponse | null;
  loading: boolean;
  dayDateKeys: string[];
  weekdayLabels: string[];
}) {
  const { weekSchedule, loading, dayDateKeys, weekdayLabels } = props;

  if (loading) {
    return (
      <div style={{ padding: '10px 0' }}>
        <Spin size="small" tip="加载护患比…" />
      </div>
    );
  }

  if (!weekSchedule) {
    return (
      <Alert
        type="warning"
        showIcon
        message="暂无患者周排班"
        description="请先完成上方患者机位排班加载。"
        style={{ marginBottom: 12 }}
      />
    );
  }

  const shifts: ShiftKey[] =
    weekSchedule.shifts?.length > 0 ? weekSchedule.shifts : ['am', 'pm', 'eve'];

  return (
    <div className={styles.staffingBlock}>
      <div className={styles.staffingHead}>
        <span className={styles.staffingTitle}>本周护患比（与上表同周）</span>
        <span className={styles.staffingHint}>
          患者数、护士数来自系统排班；比值 1:x 表示每名护士对应患者数，x≤5 为合规。
        </span>
      </div>
      <div className={styles.staffingTableWrap}>
        <table className={styles.staffingTable}>
          <thead>
            <tr>
              <th>班次</th>
              {dayDateKeys.map((dk, i) => (
                <th key={dk}>
                  <div>{weekdayLabels[i]}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500, marginTop: 2 }}>
                    {dayjs(dk).format('M/D')}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shifts.map((sk) => (
              <tr key={sk}>
                <td className={styles.staffingShiftCell}>{SHIFT_ROW_LABEL[sk] ?? sk}</td>
                {dayDateKeys.map((dk) => {
                  const cell = weekSchedule.cells[sk]?.[dk];
                  const safe: ScheduleCell = cell ?? {
                    patients: [],
                    nurses: [],
                    ratio: '—',
                    compliant: true,
                  };
                  return (
                    <td key={`${sk}-${dk}`}>
                      <StaffingMiniCell cell={safe} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DAYS_HEADER = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

function BlankCell(props: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  readOnly: boolean;
  align?: 'left' | 'center';
  inputClassName?: string;
}) {
  const { value, onChange, ariaLabel, readOnly, align = 'center', inputClassName } = props;
  const inputClass = [
    styles.cellInput,
    readOnly ? styles.cellInputReadonly : styles.cellInputEditable,
    align === 'left' ? styles.nameInput : '',
    inputClassName ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <input
      type="text"
      className={inputClass}
      aria-label={ariaLabel}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export type NurseScheduleBlankTemplateProps = {
  weekStart: Dayjs;
  canEdit: boolean;
  weekSchedule: WeekScheduleResponse | null;
  weekScheduleLoading?: boolean;
};

export default function NurseScheduleBlankTemplate({
  weekStart,
  canEdit,
  weekSchedule,
  weekScheduleLoading = false,
}: NurseScheduleBlankTemplateProps) {
  const weekKey = useMemo(() => weekStart.format('YYYY-MM-DD'), [weekStart]);
  const dayDates = DAYS_HEADER.map((_, i) => weekStart.add(i, 'day'));

  const dayDateKeys = useMemo(() => {
    if (weekSchedule?.days?.length === 7) {
      return weekSchedule.days.map((d) => d.date);
    }
    return dayDates.map((d) => d.format('YYYY-MM-DD'));
  }, [weekSchedule, dayDates]);

  const weekdayLabels = useMemo(() => {
    if (weekSchedule?.days?.length === 7) {
      return weekSchedule.days.map((d) => d.label);
    }
    return [...DAYS_HEADER];
  }, [weekSchedule]);

  const [rows, setRows] = useState<NurseScheduleSheetRow[]>(() => createEmptyNurseSheetRows());
  const [sheetLoading, setSheetLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedByName, setUpdatedByName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSheetLoading(true);
      try {
        const data = await scheduleApi.getNurseSheet(weekKey);
        if (cancelled) return;
        setRows(normalizeNurseSheetRowsClient(data.rows));
        setUpdatedAt(data.updated_at ?? null);
        setUpdatedByName(data.updated_by_name ?? null);
      } catch {
        if (!cancelled) {
          message.error('加载护士排班表失败');
          setRows(createEmptyNurseSheetRows());
          setUpdatedAt(null);
          setUpdatedByName(null);
        }
      } finally {
        if (!cancelled) setSheetLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekKey]);

  const setName = useCallback((rowIdx: number, v: string) => {
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, name: v } : r)));
  }, []);

  const setDay = useCallback((rowIdx: number, dayIdx: number, v: string) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIdx) return r;
        const nextDays = [...r.days] as NurseScheduleSheetRow['days'];
        nextDays[dayIdx] = v;
        return { ...r, days: nextDays };
      }),
    );
  }, []);

  const setOwe = useCallback((rowIdx: number, v: string) => {
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, owe: v } : r)));
  }, []);

  const handleSave = async () => {
    if (!canEdit) return;
    try {
      setSaving(true);
      const data = await scheduleApi.putNurseSheet({
        week_start_date: weekKey,
        rows,
        white_zone: '',
      });
      setRows(normalizeNurseSheetRowsClient(data.rows));
      setUpdatedAt(data.updated_at ?? null);
      setUpdatedByName(data.updated_by_name ?? null);
      message.success('护士排班表已保存');
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } } };
      message.error(ax.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const whiteShiftRows = [0, 1, 2];
  const zoneARows = [0, 1, 2, 3, 4, 5, 6, 7];
  const zoneBRows = [0, 1];

  const metaText = useMemo(() => {
    if (!updatedAt) return '本周尚未保存';
    const t = dayjs(updatedAt);
    const timeOk = t.isValid();
    const who = updatedByName?.trim();
    return `${timeOk ? t.format('MM-DD HH:mm') : updatedAt} 保存${who ? ` · ${who}` : ''}`;
  }, [updatedAt, updatedByName]);

  const readOnly = !canEdit;

  return (
    <Card
      key={weekKey}
      style={{
        marginBottom: 20,
        borderRadius: 10,
        border: '1px solid #e5e7eb',
      }}
      styles={{
        header: {
          background: '#fafafa',
          borderBottom: '1px solid #e5e7eb',
        },
      }}
      title={
        <div className="flex items-center justify-between flex-wrap gap-8" style={{ width: '100%' }}>
          <span style={{ fontWeight: 600, color: '#111827', fontSize: 15 }}>血透护士排班表</span>
          <Space wrap size="small">
            <span style={{ fontSize: 12, color: '#6b7280' }}>{metaText}</span>
            <Button type="primary" size="small" loading={saving} disabled={!canEdit} onClick={handleSave}>
              保存
            </Button>
          </Space>
        </div>
      }
    >
      <p className={styles.intro}>
        与上方本周日期对齐；最右为「欠休」列，中间为周一至周日共 7 列。
      </p>
      <PatientScheduleStaffingReference
        weekSchedule={weekSchedule}
        loading={weekScheduleLoading}
        dayDateKeys={dayDateKeys}
        weekdayLabels={weekdayLabels}
      />
      <Spin spinning={sheetLoading}>
        <div className={styles.sheetOuter}>
          <table className={styles.mainTable}>
            <colgroup>
              <col className={styles.colIdx} />
              <col className={styles.colName} />
              <col className={styles.colShift} />
              <col className={styles.colZone} />
              <col className={styles.colDay} />
              <col className={styles.colDay} />
              <col className={styles.colDay} />
              <col className={styles.colDay} />
              <col className={styles.colDay} />
              <col className={styles.colDay} />
              <col className={styles.colDay} />
              <col className={styles.colOwe} />
            </colgroup>
            <thead>
              <tr>
                <th>序号</th>
                <th>姓名</th>
                <th>班次</th>
                <th>分区</th>
                {dayDateKeys.map((dk, di) => (
                  <th key={dk}>
                    <div className={styles.thDateMain}>{dayjs(dk).format('M.D')}</div>
                    <div className={styles.thDateSub}>{weekdayLabels[di] ?? DAYS_HEADER[di]}</div>
                  </th>
                ))}
                <th className={styles.thOwe}>欠休</th>
              </tr>
            </thead>
            <tbody>
              {whiteShiftRows.map((i) => {
                const rowIdx = i;
                const isFirst = i === 0;
                return (
                  <tr key={`white-${i}`}>
                    <td className={styles.idxCell}>{rowIdx + 1}</td>
                    <td className={styles.nameCell}>
                      <BlankCell
                        value={rows[rowIdx]?.name ?? ''}
                        onChange={(v) => setName(rowIdx, v)}
                        readOnly={readOnly}
                        ariaLabel={`白班第${rowIdx + 1}行姓名`}
                        align="left"
                      />
                    </td>
                    {isFirst ? (
                      <td rowSpan={3} className={`${styles.shiftMerged} ${styles.shiftWhite}`}>
                        白班
                      </td>
                    ) : null}
                    {isFirst ? (
                      <td rowSpan={3} className={`${styles.zoneMerged} ${styles.zoneDash}`} title="只读占位">
                        <span aria-label="白班分区，无需填写">—</span>
                      </td>
                    ) : null}
                    {dayDateKeys.map((dk, di) => (
                      <td key={dk} className={styles.dayCell}>
                        <BlankCell
                          value={rows[rowIdx]?.days[di] ?? ''}
                          onChange={(v) => setDay(rowIdx, di, v)}
                          readOnly={readOnly}
                          ariaLabel={`白班第${rowIdx + 1}行${weekdayLabels[di] ?? dk}`}
                        />
                      </td>
                    ))}
                    <td className={styles.oweCell}>
                      <BlankCell
                        value={rows[rowIdx]?.owe ?? ''}
                        onChange={(v) => setOwe(rowIdx, v)}
                        readOnly={readOnly}
                        ariaLabel={`白班第${rowIdx + 1}行欠休`}
                      />
                    </td>
                  </tr>
                );
              })}

              {zoneARows.map((i) => {
                const rowIdx = 3 + i;
                const isFirst = i === 0;
                return (
                  <tr key={`zone-a-${i}`}>
                    <td className={styles.idxCell}>{rowIdx + 1}</td>
                    <td className={styles.nameCell}>
                      <BlankCell
                        value={rows[rowIdx]?.name ?? ''}
                        onChange={(v) => setName(rowIdx, v)}
                        readOnly={readOnly}
                        ariaLabel={`倒班A区第${i + 1}行姓名`}
                        align="left"
                      />
                    </td>
                    {isFirst ? (
                      <td rowSpan={10} className={`${styles.shiftMerged} ${styles.shiftRotate}`}>
                        倒班
                      </td>
                    ) : null}
                    {isFirst ? (
                      <td rowSpan={8} className={`${styles.zoneMerged} ${styles.zoneA}`}>
                        A区
                      </td>
                    ) : null}
                    {dayDateKeys.map((dk, di) => (
                      <td key={dk} className={styles.dayCell}>
                        <BlankCell
                          value={rows[rowIdx]?.days[di] ?? ''}
                          onChange={(v) => setDay(rowIdx, di, v)}
                          readOnly={readOnly}
                          ariaLabel={`倒班A区第${i + 1}行${weekdayLabels[di] ?? dk}`}
                        />
                      </td>
                    ))}
                    <td className={styles.oweCell}>
                      <BlankCell
                        value={rows[rowIdx]?.owe ?? ''}
                        onChange={(v) => setOwe(rowIdx, v)}
                        readOnly={readOnly}
                        ariaLabel={`倒班A区第${i + 1}行欠休`}
                      />
                    </td>
                  </tr>
                );
              })}

              {zoneBRows.map((i) => {
                const rowIdx = 11 + i;
                const isFirst = i === 0;
                return (
                  <tr key={`zone-b-${i}`}>
                    <td className={styles.idxCell}>{rowIdx + 1}</td>
                    <td className={styles.nameCell}>
                      <BlankCell
                        value={rows[rowIdx]?.name ?? ''}
                        onChange={(v) => setName(rowIdx, v)}
                        readOnly={readOnly}
                        ariaLabel={`倒班B区第${i + 1}行姓名`}
                        align="left"
                      />
                    </td>
                    {isFirst ? (
                      <td rowSpan={2} className={`${styles.zoneMerged} ${styles.zoneB}`}>
                        B区
                      </td>
                    ) : null}
                    {dayDateKeys.map((dk, di) => (
                      <td key={dk} className={styles.dayCell}>
                        <BlankCell
                          value={rows[rowIdx]?.days[di] ?? ''}
                          onChange={(v) => setDay(rowIdx, di, v)}
                          readOnly={readOnly}
                          ariaLabel={`倒班B区第${i + 1}行${weekdayLabels[di] ?? dk}`}
                        />
                      </td>
                    ))}
                    <td className={styles.oweCell}>
                      <BlankCell
                        value={rows[rowIdx]?.owe ?? ''}
                        onChange={(v) => setOwe(rowIdx, v)}
                        readOnly={readOnly}
                        ariaLabel={`倒班B区第${i + 1}行欠休`}
                      />
                    </td>
                  </tr>
                );
              })}

              <tr>
                <td className={`${styles.idxCell} ${styles.idxHighlight}`}>14</td>
                <td className={styles.nameCell}>
                  <BlankCell
                    value={rows[13]?.name ?? ''}
                    onChange={(v) => setName(13, v)}
                    readOnly={readOnly}
                    ariaLabel="本周二线姓名"
                    align="left"
                  />
                </td>
                <td colSpan={2} className={styles.secondaryMerged}>
                  本周二线
                </td>
                {dayDateKeys.map((dk, di) => (
                  <td key={dk} className={styles.dayCell}>
                    <BlankCell
                      value={rows[13]?.days[di] ?? ''}
                      onChange={(v) => setDay(13, di, v)}
                      readOnly={readOnly}
                      ariaLabel={`本周二线${weekdayLabels[di] ?? dk}`}
                    />
                  </td>
                ))}
                <td className={styles.oweCell}>
                  <BlankCell
                    value={rows[13]?.owe ?? ''}
                    onChange={(v) => setOwe(13, v)}
                    readOnly={readOnly}
                    ariaLabel="本周二线欠休"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Spin>
    </Card>
  );
}
