/**
 * AI 相关前后端联调冒烟：需后端已启动、数据库可用、已执行种子用户（见 seedUsers.js）。
 * 用法（在 backend 目录）：node scripts/test-ai-smoke.js
 * 环境：API_BASE=http://localhost:3080/api（默认）、登录 renjige / Shangu@2026
 *
 * 覆盖：
 * - /api/knowledge/*、/api/guidelines/*、/api/medical-sites/*
 * - /api/ai/* 参数校验与权限（不触发完整通义调用，避免耗时与费用）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BASE = (process.env.API_BASE || 'http://localhost:3080/api').replace(/\/$/, '');

async function login(username, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`登录失败 ${r.status}: ${j.message || JSON.stringify(j)}`);
  }
  const token = j.data?.token;
  if (!token) throw new Error('响应无 token');
  return token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function expectStatus(name, p, expected) {
  const r = await p;
  const ok = expected.includes(r.status);
  if (!ok) {
    const t = await r.text();
    throw new Error(`${name}: 期望 HTTP ${expected.join('|')}，实际 ${r.status} ${t.slice(0, 200)}`);
  }
  return r;
}

async function main() {
  const adminPass = process.env.SMOKE_ADMIN_PASSWORD || 'Shangu@2026';
  const adminUser = process.env.SMOKE_ADMIN_USER || 'renjige';

  console.log('API_BASE=', BASE);
  const adminToken = await login(adminUser, adminPass);

  // 未带 Token
  await expectStatus(
    'GET /knowledge/documents 未认证',
    fetch(`${BASE}/knowledge/documents`),
    [401, 403],
  );

  // 知识库
  await expectStatus(
    'GET /knowledge/documents',
    fetch(`${BASE}/knowledge/documents?page=1&pageSize=5`, { headers: authHeaders(adminToken) }),
    [200],
  );

  // 指南
  await expectStatus(
    'GET /guidelines',
    fetch(`${BASE}/guidelines?page=1&pageSize=5`, { headers: authHeaders(adminToken) }),
    [200],
  );

  // 专业网站（医护可读）
  await expectStatus(
    'GET /medical-sites',
    fetch(`${BASE}/medical-sites`, { headers: authHeaders(adminToken) }),
    [200],
  );

  // AI：缺参 400（不调用模型）
  await expectStatus(
    'POST /ai/patient-trend 缺 patientId',
    fetch(`${BASE}/ai/patient-trend`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({}),
    }),
    [400],
  );

  await expectStatus(
    'POST /ai/labs-analysis 缺 patientId',
    fetch(`${BASE}/ai/labs-analysis`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({}),
    }),
    [400],
  );

  await expectStatus(
    'POST /ai/qc-monthly-insight 缺 year/month',
    fetch(`${BASE}/ai/qc-monthly-insight`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({}),
    }),
    [400],
  );

  await expectStatus(
    'POST /ai/anomaly-analysis 缺参数',
    fetch(`${BASE}/ai/anomaly-analysis`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ patientId: 'x' }),
    }),
    [400],
  );

  // 用药建议：护士长应 403
  const headToken = await login(process.env.SMOKE_HEAD_USER || 'yangchen', adminPass);
  await expectStatus(
    'POST /ai/medication-advice head_nurse 应拒绝',
    fetch(`${BASE}/ai/medication-advice`, {
      method: 'POST',
      headers: authHeaders(headToken),
      body: JSON.stringify({ patientId: '00000000-0000-0000-0000-000000000001' }),
    }),
    [403],
  );

  // 质控月报解读：质控账号可访问接口（不要求有月报数据，可能 500/503 若服务或数据问题）
  const qcToken = await login(process.env.SMOKE_QC_USER || 'qc01', adminPass);
  const qcRes = await fetch(`${BASE}/ai/qc-monthly-insight`, {
    method: 'POST',
    headers: authHeaders(qcToken),
    body: JSON.stringify({ year: 2024, month: 1, historyMonths: 1, userQuestion: '' }),
  });
  if (![200, 500, 503].includes(qcRes.status)) {
    const t = await qcRes.text();
    throw new Error(`POST /ai/qc-monthly-insight quality 角色: 意外状态 ${qcRes.status} ${t.slice(0, 300)}`);
  }
  console.log(
    `POST /ai/qc-monthly-insight (quality) → ${qcRes.status}（200=成功；500/503=数据或 AI 配置问题，权限链路正常）`,
  );

  console.log('\n✅ AI 相关 API 冒烟通过（参数校验 + RBAC + 列表类接口）。');
  console.log(
    '提示：完整通义调用请在 UI 中手动测：/ai/assistant 各 Tab、指南阅读、知识库、管理员「专业网站」、报表页「AI 辅助解读」、透析/检验/患者详情/预警中的「异常分析」。',
  );
}

main().catch((e) => {
  console.error('\n❌', e.message);
  if (e.cause) console.error('cause:', e.cause.message || e.cause);
  if (String(e.message).includes('fetch failed')) {
    console.error('提示：请先启动后端（npm run dev），并确认 API_BASE 与 PORT 一致（默认 http://localhost:3080/api）。');
  }
  process.exit(1);
});
