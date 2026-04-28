/**
 * 患者详情与档案维护页（多 Tab）
 * 主要作用：集中展示患者基本信息、通路、处方、化验等，并支持部分字段编辑。
 * 主要功能：路由参数 id 拉取详情；Tabs 组织子模块；打印与返回列表。
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Card, Tabs, Button, Table, Tag, Space, message, Modal, Form, Input, Select, DatePicker, InputNumber, Checkbox, Switch, Popconfirm } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ANTICOAGULANT_OPTIONS,
  formatProfileAnticoagulantSummary,
  mapDbAnticoagulantToForm,
  mapFormAnticoagulantToDb,
} from '../../constants/prescriptionAnticoagulant';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  formatLocalDateKey,
  parseApiDateOnlyForPicker,
  parseApiDateOnlyNullable,
} from '../../utils/medicalDate';
import PageShell from '../../components/PageShell/PageShell';
import IsolationZoneTag from '../../components/IsolationZoneTag/IsolationZoneTag';
import { PageLoading, PageErrorResult } from '../../components/PageStates/PageStates';
import { patientsApi, type PatientDetailRecord } from '../../api/patients';
import { usersApi, type NursingStaffRow } from '../../api/users';
import { infectionApi, type InfectionScreeningLatestRow } from '../../api/infection';
import labsApi, { LAB_TYPE_LABELS, type LabResult } from '../../api/labs';
import { dialysisApi, type DialysisRecordDetail, type DialysisRecordListRow } from '../../api/dialysis';
import vascularApi, { ACCESS_TYPE_LABELS, type AccessType } from '../../api/vascular';

/** 将列表/详情中的通路类型字符串规范为 API 使用的 AccessType（小写） */
function toAccessTypeKey(raw: string): AccessType | null {
  const k = raw.trim().toLowerCase();
  if (k === 'avf' || k === 'avg' || k === 'ncc' || k === 'tcc') return k;
  return null;
}
import { useAuthStore } from '../../stores/authStore';
import AnomalyAnalysisModal from '../../components/AnomalyAnalysisModal/AnomalyAnalysisModal';
import PatientConsentDialysisImage from '../../components/PatientConsentDialysisImage/PatientConsentDialysisImage';
import ConsentDialysisImageUpload from '../../components/ConsentDialysisImageUpload/ConsentDialysisImageUpload';
import { DIALYSIS_SCHEDULE_OPTIONS, getDialysisScheduleLabel } from '../../constants/dialysisSchedule';
import type { AnomalyType } from '../../utils/anomalyAnalysis';

function consentStoredImageCount(patient: PatientDetailRecord | null | undefined): number {
  const paths = patient?.consent_dialysis_image_paths;
  return Array.isArray(paths) ? paths.length : 0;
}

function formatGender(g: string | null | undefined): string {
  if (g === 'F') return '女';
  if (g === 'M') return '男';
  return '待补全';
}

