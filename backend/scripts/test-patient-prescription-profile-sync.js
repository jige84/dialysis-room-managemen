/**
 * 患者档案抗凝/干体重 与 透析处方 联调自检
 * - 校验 DB 迁移列是否存在
 * - 需后端已启动：登录 → GET 患者 → PUT 档案干体重 → GET 校验 → 可选恢复原值
 *
 * 运行：cd backend && node scripts/test-patient-prescription-profile-sync.js
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

const base = `http://127.0.0.1:${process.env.PORT || 3080}`;

const REQUIRED_PATIENT_COLS = [
  'profile_anticoagulant',
  'profile_heparin_prime_dose',
  'profile_heparin_maintain',
  'profile_dry_weight',
  'profile_dry_weight_date',
  'profile_dry_weight_reason',
];

async function checkSchema() {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'patients'
       AND column_name = ANY($1::text[])`,
    [REQUIRED_PATIENT_COLS],
  );
  const found = new Set(rows.map((r) => r.column_name));
  const missing = REQUIRED_PATIENT_COLS.filter((c) => !found.has(c));
  if (missing.length) {
    throw new Error(`patients 表缺少列（请先执行 migrations 046/047）: ${missing.join(', ')}`);
  }
  return { ok: true, columns: [...found] };
}

async function login(username, password) {
  const lr = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await lr.json().catch(() => ({}));
  return j.data?.token;
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function httpJson(method, path, token, body) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: authHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function runHttpFlow() {
  const token = await login('doctor01', 'Shangu@2026');
  if (!token) {
    return { skipped: true, reason: 'doctor01 登录失败（检查账号或后端 /api/auth/login）' };
  }

  const { rows } = await pool.query(
    `SELECT id::text FROM patients WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`,
  );
  const patientId = rows[0]?.id;
  if (!patientId) {
    return { skipped: true, reason: '无 active 患者可测' };
  }

  const g1 = await httpJson('GET', `/api/patients/${patientId}`, token);
  if (g1.status !== 200 || g1.j.code !== 200 || !g1.j.data) {
    return {
      ok: false,
      step: 'GET /api/patients/:id',
      status: g1.status,
      message: g1.j.message,
    };
  }

  const d = g1.j.data;
  const keysOk =
    'profile_anticoagulant' in d &&
    'profile_dry_weight' in d &&
    'dry_weight' in d;
  if (!keysOk) {
    return { ok: false, step: 'GET response shape', detail: '缺少 profile_* 或处方 dry_weight 字段' };
  }

  const prev = {
    profile_dry_weight: d.profile_dry_weight,
    profile_dry_weight_date: d.profile_dry_weight_date,
    profile_dry_weight_reason: d.profile_dry_weight_reason,
  };

  // patients.profile_dry_weight 为 NUMERIC(5,1)，一位小数避免舍入误判
  const testDw = 61.2;
  const testDate = '2026-04-07';
  const testReason = '联调脚本写入（可还原）';

  const put = await httpJson(
    'PUT',
    `/api/patients/${patientId}`,
    token,
    {
      profile_dry_weight: testDw,
      profile_dry_weight_date: testDate,
      profile_dry_weight_reason: testReason,
    },
  );
  if (put.status !== 200 || put.j.code !== 200) {
    return {
      ok: false,
      step: 'PUT profile dry',
      status: put.status,
      message: put.j.message,
    };
  }

  const g2 = await httpJson('GET', `/api/patients/${patientId}`, token);
  const d2 = g2.j.data;
  const dwNum = d2.profile_dry_weight != null ? Number(d2.profile_dry_weight) : null;
  if (dwNum == null || Math.abs(dwNum - testDw) > 0.05) {
    return {
      ok: false,
      step: 'GET after PUT',
      expected: testDw,
      got: d2.profile_dry_weight,
    };
  }

  const { rows: rxRows } = await pool.query(
    `SELECT dry_weight FROM prescriptions WHERE patient_id = $1::uuid AND is_current = true`,
    [patientId],
  );
  if (rxRows.length) {
    const rxDw = Number(rxRows[0].dry_weight);
    if (Math.abs(rxDw - testDw) > 0.05) {
      return {
        ok: false,
        step: '处方表 dry_weight 应与档案同步',
        expected: testDw,
        got: rxRows[0].dry_weight,
      };
    }
  }

  if (prev.profile_dry_weight != null) {
    await httpJson('PUT', `/api/patients/${patientId}`, token, {
      profile_dry_weight: Number(prev.profile_dry_weight),
      profile_dry_weight_date: String(prev.profile_dry_weight_date || testDate).slice(0, 10),
      profile_dry_weight_reason: prev.profile_dry_weight_reason ?? null,
    });
  } else {
    console.log(
      '      NOTE: 该患者原无档案干体重，未自动还原；如需可手工在详情中修改。',
    );
  }

  return {
    ok: true,
    patientId,
    checked: ['GET 患者含 profile_*', 'PUT 干体重档案', 'GET 校验数值', prev.profile_dry_weight != null ? 'PUT 还原' : '跳过还原'],
  };
}

(async () => {
  console.log('[1/2] DB schema (patients.profile_*) …');
  const schema = await checkSchema();
  console.log('      OK:', schema.columns.sort().join(', '));

  console.log('[2/2] HTTP 联调（需本机后端 ' + base + '）…');
  let httpResult;
  try {
    httpResult = await runHttpFlow();
  } catch (e) {
    httpResult = { ok: false, error: e.message };
  } finally {
    await pool.end().catch(() => {});
  }

  if (httpResult.skipped) {
    console.log('      SKIP:', httpResult.reason);
    console.log('\n全部完成（仅 schema）。启动后端后可重跑本脚本做 HTTP 联调。');
    process.exit(0);
  }
  if (!httpResult.ok) {
    console.error('      FAIL:', httpResult);
    process.exit(1);
  }
  console.log('      OK:', httpResult);
  console.log('\n全部完成：schema + HTTP 联调通过。');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
