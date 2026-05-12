/**
 * 新建 / 编辑患者档案表单页
 * 主要作用：采集患者主数据与传染病初筛等信息，提交到患者 API。
 * 主要功能：分步或分组表单校验；创建成功后跳转；编辑模式回填（依路由）。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  DatePicker,
  Button,
  InputNumber,
  Checkbox,
  Space,
  message,
  Switch,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import ConsentDialysisImageUpload from '../../components/ConsentDialysisImageUpload/ConsentDialysisImageUpload';
import { patientsApi, type CreatePatientPayload } from '../../api/patients';
import { usersApi, type NursingStaffRow } from '../../api/users';
import vascularApi from '../../api/vascular';
import { useAuthStore } from '../../stores/authStore';
import {
  DIALYSIS_SCHEDULE_OPTIONS,
  DIALYSIS_SHIFT_OPTIONS,
  WEEKDAY_OPTIONS,
  isBiw5DialysisScheduleCode,
  serializeBiw5ScheduleNotes,
  serializeCustomCyclePlan,
  serializeWeeklyDayShiftsPlan,
  type DialysisShift,
} from '../../constants/dialysisSchedule';

type FormValues = {
  name: string;
  gender: 'M' | 'F';
  dob: Dayjs;
  dialysis_start_date: Dayjs;
  primary_diagnosis: string;
  present_illness?: string;
  past_history?: string;
  ckd_stage?: number | null;
  comorbidities?: string[];
  current_access_type?: 'none' | 'AVF' | 'AVG' | 'TCC' | 'NCC';
  isolation_zone?: CreatePatientPayload['isolation_zone'];
  id_card?: string;
  patient_identifier?: string;
  status?: 'active' | 'suspended' | 'hospitalized' | 'transferred' | 'transplanted' | 'deceased';
  phone?: string;
  family_contact_name?: string;
  family_contact_phone?: string;
  address?: string;
  consent_dialysis?: boolean;
  consent_dialysis_date?: Dayjs | null;
  dialysis_schedule_code?: string;
  dialysis_schedule_notes?: string;
  /** 隔日透析锚点 */
  dialysis_schedule_anchor_date?: Dayjs | null;
  /** 是否补充/手动调整透析时间规则说明 */
  dialysis_schedule_adjust?: boolean;
  custom_week1_days?: number[];
  custom_week1_shift?: DialysisShift;
  custom_week2_days?: number[];
  custom_week2_shift?: DialysisShift;
  weekly_dialysis_slots?: { weekday: number; shift: DialysisShift }[];
  biw5_swap_week_patterns?: boolean;
  /** 责任护士（本科室护士/护士长账号，表单校验必填） */
  responsible_nurse_id?: string;
  /** 知情同意书影像（必填，表单校验） */
  consent_dialysis_image?: UploadFile[];
};

