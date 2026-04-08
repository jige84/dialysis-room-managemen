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
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import ConsentDialysisImageUpload from '../../components/ConsentDialysisImageUpload/ConsentDialysisImageUpload';
import { patientsApi, type CreatePatientPayload } from '../../api/patients';
import { usersApi, type NursingStaffRow } from '../../api/users';
import vascularApi from '../../api/vascular';
import { useAuthStore } from '../../stores/authStore';
import { DIALYSIS_SCHEDULE_OPTIONS } from '../../constants/dialysisSchedule';

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
  /** 责任护士（本科室护士/护士长账号，表单校验必填） */
  responsible_nurse_id?: string;
  /** 知情同意书影像（必填，表单校验） */
  consent_dialysis_image?: UploadFile[];
};

// 这些代码定义了一些常量数组，用于后续生成患者信息表单的默认选项或模拟数据。

// FAMILY_NAMES 定义了常见的中文姓氏，用于构造虚拟姓名的姓。
const FAMILY_NAMES = ['赵', '钱', '孙', '李', '周', '吴', '郑', '王', '刘', '陈', '杨', '黄'];

// GIVEN_NAME_PARTS 定义了常见的中文名字中的名字部分，用于组合生成姓名。
const GIVEN_NAME_PARTS = ['伟', '芳', '娜', '敏', '静', '磊', '洋', '强', '军', '婷', '勇', '倩', '晨', '博'];

// PRIMARY_DIAGNOSIS_OPTIONS 是基础肾病诊断的选项列表，供下拉框选择或数据生成使用。
const PRIMARY_DIAGNOSIS_OPTIONS = [
  '慢性肾小球肾炎',
  '糖尿病肾病',
  '高血压肾损害',
  '多囊肾',
  '梗阻性肾病',
  '狼疮性肾炎',
];
const PRESENT_ILLNESS_TEMPLATES = [
  '近3个月乏力、纳差，夜尿增多，双下肢间断水肿，门诊复查肌酐持续升高，评估后进入维持性血液透析。',
  '反复恶心、食欲下降伴活动后气促1月余，化验提示尿毒症相关指标异常，规律透析后症状较前缓解。',
  '近期体重波动较大，透析间期容量负荷偏高，伴轻度胸闷，调整干体重与超滤策略后症状改善。',
];
const PAST_HISTORY_TEMPLATES = [
  '既往有高血压病史多年，长期口服降压药；否认结核、肝炎等传染病史。',
  '既往2型糖尿病病史，间断胰岛素治疗；无重大外伤手术史，无药物过敏史。',
  '既往冠心病病史，规律心内科随访；否认输血不良反应及明显家族遗传病史。',
];

// COMORBIDITY_OPTIONS 定义了常见合并症的字符串数组，可用于表单复选框等展示。
const COMORBIDITY_OPTIONS = ['高血压', '2型糖尿病', '冠心病', '高尿酸血症', '甲状旁腺功能亢进', '贫血'];

// CITY_DISTRICTS 是常用的地理区域名称，用于随机生成地址或下拉框选项。
const CITY_DISTRICTS = ['涉县井店镇', '涉县更乐镇', '涉县河南店镇', '涉县辽城乡', '涉县西达镇'];

// AREA_CODES 存储了一些地区行政区划代码，可用于生成身份证号码。
const AREA_CODES = ['130426', '130421', '130427', '130400', '130431'];

// ISOLATION_ZONES 定义了隔离分区类型，比如普通区(normal)、乙肝区(hbv)、丙肝区(hcv)等。
// 这里指定类型为 NonNullable<FormValues['isolation_zone']> 的数组。
const ISOLATION_ZONES: Array<NonNullable<FormValues['isolation_zone']>> = ['normal', 'normal', 'normal', 'hbv', 'hcv'];

const DIALYSIS_SCHEDULE_CODES = DIALYSIS_SCHEDULE_OPTIONS.map(o => o.value);

const pickOne = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const randomDateBetween = (start: Dayjs, end: Dayjs) => {
  const startTs = start.valueOf();
  const endTs = end.valueOf();
  const ts = randomInt(startTs, endTs);
  return dayjs(ts);
};

