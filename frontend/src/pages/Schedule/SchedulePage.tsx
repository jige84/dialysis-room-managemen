/**
 * 周排班管理页
 * 主要作用：展示本周患者与护士排班，并支持护士长调整当班护士。
 * 主要功能：周视图切换；从后端加载周排班；展示护患比；调整护士排班。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Button,
  Select,
  Modal,
  Form,
  Input,
  DatePicker,
  message,
  Spin,
  Table,
  Space,
  Popconfirm,
  Alert,
  Tag,
} from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import PageShell from '../../components/PageShell/PageShell';
import NurseScheduleBlankTemplate from '../../components/NurseScheduleBlankTemplate/NurseScheduleBlankTemplate';
import {
  scheduleApi,
  type PatientSlot,
  type ShiftKey,
  type WeekScheduleResponse,
  type TodaySchedulePatientRow,
} from '../../api/schedule';
import { patientsApi } from '../../api/patients';
import { devicesApi, type MachineRow } from '../../api/devices';
import { usePermission } from '../../utils/permission';
import { groupTodayScheduleRowsByShiftThenZone } from '../../utils/dialysisTodayScheduleDisplay';

const SHIFT_CONFIG: { key: ShiftKey; label: string }[] = [
  { key: 'am', label: '上午班 (06:00-12:00)' },
  { key: 'pm', label: '下午班 (12:00-18:00)' },
  { key: 'eve', label: '晚班 (18:00-00:00)' },
];
const DAYS_OF_WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const SHIFT_LABEL_CN: Record<string, string> = { am: '早', pm: '中', eve: '晚' };

/** GET /schedule/today 返回的 shift 为 DB 英文（morning/afternoon/evening），与周视图键 am/pm/eve 不同 */
function todayListShiftLabel(shift: string | undefined | null): string {
  if (shift === undefined || shift === null || shift === '') return '—';
  const map: Record<string, string> = {
    morning: '上午',
    afternoon: '下午',
    evening: '晚班',
    am: '上午',
    pm: '下午',
    eve: '晚班',
  };
  const key = String(shift).toLowerCase();
  return map[key] ?? String(shift);
}

/** 本条排班透析模式（HD / HDF / HD+HP），与档案「腹透/血透」类别无关 */
const HEMO_MODALITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'HD', label: 'HD' },
  { value: 'HDF', label: 'HDF' },
  { value: 'HD_HP', label: 'HD+HP' },
];

function patientRenalCategoryLabel(cat: PatientSlot['patientRenalCategory']): string {
  if (cat === 'PD') return '腹透';
  return '血透';
}

/** 排班格内展示的透析模式简称 */
function scheduleDialysisModeLabel(mode: string | null | undefined): string {
  if (!mode) return '—';
  const raw = String(mode).trim();
  const u = raw.toUpperCase().replace(/\+/g, '_');
  const map: Record<string, string> = {
    HD: 'HD',
    HDF: 'HDF',
    HD_HP: 'HD+HP',
    'HD+HP': 'HD+HP',
    HP: 'HD+HP',
    PD: 'PD',
    OTHER: '其他',
  };
  return map[u] || map[raw] || raw;
}

/**
 * 排序键：与周视图格内卡片底部展示一致（仅渲染 machineStation），
 * 故排序优先用档案约定机位；无展示文案时再退回透析机 machine_no。
 */
function scheduleSlotMachineLabelForSort(p: PatientSlot): string {
  const station = (p.machineStation ?? '').trim();
  if (station) return station;
  return (p.machineNo ?? '').trim();
}

/**
 * 机器标识排序：纯数字 → 字母+数字（如 B11）→ 中文等（急诊机、备用机）；空串靠后。
 */
function compareDialysisMachineLabels(aRaw: string, bRaw: string): number {
  const a = String(aRaw ?? '').trim();
  const b = String(bRaw ?? '').trim();
  if (a === '' && b === '') return 0;
  if (a === '') return 1;
  if (b === '') return -1;

  const tier = (s: string): number => {
    if (/^\d+$/.test(s)) return 0;
    if (/^[A-Za-z]+\d*$/.test(s)) return 1;
    return 2;
  };
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return ta - tb;

  if (ta === 0) return Number(a) - Number(b);

  if (ta === 1) {
    const ma = a.match(/^([A-Za-z]+)(\d*)$/);
    const mb = b.match(/^([A-Za-z]+)(\d*)$/);
    const pa = ma?.[1] ?? '';
    const pb = mb?.[1] ?? '';
    if (pa.toLowerCase() !== pb.toLowerCase()) {
      return pa.localeCompare(pb, 'en', { sensitivity: 'base' });
    }
    const na = ma?.[2] ? Number(ma[2]) : 0;
    const nb = mb?.[2] ? Number(mb[2]) : 0;
    return na - nb;
  }

  return a.localeCompare(b, 'zh-CN', { numeric: true });
}

