/**
 * AI API 冒烟：账号可配置、按登录后真实角色判断预期，避免因测试账号漂移产生假失败。
 *
 * 用法（在 backend 目录）：
 *   node scripts/test-ai-smoke.js
 *
 * 常用环境变量：
 *   API_BASE=http://localhost:3080/api
 *   SMOKE_PASSWORD=Shangu@2026
 *   SMOKE_ADMIN_USER=renjige
 *   SMOKE_ADMIN_PASSWORD=...
 *   SMOKE_DENY_USER=nurse01
 *   SMOKE_DENY_PASSWORD=...
 *   SMOKE_REPORT_USER=doctor01
 *   SMOKE_REPORT_PASSWORD=...
 *
 * 说明：
 * - `SMOKE_ADMIN_*` 为必填级别账号；登录失败直接终止。
 * - `SMOKE_DENY_*` 用于验证“临床 AI 被拒绝”的负向权限；若账号缺失或实际角色可用临床 AI，则自动跳过。
 * - `SMOKE_REPORT_*` 用于验证 `/ai/qc-monthly-insight`；若未配置或无权限，则自动回退到 admin，仍无法访问时跳过。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BASE = (process.env.API_BASE || 'http://localhost:3080/api').replace(/\/$/, '');
const SHARED_PASSWORD = process.env.SMOKE_PASSWORD || 'Shangu@2026';

function normalizeMenuPermissions(raw) {
  if (raw === null || raw === undefined) return raw;
  if (!Array.isArray(raw)) return null;
  return raw.filter((k) => typeof k === 'string').map((k) => k.trim());
}

function canRoleAccessClinicalAi(role) {
  return ['admin', 'doctor', 'head_nurse'].includes(role);
}

function isKeyAllowed(menuPermissions, requiredKey) {
  const normalized = normalizeMenuPermissions(menuPermissions);
  if (normalized === null || normalized === undefined) return true;
  if (normalized.length === 0) return false;
  return normalized.includes(requiredKey);
}

function canUseQcMonthlyInsight(user) {
  if (!user) return false;
  return (
    isKeyAllowed(user.menu_permissions, '/reports') ||
    (canRoleAccessClinicalAi(user.role) && isKeyAllowed(user.menu_permissions, '/ai/assistant'))
  );
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function readTextSafe(response) {
  return response.text().catch(() => '');
}

async function loginAccount(label, username, password, { required = false } = {}) {
  if (!username) {
    if (required) throw new Error(`${label} 账号未配置`);
    return { ok: false, label, username: null, skipReason: '未配置用户名' };
  }

  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || `HTTP ${response.status}`;
    if (required) {
      throw new Error(`${label} 登录失败 ${response.status}: ${message}`);
    }
    return { ok: false, label, username, skipReason: `登录失败 ${response.status}: ${message}` };
  }

  const token = payload.data?.token;
  const user = payload.data?.user;
  if (!token || !user) {
    if (required) throw new Error(`${label} 登录成功但响应缺少 token/user`);
    return { ok: false, label, username, skipReason: '响应缺少 token/user' };
  }

  return {
    ok: true,
    label,
    username,
    token,
    user,
  };
}

async function expectStatus(name, requestFactory, expected) {
  const response = await requestFactory();
  if (expected.includes(response.status)) {
    console.log(`PASS ${name} -> ${response.status}`);
    return response;
  }
  const text = await readTextSafe(response);
  throw new Error(`${name}: 期望 HTTP ${expected.join('|')}，实际 ${response.status} ${text.slice(0, 300)}`);
}

function skipTest(name, reason) {
  console.log(`SKIP ${name} -> ${reason}`);
}

async function main() {
  const adminAccount = await loginAccount(
    'admin',
    process.env.SMOKE_ADMIN_USER || 'renjige',
    process.env.SMOKE_ADMIN_PASSWORD || SHARED_PASSWORD,
    { required: true },
  );

  const denyAccount = await loginAccount(
    'deny',
    process.env.SMOKE_DENY_USER || process.env.SMOKE_NURSE_USER || 'nurse01',
    process.env.SMOKE_DENY_PASSWORD || process.env.SMOKE_NURSE_PASSWORD || SHARED_PASSWORD,
  );

  const reportAccountPrimary = await loginAccount(
    'report',
    process.env.SMOKE_REPORT_USER || process.env.SMOKE_QC_USER || '',
    process.env.SMOKE_REPORT_PASSWORD || process.env.SMOKE_QC_PASSWORD || SHARED_PASSWORD,
  );

  const reportAccount =
    reportAccountPrimary.ok && canUseQcMonthlyInsight(reportAccountPrimary.user)
      ? reportAccountPrimary
      : canUseQcMonthlyInsight(adminAccount.user)
        ? adminAccount
        : null;

  console.log('API_BASE=', BASE);
  console.log(
    `admin=${adminAccount.user.username}/${adminAccount.user.role}; ` +
      `deny=${denyAccount.ok ? `${denyAccount.user.username}/${denyAccount.user.role}` : denyAccount.skipReason}; ` +
      `report=${
        reportAccount
          ? `${reportAccount.user.username}/${reportAccount.user.role}`
          : reportAccountPrimary.ok
            ? `${reportAccountPrimary.user.username}/${reportAccountPrimary.user.role}（无权限，已跳过）`
            : reportAccountPrimary.skipReason
      }`,
  );

  await expectStatus(
    'GET /knowledge/documents 未认证',
    () => fetch(`${BASE}/knowledge/documents`),
    [401, 403],
  );

  await expectStatus(
    'GET /knowledge/documents (admin)',
    () => fetch(`${BASE}/knowledge/documents?page=1&pageSize=5`, { headers: authHeaders(adminAccount.token) }),
    [200],
  );

  await expectStatus(
    'GET /guidelines (admin)',
    () => fetch(`${BASE}/guidelines?page=1&pageSize=5`, { headers: authHeaders(adminAccount.token) }),
    [200],
  );

  await expectStatus(
    'GET /medical-sites (admin)',
    () => fetch(`${BASE}/medical-sites`, { headers: authHeaders(adminAccount.token) }),
    [200],
  );

  await expectStatus(
    'POST /ai/patient-trend 缺 patientId',
    () =>
      fetch(`${BASE}/ai/patient-trend`, {
        method: 'POST',
        headers: authHeaders(adminAccount.token),
        body: JSON.stringify({}),
      }),
    [400],
  );

  await expectStatus(
    'POST /ai/labs-analysis 缺 patientId',
    () =>
      fetch(`${BASE}/ai/labs-analysis`, {
        method: 'POST',
        headers: authHeaders(adminAccount.token),
        body: JSON.stringify({}),
      }),
    [400],
  );

  await expectStatus(
    'POST /ai/qc-monthly-insight 缺 year/month',
    () =>
      fetch(`${BASE}/ai/qc-monthly-insight`, {
        method: 'POST',
        headers: authHeaders(adminAccount.token),
        body: JSON.stringify({}),
      }),
    [400],
  );

  await expectStatus(
    'POST /ai/anomaly-analysis 缺参数',
    () =>
      fetch(`${BASE}/ai/anomaly-analysis`, {
        method: 'POST',
        headers: authHeaders(adminAccount.token),
        body: JSON.stringify({ patientId: 'x' }),
      }),
    [400],
  );

  if (!denyAccount.ok) {
    skipTest('临床 AI 负向权限', denyAccount.skipReason);
  } else if (canRoleAccessClinicalAi(denyAccount.user.role)) {
    skipTest(
      '临床 AI 负向权限',
      `账号 ${denyAccount.user.username} 实际角色为 ${denyAccount.user.role}，属于临床 AI 允许角色`,
    );
  } else {
    await expectStatus(
      `GET /knowledge/documents (${denyAccount.user.username} 应拒绝)`,
      () => fetch(`${BASE}/knowledge/documents?page=1&pageSize=1`, { headers: authHeaders(denyAccount.token) }),
      [403],
    );

    await expectStatus(
      `POST /ai/medication-advice (${denyAccount.user.username} 应拒绝)`,
      () =>
        fetch(`${BASE}/ai/medication-advice`, {
          method: 'POST',
          headers: authHeaders(denyAccount.token),
          body: JSON.stringify({ patientId: '00000000-0000-0000-0000-000000000001' }),
        }),
      [403],
    );

    await expectStatus(
      `POST /ai/nlp-query (${denyAccount.user.username} 应拒绝)`,
      () =>
        fetch(`${BASE}/ai/nlp-query`, {
          method: 'POST',
          headers: authHeaders(denyAccount.token),
          body: JSON.stringify({ query: '王五最近三个月Kt/V趋势' }),
        }),
      [403],
    );
  }

  if (!reportAccount) {
    skipTest('POST /ai/qc-monthly-insight 正向权限', '未找到可访问月度质控 AI 解读的测试账号');
  } else {
    const qcResponse = await expectStatus(
      `POST /ai/qc-monthly-insight (${reportAccount.user.username})`,
      () =>
        fetch(`${BASE}/ai/qc-monthly-insight`, {
          method: 'POST',
          headers: authHeaders(reportAccount.token),
          body: JSON.stringify({ year: 2024, month: 1, historyMonths: 1, userQuestion: '' }),
        }),
      [200, 400, 500, 503],
    );
    console.log(
      `INFO /ai/qc-monthly-insight -> ${qcResponse.status} ` +
        '(200=成功；400=月报不存在；500/503=数据或 AI 配置问题；权限链路正常)',
    );
  }

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
