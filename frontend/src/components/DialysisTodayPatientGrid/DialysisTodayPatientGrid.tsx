/**
 * 今日上机患者卡片网格（录入透析页 / 今日上机名单页共用）
 */
import { Tag, Tooltip } from 'antd';
import {
  TeamOutlined,
  ClockCircleOutlined,
  CheckCircleFilled,
  InfoCircleFilled,
} from '@ant-design/icons';
import type { TodaySchedulePatientRow } from '../../api/schedule';
import {
  scheduleShiftLabel,
  sessionDialysisModeShort,
  accessTypeCn,
  isolationTagProps,
  ageFromDob,
  groupTodayScheduleRowsByShiftThenZone,
} from '../../utils/dialysisTodayScheduleDisplay';

export type DialysisTodayPatientGridProps = {
  rows: TodaySchedulePatientRow[];
  /** 顶栏「时钟」旁展示的日期 */
  headerDateLabel: string;
  onSelectPatient: (row: TodaySchedulePatientRow) => void;
  /** 录入页：当前已选患者 + 日期时高亮对应卡片 */
  selectedPatientId?: string;
  selectedScheduleDate?: string;
};

export default function DialysisTodayPatientGrid({
  rows,
  headerDateLabel,
  onSelectPatient,
  selectedPatientId,
  selectedScheduleDate,
}: DialysisTodayPatientGridProps) {
  const grouped = groupTodayScheduleRowsByShiftThenZone(rows);

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '16px 18px 18px',
        background: 'linear-gradient(145deg, #f8fafc 0%, #eff6ff 42%, #f0fdf4 100%)',
        borderRadius: 12,
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TeamOutlined style={{ fontSize: 20, color: '#2563eb' }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>今日上机名单</span>
          <Tag color="processing">{rows.length} 人</Tag>
          <Tag icon={<ClockCircleOutlined />} color="default">
            {headerDateLabel}
          </Tag>
        </div>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          与排班管理同步 · 点击卡片进入该患者录入
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {grouped.map((shiftBlock, shiftIdx) => (
          <section
            key={shiftBlock.shiftKey}
            style={{
              marginTop: shiftIdx > 0 ? 18 : 0,
              paddingTop: shiftIdx > 0 ? 16 : 0,
              borderTop: shiftIdx > 0 ? '1px solid #e2e8f0' : 'none',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#0f172a',
                  letterSpacing: '0.02em',
                }}
              >
                {shiftBlock.shiftLabel}
              </span>
              <Tag color="blue">
                {shiftBlock.zones.reduce((n, z) => n + z.rows.length, 0)} 人
              </Tag>
            </div>
            {shiftBlock.zones.map((zoneBlock) => (
              <div key={`${shiftBlock.shiftKey}-${zoneBlock.zoneKey}`} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      width: 3,
                      height: 14,
                      borderRadius: 2,
                      background:
                        zoneBlock.zoneColor === 'orange'
                          ? '#ea580c'
                          : zoneBlock.zoneColor === 'magenta'
                            ? '#c026d3'
                            : '#2563eb',
                    }}
                    aria-hidden
                  />
                  <Tag color={zoneBlock.zoneColor}>{zoneBlock.zoneLabel}</Tag>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>
                    {zoneBlock.rows.length} 人
                  </span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                    gap: 12,
                  }}
                >
                  {zoneBlock.rows.map((row) => (
                    <PatientTodayCard
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
        ))}
      </div>
    </div>
  );
}

type PatientTodayCardProps = {
  row: TodaySchedulePatientRow;
  isSelected: boolean;
  onSelect: () => void;
};

function PatientTodayCard({ row, isSelected, onSelect }: PatientTodayCardProps) {
  const zone = isolationTagProps(row.isolation_zone);
  const dryW = row.prescription_dry_weight;
  const dryText =
    dryW != null && dryW !== ''
      ? `${typeof dryW === 'number' ? dryW : String(dryW)} kg`
      : null;
  const diag = row.primary_diagnosis?.trim();
  const age = ageFromDob(row.dob);
  const gender = row.gender?.trim();
  const metaParts = [gender, age].filter(Boolean).join(' · ');
  const hasRecord = Boolean(row.dialysis_record_id);
  const remark = row.schedule_remark?.trim();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        cursor: 'pointer',
        textAlign: 'left',
        padding: '12px 14px',
        borderRadius: 10,
        border: `1.5px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
        background: isSelected
          ? 'linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)'
          : '#ffffff',
        boxShadow: isSelected
          ? '0 2px 10px rgba(37, 99, 235, 0.14)'
          : '0 1px 2px rgba(15, 23, 42, 0.05)',
        outline: 'none',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: '#0f172a',
              marginBottom: 6,
              letterSpacing: '0.02em',
            }}
          >
            {row.patient_name || '患者'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <Tag color={zone.color}>{zone.label}</Tag>
            <Tag>{scheduleShiftLabel(row.shift)}</Tag>
            {typeof row.machine_station === 'string' && row.machine_station.trim() ? (
              <Tag color="geekblue" title="档案约定机位">
                机位 {row.machine_station.trim()}
              </Tag>
            ) : (
              <Tag>机位未填写</Tag>
            )}
            <Tag color="cyan">{sessionDialysisModeShort(row.session_dialysis_mode)}</Tag>
            <Tag>{accessTypeCn(row.access_type)}</Tag>
            {dryText ? <Tag color="green">干体重 {dryText}</Tag> : null}
            {hasRecord ? (
              <Tag color="success" icon={<CheckCircleFilled />}>
                已有记录
              </Tag>
            ) : (
              <Tag>待录入</Tag>
            )}
          </div>
          {(metaParts || diag) ? (
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              {metaParts ? <span>{metaParts}</span> : null}
              {metaParts && diag ? <span> · </span> : null}
              {diag ? (
                <span
                  title={diag}
                  style={{
                    display: 'inline-block',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    verticalAlign: 'bottom',
                  }}
                >
                  {diag}
                </span>
              ) : null}
            </div>
          ) : null}
          {remark ? (
            <Tooltip title={remark}>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
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
      </div>
    </div>
  );
}