function comparePatientSlotsByMachine(a: PatientSlot, b: PatientSlot): number {
  const byMachine = compareDialysisMachineLabels(
    scheduleSlotMachineLabelForSort(a),
    scheduleSlotMachineLabelForSort(b),
  );
  if (byMachine !== 0) return byMachine;
  return a.name.localeCompare(b.name, 'zh-CN');
}

function sortPatientSlotsByMachine(patients: PatientSlot[]): PatientSlot[] {
  return [...patients].sort(comparePatientSlotsByMachine);
}

/** PATCH 排班后立刻更新周视图中的本条记录，避免仅依赖重新拉取时界面仍显示旧透析模式 */
/** 后端提示迁移/处方未写入时用警告样式，避免误以为已完全同步 */
function shouldWarnScheduleSyncMessage(text: string | undefined): boolean {
  if (!text) return false;
  return /迁移\s*0?43|0?44|0?45|未更新|未写入|未持久化|缺少|暂无当前有效|未执行|非上机当日|上机当日/.test(text);
}

function mergeWeekDataAfterSlotPatch(
  wd: WeekScheduleResponse,
  scheduleId: string,
  row: { session_dialysis_mode?: string | null; schedule_remark?: string | null },
): WeekScheduleResponse {
  const sessRaw = row.session_dialysis_mode;
  const sess = sessRaw === undefined ? undefined : sessRaw === null || sessRaw === '' ? null : String(sessRaw);
  const cells = { ...wd.cells } as WeekScheduleResponse['cells'];
  for (const shiftKey of wd.shifts) {
    const dayMap = { ...(cells[shiftKey] ?? {}) };
    for (const day of wd.days) {
      const dk = day.date;
      const cell = dayMap[dk];
      if (!cell?.patients?.length) continue;
      dayMap[dk] = {
        ...cell,
        patients: cell.patients.map((p) => {
          if (p.scheduleId !== scheduleId) return p;
          const nextSess = sess !== undefined ? sess : (p.sessionDialysisMode ?? null);
          const eff = !nextSess || nextSess === '' ? 'HD' : String(nextSess);
          const nextRm =
            row.schedule_remark !== undefined ? row.schedule_remark : p.scheduleRemark;
          return {
            ...p,
            sessionDialysisMode: nextSess,
            dialysisMode: eff,
            scheduleRemark: nextRm ?? null,
          };
        }),
      };
    }
    cells[shiftKey] = dayMap;
  }
  return { ...wd, cells };
}

function machineZoneForPatient(isolation: string | null | undefined): 'normal' | 'hbv' | 'hcv' {
  if (isolation === 'hbv') return 'hbv';
  if (isolation === 'hcv') return 'hcv';
  return 'normal';
}

function machineOptionsForSlot(
  row: PatientSlot,
  allMachines: MachineRow[],
  cellPatients: PatientSlot[],
): { value: string; label: string }[] {
  const z = machineZoneForPatient(row.isolationZone);
  const usedOther = new Set(
    cellPatients
      .filter((x) => x.scheduleId !== row.scheduleId)
      .map((x) => x.machineId)
      .filter((id): id is string => Boolean(id)),
  );
  return allMachines
    .filter(
      (m) =>
        m.zone === z
        && m.status === 'active'
        && (!usedOther.has(m.id) || m.id === row.machineId),
    )
    .sort((a, b) => a.machine_no.localeCompare(b.machine_no, 'zh-CN'))
    .map((m) => ({ value: m.id, label: `${m.machine_no}（${m.zone}）` }));
}

