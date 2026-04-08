/**
 * 一次性联调：登录后探测 AI 路由（需后端已启动、DB 可用）
 * 运行：node scripts/smoke-test-ai.js
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

const base = `http://127.0.0.1:${process.env.PORT || 3000}`;

async function login(username, password) {
  const lr = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await lr.json();
  return j.data?.token;
}

function headers(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function post(path, body, token) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return {
    status: r.status,
    code: j.code,
    message: (j.message || '').slice(0, 120),
    hasContent: !!(j.data && j.data.content),
  };
}

(async () => {
  const doctorTok = await login('doctor01', 'Shangu@2026');
  const nurseTok = await login('nurse01', 'Shangu@2026');
  if (!doctorTok) {
    console.error('FAIL: doctor01 登录失败');
    process.exit(1);
  }

  const out = [];
  out.push({ test: 'nlp-query', ...(await post('/api/ai/nlp-query', { query: '简述干体重评估要点' }, doctorTok)) });

  let patientId;
  try {
    const { rows } = await pool.query(
      "SELECT id::text FROM patients WHERE status = 'active' LIMIT 1",
    );
    patientId = rows[0]?.id;
  } finally {
    await pool.end().catch(() => {});
  }

  if (patientId) {
    out.push({
      test: 'patient-trend',
      patientId,
      ...(await post('/api/ai/patient-trend', { patientId, months: 3 }, doctorTok)),
    });
    out.push({
      test: 'labs-analysis',
      ...(await post('/api/ai/labs-analysis', { patientId }, doctorTok)),
    });
    out.push({
      test: 'medication-advice (doctor)',
      ...(await post('/api/ai/medication-advice', { patientId }, doctorTok)),
    });
    out.push({
      test: 'medication-advice (nurse 应403)',
      ...(await post('/api/ai/medication-advice', { patientId }, nurseTok)),
    });
    out.push({
      test: 'anomaly-analysis',
      ...(await post(
        '/api/ai/anomaly-analysis',
        { patientId, anomalyType: 'lab_abnormal' },
        doctorTok,
      )),
    });
  } else {
    out.push({ note: '无 active 患者，跳过依赖 patient 的端点' });
    out.push({
      test: 'medication-advice (nurse 应403)',
      ...(await post(
        '/api/ai/medication-advice',
        { patientId: '00000000-0000-0000-0000-000000000000' },
        nurseTok,
      )),
    });
  }

  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