export default function PatientCreatePage() {
  const navigate = useNavigate();
  const hasRole = useAuthStore(s => s.hasRole);
  const [loading, setLoading] = useState(false);
  const [nursingStaff, setNursingStaff] = useState<NursingStaffRow[]>([]);
  const [nursingStaffLoading, setNursingStaffLoading] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const watchName = Form.useWatch('name', form);
  const watchDob = Form.useWatch('dob', form);
  const watchDialysisStartDate = Form.useWatch('dialysis_start_date', form);
  const watchPrimaryDiagnosis = Form.useWatch('primary_diagnosis', form);
  const watchIsolationZone = Form.useWatch('isolation_zone', form);
  const watchConsentDialysis = Form.useWatch('consent_dialysis', form);
  const watchConsentDialysisDate = Form.useWatch('consent_dialysis_date', form);
  const watchDialysisScheduleCode = Form.useWatch('dialysis_schedule_code', form);
  const watchDialysisScheduleAdjust = Form.useWatch('dialysis_schedule_adjust', form);
  const watchDialysisScheduleNotes = Form.useWatch('dialysis_schedule_notes', form);
  const watchIdCard = Form.useWatch('id_card', form);
  const watchPhone = Form.useWatch('phone', form);
  const watchResponsibleNurseId = Form.useWatch('responsible_nurse_id', form);
  const watchConsentDialysisImage = Form.useWatch('consent_dialysis_image', form);

  useEffect(() => {
    if (!hasRole(['admin', 'doctor'])) {
      message.warning('仅管理员与医生可新建患者档案');
      navigate('/patients', { replace: true });
    }
  }, [hasRole, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNursingStaffLoading(true);
      try {
        const res = await usersApi.nursingStaff();
        if (cancelled) return;
        if (res.data.code === 200 && Array.isArray(res.data.data)) {
          setNursingStaff(res.data.data);
        }
      } catch {
        if (!cancelled) message.warning('护理人员列表加载失败，责任护士可稍后在患者详情中补选');
      } finally {
        if (!cancelled) setNursingStaffLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nurseSelectOptions = useMemo(
    () => nursingStaff.map(n => ({
      value: n.id,
      label: `${n.real_name}（${n.role === 'head_nurse' ? '护士长' : '护士'}）`,
    })),
    [nursingStaff],
  );

  const onFinish = async (values: FormValues) => {
    setLoading(true);
    try {
      const familyName = values.family_contact_name?.trim();
      const familyPhone = values.family_contact_phone?.trim();
      const payload: CreatePatientPayload = {
        name: values.name.trim(),
        gender: values.gender,
        dob: values.dob.format('YYYY-MM-DD'),
        dialysis_start_date: values.dialysis_start_date.format('YYYY-MM-DD'),
        primary_diagnosis: values.primary_diagnosis.trim(),
        present_illness: values.present_illness?.trim() || undefined,
        past_history: values.past_history?.trim() || undefined,
        isolation_zone: values.isolation_zone || 'normal',
        consent_dialysis: values.consent_dialysis ?? false,
        consent_dialysis_date: values.consent_dialysis && values.consent_dialysis_date
          ? values.consent_dialysis_date.format('YYYY-MM-DD')
          : null,
        responsible_nurse_id: values.responsible_nurse_id as string,
      };

      if (values.id_card?.trim()) payload.id_card = values.id_card.trim();
      if (values.patient_identifier?.trim()) payload.patient_identifier = values.patient_identifier.trim();
      if (values.phone?.trim()) payload.phone = values.phone.trim();
      if (values.status) payload.status = values.status;
      if (values.address?.trim()) payload.address = values.address.trim();
      if (values.ckd_stage != null && values.ckd_stage >= 1 && values.ckd_stage <= 5) {
        payload.ckd_stage = values.ckd_stage;
      }
      if (values.comorbidities && values.comorbidities.length > 0) {
        payload.comorbidities = values.comorbidities.map(s => s.trim()).filter(Boolean);
      }
      if (familyName || familyPhone) {
        payload.family_contact = {
          ...(familyName ? { name: familyName } : {}),
          ...(familyPhone ? { phone: familyPhone } : {}),
        };
      }

      const code = values.dialysis_schedule_code?.trim();
      if (code) payload.dialysis_schedule_code = code;
      let notes: string | undefined = values.dialysis_schedule_notes?.trim() || undefined;
      if (code === 'weekly_day_shifts') {
        const rows = values.weekly_dialysis_slots ?? [];
        const picked = rows.filter(
          (r): r is { weekday: number; shift: DialysisShift } =>
            r != null
            && Number.isInteger(r.weekday)
            && r.weekday >= 0
            && r.weekday <= 6
            && ['morning', 'afternoon', 'evening'].includes(String(r.shift)),
        );
        if (!picked.length) {
          message.error('请至少保留一行并选择周几与时段');
          setLoading(false);
          return;
        }
        const lastByWd = new Map<number, DialysisShift>();
        for (const r of picked) {
          lastByWd.set(r.weekday, r.shift);
        }
        const days = [...lastByWd.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([wd, shift]) => ({ wd, shift }));
        notes = serializeWeeklyDayShiftsPlan(days);
      } else if (code === 'custom_cycle') {
        const week1Days = values.custom_week1_days ?? [];
        const week2Days = values.custom_week2_days ?? [];
        if (!week1Days.length || !values.custom_week1_shift || !week2Days.length || !values.custom_week2_shift) {
          message.error('自定方案需完整选择第一周、第二周的透析日和时段');
          setLoading(false);
          return;
        }
        notes = serializeCustomCyclePlan({
          week1: { weekdays: week1Days, shift: values.custom_week1_shift },
          week2: { weekdays: week2Days, shift: values.custom_week2_shift },
        });
      } else if (code && isBiw5DialysisScheduleCode(code)) {
        const swap = Boolean(values.biw5_swap_week_patterns);
        const memo = values.dialysis_schedule_notes?.trim() || '';
        notes = swap || memo
          ? serializeBiw5ScheduleNotes({ swapOddEvenWeeks: swap || undefined, memo: memo || undefined })
          : undefined;
      }
      if (notes) payload.dialysis_schedule_notes = notes;
      if (code === 'qod' && values.dialysis_schedule_anchor_date) {
        payload.dialysis_schedule_anchor_date = values.dialysis_schedule_anchor_date.format('YYYY-MM-DD');
      }

      const consentFiles = (values.consent_dialysis_image ?? [])
        .map((f) => f.originFileObj)
        .filter((f): f is NonNullable<UploadFile['originFileObj']> => f != null);
      if (!consentFiles.length) {
        message.error('请上传知情同意书影像');
        setLoading(false);
        return;
      }

      const res = await patientsApi.create(payload);
      if (res.data.code === 201 && res.data.data?.id) {
        const newPatientId = res.data.data.id;

        try {
          const up = await patientsApi.uploadConsentDialysisImage(newPatientId, consentFiles);
          if (up.data.code !== 200) {
            message.warning(up.data.message || '知情同意书图片上传失败，可在患者详情中重新上传');
          }
        } catch {
          message.warning('知情同意书图片上传失败，可在患者详情中重新上传');
        }

        // 同步创建血管通路记录（与患者详情编辑档案保持一致）
        const selectedAccessType = values.current_access_type || 'none';
        if (selectedAccessType !== 'none') {
          try {
            await vascularApi.create(newPatientId, {
              access_type: selectedAccessType.toLowerCase() as 'avf' | 'avg' | 'tcc' | 'ncc',
              location: '待完善',
              established_date: dayjs().format('YYYY-MM-DD'),
              notes: '由新建患者档案时快速录入，请在血管通路管理中完善详细信息',
            });
          } catch (e) {
            const maybeResponse = e as { response?: { data?: { message?: string }; status?: number } };
            message.error(
              maybeResponse?.response?.data?.message
                || (maybeResponse?.response?.status
                  ? `患者档案已创建，但通路同步失败（HTTP ${maybeResponse.response.status}）`
                  : '患者档案已创建，但通路同步失败'),
            );
          }
        }

        message.success(res.data.message || '患者档案创建成功');
        navigate(`/patients/${newPatientId}`, { replace: true });
      } else {
        message.error(res.data.message || '创建失败');
      }
    } catch {
      // 错误已由 axios 拦截器提示
    } finally {
      setLoading(false);
    }
  };

  const reminderItems = [
    ...(!watchName ? [{
      key: 'name-missing',
      level: 'medium' as const,
      title: '患者姓名未填写',
      desc: '请先完善姓名后再保存档案。',
    }] : []),
    ...(!watchPrimaryDiagnosis?.trim() ? [{
      key: 'diagnosis-missing',
      level: 'medium' as const,
      title: '主要诊断未填写',
      desc: '主要诊断是后续处方与随访管理的关键字段。',
    }] : []),
    ...(watchDob && dayjs().diff(watchDob, 'year') < 18 ? [{
      key: 'young-age',
      level: 'high' as const,
      title: '患者年龄小于 18 岁',
      desc: '请确认日期录入是否正确，并按特殊人群流程评估。',
    }] : []),
    ...(watchDialysisStartDate && watchDialysisStartDate.isAfter(dayjs(), 'day') ? [{
      key: 'future-dialysis-date',
      level: 'high' as const,
      title: '开始透析日期晚于今天',
      desc: '开始透析日期不应为未来日期，请核对后再提交。',
    }] : []),
    ...(!watchConsentDialysis ? [{
      key: 'consent-not-signed',
      level: 'high' as const,
      title: '未勾选透析知情同意书',
      desc: '请确认是否已签署透析知情同意书；未签署将影响后续透析流程。',
    }] : []),
    ...(watchConsentDialysis && !watchConsentDialysisDate ? [{
      key: 'consent-date-missing',
      level: 'medium' as const,
      title: '透析知情同意书签署日期未填写',
      desc: '已勾选同意书后建议补全签署日期，便于审计追踪。',
    }] : []),
    ...((watchIsolationZone === 'hbv' || watchIsolationZone === 'hcv') ? [{
      key: 'isolation-zone-positive',
      level: 'high' as const,
      title: '患者已分配至感染隔离区',
      desc: '请确认传染病筛查结果与分区一致，并在后续排班中使用对应专机。',
    }] : []),
    ...(!watchIdCard?.trim() || !watchPhone?.trim() ? [{
      key: 'identity-contact-missing',
      level: 'info' as const,
      title: '身份证号或手机号未完善',
      desc: '建议补全关键身份与联系方式，便于随访通知与档案追踪。',
    }] : []),
    ...(watchDialysisScheduleCode === 'other' && !watchDialysisScheduleNotes?.trim() ? [{
      key: 'schedule-other-no-notes',
      level: 'medium' as const,
      title: '透析时间选择为「其他」但未填写说明',
      desc: '请在补充说明中写明具体透析时间安排，便于排班与沟通。',
    }] : []),
    ...(!watchResponsibleNurseId ? [{
      key: 'nurse-missing',
      level: 'high' as const,
      title: '未选择责任护士',
      desc: '责任护士为必填项，用于日常宣教与随访协调对接。',
    }] : []),
    ...(!watchConsentDialysisImage?.some((f) => f.originFileObj) ? [{
      key: 'consent-image-missing',
      level: 'high' as const,
      title: '未上传知情同意书影像',
      desc: '请上传已签署的透析知情同意书图片（可多张），保存后存档备查。',
    }] : []),
  ];

  const reminderStyle: Record<'high' | 'medium' | 'info', { label: string; color: string; bg: string; border: string }> = {
    high: { label: '高优先', color: '#BE123C', bg: '#FFF1F2', border: '#FECDD3' },
    medium: { label: '中优先', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
    info: { label: '提示', color: '#0369A1', bg: '#F0F9FF', border: '#BAE6FD' },
  };

  return (
    <PageShell
      subtitle="新建患者档案"
      extra={
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/patients')}>
          返回列表
        </Button>
      }
    >
      <Card
        size="small"
        title="⚠️ 重要信息提醒与预警"
        style={{ border: '1px solid #DBEAFE', maxWidth: 920, marginBottom: 14 }}
        styles={{ header: { background: '#FAFCFF' } }}
      >
        {reminderItems.length === 0 ? (
          <div style={{ padding: '6px 0', color: '#059669', fontSize: 13.5, lineHeight: 1.8 }}>
            当前关键信息完整，未发现明显录入风险，可继续保存。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reminderItems.map(item => {
              const style = reminderStyle[item.level];
              return (
                <div
                  key={item.key}
                  style={{
                    border: `1px solid ${style.border}`,
                    background: style.bg,
                    borderRadius: 8,
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: style.color, fontWeight: 700 }}>{style.label}</span>
                    <span style={{ fontSize: 14, color: '#0D1B3E', fontWeight: 600 }}>{item.title}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.7 }}>{item.desc}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card style={{ border: '1px solid #DBEAFE', maxWidth: 920 }} styles={{ header: { background: '#FAFCFF' } }}>
        <Form<FormValues>
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            gender: 'M',
            current_access_type: 'none',
            isolation_zone: 'normal',
            consent_dialysis: false,
            dialysis_schedule_adjust: false,
            custom_week1_shift: 'morning',
            custom_week2_shift: 'morning',
            biw5_swap_week_patterns: false,
            consent_dialysis_image: [],
          }}
        >
          <div className="grid-2" style={{ gap: '0 24px' }}>
            <div style={{ gridColumn: 'span 2', fontSize: 13, color: '#64748B', marginBottom: 4 }}>
              抗凝默认方案请在患者详情「编辑患者档案」中维护；保存档案时会同步至当前透析处方。处方页可临时调整用药，保存档案将再次覆盖处方中的抗凝项。
            </div>
            <Form.Item
              name="name"
              label="姓名"
              rules={[{ required: true, message: '请输入姓名' }]}
            >
              <Input placeholder="患者姓名" maxLength={50} />
            </Form.Item>
            <Form.Item
              name="patient_identifier"
              label="患者ID（真实ID）"
              rules={[{ required: true, message: '请填写患者真实ID' }]}
            >
              <Input placeholder="如：HD-2026-001" maxLength={64} />
            </Form.Item>
            <Form.Item
              name="gender"
              label="性别"
              rules={[{ required: true, message: '请选择性别' }]}
            >
              <Select
                options={[
                  { value: 'M', label: '男' },
                  { value: 'F', label: '女' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="dob"
              label="出生日期"
              rules={[{ required: true, message: '请选择出生日期' }]}
            >
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item
              name="dialysis_start_date"
              label="开始透析日期"
              rules={[{ required: true, message: '请选择开始透析日期' }]}
            >
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item
              name="primary_diagnosis"
              label="主要诊断"
              rules={[{ required: true, message: '请输入主要诊断' }]}
              style={{ gridColumn: 'span 2' }}
            >
              <Input placeholder="如：糖尿病肾病" maxLength={100} />
            </Form.Item>
            <Form.Item
              name="present_illness"
              label="现病史（可选）"
              style={{ gridColumn: 'span 2' }}
            >
              <Input.TextArea rows={3} placeholder="请输入本次透析相关现病史摘要" maxLength={500} showCount />
            </Form.Item>
            <Form.Item
              name="past_history"
              label="既往史（可选）"
              style={{ gridColumn: 'span 2' }}
            >
              <Input.TextArea rows={3} placeholder="请输入既往史（慢病、手术史、过敏史等）" maxLength={500} showCount />
            </Form.Item>
            <Form.Item name="ckd_stage" label="CKD 分期（可选）">
              <InputNumber min={1} max={5} placeholder="1–5" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="comorbidities" label="合并症（可选）">
              <Select mode="tags" placeholder="输入后回车添加" tokenSeparators={[',']} />
            </Form.Item>
            <Form.Item
              name="current_access_type"
              label="血管通路（当前）"
              tooltip="用于患者档案与通路页联动；详细通路档案请在“血管通路管理”维护"
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
              name="dialysis_schedule_code"
              label="透析时间"
              tooltip="预设排班模式；若与科室实际排班不一致，请开启下方「补充说明」并手写约定。"
            >
              <Select
                allowClear
                placeholder="请选择透析频次与时段"
                options={[...DIALYSIS_SCHEDULE_OPTIONS]}
              />
            </Form.Item>
            {isBiw5DialysisScheduleCode(watchDialysisScheduleCode) ? (
              <Form.Item
                name="biw5_swap_week_patterns"
                label="两周五次 · 奇偶周对调"
                valuePropName="checked"
                style={{ gridColumn: 'span 2' }}
                tooltip="默认：奇 ISO 周按周一、四、六；偶周按周二、五。勾选后对调（奇周周二、五；偶周周一、四、六）。"
              >
                <Checkbox>对调两周透析日模板（与 ISO 周奇偶的对应关系互换）</Checkbox>
              </Form.Item>
            ) : null}
            <Form.Item
              name="dialysis_schedule_adjust"
              label="补充/调整规则"
              valuePropName="checked"
              tooltip="开启后可手写与预设不一致的约定（如换机位、节假日调整等）"
            >
              <Switch checkedChildren="已开启" unCheckedChildren="关闭" />
            </Form.Item>
            {(watchDialysisScheduleAdjust || watchDialysisScheduleCode === 'other' || isBiw5DialysisScheduleCode(watchDialysisScheduleCode)) ? (
              <Form.Item
                name="dialysis_schedule_notes"
                label="透析时间说明（可手动输入）"
                style={{ gridColumn: 'span 2' }}
                rules={watchDialysisScheduleCode === 'other'
                  ? [{ required: true, message: '选择「其他」时请填写具体透析时间说明' }]
                  : undefined}
              >
                <Input.TextArea
                  rows={3}
                  placeholder="例如：与护士长约定每周二、四、六下午，节假日按通知调整；或写明与上方预设不一致之处"
                  maxLength={800}
                  showCount
                />
              </Form.Item>
            ) : null}
            {watchDialysisScheduleCode === 'weekly_day_shifts' ? (
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>
                  每周按下方规则重复：每个透析日单独选择周几与时段（同一周几多行时以后一行为准）。
                </div>
                <Form.List name="weekly_dialysis_slots" initialValue={[{ weekday: 1, shift: 'morning' }]}>
                  {(fields, { add, remove }) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {fields.map(({ key, name, ...restField }) => (
                        <Space key={key} wrap align="baseline">
                          <Form.Item
                            {...restField}
                            name={[name, 'weekday']}
                            rules={[{ required: true, message: '请选择周几' }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Select
                              options={[...WEEKDAY_OPTIONS]}
                              placeholder="周几"
                              style={{ width: 120 }}
                            />
                          </Form.Item>
                          <Form.Item
                            {...restField}
                            name={[name, 'shift']}
                            rules={[{ required: true, message: '请选择时段' }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Select options={DIALYSIS_SHIFT_OPTIONS} placeholder="时段" style={{ width: 110 }} />
                          </Form.Item>
                          <Button
                            type="link"
                            danger
                            disabled={fields.length <= 1}
                            onClick={() => remove(name)}
                          >
                            删除
                          </Button>
                        </Space>
                      ))}
                      <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ weekday: undefined, shift: 'morning' })}>
                        添加透析日
                      </Button>
                    </div>
                  )}
                </Form.List>
              </div>
            ) : null}
            {watchDialysisScheduleCode === 'custom_cycle' ? (
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>
                  自定方案按自然周两周一轮生成排班：第一周、第二周分别选择周几和上午/下午/晚上。
                </div>
                <div className="grid-2" style={{ gap: '0 16px' }}>
                  <Form.Item
                    name="custom_week1_days"
                    label="第一周透析日"
                    rules={[{ required: true, message: '请选择第一周透析日' }]}
                  >
                    <Select mode="multiple" options={[...WEEKDAY_OPTIONS]} placeholder="选择周几" />
                  </Form.Item>
                  <Form.Item
                    name="custom_week1_shift"
                    label="第一周时段"
                    rules={[{ required: true, message: '请选择第一周时段' }]}
                  >
                    <Select options={DIALYSIS_SHIFT_OPTIONS} />
                  </Form.Item>
                  <Form.Item
                    name="custom_week2_days"
                    label="第二周透析日"
                    rules={[{ required: true, message: '请选择第二周透析日' }]}
                  >
                    <Select mode="multiple" options={[...WEEKDAY_OPTIONS]} placeholder="选择周几" />
                  </Form.Item>
                  <Form.Item
                    name="custom_week2_shift"
                    label="第二周时段"
                    rules={[{ required: true, message: '请选择第二周时段' }]}
                  >
                    <Select options={DIALYSIS_SHIFT_OPTIONS} />
                  </Form.Item>
                </div>
              </div>
            ) : null}
            {watchDialysisScheduleCode === 'qod' ? (
              <Form.Item
                name="dialysis_schedule_anchor_date"
                label="隔日锚点日期"
                tooltip="用于排班系统自动推算隔日透析日；通常为最近一次透析日或科室约定的起始日。"
                rules={[{ required: true, message: '请选择隔日锚点日期' }]}
                style={{ gridColumn: 'span 2' }}
              >
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            ) : null}
            <Form.Item name="isolation_zone" label="隔离分区">
              <Select
                options={[
                  { value: 'normal', label: '普通区' },
                  { value: 'hbv', label: '乙肝隔离区' },
                  { value: 'hcv', label: '丙肝隔离区' },
                  { value: 'observation', label: '观察区' },
                  { value: 'last_shift', label: '末班专区' },
                ]}
              />
            </Form.Item>
            <Form.Item name="status" label="透析状态" initialValue="active">
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
            <Form.Item name="id_card" label="身份证号（可选，加密存储）">
              <Input placeholder="选填" maxLength={18} />
            </Form.Item>
            <Form.Item name="phone" label="手机号（可选，加密存储）">
              <Input placeholder="选填" maxLength={20} />
            </Form.Item>
            <Form.Item name="family_contact_name" label="家属联系人姓名（可选）">
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item name="family_contact_phone" label="家属联系电话（可选）">
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="address" label="家庭住址（可选）" style={{ gridColumn: 'span 2' }}>
              <Input.TextArea rows={2} placeholder="选填" />
            </Form.Item>
            <Form.Item
              name="responsible_nurse_id"
              label="责任护士"
              style={{ gridColumn: 'span 2' }}
              rules={[{ required: true, message: '请选择责任护士' }]}
              tooltip="用于日常宣教、随访协调等管理对接；选项来自本科室已启用的护士/护士长账号，与透析排班机位无绑定。"
            >
              <Select
                showSearch
                placeholder="请选择本科室护理人员"
                optionFilterProp="label"
                options={nurseSelectOptions}
                loading={nursingStaffLoading}
              />
            </Form.Item>
          </div>

          <Form.Item label="透析知情同意">
            <Space direction="vertical" size={8}>
              <Form.Item name="consent_dialysis" valuePropName="checked" noStyle>
                <Checkbox>已签署透析知情同意书</Checkbox>
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.consent_dialysis !== cur.consent_dialysis}>
                {({ getFieldValue }) =>
                  getFieldValue('consent_dialysis') ? (
                    <Form.Item name="consent_dialysis_date" label="签署日期" style={{ marginBottom: 0 }}>
                      <DatePicker format="YYYY-MM-DD" />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
              <Form.Item
                name="consent_dialysis_image"
                label="知情同意书影像"
                style={{ marginBottom: 0 }}
                rules={[
                  {
                    validator: (_, value) => {
                      const list = value as UploadFile[] | undefined;
                      if (!list?.some((f) => f.originFileObj)) {
                        return Promise.reject(new Error('请上传知情同意书影像'));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
                valuePropName="fileList"
                getValueFromEvent={(e) => {
                  if (Array.isArray(e)) return e;
                  return e?.fileList ?? [];
                }}
              >
                <ConsentDialysisImageUpload maxCount={15} triggerLabel="上传" />
              </Form.Item>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: -4, marginBottom: 0 }}>
                必填；点击上传可选择本地相册/文件或拍照，1～15 张，单张不超过 5MB；保存后仅授权医护在患者档案中查看。
              </div>
            </Space>
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                保存并进入档案
              </Button>
              <Button onClick={() => navigate('/patients')}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </PageShell>
  );
}