function machinesAvailableForNewPatient(
  allMachines: MachineRow[],
  zone: 'normal' | 'hbv' | 'hcv',
  cellPatients: PatientSlot[],
): { value: string; label: string }[] {
  const used = new Set(
    cellPatients
      .map((x) => x.machineId)
      .filter((id): id is string => Boolean(id)),
  );
  return allMachines
    .filter((m) => m.zone === zone && m.status === 'active' && !used.has(m.id))
    .sort((a, b) => a.machine_no.localeCompare(b.machine_no, 'zh-CN'))
    .map((m) => ({ value: m.id, label: `${m.machine_no}（${m.zone}）` }));
}

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
  const navigate = useNavigate();
  const [currentWeek, setCurrentWeek] = useState(dayjs().startOf('week'));
  const [weekData, setWeekData] = useState<WeekScheduleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [weeklyPlan, setWeeklyPlan] = useState<string>('');
  const [form] = Form.useForm();
  const { canSchedule } = usePermission();

  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [cellModalOpen, setCellModalOpen] = useState(false);
  const [cellCtx, setCellCtx] = useState<{ date: string; shiftKey: ShiftKey } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [addPatientId, setAddPatientId] = useState<string | undefined>();
  const [addPatientIsolation, setAddPatientIsolation] = useState<string | undefined>();
  const [addMachineId, setAddMachineId] = useState<string | undefined>();
  const [patientSearchOptions, setPatientSearchOptions] = useState<{ value: string; label: string; zone: string }[]>([]);
  const [weekPatientAdjustOpen, setWeekPatientAdjustOpen] = useState(false);
  const [addScheduleRemark, setAddScheduleRemark] = useState('');
  const [addIsTempDialysis, setAddIsTempDialysis] = useState(true);
  const [addSessionDialysisMode, setAddSessionDialysisMode] = useState<string>('HD');
  /** 点击姓名：编辑本条透析模式与备注（默认 HD、备注空） */
  const [slotHemoModalOpen, setSlotHemoModalOpen] = useState(false);
  const [slotHemoEditing, setSlotHemoEditing] = useState<PatientSlot | null>(null);
  /** 本条排班所属日期（YYYY-MM-DD），用于判断「仅上机当日同步处方」后是否通知处方页刷新 */
  const [slotHemoScheduleDate, setSlotHemoScheduleDate] = useState<string | null>(null);
  const [slotHemoForm] = Form.useForm<{ modality: string; remark: string }>();

  /** 今日上机患者（与 /api/schedule/today 一致，供跳转透析录入） */
  const [todayDialysisRows, setTodayDialysisRows] = useState<TodaySchedulePatientRow[]>([]);

  const weekLabel = `${currentWeek.format('YYYY年M月D日')} — ${currentWeek.add(6, 'day').format('M月D日')}`;

  /** 今日上机：先按班次、再按透析隔离区分组（与透析工作台今日名单一致） */
  const todayDialysisGrouped = useMemo(
    () => groupTodayScheduleRowsByShiftThenZone(todayDialysisRows),
    [todayDialysisRows],
  );

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await scheduleApi.getToday();
        if (!cancelled) setTodayDialysisRows(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setTodayDialysisRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await devicesApi.machines();
        if (cancelled || res.data.code !== 200 || !Array.isArray(res.data.data)) return;
        setMachines(res.data.data);
      } catch {
        /* 机位列表失败时仍可浏览周视图 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const searchPatientsDebounced = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (q: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const t = q.trim();
        if (!t) {
          setPatientSearchOptions([]);
          return;
        }
        try {
          const res = await patientsApi.searchByKeyword(t);
          if (res.data.code !== 200 || !res.data.data?.list) return;
          setPatientSearchOptions(
            res.data.data.list.map((p) => ({
              value: p.id,
              label: `${p.name}（${p.isolation_zone}）`,
              zone: p.isolation_zone,
            })),
          );
        } catch {
          setPatientSearchOptions([]);
        }
      }, 320);
    };
  }, []);

  const cellPatientsForModal = useMemo(() => {
    if (!weekData || !cellCtx) return [];
    const raw = weekData.cells[cellCtx.shiftKey]?.[cellCtx.date]?.patients ?? [];
    return sortPatientSlotsByMachine(raw);
  }, [weekData, cellCtx]);

  const weekPatientOverviewRows = useMemo(() => {
    if (!weekData) return [];
    const out: Array<{
      key: string;
      date: string;
      weekdayLabel: string;
      shiftKey: ShiftKey;
      shiftShort: string;
      slot: PatientSlot;
    }> = [];
    for (const shiftKey of weekData.shifts) {
      for (const day of weekData.days) {
        const cell = weekData.cells[shiftKey]?.[day.date];
        if (!cell) continue;
        for (const p of cell.patients) {
          out.push({
            key: p.scheduleId,
            date: day.date,
            weekdayLabel: day.label,
            shiftKey,
            shiftShort: SHIFT_LABEL_CN[shiftKey] ?? shiftKey,
            slot: p,
          });
        }
      }
    }
    const order: ShiftKey[] = ['am', 'pm', 'eve'];
    out.sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      const sd = order.indexOf(a.shiftKey) - order.indexOf(b.shiftKey);
      if (sd !== 0) return sd;
      const sm = comparePatientSlotsByMachine(a.slot, b.slot);
      if (sm !== 0) return sm;
      return a.slot.name.localeCompare(b.slot.name, 'zh-CN');
    });
    return out;
  }, [weekData]);

  const openCellModal = (date: string, shiftKey: ShiftKey) => {
    setCellCtx({ date, shiftKey });
    setAddPatientId(undefined);
    setAddPatientIsolation(undefined);
    setAddMachineId(undefined);
    setAddScheduleRemark('');
    setAddSessionDialysisMode('HD');
    setAddIsTempDialysis(true);
    setPatientSearchOptions([]);
    setCellModalOpen(true);
  };

  const openSlotHemoModal = (slot: PatientSlot, scheduleDate: string) => {
    setSlotHemoEditing(slot);
    setSlotHemoScheduleDate(scheduleDate);
    slotHemoForm.setFieldsValue({
      modality: slot.sessionDialysisMode || 'HD',
      remark: slot.scheduleRemark ?? '',
    });
    setSlotHemoModalOpen(true);
  };

  const appendHeparinToSlotHemo = () => {
    const r = slotHemoForm.getFieldValue('remark') ?? '';
    const tag = '无肝素';
    const cur = String(r).trim();
    const next = cur.includes(tag)
      ? cur.replace(/无肝素/g, '').replace(/\s+/g, ' ').trim()
      : (cur ? `${cur} ${tag}` : tag);
    slotHemoForm.setFieldsValue({ remark: next });
  };

  const handleSaveSlotHemo = async () => {
    if (!slotHemoEditing || !canSchedule) return;
    const v = await slotHemoForm.validateFields();
    const scheduleId = slotHemoEditing.scheduleId;
    const patientId = slotHemoEditing.patientId;
    try {
      const res = await scheduleApi.updateSlot(scheduleId, {
        session_dialysis_mode: v.modality || 'HD',
        schedule_remark: v.remark?.trim() ? v.remark.trim() : null,
      });
      const row = res.data?.data as
        | { session_dialysis_mode?: string | null; schedule_remark?: string | null }
        | null
        | undefined;
      if (row) {
        setWeekData((prev) => (prev ? mergeWeekDataAfterSlotPatch(prev, scheduleId, row) : prev));
      }
      window.dispatchEvent(
        new CustomEvent('hd-hemodialysis-modality-synced', {
          detail: { patientId, scheduledDate: slotHemoScheduleDate },
        }),
      );
      const msgText = res.data?.message || '已保存';
      if (shouldWarnScheduleSyncMessage(msgText)) {
        message.warning(msgText, 10);
      } else {
        message.success(msgText);
      }
      setSlotHemoModalOpen(false);
      setSlotHemoEditing(null);
      setSlotHemoScheduleDate(null);
      await loadWeek(currentWeek);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } } };
      message.error(ax.response?.data?.message || '保存失败');
    }
  };

  const handleGenerateWeek = () => {
    if (!canSchedule) return;
    Modal.confirm({
      title: '按患者档案生成本周排班？',
      content:
        '将根据在透患者档案中的「透析时间」预设与隔日锚点，为本自然周生成机位排班；已存在的排班不会被覆盖。',
      okText: '生成',
      cancelText: '取消',
      onOk: async () => {
        try {
          setGenerating(true);
          const startDate = currentWeek.format('YYYY-MM-DD');
          const res = await scheduleApi.generateWeek(startDate);
          if (res.data.code !== 200 || !res.data.data) {
            message.error(res.data.message || '生成失败');
            return;
          }
          const d = res.data.data;
          if (d.inserted > 0) {
            message.success(`新增 ${d.inserted} 条，跳过 ${d.skipped} 条`);
          } else {
            message.warning('本周未新增排班条目，请查看弹出说明');
          }

          const showGenerateDetail = () => (
            <div>
              <p style={{ marginBottom: 10, color: '#64748B', fontSize: 13 }}>
                统计：候选在透患者{' '}
                <strong>{d.candidatePatients ?? '—'}</strong> 人；展开时段{' '}
                <strong>{d.expandedSlots ?? 0}</strong> 个；重复跳过{' '}
                <strong>{d.skipped}</strong> 次；无机位未落位{' '}
                <strong>{d.blockedNoMachine ?? 0}</strong> 次。
              </p>
              {d.hints && d.hints.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message="可能原因"
                  description={
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                      {d.hints.map((h) => (
                        <li key={h} style={{ marginBottom: 6 }}>
                          {h}
                        </li>
                      ))}
                    </ul>
                  }
                  style={{ marginBottom: 12 }}
                />
              ) : null}
              {d.note ? (
                <Alert type="info" showIcon message={d.note} style={{ marginBottom: 12 }} />
              ) : null}
              {d.warnings && d.warnings.length > 0 ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>明细警告</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {d.warnings.map((w) => (
                      <li key={w} style={{ marginBottom: 4 }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          );

          if (d.inserted === 0) {
            Modal.warning({
              title: '按档案生成：本周未新增排班',
              width: 600,
              content: showGenerateDetail(),
            });
          } else if (d.warnings?.length) {
            Modal.warning({
              title: '排班已生成，但有提示',
              width: 560,
              content: showGenerateDetail(),
            });
          }

          loadWeek(currentWeek);
        } catch {
          message.error('生成排班失败，请稍后重试');
        } finally {
          setGenerating(false);
        }
      },
    });
  };

  const handleDeleteSlot = async (scheduleId: string) => {
    try {
      await scheduleApi.deleteSlot(scheduleId);
      message.success('已删除排班');
      loadWeek(currentWeek);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } } };
      message.error(ax.response?.data?.message || '删除失败');
    }
  };

  const handleChangeMachine = async (scheduleId: string, machineId: string) => {
    try {
      await scheduleApi.updateSlot(scheduleId, { machine_id: machineId });
      message.success('机位已更新');
      loadWeek(currentWeek);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } } };
      message.error(ax.response?.data?.message || '更新失败');
    }
  };

  const handleAddSlot = async () => {
    if (!cellCtx || !addPatientId || !addMachineId) return;
    try {
      const remarkTrim = addScheduleRemark.trim();
      await scheduleApi.createSlot({
        patient_id: addPatientId,
        scheduled_date: cellCtx.date,
        shift: cellCtx.shiftKey,
        machine_id: addMachineId,
        session_dialysis_mode: addSessionDialysisMode || 'HD',
        is_temp: addIsTempDialysis,
        ...(remarkTrim ? { schedule_remark: remarkTrim } : {}),
      });
      message.success(addIsTempDialysis ? '已添加临时加透排班' : '已添加排班');
      setAddPatientId(undefined);
      setAddPatientIsolation(undefined);
      setAddMachineId(undefined);
      setAddScheduleRemark('');
      setAddSessionDialysisMode('HD');
      setAddIsTempDialysis(true);
      setPatientSearchOptions([]);
      loadWeek(currentWeek);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } } };
      message.error(ax.response?.data?.message || '添加失败');
    }
  };

  const addMachineOptions = useMemo(() => {
    if (!addPatientIsolation) return [];
    const z = machineZoneForPatient(addPatientIsolation);
    return machinesAvailableForNewPatient(machines, z, cellPatientsForModal);
  }, [machines, addPatientIsolation, cellPatientsForModal]);

  const nonCompliantCount = weekData
    ? weekData.shifts.reduce((sum, shift) => {
        const cellsByDate = weekData.cells[shift];
        const count = Object.values(cellsByDate || {}).filter(
          (cell) => !cell.compliant && cell.patients.length > 0,
        ).length;
        return sum + count;
      }, 0)
    : 0;

  /** 当前自然周全部「患者机位排班」条数（来自 schedules，非患者总数） */
  const weekSchedulePatientCount = useMemo(() => {
    if (!weekData) return 0;
    let n = 0;
    for (const sh of weekData.shifts) {
      for (const d of weekData.days) {
        n += weekData.cells[sh]?.[d.date]?.patients.length ?? 0;
      }
    }
    return n;
  }, [weekData]);

  const today = dayjs();
  const todayDateStr = today.format('YYYY-MM-DD');

  const todayStats = weekData
    ? weekData.shifts.reduce(
        (acc, shift) => {
          const cell = weekData.cells[shift]?.[todayDateStr];
          if (!cell) return acc;
          acc.patients += cell.patients.length;
          acc.nurses += cell.nurses.length;
          if (cell.patients.length > 0 || cell.nurses.length > 0) {
            acc.shifts += 1;
          }
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

  const cellShiftLabel = cellCtx
    ? SHIFT_CONFIG.find((s) => s.key === cellCtx.shiftKey)?.label ?? cellCtx.shiftKey
    : '';

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
          <div className="hd-stat-meta">本日已有患者或护士安排的班次数</div>
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

      {todayDialysisRows.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="今日上机患者 · 透析录入快捷入口"
          description={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {todayDialysisGrouped.map((shiftBlock, shiftIdx) => (
                <div
                  key={shiftBlock.shiftKey}
                  style={{
                    paddingTop: shiftIdx > 0 ? 12 : 0,
                    marginTop: shiftIdx > 0 ? 4 : 0,
                    borderTop: shiftIdx > 0 ? '1px solid #bfdbfe' : undefined,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: '#1e40af',
                      marginBottom: 10,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {shiftBlock.shiftLabel}
                    <Tag color="processing" style={{ marginLeft: 8 }}>
                      {shiftBlock.zones.reduce((n, z) => n + z.rows.length, 0)} 人
                    </Tag>
                  </div>
                  {shiftBlock.zones.map((zoneBlock, zi) => (
                    <div
                      key={`${shiftBlock.shiftKey}-${zoneBlock.zoneKey}`}
                      style={{ marginBottom: zi < shiftBlock.zones.length - 1 ? 12 : 0 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
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
                        <span style={{ fontSize: 12, color: '#64748b' }}>{zoneBlock.rows.length} 人</span>
                      </div>
                      <Space wrap size="small">
                        {zoneBlock.rows.map((row) => (
                          <Button
                            key={row.id}
                            type="primary"
                            ghost
                            size="small"
                            onClick={() =>
                              navigate(
                                `/dialysis/entry?patient_id=${encodeURIComponent(row.patient_id)}&date=${encodeURIComponent(dayjs().format('YYYY-MM-DD'))}`,
                              )
                            }
                          >
                            {row.patient_name || '患者'}
                            {row.machine_no ? ` · ${row.machine_no}` : ''}
                            {' · '}
                            {todayListShiftLabel(row.shift)}
                            {row.session_dialysis_mode
                              ? ` · ${scheduleDialysisModeLabel(row.session_dialysis_mode)}`
                              : ''}
                          </Button>
                        ))}
                      </Space>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          }
        />
      )}

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
            <Space size={10} wrap>
              <Button onClick={() => setWeekPatientAdjustOpen(true)}>
                本周患者调班
              </Button>
              <Button loading={generating} onClick={handleGenerateWeek}>
                按档案生成本周
              </Button>
              <span style={{ display: 'inline-block', width: 1, height: 16, background: 'var(--border)', verticalAlign: 'middle', margin: '0 2px' }} />
              <Button type="primary" onClick={handleOpenModal}>
                ＋ 调整排班（护士）
              </Button>
            </Space>
          )
        }
      >
        <Spin spinning={loading}>
          {weekData && !loading && weekSchedulePatientCount === 0 && (
            <Alert
              type="info"
              showIcon
              message="本周周历中尚无患者机位排班"
              description={
                '不是因为读不到患者档案：本页名单来自排班表（schedules）里的具体上机安排。若该周尚未生成或添加记录，格子里就会为空。请在有权限时使用「按档案生成本周」（需档案中已维护透析频次/时间且为在透患者），或在各单元格点击「患者排班」手工添加。'
              }
              style={{ marginBottom: 16 }}
            />
          )}
          <div id="hd-schedule-week-grid" style={{ overflowX: 'auto' }}>
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
                          <div>
                            {canSchedule && (
                              <div style={{ marginBottom: 4 }}>
                                <Button
                                  type="link"
                                  size="small"
                                  style={{ padding: 0, height: 'auto', fontSize: 12 }}
                                  onClick={() => openCellModal(date, shiftKey)}
                                >
                                  临时加透/患者排班
                                </Button>
                              </div>
                            )}
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {sortPatientSlotsByMachine(cell.patients).map((p) => (
                                    <div
                                      key={p.scheduleId}
                                      style={{
                                        borderRadius: 6,
                                        border: '1px solid #E2E8F0',
                                        padding: '6px 8px',
                                        background: '#FAFAFA',
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'flex-start',
                                          gap: 6,
                                        }}
                                      >
                                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                          <span
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => openSlotHemoModal(p, date)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' || e.key === ' ') openSlotHemoModal(p, date);
                                            }}
                                            style={{
                                              cursor: 'pointer',
                                              fontWeight: 600,
                                              fontSize: 12,
                                              color: '#0369A1',
                                              lineHeight: 1.35,
                                              wordBreak: 'break-all',
                                              textDecoration: 'underline',
                                              textDecorationColor: '#BAE6FD',
                                            }}
                                          >
                                            {p.name}
                                          </span>
                                          {p.isTemp ? (
                                            <Tag color="orange" style={{ margin: 0, fontSize: 10, lineHeight: '18px', padding: '0 4px' }}>临</Tag>
                                          ) : null}
                                          {p.scheduleRemark ? (
                                            <Tag color="gold" style={{ margin: 0, fontSize: 10, lineHeight: '18px', padding: '0 4px' }}>备</Tag>
                                          ) : null}
                                        </div>
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 600,
                                            color: '#475569',
                                            flexShrink: 0,
                                            lineHeight: 1.35,
                                          }}
                                        >
                                          {scheduleDialysisModeLabel(p.dialysisMode)}
                                        </span>
                                      </div>
                                      {p.scheduleRemark ? (
                                        <div
                                          style={{
                                            fontSize: 10,
                                            color: '#78716C',
                                            textAlign: 'right',
                                            marginTop: 4,
                                            lineHeight: 1.35,
                                            wordBreak: 'break-all',
                                          }}
                                        >
                                          {p.scheduleRemark}
                                        </div>
                                      ) : null}
                                      {p.machineStation?.trim() ? (
                                        <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                                          {p.machineStation.trim()}
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                                <div style={{ fontSize: 11, color: '#7B92BC', marginTop: 4 }}>共{cell.patients.length}人</div>
                              </div>
                            ) : (
                              <div style={{ color: '#BFDBFE', fontSize: 12, padding: '4px 0' }}>—</div>
                            )}
                          </div>
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

      <NurseScheduleBlankTemplate
        weekStart={currentWeek}
        canEdit={canSchedule}
        weekSchedule={weekData}
        weekScheduleLoading={loading}
      />

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

      <Modal
        title={
          cellCtx
            ? `患者排班 · ${cellCtx.date} · ${cellShiftLabel}`
            : '患者排班'
        }
        open={cellModalOpen}
        onCancel={() => {
          setCellModalOpen(false);
          setCellCtx(null);
        }}
        footer={null}
        width={900}
        destroyOnClose
      >
        <p style={{ color: '#64748B', fontSize: 12, marginBottom: 12 }}>
          点击患者姓名设置本条透析模式（HD/HDF/HD+HP）与备注。新增患者默认按<strong>临时加透</strong>保存；如患者或机位冲突，系统会阻止提交并提示更换机位或调整班次。排班可提前一周维护；<strong>仅当本条排班日期为「上机当日」</strong>时才会写入透析处方；其他日期仅保存在排班中。
        </p>
        <Table<PatientSlot>
          size="small"
          rowKey={(r) => r.scheduleId}
          pagination={false}
          scroll={{ x: 820 }}
          dataSource={cellPatientsForModal}
          columns={[
            {
              title: '患者（点击姓名编辑）',
              dataIndex: 'name',
              key: 'name',
              width: 140,
              render: (name: string, row) => (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => cellCtx && openSlotHemoModal(row, cellCtx.date)}
                >
                  {name}
                  {row.isTemp ? <Tag color="orange" style={{ marginLeft: 6 }}>临时加透</Tag> : null}
                </Button>
              ),
            },
            {
              title: '档案类别',
              key: 'renalCat',
              width: 72,
              render: (_, row) => patientRenalCategoryLabel(row.patientRenalCategory),
            },
            {
              title: '透析模式 / 备注',
              key: 'sum',
              width: 200,
              ellipsis: true,
              render: (_, row) => {
                const mode = scheduleDialysisModeLabel(row.dialysisMode);
                const rm = row.scheduleRemark?.trim();
                return rm ? `${mode} · ${rm}` : mode;
              },
            },
            {
              title: '透析机',
              key: 'machine',
              width: 220,
              render: (_, row) => (
                <Select
                  style={{ width: '100%' }}
                  value={row.machineId ?? undefined}
                  options={machineOptionsForSlot(row, machines, cellPatientsForModal)}
                  onChange={(v) => handleChangeMachine(row.scheduleId, v)}
                  disabled={!canSchedule}
                />
              ),
            },
            {
              title: '操作',
              key: 'x',
              width: 72,
              render: (_, row) => (
                <Popconfirm title="确定删除该排班？" onConfirm={() => handleDeleteSlot(row.scheduleId)}>
                  <Button type="link" size="small" danger disabled={!canSchedule}>
                    删除
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
        <Card size="small" title="临时加透 / 新增本班次患者" style={{ marginTop: 16 }} styles={{ body: { paddingBottom: 12 } }}>
          <Space wrap align="start">
            <Select
              showSearch
              filterOption={false}
              placeholder="搜索患者姓名"
              style={{ minWidth: 240 }}
              options={patientSearchOptions}
              onSearch={searchPatientsDebounced}
              value={addPatientId}
              onChange={(v) => {
                setAddPatientId(v);
                const o = patientSearchOptions.find((x) => x.value === v);
                setAddPatientIsolation(o?.zone);
                setAddMachineId(undefined);
              }}
              allowClear
            />
            <Select
              placeholder="选择透析机"
              style={{ minWidth: 220 }}
              options={addMachineOptions}
              value={addMachineId}
              onChange={setAddMachineId}
              disabled={!addPatientId}
              allowClear
            />
            <Select
              placeholder="透析模式"
              style={{ minWidth: 120 }}
              value={addSessionDialysisMode}
              options={HEMO_MODALITY_OPTIONS}
              onChange={setAddSessionDialysisMode}
              disabled={!addPatientId}
            />
            <Input.TextArea
              rows={1}
              placeholder="本条备注（可选，如临时加透原因）"
              style={{ minWidth: 200, maxWidth: 280 }}
              value={addScheduleRemark}
              onChange={(e) => setAddScheduleRemark(e.target.value)}
            />
            <Select
              style={{ minWidth: 130 }}
              value={addIsTempDialysis ? 'temp' : 'regular'}
              options={[
                { value: 'temp', label: '临时加透' },
                { value: 'regular', label: '普通排班' },
              ]}
              onChange={(v) => setAddIsTempDialysis(v === 'temp')}
            />
            <Button
              type="primary"
              onClick={handleAddSlot}
              disabled={!addPatientId || !addMachineId}
            >
              {addIsTempDialysis ? '添加临时加透' : '添加到本班次'}
            </Button>
          </Space>
          <div style={{ marginTop: 8, color: '#64748B', fontSize: 12 }}>
            可选机位已按患者隔离分区过滤，并排除本班次已占用机位；若当天人数超过可用机器数，请调整班次或先删除/改派冲突排班。
          </div>
        </Card>
      </Modal>

      <Modal
        title={slotHemoEditing ? `${slotHemoEditing.name} · 透析模式与备注` : '透析模式与备注'}
        open={slotHemoModalOpen}
        onCancel={() => {
          setSlotHemoModalOpen(false);
          setSlotHemoEditing(null);
          setSlotHemoScheduleDate(null);
        }}
        width={440}
        destroyOnClose
        footer={
          canSchedule ? (
            <Space>
              <Button onClick={appendHeparinToSlotHemo}>无肝素</Button>
              <Button type="primary" onClick={handleSaveSlotHemo}>
                保存
              </Button>
            </Space>
          ) : (
            <Button onClick={() => setSlotHemoModalOpen(false)}>关闭</Button>
          )
        }
      >
        <p style={{ color: '#64748B', fontSize: 12, marginBottom: 12 }}>
          透析模式（HD / HDF / HD+HP）与档案中的「腹透／血透」类别是不同概念；默认 HD、备注空。保存后写入本条排班；<strong>仅在上机当日</strong>同步至患者当前透析处方（提前排班请在上机日在透析处方中确认）。
        </p>
        <Form form={slotHemoForm} layout="vertical" disabled={!canSchedule}>
          <Form.Item name="modality" label="透析模式" rules={[{ required: true, message: '请选择透析模式' }]}>
            <Select options={HEMO_MODALITY_OPTIONS} placeholder="默认 HD" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="如无肝素、临时说明等（可空）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="本周患者调班"
        open={weekPatientAdjustOpen}
        onCancel={() => setWeekPatientAdjustOpen(false)}
        footer={null}
        width={920}
        destroyOnClose
      >
        <p style={{ color: '#64748B', fontSize: 12, marginBottom: 12 }}>
          用于临时换班、改机位或增删单次排班。在下方周历对应「日期 × 班次」中点击「患者排班」进行详细操作；亦可从本表直接跳转。
        </p>
        <Table
          size="small"
          rowKey={(r) => r.key}
          pagination={false}
          scroll={{ y: 420 }}
          dataSource={weekPatientOverviewRows}
          locale={{ emptyText: '本周暂无患者排班，可先「按档案生成本周」或直接在格子里添加。' }}
          columns={[
            {
              title: '日期',
              key: 'd',
              width: 120,
              render: (_, r) => (
                <span>
                  {r.weekdayLabel} {r.date.slice(5)}
                </span>
              ),
            },
            { title: '班次', dataIndex: 'shiftShort', key: 'shiftShort', width: 56 },
            {
              title: '患者',
              key: 'name',
              width: 120,
              render: (_, r) => (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openSlotHemoModal(r.slot, r.date)}>
                  {r.slot.name}
                </Button>
              ),
            },
            {
              title: '档案',
              key: 'rc',
              width: 56,
              render: (_, r) => patientRenalCategoryLabel(r.slot.patientRenalCategory),
            },
            {
              title: '透析模式',
              key: 'mode',
              width: 80,
              render: (_, r) => scheduleDialysisModeLabel(r.slot.dialysisMode),
            },
            {
              title: '档案机位',
              key: 'm',
              width: 120,
              render: (_, r) => r.slot.machineStation?.trim() ?? '',
            },
            {
              title: '备注',
              key: 'rm',
              ellipsis: true,
              render: (_, r) => r.slot.scheduleRemark ?? '—',
            },
            {
              title: '操作',
              key: 'go',
              width: 88,
              fixed: 'right' as const,
              render: (_, r) => (
                <Button
                  type="link"
                  size="small"
                  disabled={!canSchedule}
                  onClick={() => {
                    setWeekPatientAdjustOpen(false);
                    openCellModal(r.date, r.shiftKey);
                  }}
                >
                  去调整
                </Button>
              ),
            },
          ]}
        />
      </Modal>

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