function formatFamilyContact(fc: unknown): string {
  if (!fc || typeof fc !== 'object') return '—';
  const o = fc as { name?: string; phone?: string };
  const parts = [o.name, o.phone].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function buildPresentIllness(p: PatientDetailRecord): string {
  if (p.present_illness?.trim()) return p.present_illness.trim();
  const dx = p.primary_diagnosis || '—';
  const stage = p.ckd_stage ? `CKD ${p.ckd_stage} 期` : '';
  const comorb = p.comorbidities?.filter(Boolean).length
    ? `合并症包括：${p.comorbidities.join('、')}。`
    : '';
  const startKey = formatLocalDateKey(p.dialysis_start_date);
  return `患者诊断「${dx}」${stage ? `，${stage}` : ''}。自 ${startKey || '—'} 起在本科行维持性血液透析。${comorb}`;
}

function buildPastHistory(p: PatientDetailRecord): string {
  if (p.past_history?.trim()) return p.past_history.trim();
  const comorb = p.comorbidities?.filter(Boolean).join('、');
  return comorb
    ? `既往长期合并症与伴发疾病：${comorb}。`
    : '患者档案中暂无结构化既往史条目，可在患者档案中维护合并症等信息。';
}

function infectionItemLabel(screenType: string): string {
  const map: Record<string, string> = {
    hbsag: 'HBsAg',
    hbvdna: 'HBV-DNA',
    hcvab: '抗-HCV',
    hcvrna: 'HCV-RNA',
    hiv: '抗-HIV',
    syphilis_tppa: '梅毒（TPPA）',
    syphilis_rpr: '梅毒（RPR）',
    chest_xray: '胸部X线',
  };
  return map[screenType] || screenType;
}

function formatInfectionResult(code: string): string {
  const m: Record<string, string> = {
    positive: '阳性',
    negative: '阴性',
    normal: '正常',
    abnormal: '异常',
  };
  return m[code] || code;
}

function formatShift(shift: string): string {
  const m: Record<string, string> = {
    morning: '上午班',
    afternoon: '下午班',
    evening: '晚班',
  };
  return m[shift] || shift;
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildRecentChangeLines(
  labs: LabResult[],
  dialysis: DialysisRecordListRow[],
): { date: string; text: string }[] {
  const lines: { date: string; text: string }[] = [];
  const seen = new Set<string>();
  const push = (date: string, text: string) => {
    const k = `${date}|${text}`;
    if (seen.has(k)) return;
    seen.add(k);
    lines.push({ date, text });
  };

  const labSorted = [...labs]
    .filter(l => l.is_abnormal || l.is_critical)
    .sort((a, b) => b.test_date.localeCompare(a.test_date))
    .slice(0, 8);

  for (const l of labSorted) {
    const name = LAB_TYPE_LABELS[l.test_type] || l.test_type;
    const flag = l.is_critical ? '危急值' : '异常';
    push(l.test_date, `检验：${name} ${l.value} ${l.unit}（${flag}）`);
  }

  const dialSorted = [...dialysis].sort((a, b) => b.session_date.localeCompare(a.session_date)).slice(0, 8);
  for (const d of dialSorted) {
    if (d.ktv != null && Number(d.ktv) < 1.2) {
      push(d.session_date, `透析：Kt/V ${d.ktv}（未达 1.2），${formatShift(d.shift)}`);
    }
    if (d.is_circuit_clotted) {
      push(d.session_date, `透析：体外循环完全凝血（停机更换管路），${formatShift(d.shift)}`);
    }
    if (d.is_membrane_ruptured) {
      push(d.session_date, `透析：透析器破膜 / 漏血，${formatShift(d.shift)}`);
    }
    if (d.coagulation_grade != null && d.coagulation_grade >= 2) {
      push(d.session_date, `透析：体外循环凝血分级 ${d.coagulation_grade} 级，${formatShift(d.shift)}`);
    }
  }

  return lines.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
}

// ── 标签页内容 ──────────────────────────────────────────────
type TabBasicProps = {
  patient: PatientDetailRecord;
  infectionRows: InfectionScreeningLatestRow[];
  recentLines: { date: string; text: string }[];
};

type EditFormValues = {
  patient_identifier?: string;
  status?: 'active' | 'suspended' | 'hospitalized' | 'transferred' | 'transplanted' | 'deceased';
  name: string;
  gender?: 'M' | 'F';
  dob?: Dayjs | null;
  dialysis_start_date?: Dayjs | null;
  primary_diagnosis?: string;
  present_illness?: string;
  past_history?: string;
  ckd_stage?: number | null;
  comorbidities?: string[];
  profile_anticoagulant?: string;
  profile_heparin_first?: number | null;
  profile_heparin_maintain?: number | null;
  profile_dry_weight?: number | null;
  profile_dry_weight_date?: Dayjs | null;
  profile_dry_weight_reason?: string;
  id_card?: string;
  phone?: string;
  family_contact_name?: string;
  family_contact_phone?: string;
  address?: string;
  consent_dialysis?: boolean;
  consent_dialysis_date?: Dayjs | null;
  consent_cvc?: boolean;
  consent_cvc_date?: Dayjs | null;
  current_access_type?: 'none' | 'AVF' | 'AVG' | 'TCC' | 'NCC';
  dialysis_schedule_code?: string;
  dialysis_schedule_notes?: string;
  dialysis_schedule_anchor_date?: Dayjs | null;
  dialysis_schedule_adjust?: boolean;
  /** 约定机位（可选），保存后同步至排班表 */
  machine_station?: string;
  responsible_nurse_id?: string;
};

type PatientVascularAccessBrief = {
  id?: string;
  access_type?: string | null;
  is_active?: boolean;
};

function getCurrentAccessRecord(patient: PatientDetailRecord): PatientVascularAccessBrief | null {
  const list = patient.vascular_accesses ?? [];
  const fromList = list.find(v => v?.is_active) ?? list[0];
  if (fromList) return fromList;
  if (patient.access_type) {
    return { access_type: patient.access_type };
  }
  return null;
}

function getCurrentAccessType(patient: PatientDetailRecord): 'AVF' | 'AVG' | 'TCC' | 'NCC' | 'none' {
  const current = getCurrentAccessRecord(patient);
  const raw = (current?.access_type || '').toString().trim().toUpperCase();
  if (raw === 'AVF' || raw === 'AVG' || raw === 'TCC' || raw === 'NCC') return raw;
  return 'none';
}

function formatDryWeightDisplay(p: PatientDetailRecord): string {
  const dw =
    p.profile_dry_weight != null
      ? Number(p.profile_dry_weight)
      : p.dry_weight != null
        ? Number(p.dry_weight)
        : null;
  const dwd = p.profile_dry_weight_date ?? p.dry_weight_date;
  const dwr = (p.profile_dry_weight_reason ?? p.dry_weight_reason)?.trim();
  if (dw == null || !Number.isFinite(dw)) return '—';
  const bits = [`${dw} kg`];
  if (dwd) bits.push(`评估日 ${formatLocalDateKey(dwd)}`);
  if (dwr) bits.push(`原因：${dwr}`);
  return bits.join(' · ');
}

function TabBasic({ patient, infectionRows, recentLines }: TabBasicProps) {
  const navigate = useNavigate();
  const ac = formatProfileAnticoagulantSummary(patient);
  const dobStr = patient.dob ? formatLocalDateKey(patient.dob) || '—' : '—';
  const currentAccess = getCurrentAccessRecord(patient);
  const rawAccessType =
    (currentAccess?.access_type || patient.access_type || '').toString();
  const accessKey = toAccessTypeKey(rawAccessType);
  const accessLabelBase = accessKey ? ACCESS_TYPE_LABELS[accessKey] : null;
  const accessLocation =
    (currentAccess as PatientVascularAccessBrief & { location?: string })?.location ||
    patient.access_location ||
    '';
  const accessDisplay = accessLabelBase
    ? accessLocation
      ? `${accessLabelBase} · ${accessLocation}`
      : accessLabelBase
    : '—';
  const rows = [
    ['姓名', patient.name],
    ['性别 / 年龄', `${formatGender(patient.gender)} / ${patient.age ?? '—'}岁（${dobStr}）`],
    ['身份证号', patient.id_card || '—'],
    ['主要诊断', patient.primary_diagnosis || '待补全'],
    ['CKD 分期', patient.ckd_stage ? `${patient.ckd_stage} 期` : '—'],
    ['合并症', patient.comorbidities?.length ? patient.comorbidities.join('、') : '—'],
    ['约定机位', patient.machine_station?.trim() || '—'],
    ['干体重', formatDryWeightDisplay(patient)],
    ['联系电话', patient.phone || '—'],
    ['家属联系人', formatFamilyContact(patient.family_contact)],
    ['家庭住址', patient.address?.trim() || '—'],
    [
      '抗凝方式及剂量',
      (
        <span>
          <span>
            {ac.scheme} · 首剂 {ac.firstDose} · 追加 {ac.maintainDose}
          </span>
          <Button
            type="link"
            size="small"
            style={{ paddingLeft: 8 }}
            onClick={() => navigate(`/prescription?patient_id=${encodeURIComponent(patient.id)}`)}
          >
            透析处方管理
          </Button>
          <span style={{ fontSize: 12, color: '#94A3B8', marginLeft: 6 }}>
            （档案默认；处方页可临时改药，保存档案将再次同步抗凝项）
          </span>
        </span>
      ),
    ],
    [
      '透析时间',
      (
        <span>
          {getDialysisScheduleLabel(patient.dialysis_schedule_code)}
          {patient.dialysis_schedule_code === 'qod' && patient.dialysis_schedule_anchor_date ? (
            <>
              <br />
              <span style={{ fontSize: 12, color: '#64748B' }}>
                隔日锚点：{formatLocalDateKey(patient.dialysis_schedule_anchor_date)}
              </span>
            </>
          ) : null}
          {patient.dialysis_schedule_notes?.trim() ? (
            <>
              <br />
              <span style={{ fontSize: 12, color: '#64748B' }}>{patient.dialysis_schedule_notes}</span>
            </>
          ) : null}
        </span>
      ),
    ],
    ['血管通路', accessDisplay],
    [
      '透析开始日期',
      `${formatLocalDateKey(patient.dialysis_start_date) || '—'}（透析龄 ${patient.dialysis_age ?? '—'}）`,
    ],
    ['责任护士', patient.responsible_nurse_name?.trim() || '—'],
  ] as const;

  const infectionTable = infectionRows.map((r, i) => {
    const next =
      (r.next_due_date ? formatLocalDateKey(r.next_due_date) : '') ||
      (r.screen_date
        ? dayjs(formatLocalDateKey(r.screen_date)).add(6, 'month').format('YYYY-MM-DD')
        : '—');
    const neg = r.result === 'negative' || r.result === 'normal';
    return {
      key: String(i),
      item: infectionItemLabel(r.screen_type),
      resultText: formatInfectionResult(r.result),
      neg,
      date: formatLocalDateKey(r.screen_date) || r.screen_date,
      next,
    };
  });

  return (
    <div className="grid-2" style={{ gap: 20 }}>
      <Card title="👤 基本信息" size="small" style={{ border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF' } }}>
        <table style={{ width: '100%', fontSize: 13.5, borderCollapse: 'collapse' }}>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td style={{ color: '#7B92BC', padding: '7px 0', width: 120, verticalAlign: 'top' }}>{label}</td>
              <td style={{ fontWeight: label === '姓名' ? 600 : 400, color: '#0D1B3E' }}>{value}</td>
            </tr>
          ))}
        </table>
      </Card>

      <Card title="🦠 传染病筛查" size="small" style={{ border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF' } }}>
        <Table
          dataSource={infectionTable}
          size="small"
          pagination={false}
          locale={{ emptyText: '暂无传染病筛查记录，请在「传染病管理」中录入。' }}
          columns={[
            { title: '项目', dataIndex: 'item' },
            {
              title: '结果',
              render: (_, r) => (
                <span style={{
                  background: r.neg ? '#ECFDF5' : '#FFF1F2',
                  color: r.neg ? '#059669' : '#BE123C',
                  padding: '2px 8px', borderRadius: 20, fontSize: 11.5,
                }}>{r.resultText}</span>
              ),
            },
            { title: '检测日期', dataIndex: 'date', render: v => <span className="num text-sm">{v}</span> },
            {
              title: '下次复查',
              dataIndex: 'next',
              render: v => <span className="num text-sm" style={{ color: '#D97706' }}>{v}</span>,
            },
          ]}
        />
      </Card>

      <Card title="📝 简要病史" size="small" style={{ border: '1px solid #DBEAFE', gridColumn: 'span 2' }}
        styles={{ header: { background: '#FAFCFF' } }}>
        <div className="grid-3" style={{ gap: 24, fontSize: 13.5 }}>
          <div>
            <div style={{ fontWeight: 600, color: '#7B92BC', marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>现病史</div>
            <p style={{ color: '#0D1B3E', lineHeight: 1.8, margin: 0 }}>{buildPresentIllness(patient)}</p>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: '#7B92BC', marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>既往史</div>
            <p style={{ color: '#0D1B3E', lineHeight: 1.8, margin: 0 }}>{buildPastHistory(patient)}</p>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: '#7B92BC', marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>近期病情变化</div>
            {recentLines.length === 0 ? (
              <p style={{ color: '#7B92BC', lineHeight: 1.8, margin: 0 }}>近期无异常检验或未达标的透析摘要；数据来自检验结果与透析记录。</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentLines.map(line => (
                  <div
                    key={`${line.date}-${line.text}`}
                    style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: 10, lineHeight: 1.8 }}
                  >
                    <span style={{ color: '#D97706', fontWeight: 600 }} className="num">{line.date}</span>
                    <span style={{ color: '#0D1B3E' }}> {line.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

type TabDialysisHistoryProps = {
  rows: DialysisRecordListRow[];
  patientId: string;
};

function TabDialysisHistory({ rows, patientId }: TabDialysisHistoryProps) {
  const navigate = useNavigate();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRecord, setDetailRecord] = useState<DialysisRecordDetail | null>(null);

  const openDetail = useCallback(async (recordId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailRecord(null);
    try {
      const res = await dialysisApi.detail(recordId);
      if (res.data.code !== 200 || !res.data.data) {
        message.error(res.data.message || '透析记录详情加载失败');
        return;
      }
      setDetailRecord(res.data.data);
    } catch {
      message.error('透析记录详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const sortedRows = [...rows].sort((a, b) => b.session_date.localeCompare(a.session_date));
  const tableRows = sortedRows.map(r => {
    const complications: string[] = [];
    if (r.is_circuit_clotted) complications.push('完全凝血');
    if (r.is_membrane_ruptured) complications.push('漏血');
    if (r.coagulation_grade != null && r.coagulation_grade >= 2) {
      complications.push(`凝血${r.coagulation_grade}级`);
    }
    return {
      ...r,
      complicationsText: complications.length > 0 ? complications.join('、') : '无',
      durationHours: r.actual_duration != null ? (r.actual_duration / 60).toFixed(1) : '—',
    };
  });

  return (
    <Card
      title="📖 透析历史记录"
      size="small"
      style={{ border: '1px solid #DBEAFE' }}
      styles={{ header: { background: '#FAFCFF' } }}
    >
      <Table
        rowKey="id"
        dataSource={tableRows}
        size="small"
        pagination={{ pageSize: 10, showTotal: total => `共 ${total} 条` }}
        locale={{ emptyText: '暂无透析历史记录。' }}
        columns={[
          { title: '透析日期', dataIndex: 'session_date' },
          { title: '班次', dataIndex: 'shift', render: v => <Tag color="orange" style={{ fontSize: 11 }}>{formatShift(v)}</Tag> },
          { title: '上机体重', dataIndex: 'pre_weight', render: v => <span className="num">{v ?? '—'}{v != null ? ' kg' : ''}</span> },
          { title: '下机体重', dataIndex: 'post_weight', render: v => <span className="num">{v ?? '—'}{v != null ? ' kg' : ''}</span> },
          { title: '超滤量', dataIndex: 'uf_volume', render: v => <span className="num">{v ?? '—'}{v != null ? ' mL' : ''}</span> },
          { title: '实际时长', dataIndex: 'durationHours', render: v => <span className="num">{v} {v !== '—' ? 'h' : ''}</span> },
          {
            title: 'Kt/V',
            dataIndex: 'ktv',
            render: v => (
              <span className={`num ${v != null && v < 1.2 ? 'lab-critical' : 'lab-normal'}`}>
                {v ?? '—'}
              </span>
            ),
          },
          {
            title: 'URR',
            dataIndex: 'urr',
            render: v => <span className="num">{v != null ? `${v}%` : '—'}</span>,
          },
          { title: '并发症摘要', dataIndex: 'complicationsText' },
          {
            title: '操作',
            key: 'actions',
            width: 170,
            render: (_value, record) => (
              <Space size={6}>
                <Button type="link" size="small" onClick={() => void openDetail(record.id)}>
                  查看详情
                </Button>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    const dateParam =
                      formatLocalDateKey(record.session_date)
                      || String(record.session_date || '').slice(0, 10)
                      || dayjs().format('YYYY-MM-DD');
                    navigate(
                      `/dialysis/entry?patient_id=${encodeURIComponent(patientId)}&date=${encodeURIComponent(dateParam)}&record_id=${encodeURIComponent(record.id)}`,
                    );
                  }}
                >
                  打开记录单
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="透析记录详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={760}
      >
        {detailLoading ? (
          <div style={{ color: '#64748B' }}>加载中…</div>
        ) : detailRecord ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div className="grid-3" style={{ gap: 12 }}>
              <div>日期：<b>{detailRecord.session_date}</b></div>
              <div>班次：<b>{formatShift(detailRecord.shift)}</b></div>
              <div>护士：<b>{detailRecord.nurse_name || '—'}</b></div>
              <div>机器：<b>{detailRecord.machine_no || '—'}</b></div>
              <div>透前体重：<b>{detailRecord.pre_weight ?? '—'}{detailRecord.pre_weight != null ? ' kg' : ''}</b></div>
              <div>透后体重：<b>{detailRecord.post_weight ?? '—'}{detailRecord.post_weight != null ? ' kg' : ''}</b></div>
              <div>超滤量：<b>{detailRecord.uf_volume ?? '—'}{detailRecord.uf_volume != null ? ' mL' : ''}</b></div>
              <div>实际时长：<b>{detailRecord.actual_duration != null ? `${(detailRecord.actual_duration / 60).toFixed(1)} h` : '—'}</b></div>
              <div>Kt/V：<b>{detailRecord.ktv ?? '—'}</b></div>
            </div>
            <div style={{ color: '#1F2937' }}>
              生命体征 {detailRecord.vital_signs?.length || 0} 条；并发症 {detailRecord.complications?.length || 0} 条；医嘱执行 {detailRecord.order_executions?.length || 0} 条
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>备注</div>
              <div style={{ whiteSpace: 'pre-wrap', color: '#374151' }}>{detailRecord.notes || '—'}</div>
            </div>
          </Space>
        ) : (
          <div style={{ color: '#64748B' }}>暂无详情数据</div>
        )}
      </Modal>
    </Card>
  );
}

type TabCareCoordinationProps = {
  patient: PatientDetailRecord;
  dialysisRows: DialysisRecordListRow[];
  infectionRows: InfectionScreeningLatestRow[];
  labRows: LabResult[];
  onNavigate: (path: string) => void;
  onOpenEditPatient: () => void;
};

function TabCareCoordination({
  patient,
  dialysisRows,
  infectionRows,
  labRows,
  onNavigate,
  onOpenEditPatient,
}: TabCareCoordinationProps) {
  const canAnomaly = useAuthStore((s) => s.hasRole(['admin', 'doctor', 'head_nurse']));
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [anomalyCtx, setAnomalyCtx] = useState<{
    anomalyType: AnomalyType;
    contextId?: string;
  } | null>(null);

  const openAnomaly = useCallback(
    (ctx: { anomalyType: AnomalyType; contextId?: string }) => {
      setAnomalyCtx(ctx);
      setAnomalyOpen(true);
    },
    [],
  );

  const INFECTION_WARNING_DAYS = 175;
  const INFECTION_OVERDUE_DAYS = 185;
  const alertLevelPriority: Record<'high' | 'medium' | 'info', number> = {
    high: 0,
    medium: 1,
    info: 2,
  };
  const alertLevelStyle: Record<'high' | 'medium' | 'info', { label: string; color: string; bg: string; border: string }> = {
    high: { label: '高优先', color: '#BE123C', bg: '#FFF1F2', border: '#FECDD3' },
    medium: { label: '中优先', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
    info: { label: '提示', color: '#0369A1', bg: '#F0F9FF', border: '#BAE6FD' },
  };

  const moduleCards = [
    { title: '💉 透析记录录入', route: '/dialysis/entry', desc: '录入本次透析执行、生命体征、并发症与 Kt/V。', action: '去录入' },
    { title: '💊 透析处方管理', route: '/prescription', desc: '维护透析参数、干体重、抗凝方案与处方版本。', action: '去管理' },
    { title: '📋 长期医嘱单', route: '/orders', desc: '开立/停止长期医嘱，供透析当班逐条执行确认。', action: '去管理' },
    { title: '🧪 检验结果管理', route: '/labs', desc: '录入与追踪检验结果、异常值与危急值处理。', action: '去管理' },
    { title: '🫀 血管通路管理', route: '/vascular', desc: '维护通路状态、评估记录、穿刺记录与风险评估。', action: '去管理' },
    { title: '🦠 传染病管理', route: '/infection', desc: '录入筛查、追踪到期、维护隔离分区与分机规则。', action: '去管理' },
  ] as const;

  const latestDialysis = [...dialysisRows].sort((a, b) => b.session_date.localeCompare(a.session_date))[0];
  const abnormalLabCount = labRows.filter(l => l.is_abnormal).length;
  const criticalLabCount = labRows.filter(l => l.is_critical).length;
  const nextInfectionDate = infectionRows
    .map(r => (r.next_due_date ? formatLocalDateKey(r.next_due_date) : ''))
    .filter((v): v is string => Boolean(v))
    .sort()[0];
  const currentAccessType = getCurrentAccessType(patient);
  const isCatheterAccess = currentAccessType === 'TCC' || currentAccessType === 'NCC';
  const catheterLabel = currentAccessType === 'TCC' ? '长期导管（TCC）' : '临时导管（NCC）';
  const unSignedConsents = [
    !patient.consent_dialysis ? '透析知情同意书' : null,
    isCatheterAccess && !patient.consent_cvc ? `${catheterLabel}置管同意书` : null,
  ].filter((v): v is string => Boolean(v));

  type CareReminderItem = {
    key: string;
    level: 'high' | 'medium' | 'info';
    title: string;
    desc: string;
    actionLabel: string;
    actionPath: string;
    analyze?: { anomalyType: AnomalyType; contextId?: string };
  };

  const infectionAlerts: CareReminderItem[] = infectionRows
    .filter(r => Boolean(r.screen_date))
    .flatMap((r, idx): CareReminderItem[] => {
      const daysSince = dayjs().diff(dayjs(formatLocalDateKey(r.screen_date)), 'day');
      if (daysSince >= INFECTION_OVERDUE_DAYS) {
        return [{
          key: `infection-overdue-${idx}`,
          level: 'high',
          title: `${infectionItemLabel(r.screen_type)} 复查已超期`,
          desc: `距离上次检测 ${daysSince} 天（阈值 ${INFECTION_OVERDUE_DAYS} 天），建议立即复查。`,
          actionLabel: '去传染病管理',
          actionPath: `/infection?patient_id=${encodeURIComponent(patient.id)}`,
          analyze: { anomalyType: 'infection_overdue' as const, contextId: r.id },
        }];
      }
      if (daysSince >= INFECTION_WARNING_DAYS) {
        return [{
          key: `infection-warning-${idx}`,
          level: 'medium',
          title: `${infectionItemLabel(r.screen_type)} 即将到期`,
          desc: `距离上次检测 ${daysSince} 天（预警阈值 ${INFECTION_WARNING_DAYS} 天），请提前安排复查。`,
          actionLabel: '去传染病管理',
          actionPath: `/infection?patient_id=${encodeURIComponent(patient.id)}`,
          analyze: { anomalyType: 'infection_warning' as const, contextId: r.id },
        }];
      }
      return [];
    });

  const firstCriticalLab = labRows.find(l => l.is_critical);
  const firstAbnormalLab = labRows.find(l => l.is_abnormal && !l.is_critical);

  const reminderItems: CareReminderItem[] = [
    ...(criticalLabCount > 0
      ? [{
          key: 'critical-lab',
          level: 'high' as const,
          title: '存在检验危急值',
          desc: `当前批次共 ${criticalLabCount} 项危急值，需立即确认与处置。`,
          actionLabel: '去检验结果管理',
          actionPath: `/labs?patient_id=${encodeURIComponent(patient.id)}`,
          analyze: firstCriticalLab
            ? { anomalyType: 'lab_critical' as const, contextId: firstCriticalLab.id }
            : undefined,
        }]
      : []),
    ...(abnormalLabCount > 0
      ? [{
          key: 'abnormal-lab',
          level: 'medium' as const,
          title: '存在异常检验结果',
          desc: `当前批次共 ${abnormalLabCount} 项异常，请结合透析处方与医嘱评估。`,
          actionLabel: '去检验结果管理',
          actionPath: `/labs?patient_id=${encodeURIComponent(patient.id)}`,
          analyze: firstAbnormalLab
            ? { anomalyType: 'lab_abnormal' as const, contextId: firstAbnormalLab.id }
            : undefined,
        }]
      : []),
    ...(latestDialysis?.ktv != null && Number(latestDialysis.ktv) < 1.2
      ? [{
          key: 'ktv-inadequate',
          level: 'high' as const,
          title: 'Kt/V 未达标',
          desc: `最近一次 Kt/V=${latestDialysis.ktv}（标准 ≥1.2），建议复核处方与实际执行。`,
          actionLabel: '去透析处方管理',
          actionPath: `/prescription?patient_id=${encodeURIComponent(patient.id)}`,
          analyze: { anomalyType: 'ktv_inadequate' as const, contextId: latestDialysis.id },
        }]
      : []),
    ...(latestDialysis?.is_circuit_clotted
      ? [{
          key: 'circuit-clotted',
          level: 'high' as const,
          title: '最近透析出现完全凝血',
          desc: '已记录体外循环完全凝血事件，建议评估抗凝策略与通路状态。',
          actionLabel: '去血管通路管理',
          actionPath: `/vascular?patient_id=${encodeURIComponent(patient.id)}`,
          analyze: { anomalyType: 'coagulation_severe' as const, contextId: latestDialysis.id },
        }]
      : []),
    ...(latestDialysis?.is_membrane_ruptured
      ? [{
          key: 'blood-leak',
          level: 'high' as const,
          title: '最近透析出现漏血事件',
          desc: '存在透析器破膜/漏血记录，建议复盘并加强过程监测。',
          actionLabel: '去透析记录录入',
          actionPath: `/dialysis/entry?patient_id=${encodeURIComponent(patient.id)}`,
          analyze: { anomalyType: 'dialysis_leak' as const, contextId: latestDialysis.id },
        }]
      : []),
    ...(unSignedConsents.length > 0
      ? [{
          key: 'consent-missing',
          level: 'info' as const,
          title: '知情同意书待完善',
          desc: `未登记：${unSignedConsents.join('、')}。`,
          actionLabel: '去编辑患者信息',
          actionPath: `/patients/${encodeURIComponent(patient.id)}`,
        }]
      : []),
    ...infectionAlerts,
  ];

  const prioritizedReminders = [...reminderItems]
    .sort((a, b) => alertLevelPriority[a.level] - alertLevelPriority[b.level])
    .slice(0, 6);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        size="small"
        title="⚠️ 重要提醒与预警"
        style={{ border: '1px solid #DBEAFE' }}
        styles={{ header: { background: '#FAFCFF' } }}
      >
        {prioritizedReminders.length === 0 ? (
          <div style={{ padding: '8px 0', fontSize: 13.5, color: '#059669', lineHeight: 1.8 }}>
            当前无高优先级预警，患者管理状态稳定。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {prioritizedReminders.map(item => {
              const style = alertLevelStyle[item.level];
              return (
                <div
                  key={item.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    border: `1px solid ${style.border}`,
                    background: style.bg,
                    borderRadius: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: style.color, fontWeight: 700 }}>{style.label}</span>
                      <span style={{ fontSize: 14, color: '#0D1B3E', fontWeight: 600 }}>{item.title}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.7 }}>{item.desc}</div>
                  </div>
                  <Space size={8} wrap>
                    {canAnomaly && item.analyze ? (
                      <Button
                        size="small"
                        onClick={() => openAnomaly(item.analyze!)}
                      >
                        分析
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        if (item.key === 'consent-missing') {
                          onOpenEditPatient();
                          return;
                        }
                        onNavigate(item.actionPath);
                      }}
                    >
                      {item.actionLabel}
                    </Button>
                  </Space>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {anomalyCtx ? (
        <AnomalyAnalysisModal
          open={anomalyOpen}
          onClose={() => setAnomalyOpen(false)}
          patientId={patient.id}
          anomalyType={anomalyCtx.anomalyType}
          contextId={anomalyCtx.contextId}
          patientLabel={patient.name}
        />
      ) : null}

      <div className="grid-4" style={{ gap: 12 }}>
        <div className="hd-stat-card teal">
          <div className="hd-stat-label">最近透析</div>
          <div className="hd-stat-value num">{latestDialysis?.session_date ?? '—'}</div>
          <div className="hd-stat-meta">{latestDialysis ? formatShift(latestDialysis.shift) : '暂无记录'}</div>
        </div>
        <div className="hd-stat-card amber">
          <div className="hd-stat-label">异常检验</div>
          <div className="hd-stat-value num">{abnormalLabCount}</div>
          <div className="hd-stat-meta">最近加载批次</div>
        </div>
        <div className="hd-stat-card red">
          <div className="hd-stat-label">危急值</div>
          <div className="hd-stat-value num">{criticalLabCount}</div>
          <div className="hd-stat-meta">需要优先处理</div>
        </div>
        <div className="hd-stat-card blue">
          <div className="hd-stat-label">下次传染病复查</div>
          <div className="hd-stat-value num">{nextInfectionDate ?? '—'}</div>
          <div className="hd-stat-meta">{nextInfectionDate ? '以最新筛查为准' : '暂无计划日期'}</div>
        </div>
      </div>

      <div className="grid-3" style={{ gap: 14 }}>
        {moduleCards.map(card => (
          <Card
            key={card.route}
            size="small"
            style={{ border: '1px solid #DBEAFE' }}
            styles={{ body: { padding: 14 } }}
          >
            <div style={{ fontWeight: 600, color: '#0D1B3E', marginBottom: 8 }}>{card.title}</div>
            <div style={{ fontSize: 12.5, color: '#7B92BC', lineHeight: 1.7, minHeight: 44 }}>
              {card.desc}
            </div>
            <div style={{ marginTop: 10 }}>
              <Button
                type="primary"
                size="small"
                onClick={() => onNavigate(`${card.route}?patient_id=${encodeURIComponent(patient.id)}`)}
              >
                {card.action}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const HEADER_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: '在透', color: '#059669', bg: '#ECFDF5' },
  suspended: { label: '暂停', color: '#D97706', bg: '#FFFBEB' },
  hospitalized: { label: '住院', color: '#0369A1', bg: '#F0F9FF' },
  transferred: { label: '转出', color: '#7B92BC', bg: '#F1F5F9' },
  transplanted: { label: '肾移植', color: '#4338CA', bg: '#EEF2FF' },
  deceased: { label: '死亡', color: '#64748B', bg: '#F8FAFC' },
};

// ── 主组件 ──────────────────────────────────────────────────
export default function PatientDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const hasRole = useAuthStore(s => s.hasRole);
  const [activeTab, setActiveTab] = useState('basic');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [patient, setPatient] = useState<PatientDetailRecord | null>(null);
  const [infectionRows, setInfectionRows] = useState<InfectionScreeningLatestRow[]>([]);
  const [recentLines, setRecentLines] = useState<{ date: string; text: string }[]>([]);
  const [dialysisRows, setDialysisRows] = useState<DialysisRecordListRow[]>([]);
  const [labRows, setLabRows] = useState<LabResult[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [consentDeleteLoading, setConsentDeleteLoading] = useState<number | null>(null);
  const [editConsentFileList, setEditConsentFileList] = useState<UploadFile[]>([]);
  const [nursingStaff, setNursingStaff] = useState<NursingStaffRow[]>([]);
  const [editForm] = Form.useForm<EditFormValues>();
  const watchEditDialysisCode = Form.useWatch('dialysis_schedule_code', editForm);
  const canEditPatient = hasRole(['admin', 'doctor']);
  const canDeletePatient = hasRole(['admin', 'head_nurse']);

  const nurseSelectOptions = useMemo(
    () => nursingStaff.map(n => ({
      value: n.id,
      label: `${n.real_name}（${n.role === 'head_nurse' ? '护士长' : '护士'}）`,
    })),
    [nursingStaff],
  );

  useEffect(() => {
    if (!canEditPatient) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await usersApi.nursingStaff();
        if (cancelled || res.data.code !== 200 || !Array.isArray(res.data.data)) return;
        setNursingStaff(res.data.data);
      } catch {
        /* 下拉失败时仍可保存其他字段 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEditPatient]);

  const loadPatientData = async (patientId: string) => {
    const [pr, ir, lr, dr] = await Promise.all([
      patientsApi.get(patientId),
      infectionApi.getLatestByPatient(patientId),
      labsApi.list(patientId, { page_size: 50 }),
      dialysisApi.list({ patient_id: patientId, page_size: 50 }),
    ]);
    if (pr.data.code !== 200 || !pr.data.data) {
      throw new Error('患者档案加载失败');
    }
    const labList = lr.data.code === 200 && lr.data.data?.list ? lr.data.data.list : [];
    const dialList = dr.data.code === 200 && dr.data.data?.list ? dr.data.data.list : [];
    const infectionList = ir.data.code === 200 && Array.isArray(ir.data.data) ? ir.data.data : [];
    return {
      patient: pr.data.data,
      infectionRows: infectionList,
      labRows: labList,
      dialysisRows: dialList,
      recentLines: buildRecentChangeLines(labList, dialList),
    };
  };

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setLoadError(true);
      return;
    }
    if (!isValidUuid(id)) {
      setLoading(false);
      setLoadError(true);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        if (cancelled) return;
        const data = await loadPatientData(id);
        if (cancelled) return;
        setPatient(data.patient);
        setInfectionRows(data.infectionRows);
        setLabRows(data.labRows);
        setDialysisRows(data.dialysisRows);
        setRecentLines(data.recentLines);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handlePrint = () => { message.info('打印功能开发中'); };

  const handleDeletePatient = async () => {
    if (!id || !patient) return;
    try {
      setDeleteLoading(true);
      const res = await patientsApi.remove(id);
      if (res.data.code !== 200) {
        message.error(res.data.message || '删除失败');
        return;
      }
      message.success(`已删除患者档案：${patient.name}`);
      navigate('/patients');
    } catch (err) {
      // 统一由 axios 响应拦截器提示错误，避免重复弹 toast
      console.error('[PatientDetail] delete patient failed', err);
    } finally {
      setDeleteLoading(false);
    }
  };
  const p = patient;

  const openEditModal = () => {
    if (!p) return;
    editForm.setFieldsValue({
      name: p.name,
      patient_identifier: p.patient_identifier || undefined,
      status: (p.status as EditFormValues['status']) || 'active',
      gender: p.gender || undefined,
      dob: parseApiDateOnlyNullable(p.dob),
      dialysis_start_date: parseApiDateOnlyNullable(p.dialysis_start_date),
      primary_diagnosis: p.primary_diagnosis || undefined,
      present_illness: p.present_illness || undefined,
      past_history: p.past_history || undefined,
      ckd_stage: p.ckd_stage ?? null,
      comorbidities: p.comorbidities || [],
      profile_anticoagulant: mapDbAnticoagulantToForm(p.profile_anticoagulant ?? 'heparin'),
      profile_heparin_first: p.profile_heparin_prime_dose ?? undefined,
      profile_heparin_maintain: p.profile_heparin_maintain != null ? Number(p.profile_heparin_maintain) : undefined,
      profile_dry_weight:
        p.profile_dry_weight != null
          ? Number(p.profile_dry_weight)
          : p.dry_weight != null
            ? Number(p.dry_weight)
            : undefined,
      profile_dry_weight_date: parseApiDateOnlyForPicker(
        p.profile_dry_weight_date ?? p.dry_weight_date,
      ),
      profile_dry_weight_reason: p.profile_dry_weight_reason ?? p.dry_weight_reason ?? undefined,
      id_card: p.id_card || undefined,
      phone: p.phone || undefined,
      family_contact_name: p.family_contact?.name || undefined,
      family_contact_phone: p.family_contact?.phone || undefined,
      address: p.address || undefined,
      consent_dialysis: p.consent_dialysis ?? false,
      consent_dialysis_date: parseApiDateOnlyNullable(p.consent_dialysis_date),
      consent_cvc: p.consent_cvc ?? false,
      consent_cvc_date: parseApiDateOnlyNullable(p.consent_cvc_date),
      current_access_type: getCurrentAccessType(p),
      dialysis_schedule_code: p.dialysis_schedule_code || undefined,
      dialysis_schedule_notes: p.dialysis_schedule_notes || undefined,
      dialysis_schedule_adjust: Boolean(
        p.dialysis_schedule_notes?.trim() || p.dialysis_schedule_code === 'other',
      ),
      dialysis_schedule_anchor_date: p.dialysis_schedule_anchor_date
        ? parseApiDateOnlyForPicker(p.dialysis_schedule_anchor_date)
        : undefined,
      machine_station: p.machine_station?.trim() || undefined,
      responsible_nurse_id: p.responsible_nurse_id || undefined,
    });
    setEditConsentFileList([]);
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!id) return;
    try {
      const values = await editForm.validateFields();
      const hasConsentImage =
        consentStoredImageCount(p) > 0
        || editConsentFileList.some(f => f.originFileObj);
      if (!hasConsentImage) {
        message.error('请上传透析知情同意书影像（档案中尚无影像时必须上传）');
        return;
      }
      setEditLoading(true);
      const currentAccessRecord = p ? getCurrentAccessRecord(p) : null;
      const currentAccessType = p ? getCurrentAccessType(p) : 'none';
      const selectedAccessType = values.current_access_type || currentAccessType;
      const familyName = values.family_contact_name?.trim();
      const familyPhone = values.family_contact_phone?.trim();
      const showScheduleNotes =
        Boolean(values.dialysis_schedule_adjust) || values.dialysis_schedule_code === 'other';
      const updatePayload = {
        name: values.name.trim(),
        patient_identifier: values.patient_identifier?.trim() || undefined,
        gender: values.gender || undefined,
        dob: values.dob ? values.dob.format('YYYY-MM-DD') : undefined,
        dialysis_start_date: values.dialysis_start_date
          ? values.dialysis_start_date.format('YYYY-MM-DD')
          : null,
        primary_diagnosis: values.primary_diagnosis?.trim() || undefined,
        present_illness: values.present_illness?.trim() || undefined,
        past_history: values.past_history?.trim() || undefined,
        ckd_stage: values.ckd_stage ?? undefined,
        comorbidities: values.comorbidities?.map(s => s.trim()).filter(Boolean) || [],
        profile_anticoagulant: mapFormAnticoagulantToDb(values.profile_anticoagulant),
        profile_heparin_prime_dose: values.profile_heparin_first != null ? Number(values.profile_heparin_first) : null,
        profile_heparin_maintain: values.profile_heparin_maintain != null ? Number(values.profile_heparin_maintain) : null,
        profile_dry_weight: values.profile_dry_weight != null ? Number(values.profile_dry_weight) : undefined,
        profile_dry_weight_date: values.profile_dry_weight_date
          ? values.profile_dry_weight_date.format('YYYY-MM-DD')
          : undefined,
        profile_dry_weight_reason: values.profile_dry_weight_reason?.trim() || null,
        id_card: values.id_card?.trim() || undefined,
        phone: values.phone?.trim() || undefined,
        address: values.address?.trim() || undefined,
        consent_dialysis: Boolean(values.consent_dialysis),
        consent_dialysis_date: values.consent_dialysis && values.consent_dialysis_date
          ? values.consent_dialysis_date.format('YYYY-MM-DD')
          : null,
        consent_cvc: Boolean(values.consent_cvc),
        consent_cvc_date: values.consent_cvc && values.consent_cvc_date
          ? values.consent_cvc_date.format('YYYY-MM-DD')
          : null,
        status: values.status ?? undefined,
        family_contact: familyName || familyPhone
          ? {
              ...(familyName ? { name: familyName } : {}),
              ...(familyPhone ? { phone: familyPhone } : {}),
            }
          : undefined,
        dialysis_schedule_code: values.dialysis_schedule_code ?? null,
        ...(showScheduleNotes
          ? { dialysis_schedule_notes: values.dialysis_schedule_notes?.trim() || null }
          : {}),
        dialysis_schedule_anchor_date:
          values.dialysis_schedule_code === 'qod' && values.dialysis_schedule_anchor_date
            ? values.dialysis_schedule_anchor_date.format('YYYY-MM-DD')
            : null,
        machine_station: values.machine_station?.trim()
          ? values.machine_station.trim().slice(0, 80)
          : null,
        responsible_nurse_id: values.responsible_nurse_id ?? undefined,
      };
      await patientsApi.update(id, updatePayload);

      const newConsentFiles = editConsentFileList
        .map(f => f.originFileObj)
        .filter((f): f is NonNullable<UploadFile['originFileObj']> => f != null);
      if (newConsentFiles.length > 0) {
        try {
          const up = await patientsApi.uploadConsentDialysisImage(id, newConsentFiles);
          if (up.data.code !== 200) {
            message.warning(up.data.message || '知情同意书图片上传失败');
          }
        } catch {
          message.warning('知情同意书图片上传失败');
        }
      }

      // 先保证“患者档案”更新成功；通路同步失败时给出明确提示（避免静默中断）
      let vascularSyncError: unknown = null;
      try {
        if (selectedAccessType !== currentAccessType) {
          if (selectedAccessType === 'none') {
            if (currentAccessRecord?.id) {
              await vascularApi.abandon(
                currentAccessRecord.id,
                '患者档案编辑：调整为无需置管/暂无通路',
                dayjs().format('YYYY-MM-DD'),
              );
            }
          } else {
            await vascularApi.create(id, {
              access_type: selectedAccessType.toLowerCase() as 'avf' | 'avg' | 'tcc' | 'ncc',
              location: '待完善',
              established_date: dayjs().format('YYYY-MM-DD'),
              notes: '由患者档案编辑窗口快速更新，请在血管通路管理完善详细信息',
            });
          }
        }
      } catch (e) {
        vascularSyncError = e;
      }

      const data = await loadPatientData(id);
      const nextPatient: PatientDetailRecord = {
        ...data.patient,
        machine_station:
          data.patient.machine_station ?? updatePayload.machine_station ?? null,
      };
      setPatient(nextPatient);
      setInfectionRows(data.infectionRows);
      setLabRows(data.labRows);
      setDialysisRows(data.dialysisRows);
      setRecentLines(data.recentLines);
      setEditOpen(false);
      message.success('患者档案已更新');

      if (vascularSyncError) {
        const maybeResponse = vascularSyncError as { response?: { data?: { message?: string }; status?: number } };
        message.error(
          maybeResponse?.response?.data?.message ||
            (maybeResponse?.response?.status
              ? `患者信息已保存，但通路同步失败（HTTP ${maybeResponse.response.status}）`
              : '患者信息已保存，但通路同步失败'),
        );
      }
    } catch (err: unknown) {
      // 表单校验失败：antd 会在对应字段展示错误提示；此处只兜底避免“静默失败”
      // 请求失败：axios 拦截器会兜底提示，但这里同样给出后端 message 以便定位
      const maybeResponse = err as { response?: { data?: { message?: string }; status?: number } };
      const backendMsg = maybeResponse?.response?.data?.message;
      const status = maybeResponse?.response?.status;

      const maybeValidationError = err as { errorFields?: unknown };
      if (!maybeResponse?.response && maybeValidationError?.errorFields) return;

      message.error(
        backendMsg ||
          (status ? `保存失败（HTTP ${status}），请稍后重试` : '保存失败，请稍后重试'),
      );

      console.error('[PatientDetail] save patient error', { status, message: backendMsg || (err as Error)?.message });
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteConsentImage = async (index: number) => {
    if (!p || !canEditPatient) return;
    try {
      setConsentDeleteLoading(index);
      const res = await patientsApi.deleteConsentDialysisImage(p.id, index);
      if (res.data.code !== 200) {
        message.error(res.data.message || '删除失败');
        return;
      }
      const data = await loadPatientData(p.id);
      setPatient(data.patient);
      setInfectionRows(data.infectionRows);
      setLabRows(data.labRows);
      setDialysisRows(data.dialysisRows);
      setRecentLines(data.recentLines);
      message.success('知情同意书影像已删除');
    } catch {
      // 错误由拦截器处理
    } finally {
      setConsentDeleteLoading(null);
    }
  };

  if (loading) {
    return (
      <PageShell fullWidth>
        <PageLoading tip="加载患者档案…" />
      </PageShell>
    );
  }

  if (loadError || !p) {
    return (
      <PageShell fullWidth>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/patients')} style={{ marginBottom: 16 }}>
          返回列表
        </Button>
        <PageErrorResult title="无法加载患者" subTitle="患者不存在或网络异常，请返回列表重试。" />
      </PageShell>
    );
  }

  const st = HEADER_STATUS[p.status] || HEADER_STATUS.active;
  const subtitle = `${formatGender(p.gender)} · ${p.age ?? '—'}岁 · 患者ID: ${p.patient_identifier || '—'} · 档案ID: ${p.id} · ${p.primary_diagnosis || '待补全'}${p.ckd_stage ? ` · CKD ${p.ckd_stage} 期` : ''} · 透析龄 ${p.dialysis_age ?? '—'}`;

  return (
    <PageShell fullWidth>
      {/* 顶部操作栏 */}
      <div className="flex items-center" style={{ marginBottom: 16, gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/patients')}>返回列表</Button>
        <span style={{ fontSize: 13, color: '#7B92BC' }}>患者ID: {id}</span>
      </div>

      {/* 患者基本信息条 */}
      <Card
        style={{ marginBottom: 16, border: '1px solid #0EA5E9', borderLeft: '4px solid #0EA5E9' }}
        styles={{ body: { padding: '16px 20px' } }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-16">
            <div
              className={`hd-avatar ${p.gender === 'F' ? 'hd-avatar-f' : p.gender === 'M' ? 'hd-avatar-m' : ''}`}
              style={{ width: 52, height: 52, fontSize: 20, borderRadius: 12 }}
            >
              {p.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-8">
                <span style={{ fontSize: 20, fontWeight: 700, color: '#0D1B3E' }}>{p.name}</span>
                <span style={{ background: st.bg, color: st.color, padding: '2px 9px', borderRadius: 20, fontSize: 13, fontWeight: 500 }}>
                  {st.label}
                </span>
                <IsolationZoneTag zone={p.isolation_zone} />
              </div>
              <div style={{ fontSize: 13, color: '#7B92BC', marginTop: 4 }}>
                {subtitle}
              </div>
            </div>
          </div>
          <Space size={8}>
            {canEditPatient && <Button onClick={openEditModal}>编辑患者信息</Button>}
            {canDeletePatient && (
              <Popconfirm
                title="确定删除该患者档案？"
                description="将同步删除该患者相关透析/检验/医嘱等记录，删除后不可恢复。"
                okText="确认删除"
                cancelText="取消"
                okButtonProps={{ danger: true, loading: deleteLoading }}
                onConfirm={() => void handleDeletePatient()}
              >
                <Button danger loading={deleteLoading}>删除档案</Button>
              </Popconfirm>
            )}
            <Button icon={<PrinterOutlined />} onClick={handlePrint}>打印档案</Button>
            <Button
              type="primary"
              onClick={() => navigate(`/dialysis/entry?patient_id=${encodeURIComponent(p.id)}`)}
            >
              💉 录入今日透析
            </Button>
          </Space>
        </div>
      </Card>

      {/* 知情同意书状态（与患者档案 consent 字段同步） */}
      <div className="flex gap-8" style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <span style={{
          background: p.consent_dialysis ? '#ECFDF5' : '#F1F5F9',
          color: p.consent_dialysis ? '#059669' : '#64748B',
          border: `1px solid ${p.consent_dialysis ? '#6EE7B7' : '#CBD5E1'}`,
          padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
        }}>
          {p.consent_dialysis
            ? `✅ 透析知情同意书已签${p.consent_dialysis_date ? ` (${p.consent_dialysis_date})` : ''}`
            : '— 透析知情同意书未登记'}
        </span>
        {consentStoredImageCount(p) > 0 ? (
          <div style={{ flex: '1 1 320px', minWidth: 200 }}>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>
              知情同意书影像（共 {consentStoredImageCount(p)} 张）
            </div>
            <Space wrap size={[8, 8]}>
              {(p.consent_dialysis_image_paths ?? []).map((_, i) => (
                <Space key={i} size={4} direction="vertical">
                  <PatientConsentDialysisImage patientId={p.id} index={i} />
                  {canEditPatient ? (
                    <Popconfirm
                      title="确认删除该影像？"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => void handleDeleteConsentImage(i)}
                    >
                      <Button
                        size="small"
                        danger
                        loading={consentDeleteLoading === i}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  ) : null}
                </Space>
              ))}
            </Space>
          </div>
        ) : null}
        <span style={{
          background: p.consent_cvc ? '#ECFDF5' : '#F1F5F9',
          color: p.consent_cvc ? '#059669' : '#64748B',
          border: `1px solid ${p.consent_cvc ? '#6EE7B7' : '#CBD5E1'}`,
          padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
        }}>
          {p.consent_cvc
            ? `✅ CVC置管同意书已签${p.consent_cvc_date ? ` (${p.consent_cvc_date})` : ''}`
            : '— CVC置管同意书未登记 / 不适用'}
        </span>
      </div>

      {/* 患者纵览标签页 */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'basic',
            label: '📋 基本信息',
            children: <TabBasic patient={p} infectionRows={infectionRows} recentLines={recentLines} />,
          },
          {
            key: 'history',
            label: '📖 透析历史',
            children: <TabDialysisHistory rows={dialysisRows} patientId={p.id} />,
          },
          {
            key: 'care',
            label: '🧭 管理入口',
            children: (
              <TabCareCoordination
                patient={p}
                dialysisRows={dialysisRows}
                infectionRows={infectionRows}
                labRows={labRows}
                onNavigate={navigate}
                onOpenEditPatient={openEditModal}
              />
            ),
          },
        ]}
        style={{ background: '#fff', padding: '0 0 16px', borderRadius: 10, border: '1px solid #DBEAFE' }}
        tabBarStyle={{ padding: '0 20px', borderBottom: '2px solid #DBEAFE' }}
      />

      <Modal
        title="编辑患者档案"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleSaveEdit}
        confirmLoading={editLoading}
        okText="保存修改"
        cancelText="取消"
        width={760}
        destroyOnClose
      >
        <Form<EditFormValues>
          form={editForm}
          layout="vertical"
        >
          <div className="grid-2" style={{ gap: '0 16px' }}>
            <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item
              name="patient_identifier"
              label="患者ID（真实ID）"
              rules={[{ required: true, message: '请填写患者真实ID' }]}
            >
              <Input maxLength={64} />
            </Form.Item>
            <Form.Item name="gender" label="性别">
              <Select allowClear options={[{ value: 'M', label: '男' }, { value: 'F', label: '女' }]} />
            </Form.Item>
            <Form.Item name="dob" label="出生日期">
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="dialysis_start_date" label="开始透析日期">
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item
              name="machine_station"
              label="机位（可选）"
              style={{ gridColumn: 'span 2' }}
              tooltip="约定机位或位置说明；保存档案后将同步至该患者在排班表中的全部记录。"
            >
              <Input maxLength={80} allowClear placeholder="如：靠窗、固定区域等" />
            </Form.Item>
            <Form.Item
              name="primary_diagnosis"
              label="主要诊断"
              style={{ gridColumn: 'span 2' }}
            >
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="present_illness" label="现病史（可选）" style={{ gridColumn: 'span 2' }}>
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
            <Form.Item name="past_history" label="既往史（可选）" style={{ gridColumn: 'span 2' }}>
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
            <Form.Item name="ckd_stage" label="CKD 分期（可选）">
              <InputNumber min={1} max={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="comorbidities" label="合并症（可选）" style={{ gridColumn: 'span 2' }}>
              <Select mode="tags" tokenSeparators={[',']} placeholder="输入后回车添加" />
            </Form.Item>
            <div style={{ gridColumn: 'span 2', fontSize: 12, color: '#64748B', marginBottom: 4 }}>
              干体重（保存档案时同步至当前透析处方；在处方页保存处方或仅更新干体重时也会回写此处）
            </div>
            <Form.Item
              name="profile_dry_weight"
              label="干体重目标 (kg)"
              rules={[
                { required: true, message: '请填写干体重' },
                { type: 'number', min: 20, max: 200, message: '范围为 20–200 kg' },
              ]}
            >
              <InputNumber min={20} max={200} step={0.1} style={{ width: '100%' }} placeholder="如 58.5" />
            </Form.Item>
            <Form.Item
              name="profile_dry_weight_date"
              label="评估日期"
              rules={[{ required: true, message: '请选择评估日期' }]}
            >
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item
              name="profile_dry_weight_reason"
              label="变更原因（可选）"
              style={{ gridColumn: 'span 2' }}
            >
              <Input.TextArea rows={2} maxLength={2000} showCount placeholder="如：容量负荷评估后调整" />
            </Form.Item>
            <div style={{ gridColumn: 'span 2', fontSize: 12, color: '#64748B', marginBottom: 4 }}>
              抗凝默认方案（保存档案时写入并覆盖当前透析处方的抗凝项；仅在处方页调整处方时不会回写此处）
            </div>
            <Form.Item
              name="profile_anticoagulant"
              label="抗凝方案"
              rules={[{ required: true, message: '请选择抗凝方案' }]}
            >
              <Select options={[...ANTICOAGULANT_OPTIONS]} placeholder="请选择" />
            </Form.Item>
            <Form.Item name="profile_heparin_first" label="首剂（IU）">
              <InputNumber min={0} style={{ width: '100%' }} placeholder="如 5000" />
            </Form.Item>
            <Form.Item name="profile_heparin_maintain" label="追加（IU/h）">
              <InputNumber min={0} step={0.1} style={{ width: '100%' }} placeholder="如 500" />
            </Form.Item>
            <Form.Item name="dialysis_schedule_code" label="透析时间">
              <Select allowClear placeholder="请选择透析频次与时段" options={[...DIALYSIS_SCHEDULE_OPTIONS]} />
            </Form.Item>
            <Form.Item name="status" label="透析状态">
              <Select
                options={[
                  { value: 'active', label: '在透' },
                  { value: 'suspended', label: '暂停' },
                  { value: 'hospitalized', label: '住院' },
                  { value: 'transferred', label: '转出' },
                  { value: 'transplanted', label: '肾移植' },
                  { value: 'deceased', label: '死亡' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="dialysis_schedule_adjust"
              label="补充/调整规则"
              valuePropName="checked"
            >
              <Switch checkedChildren="已开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(prev, cur) =>
                prev.dialysis_schedule_adjust !== cur.dialysis_schedule_adjust
                || prev.dialysis_schedule_code !== cur.dialysis_schedule_code
              }
            >
              {({ getFieldValue }) => {
                const adj = getFieldValue('dialysis_schedule_adjust');
                const code = getFieldValue('dialysis_schedule_code');
                if (!adj && code !== 'other') return null;
                return (
                  <Form.Item
                    name="dialysis_schedule_notes"
                    label="透析时间说明（可手动输入）"
                    style={{ gridColumn: 'span 2' }}
                    rules={code === 'other' ? [{ required: true, message: '选择「其他」时请填写说明' }] : undefined}
                  >
                    <Input.TextArea rows={3} maxLength={800} showCount />
                  </Form.Item>
                );
              }}
            </Form.Item>
            {watchEditDialysisCode === 'qod' ? (
              <Form.Item
                name="dialysis_schedule_anchor_date"
                label="隔日锚点日期"
                style={{ gridColumn: 'span 2' }}
                tooltip="用于排班系统自动推算隔日透析日。"
                rules={[{ required: true, message: '请选择隔日锚点日期' }]}
              >
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            ) : null}
            <Form.Item name="id_card" label="身份证号（可选）">
              <Input maxLength={18} />
            </Form.Item>
            <Form.Item name="phone" label="手机号（可选）">
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="family_contact_name" label="家属联系人姓名（可选）">
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item name="family_contact_phone" label="家属联系电话（可选）">
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="address" label="家庭住址（可选）" style={{ gridColumn: 'span 2', marginBottom: 0 }}>
              <Input.TextArea rows={2} />
            </Form.Item>

            <Form.Item
              name="responsible_nurse_id"
              label="责任护士"
              style={{ gridColumn: 'span 2' }}
              rules={[{ required: true, message: '请选择责任护士' }]}
              tooltip="用于日常宣教、随访协调等管理对接；选项为本科室已启用的护士/护士长账号，与透析排班机位无绑定。"
            >
              <Select
                showSearch
                placeholder="请选择本科室护理人员"
                optionFilterProp="label"
                options={nurseSelectOptions}
              />
            </Form.Item>

            <Form.Item
              name="current_access_type"
              label="血管通路（当前）"
              style={{ gridColumn: 'span 2' }}
              tooltip="用于本页提醒与知情同意联动；详细通路档案请在“血管通路管理”维护"
            >
              <Select
                options={[
                  { value: 'none', label: '无需置管/暂无通路记录' },
                  { value: 'AVF', label: 'AVF（自体动静脉内瘘）' },
                  { value: 'AVG', label: 'AVG（人工血管内瘘）' },
                  { value: 'TCC', label: 'TCC（长期导管）' },
                  { value: 'NCC', label: 'NCC（临时导管）' },
                ]}
              />
            </Form.Item>

            <Form.Item
              label="知情同意书"
              style={{ gridColumn: 'span 2', marginTop: 8, marginBottom: 8 }}
            >
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div
                  style={{
                    border: '1px solid #DBEAFE',
                    borderRadius: 8,
                    padding: '10px 12px',
                    background: '#FAFCFF',
                  }}
                >
                  <Form.Item name="consent_dialysis" valuePropName="checked" noStyle>
                    <Checkbox>已签署透析知情同意书</Checkbox>
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, cur) => prev.consent_dialysis !== cur.consent_dialysis}
                  >
                    {({ getFieldValue }) =>
                      getFieldValue('consent_dialysis') ? (
                        <Form.Item
                          name="consent_dialysis_date"
                          label="透析同意书签署日期"
                          style={{ marginTop: 8, marginBottom: 0 }}
                        >
                          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                        </Form.Item>
                      ) : null
                    }
                  </Form.Item>
                </div>

                <div
                  style={{
                    border: '1px solid #DBEAFE',
                    borderRadius: 8,
                    padding: '10px 12px',
                    background: '#FAFCFF',
                  }}
                >
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, cur) => prev.current_access_type !== cur.current_access_type || prev.consent_cvc !== cur.consent_cvc}
                  >
                    {({ getFieldValue }) => {
                      const accessType = getFieldValue('current_access_type');
                      const showCvcConsent = accessType === 'TCC' || accessType === 'NCC';
                      if (!showCvcConsent) {
                        return (
                          <div style={{ fontSize: 12.5, color: '#7B92BC', lineHeight: 1.7 }}>
                            当前选择为非导管通路，无需签署 CVC 置管同意书。
                          </div>
                        );
                      }
                      const cvcLabel = accessType === 'TCC' ? '长期导管（TCC）置管同意书' : '临时导管（NCC）置管同意书';
                      return (
                        <>
                          <Form.Item name="consent_cvc" valuePropName="checked" noStyle>
                            <Checkbox>已签署{cvcLabel}</Checkbox>
                          </Form.Item>
                          <Form.Item
                            noStyle
                            shouldUpdate={(p, c) => p.consent_cvc !== c.consent_cvc}
                          >
                            {({ getFieldValue: getValue }) =>
                              getValue('consent_cvc') ? (
                                <Form.Item
                                  name="consent_cvc_date"
                                  label={`${cvcLabel}签署日期`}
                                  style={{ marginTop: 8, marginBottom: 0 }}
                                >
                                  <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                                </Form.Item>
                              ) : null
                            }
                          </Form.Item>
                        </>
                      );
                    }}
                  </Form.Item>
                </div>

                {canEditPatient ? (
                  <div
                    style={{
                      border: '1px solid #DBEAFE',
                      borderRadius: 8,
                      padding: '10px 12px',
                      background: '#FAFCFF',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                      透析知情同意书影像
                      {consentStoredImageCount(p) === 0 ? (
                        <span style={{ color: '#BE123C', fontWeight: 600 }}>（必填）</span>
                      ) : (
                        <span style={{ color: '#64748B', fontWeight: 400 }}>（已存档时可不上传新图）</span>
                      )}
                    </div>
                    <ConsentDialysisImageUpload
                      fileList={editConsentFileList}
                      onChange={({ fileList }) => setEditConsentFileList(fileList)}
                      maxCount={15}
                      triggerLabel="上传图片"
                    />
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                      {consentStoredImageCount(p) > 0
                        ? '点击上传可选择本地相册/文件或拍照；可一次多张替换已有存档，保存后覆盖原图。单张不超过 5MB，最多 15 张。'
                        : '档案中尚未存档影像，须上传后方可保存。点击上传可选择本地相册/文件或拍照，单张不超过 5MB，最多 15 张。'}
                    </div>
                  </div>
                ) : null}
              </Space>
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </PageShell>
  );
}
