/**
 * 上线前关键链路冒烟：alerts / reports / schedule / devices
 * 需：后端已启动、数据库已迁移且种子用户存在。
 * 运行：cd backend && npm run test:smoke-readiness
 *
 * 环境变量：
 *   PORT（默认 3080）
 *   SMOKE_PASSWORD（默认 Shangu@2026）
 */
require('dotenv').config();

const base = `http://127.0.0.1:${process.env.PORT || 3080}`;

function todayParts() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    weekStart: mondayKey(now),
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function mondayKey(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - (day - 1));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

async function login(username, password) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await response.json().catch(() => ({}));
  return {
    status: response.status,
    code: json.code,
    message: json.message,
    token: json.data?.token || null,
  };
}

function authHeaders(token, contentType = 'application/json') {
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': contentType }
    : { 'Content-Type': contentType };
}

async function getJson(path, token) {
  const response = await fetch(`${base}${path}`, { headers: authHeaders(token) });
  const json = await response.json().catch(() => ({}));
  return {
    path,
    status: response.status,
    code: json.code,
    ok: response.status === 200 && json.code === 200,
    data: json.data,
    message: json.message,
  };
}

async function postJson(path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body || {}),
  });
  const json = await response.json().catch(() => ({}));
  const codeOk = json.code === 200 || json.code === 201;
  return {
    path,
    status: response.status,
    code: json.code,
    ok: response.ok && codeOk,
    data: json.data,
    message: json.message,
  };
}

async function getBinary(path, token) {
  const response = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const arrayBuffer = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
  return {
    path,
    status: response.status,
    ok: response.status === 200 && arrayBuffer.byteLength > 0,
    contentType: response.headers.get('content-type') || '',
    size: arrayBuffer.byteLength,
  };
}

function printResult(label, pass, detail) {
  console.log(`${pass ? '✓' : '✗'} ${label}: ${detail}`);
}

(async () => {
  const password = process.env.SMOKE_PASSWORD || 'Shangu@2026';
  const admin = await login('renjige', password);
  const doctor = await login('doctor01', password);
  const head = await login('yangchen', password);

  console.log('登录探测:', {
    admin: !!admin.token,
    doctor01: !!doctor.token,
    head_nurse: !!head.token,
  });

  if (!admin.token || !doctor.token) {
    console.error('缺少关键测试账号，无法继续冒烟');
    process.exit(1);
  }

  const { year, month, weekStart } = todayParts();
  const rows = [];

  rows.push({ label: 'alerts summary', ...(await getJson('/api/alerts/summary', doctor.token)) });
  rows.push({ label: 'alerts list', ...(await getJson('/api/alerts?status=active&page_size=5', doctor.token)) });
  rows.push({ label: 'alerts run-checks', ...(await postJson('/api/alerts/run-checks', admin.token, {})) });

  const qcGet = await getJson(`/api/reports/qc-upload/${year}/${month}`, doctor.token);
  rows.push({ label: 'reports get qc-upload', ...qcGet, ok: qcGet.status === 200 && qcGet.code === 200 });

  if (!qcGet.data && (head.token || admin.token)) {
    const initRes = await postJson(`/api/reports/qc-upload/${year}/${month}/init`, head.token || admin.token, {});
    rows.push({ label: 'reports init qc-upload', ...initRes });
  }

  rows.push({ label: 'reports monthly-workload', ...(await getJson(`/api/reports/monthly-workload/${year}/${month}`, doctor.token)) });
  rows.push({ label: 'reports qc-routine', ...(await getJson(`/api/reports/qc-routine/${year}/${month}`, doctor.token)) });

  const exportExcel = await getBinary(`/api/reports/qc-upload/${year}/${month}/export`, doctor.token);
  rows.push({
    label: 'reports export excel',
    ...exportExcel,
    ok: exportExcel.ok && exportExcel.contentType.includes('spreadsheetml'),
  });

  const exportPdf = await getBinary(`/api/reports/qc-upload/${year}/${month}/export-pdf`, doctor.token);
  rows.push({
    label: 'reports export pdf',
    ...exportPdf,
    ok: exportPdf.ok && exportPdf.contentType.includes('application/pdf'),
  });

  rows.push({ label: 'schedule week', ...(await getJson(`/api/schedule/week?start_date=${weekStart}`, doctor.token)) });
  rows.push({ label: 'schedule nurse-sheet', ...(await getJson(`/api/schedule/nurse-sheet?week_start=${weekStart}`, doctor.token)) });

  rows.push({ label: 'devices machines', ...(await getJson('/api/devices/machines', doctor.token)) });
  rows.push({ label: 'devices consumables', ...(await getJson('/api/devices/consumables', doctor.token)) });
  rows.push({ label: 'devices today-summary', ...(await getJson('/api/devices/consumables/today-summary', doctor.token)) });
  rows.push({ label: 'devices water-machines', ...(await getJson('/api/devices/water-machines', doctor.token)) });
  rows.push({ label: 'devices water-quality', ...(await getJson('/api/devices/water-quality?page_size=5', doctor.token)) });
  rows.push({
    label: 'devices water-daily-inspections',
    ...(await getJson('/api/devices/water-daily-inspections?page_size=5', doctor.token)),
  });

  const wmList = await getJson('/api/devices/water-machines', admin.token);
  const firstWaterMachineId = Array.isArray(wmList.data) && wmList.data[0]?.id ? wmList.data[0].id : null;
  const todayStr = new Date().toISOString().slice(0, 10);

  if (firstWaterMachineId) {
    rows.push({
      label: 'devices post water-daily-inspection',
      ...(await postJson('/api/devices/water-daily-inspections', admin.token, {
        water_machine_id: firstWaterMachineId,
        check_date: todayStr,
        hardness: '0',
      })),
    });
    rows.push({
      label: 'devices post water-quality',
      ...(await postJson('/api/devices/water-quality', admin.token, {
        test_date: todayStr,
        bacteria_count: 1,
        result: 'qualified',
        water_machine_id: firstWaterMachineId,
      })),
    });
  } else {
    rows.push({
      label: 'devices post water-daily-inspection',
      ok: true,
      skipReason: '跳过（当前无水机台账，无法测写入）',
    });
    rows.push({
      label: 'devices post water-quality',
      ok: true,
      skipReason: '跳过（当前无水机台账，无法测写入）',
    });
  }

  let fail = 0;
  for (const row of rows) {
    const pass = row.ok === true;
    const detail = row.skipReason
      ? row.skipReason
      : row.contentType
        ? `${row.status} ${row.contentType} size=${row.size}`
        : `${row.status} code=${row.code}`;
    printResult(row.label, pass, detail);
    if (!pass) fail += 1;
  }

  if (fail > 0) {
    console.error(`\n关键链路冒烟完成：${rows.length - fail}/${rows.length} 项通过`);
    process.exit(1);
  }

  console.log(`\n关键链路冒烟完成：${rows.length} 项全部通过`);
})();
