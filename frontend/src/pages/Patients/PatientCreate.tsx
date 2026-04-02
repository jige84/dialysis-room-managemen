/**
 * 新建 / 编辑患者档案表单页
 * 主要作用：采集患者主数据与传染病初筛等信息，提交到患者 API。
 * 主要功能：分步或分组表单校验；创建成功后跳转；编辑模式回填（依路由）。
 */
import { useEffect, useState } from 'react';
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
} from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell/PageShell';
import { patientsApi, type CreatePatientPayload } from '../../api/patients';
import vascularApi from '../../api/vascular';
import { useAuthStore } from '../../stores/authStore';

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
  dialysis_mode?: string;
  current_access_type?: 'none' | 'AVF' | 'AVG' | 'TCC' | 'NCC';
  isolation_zone?: CreatePatientPayload['isolation_zone'];
  id_card?: string;
  phone?: string;
  family_contact_name?: string;
  family_contact_phone?: string;
  address?: string;
  consent_dialysis?: boolean;
  consent_dialysis_date?: Dayjs | null;
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

// DIALYSIS_MODES 列举了不同的透析方式代码：
// HD：血液透析；PD：腹膜透析；OTHER：其他方式。
const DIALYSIS_MODES: Array<FormValues['dialysis_mode']> = ['HD', 'HD', 'HD', 'PD', 'OTHER'];

// ISOLATION_ZONES 定义了隔离分区类型，比如普通区(normal)、乙肝区(hbv)、丙肝区(hcv)等。
// 这里指定类型为 NonNullable<FormValues['isolation_zone']> 的数组。
const ISOLATION_ZONES: Array<NonNullable<FormValues['isolation_zone']>> = ['normal', 'normal', 'normal', 'hbv', 'hcv'];

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
  const [form] = Form.useForm<FormValues>();
  const watchName = Form.useWatch('name', form);
  const watchDob = Form.useWatch('dob', form);
  const watchDialysisStartDate = Form.useWatch('dialysis_start_date', form);
  const watchPrimaryDiagnosis = Form.useWatch('primary_diagnosis', form);
  const watchIsolationZone = Form.useWatch('isolation_zone', form);
  const watchConsentDialysis = Form.useWatch('consent_dialysis', form);
  const watchConsentDialysisDate = Form.useWatch('consent_dialysis_date', form);
  const watchIdCard = Form.useWatch('id_card', form);
  const watchPhone = Form.useWatch('phone', form);

  useEffect(() => {
    if (!hasRole(['admin', 'doctor'])) {
      message.warning('仅管理员与医生可新建患者档案');
      navigate('/patients', { replace: true });
    }
  }, [hasRole, navigate]);

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
      dialysis_mode: pickOne(DIALYSIS_MODES),
      isolation_zone: pickOne(ISOLATION_ZONES),
      current_access_type: 'none',
      id_card: buildVirtualIdCard(dob, gender),
      phone: buildVirtualPhone(),
      family_contact_name: buildVirtualName(),
      family_contact_phone: buildVirtualPhone(),
      address: `${pickOne(CITY_DISTRICTS)}${randomInt(1, 12)}号`,
      consent_dialysis: consentDialysis,
      consent_dialysis_date: consentDate,
    });
    message.success('已生成一份虚拟患者数据，请核对后保存');
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
        dialysis_mode: values.dialysis_mode || 'HD',
        isolation_zone: values.isolation_zone || 'normal',
        consent_dialysis: values.consent_dialysis ?? false,
        consent_dialysis_date: values.consent_dialysis && values.consent_dialysis_date
          ? values.consent_dialysis_date.format('YYYY-MM-DD')
          : null,
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

      const res = await patientsApi.create(payload);
      if (res.data.code === 201 && res.data.data?.id) {
        const newPatientId = res.data.data.id;

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
            dialysis_mode: 'HD',
            current_access_type: 'none',
            isolation_zone: 'normal',
            consent_dialysis: false,
          }}
        >
          <div className="grid-2" style={{ gap: '0 24px' }}>
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
            <Form.Item name="dialysis_mode" label="透析方式">
              <Select
                options={[
                  { value: 'HD', label: '血液透析' },
                  { value: 'PD', label: '腹膜透析' },
                  { value: 'OTHER', label: '其他' },
                ]}
              />
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