const buildVirtualName = () => {
  const family = pickOne(FAMILY_NAMES);
  const givenLength = Math.random() > 0.65 ? 2 : 1;
  let given = '';
  for (let i = 0; i < givenLength; i += 1) {
    given += pickOne(GIVEN_NAME_PARTS);
  }
  return `${family}${given}`;
};

const buildVirtualPhone = () => `1${randomInt(30, 99)}${randomInt(1000, 9999)}${randomInt(1000, 9999)}`;

const buildVirtualIdCard = (birthDate: Dayjs, gender: FormValues['gender']) => {
  const areaCode = pickOne(AREA_CODES);
  const birth = birthDate.format('YYYYMMDD');
  const sequenceBase = randomInt(0, 499) * 2;
  const sequence = (gender === 'M' ? sequenceBase + 1 : sequenceBase)
    .toString()
    .padStart(3, '0');
  const base17 = `${areaCode}${birth}${sequence}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkMap = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = base17.split('').reduce((acc, cur, idx) => acc + Number(cur) * weights[idx], 0);
  const checkCode = checkMap[sum % 11];
  return `${base17}${checkCode}`;
};

const buildComorbidities = () => {
  const count = randomInt(1, 3);
  const pool = [...COMORBIDITY_OPTIONS];
  const result: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const idx = randomInt(0, pool.length - 1);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
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

  const fillVirtualPatient = () => {
    const gender: FormValues['gender'] = Math.random() > 0.5 ? 'M' : 'F';
    const dob = randomDateBetween(dayjs('1948-01-01'), dayjs('2005-12-31'));
    const adultDate = dob.add(18, 'year');
    const minDialysisDate = adultDate.isAfter(dayjs('2012-01-01')) ? adultDate : dayjs('2012-01-01');
    const dialysisStartDate = randomDateBetween(
      minDialysisDate,
      dayjs().subtract(30, 'day'),
    );
    const consentDialysis = Math.random() > 0.15;
    const consentDate = consentDialysis
      ? randomDateBetween(dialysisStartDate, dayjs())
      : null;

    form.setFieldsValue({
      name: buildVirtualName(),
      gender,
      dob,
      dialysis_start_date: dialysisStartDate,
      primary_diagnosis: pickOne(PRIMARY_DIAGNOSIS_OPTIONS),
      present_illness: pickOne(PRESENT_ILLNESS_TEMPLATES),
      past_history: pickOne(PAST_HISTORY_TEMPLATES),
      ckd_stage: randomInt(4, 5),
      comorbidities: buildComorbidities(),
      isolation_zone: pickOne(ISOLATION_ZONES),
      current_access_type: 'none',
      id_card: buildVirtualIdCard(dob, gender),
      phone: buildVirtualPhone(),
      family_contact_name: buildVirtualName(),
      family_contact_phone: buildVirtualPhone(),
      address: `${pickOne(CITY_DISTRICTS)}${randomInt(1, 12)}号`,
      consent_dialysis: consentDialysis,
      consent_dialysis_date: consentDate,
      dialysis_schedule_code: pickOne(DIALYSIS_SCHEDULE_CODES),
      dialysis_schedule_adjust: Math.random() > 0.7,
      dialysis_schedule_notes: Math.random() > 0.5 ? '与排班室约定为固定机位，节假日按科室通知调整。' : undefined,
      responsible_nurse_id: nursingStaff.length ? pickOne(nursingStaff).id : undefined,
      consent_dialysis_image: [],
    });
    message.success('已生成虚拟数据；责任护士已随机指定，知情同意书影像仍需您上传后保存。');
  };

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
      if (values.phone?.trim()) payload.phone = values.phone.trim();
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
      const notes = values.dialysis_schedule_notes?.trim();
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
            <Form.Item
              name="dialysis_schedule_adjust"
              label="补充/调整规则"
              valuePropName="checked"
              tooltip="开启后可手写与预设不一致的约定（如换机位、节假日调整等）"
            >
              <Switch checkedChildren="已开启" unCheckedChildren="关闭" />
            </Form.Item>
            {(watchDialysisScheduleAdjust || watchDialysisScheduleCode === 'other') ? (
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
              <Button onClick={fillVirtualPatient}>生成虚拟数据</Button>
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
