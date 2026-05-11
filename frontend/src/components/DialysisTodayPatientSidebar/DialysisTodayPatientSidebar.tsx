/**
 * 今日上机名单侧栏：纵向一列，按班次 → 分区展示，供透析工作台左侧与右侧录入联动
 */
import { useMemo, useState } from 'react';
import { Tag, Tooltip } from 'antd';
import { CheckCircleFilled, InfoCircleFilled } from '@ant-design/icons';
import type { TodaySchedulePatientRow } from '../../api/schedule';
import {
  scheduleShiftLabel,
  sessionDialysisModeShort,
  accessTypeCn,
  isolationTagProps,
  ageFromDob,
  groupTodayScheduleRowsByShiftThenZone,
  normalizeScheduleShiftKey,
} from '../../utils/dialysisTodayScheduleDisplay';

export type DialysisTodayPatientSidebarProps = {
  rows: TodaySchedulePatientRow[];
  headerDateLabel: string;
  onSelectPatient: (row: TodaySchedulePatientRow) => void;
  selectedPatientId?: string;
  selectedScheduleDate?: string;
};

type SidebarShiftFilter = 'all' | 'morning' | 'afternoon' | 'evening';

export default function DialysisTodayPatientSidebar({
  rows,
  headerDateLabel,
  onSelectPatient,
  selectedPatientId,
  selectedScheduleDate,
}: DialysisTodayPatientSidebarProps) {
  const [sidebarScheduleShiftFilter, setSidebarScheduleShiftFilter] = useState<SidebarShiftFilter>('all');

  const sidebarShiftTabCounts = useMemo(() => {
    let morning = 0;
    let afternoon = 0;
    let evening = 0;
    for (const r of rows) {
      const k = normalizeScheduleShiftKey(r.shift);
      if (k === 'morning') morning += 1;
      else if (k === 'afternoon') afternoon += 1;
      else if (k === 'evening') evening += 1;
    }
    return { morning, afternoon, evening };
  }, [rows]);

  const rowsForList = useMemo(() => {
    if (sidebarScheduleShiftFilter === 'all') return rows;
    return rows.filter((r) => normalizeScheduleShiftKey(r.shift) === sidebarScheduleShiftFilter);
  }, [rows, sidebarScheduleShiftFilter]);

  const grouped = useMemo(
    () => groupTodayScheduleRowsByShiftThenZone(rowsForList),
    [rowsForList],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div
        style={{
          padding: '0 0 10px',
          marginBottom: 8,
          borderBottom: '1px solid #EEF2F7',
          fontSize: 12,
          color: '#64748b',
        }}
      >
        <span style={{ fontWeight: 600, color: '#0f172a' }}>{rows.length} 人</span>
        <span style={{ marginLeft: 8 }}>{headerDateLabel}</span>
      </div>
      <div
        role="tablist"
        aria-label="按班次筛选今日上机名单"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 12,
          paddingLeft: 0,
        }}
      >
        {(
          [
            { filterKey: 'all' as const, label: '全部' },
            { filterKey: 'morning' as const, label: '上午' },
            { filterKey: 'afternoon' as const, label: '下午' },
            { filterKey: 'evening' as const, label: '晚上' },
          ] as const
        ).map(({ filterKey, label }) => {
          const count = filterKey === 'all' ? rows.length : sidebarShiftTabCounts[filterKey];
          const selected = sidebarScheduleShiftFilter === filterKey;
          return (
            <button
              key={filterKey}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSidebarScheduleShiftFilter(filterKey)}
              style={{
                border: `1px solid ${selected ? '#2563eb' : '#e2e8f0'}`,
                background: selected ? '#eff6ff' : '#fff',
                borderRadius: 8,
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: selected ? 700 : 600,
                color: selected ? '#1d4ed8' : '#475569',
                cursor: 'pointer',
                lineHeight: 1.3,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{label}</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: selected ? '#1d4ed8' : '#64748b',
                  background: selected ? '#dbeafe' : '#f1f5f9',
                  borderRadius: 6,
                  padding: '0 5px',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      {grouped.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: '#94a3b8',
            padding: '12px 4px',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {sidebarScheduleShiftFilter === 'all' ? '暂无患者数据' : '该时段暂无患者'}
        </div>
      ) : (
        grouped.map((shiftBlock, shiftIdx) => {
          const showShiftSectionTitle =
            sidebarScheduleShiftFilter === 'all' || grouped.length > 1;
          return (
        <section
          key={shiftBlock.shiftKey}
          style={{
            marginTop: shiftIdx > 0 ? 12 : 0,
            paddingTop: shiftIdx > 0 ? 10 : 0,
            borderTop: shiftIdx > 0 ? '1px solid #EEF2F7' : 'none',
          }}
        >
          {showShiftSectionTitle ? (
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#334155',
              marginBottom: 8,
              letterSpacing: '0.02em',
            }}
          >
            {shiftBlock.shiftLabel}
            <Tag color="blue" style={{ marginLeft: 6, fontSize: 11 }}>
              {shiftBlock.zones.reduce((n, z) => n + z.rows.length, 0)} 人
            </Tag>
          </div>
          ) : null}
          {shiftBlock.zones.map((zoneBlock) => (
            <div key={`${shiftBlock.shiftKey}-${zoneBlock.zoneKey}`} style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    width: 3,
                    height: 12,
                    borderRadius: 2,
                    flexShrink: 0,
                    background:
                      zoneBlock.zoneColor === 'orange'
                        ? '#ea580c'
                        : zoneBlock.zoneColor === 'magenta'
                          ? '#c026d3'
                          : '#2563eb',
                  }}
                  aria-hidden
                />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
                  {zoneBlock.zoneLabel}
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{zoneBlock.rows.length} 人</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {zoneBlock.rows.map((row) => (
                  <SidebarPatientRow
                    key={row.id}
                    row={row}
                    isSelected={
                      Boolean(selectedPatientId && selectedScheduleDate) &&
                      row.patient_id === selectedPatientId &&
                      String(row.scheduled_date ?? '').slice(0, 10) === selectedScheduleDate
                    }
                    onSelect={() => onSelectPatient(row)}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
          );
        })
      )}
    </div>
  );
}

type SidebarPatientRowProps = {
  row: TodaySchedulePatientRow;
  isSelected: boolean;
  onSelect: () => void;
};

function SidebarPatientRow({ row, isSelected, onSelect }: SidebarPatientRowProps) {
  const zone = isolationTagProps(row.isolation_zone);
  const hasRecord = Boolean(row.dialysis_record_id);
  const remark = row.schedule_remark?.trim();
  const age = ageFromDob(row.dob);
  const gender = row.gender?.trim();
  const meta = [gender, age].filter(Boolean).join(' · ');
  const tagCompact = {
    margin: 0,
    fontSize: 10,
    lineHeight: '15px' as const,
    padding: '0 3px',
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`hd-schedule-patient-card${isSelected ? ' hd-schedule-patient-card--active' : ''}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#0f172a',
          marginBottom: 5,
          lineHeight: 1.3,
          letterSpacing: '0.01em',
        }}
      >
        {row.patient_name || '患者'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 3 }}>
        <Tag color={zone.color} style={tagCompact}>
          {zone.label}
        </Tag>
        <Tag style={tagCompact}>{scheduleShiftLabel(row.shift)}</Tag>
        {typeof row.machine_station === 'string' && row.machine_station.trim() ? (
          <Tag color="geekblue" style={tagCompact} title="档案约定机位">
            机位 {row.machine_station.trim()}
          </Tag>
        ) : (
          <Tag style={tagCompact}>机位未填写</Tag>
        )}
        <Tag color="cyan" style={tagCompact}>
          {sessionDialysisModeShort(row.session_dialysis_mode)}
        </Tag>
        <Tag style={tagCompact}>{accessTypeCn(row.access_type)}</Tag>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
        {hasRecord ? (
          <Tag color="success" icon={<CheckCircleFilled />} style={{ margin: 0, fontSize: 10 }}>
            已有记录
          </Tag>
        ) : (
          <span style={{ color: '#ca8a04' }}>待录入</span>
        )}
        {meta ? <span style={{ marginLeft: 6 }}>{meta}</span> : null}
      </div>
      {remark ? (
        <Tooltip title={remark}>
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: '#0369a1',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <InfoCircleFilled style={{ marginRight: 4 }} />
            {remark}
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
}
