/**
 * 五模块关键 API 冒烟：登录后探测 labs / vascular / infection / reports / cqi
 * 需：后端已启动、数据库已迁移且种子用户存在（见 seeds/001_admin_users.sql）
 * 运行：cd backend && node scripts/smoke-five-modules.js
 *
 * 环境变量：SMOKE_PASSWORD（默认 Shangu@2026）；PORT（默认 3080）
 */
require('dotenv').config();

const base = `http://127.0.0.1:${process.env.PORT || 3080}`;

async function login(username, password) {
  const lr = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await lr.json();
  return { token: j.data?.token, code: j.code, message: j.message };
}

function authHeaders(token, contentType = 'application/json') {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

async function get(path, token) {
  if (!token) {
    return { path, status: 0, code: null, ok: false, skip: true };
  }
  const r = await fetch(`${base}${path}`, { headers: authHeaders(token) });
  const j = await r.json().catch(() => ({}));
  return {
    path,
    status: r.status,
    code: j.code,
    ok: r.status === 200 && j.code === 200,
    skip: false,
  };
}

async function post(path, token, body) {
  if (!token) {
    return { path, status: 0, code: null, ok: false, skip: true };
  }
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return {
    path,
    status: r.status,
    code: j.code,
    ok: r.status < 400 && typeof j.code === 'number' && j.code < 400,
    skip: false,
  };
}

async function patch(path, token, body) {
  if (!token) {
    return { path, status: 0, code: null, ok: false, skip: true };
  }
  const r = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return {
    path,
    status: r.status,
    code: j.code,
    ok: r.status === 200 && j.code === 200,
    skip: false,
  };
}

async function getRaw(path, token) {
  if (!token) {
    return { path, status: 0, code: null, ok: false, skip: true, headers: {} };
  }
  const r = await fetch(`${base}${path}`, { headers: authHeaders(token, null) });
  return {
    path,
    status: r.status,
    code: null,
    ok: r.status === 200,
    skip: false,
    headers: {
      contentType: r.headers.get('content-type') || '',
      contentDisposition: r.headers.get('content-disposition') || '',
    },
  };
}

(async () => {
  const password = process.env.SMOKE_PASSWORD || 'Shangu@2026';
  const admin = await login('renjige', password);
  const doctor = await login('doctor01', password);
  const head = await login('yangchen', password);
  const nurse = await login('nurse01', password);
  const quality = await login('qc01', password);
  const technician = await login('tech01', password);

  console.log('登录探测:', {
    admin: !!admin.token,
    doctor01: !!doctor.token,
    head_nurse: !!head.token,
    nurse01: !!nurse.token,
    qc01: !!quality.token,
    tech01: !!technician.token,
  });

  if (!doctor.token) {
    console.error('doctor01 登录失败，无法继续:', doctor);
    process.exit(1);
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  const rows = [];

  rows.push({ label: 'labs GET /api/labs (p1)', ...(await get('/api/labs?page=1&page_size=3', doctor.token)) });
  rows.push({
    label: 'labs GET /api/labs/recent (quality 或 doctor)',
    ...(await get('/api/labs/recent?days=7&page_size=5', quality.token || doctor.token)),
  });
  rows.push({ label: 'vascular GET /api/vascular/cvc-all (doctor)', ...(await get('/api/vascular/cvc-all', doctor.token)) });
  rows.push({
    label: 'vascular GET /api/vascular/cvc-all (nurse 应403)',
    ...(await get('/api/vascular/cvc-all', nurse.token)),
  });
  rows.push({
    label: 'infection GET overdue (head_nurse 或 admin)',
    ...(await get('/api/infection/screenings/overdue', head.token || admin.token)),
  });
  rows.push({
    label: 'infection GET overdue (doctor 应403)',
    ...(await get('/api/infection/screenings/overdue', doctor.token)),
  });
  rows.push({
    label: 'infection POST screenings (quality 应403)',
    ...(await post('/api/infection/screenings/00000000-0000-0000-0000-000000000001', quality.token, {
      test_type: 'hbsag',
      result: 'negative',
      test_date: `${y}-${String(m).padStart(2, '0')}-01`,
      notes: 'rbac smoke',
    })),
  });
  rows.push({
    label: 'infection POST latest batch (technician)',
    ...(await post('/api/infection/screenings/latest/batch', technician.token, {
      patient_ids: ['00000000-0000-0000-0000-000000000001'],
    })),
    optionalSkip: true,
  });
  rows.push({ label: 'reports GET qc-upload', ...(await get(`/api/reports/qc-upload/${y}/${m}`, admin.token || doctor.token)) });
  const initRes = await post(`/api/reports/qc-upload/${y}/${m}/init`, admin.token || head.token, {});
  rows.push({
    label: 'reports init draft (admin/head_nurse)',
    ...initRes,
    ok: initRes.skip ? false : initRes.status === 200 || initRes.code === 200,
  });
  rows.push({
    label: 'reports GET monthly-workload',
    ...(await get(`/api/reports/monthly-workload/${y}/${m}`, doctor.token)),
  });
  rows.push({ label: 'reports GET qc-upload/history', ...(await get('/api/reports/qc-upload/history', doctor.token)) });
  const exportXlsx = await getRaw(`/api/reports/qc-upload/${y}/${m}/export`, admin.token || head.token || doctor.token);
  rows.push({
    label: 'reports GET qc-upload export(xlsx)',
    ...exportXlsx,
    ok:
      !exportXlsx.skip &&
      exportXlsx.status === 200 &&
      exportXlsx.headers.contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  });
  const exportPdf = await getRaw(`/api/reports/qc-upload/${y}/${m}/export-pdf`, admin.token || head.token || doctor.token);
  rows.push({
    label: 'reports GET qc-upload export(pdf)',
    ...exportPdf,
    ok:
      !exportPdf.skip &&
      exportPdf.status === 200 &&
      exportPdf.headers.contentType.includes('application/pdf'),
  });
  rows.push({
    label: 'cqi GET /api/cqi',
    ...(await get('/api/cqi?page=1&page_size=5', quality.token || doctor.token)),
  });
  rows.push({
    label: 'cqi GET user-options (head_nurse)',
    ...(await get('/api/cqi/user-options', head.token)),
  });
  rows.push({
    label: 'cqi GET user-options (quality 应403)',
    ...(await get('/api/cqi/user-options', quality.token)),
  });
  rows.push({ label: 'cqi GET /api/cqi/defects/list', ...(await get('/api/cqi/defects/list', doctor.token)) });

  const patchSupp = await patch(
    `/api/reports/qc-upload/${y}/${m}`,
    head.token || admin.token,
    { notes: 'smoke test', spot_check_ratio: 4.2 },
  );
  rows.push({
    label: 'reports PATCH qc-upload 补充项（护士长；已确认月可能400）',
    ...patchSupp,
    ok:
      patchSupp.skip
        ? false
        : patchSupp.ok ||
          patchSupp.status === 400 ||
          patchSupp.code === 400,
  });

  const submitRes = await post(`/api/reports/qc-upload/${y}/${m}/submit`, head.token || admin.token, {});
  rows.push({
    label: 'reports submit (路由可达；无草稿时400可接受)',
    ...submitRes,
    ok:
      submitRes.skip
        ? false
        : submitRes.status === 200 ||
          submitRes.code === 200 ||
          submitRes.status === 400 ||
          submitRes.code === 400,
  });

  let fail = 0;
  for (const r of rows) {
    if (r.skip) {
      const optionalSkip = r.optionalSkip === true;
      console.log(`- ${r.label}: SKIP 无 token${optionalSkip ? '（可选账号）' : ''}`);
      if (!optionalSkip) fail += 1;
      continue;
    }
    const expect403 = r.label.includes('应403');
    const pass = expect403 ? r.status === 403 || r.code === 403 : r.ok === true;
    const line = expect403
      ? r.status === 403 || r.code === 403
        ? 'OK 403'
        : `FAIL 期望403 得${r.status}`
      : r.ok
        ? 'OK'
        : `FAIL ${r.status}`;
    if (!pass) fail += 1;
    console.log(`${pass ? '✓' : '✗'} ${r.label}: ${line} code=${r.code}`);
  }

  if (fail > 0) {
    console.error(`\n完成：${rows.length - fail}/${rows.length} 项严格通过（含403预期）；失败含业务码/缺账号`);
    process.exit(1);
  }
  console.log(`\n全部探测完成：${rows.length} 项`);
})();
