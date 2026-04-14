/**
 * 鉴权链路冒烟：
 * 1) 正常登录与 /api/auth/me
 * 2) 缺失 token / 无效 token 拒绝
 * 3) 退出登录后旧 token 复用（Redis 黑名单可用时应被拒绝）
 *
 * 环境变量：
 * - PORT（默认 3080）
 * - SMOKE_PASSWORD（默认 Shangu@2026）
 * - AUTH_STRICT_REVOKE=true 时，强制要求 logout 后旧 token 必须 401
 */
require('dotenv').config();

const base = `http://127.0.0.1:${process.env.PORT || 3080}`;
const strictRevoke = String(process.env.AUTH_STRICT_REVOKE || '').toLowerCase() === 'true';

async function login(username, password) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, code: json.code, data: json.data, message: json.message };
}

async function callMe(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${base}/api/auth/me`, { headers });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, code: json.code, message: json.message };
}

async function callLogout(token) {
  const response = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, code: json.code, message: json.message };
}

function printResult(label, pass, detail) {
  console.log(`${pass ? '✓' : '✗'} ${label}: ${detail}`);
}

(async () => {
  const password = process.env.SMOKE_PASSWORD || 'Shangu@2026';
  const admin = await login('renjige', password);
  if (!admin.data?.token) {
    console.error('管理员登录失败，无法执行鉴权链路冒烟');
    process.exit(1);
  }

  const token = admin.data.token;
  let fail = 0;

  const meOk = await callMe(token);
  const meNoToken = await callMe(null);
  const meBadToken = await callMe('bad.token.value');
  const logout = await callLogout(token);
  const meAfterLogout = await callMe(token);

  const checks = [
    {
      label: 'auth login admin',
      pass: admin.status === 200 && admin.code === 200,
      detail: `${admin.status} code=${admin.code}`,
    },
    {
      label: 'auth me with valid token',
      pass: meOk.status === 200 && meOk.code === 200,
      detail: `${meOk.status} code=${meOk.code}`,
    },
    {
      label: 'auth me without token -> 401',
      pass: meNoToken.status === 401 && meNoToken.code === 401,
      detail: `${meNoToken.status} code=${meNoToken.code}`,
    },
    {
      label: 'auth me with invalid token -> 401',
      pass: meBadToken.status === 401 && meBadToken.code === 401,
      detail: `${meBadToken.status} code=${meBadToken.code}`,
    },
    {
      label: 'auth logout',
      pass: logout.status === 200 && logout.code === 200,
      detail: `${logout.status} code=${logout.code}`,
    },
  ];

  for (const c of checks) {
    printResult(c.label, c.pass, c.detail);
    if (!c.pass) fail += 1;
  }

  // Redis 不可用时，黑名单校验会降级；该项默认提示，不强制失败。
  const revokePass = meAfterLogout.status === 401 && meAfterLogout.code === 401;
  const revokeDetail = `${meAfterLogout.status} code=${meAfterLogout.code}`;
  if (strictRevoke) {
    printResult('auth me after logout (strict revoke)', revokePass, revokeDetail);
    if (!revokePass) fail += 1;
  } else {
    const infoPass = revokePass || (meAfterLogout.status === 200 && meAfterLogout.code === 200);
    printResult(
      'auth me after logout (observed)',
      infoPass,
      `${revokeDetail}${revokePass ? '' : '（可能是 Redis 黑名单降级）'}`,
    );
    if (!infoPass) fail += 1;
  }

  if (fail > 0) {
    console.error(`\n鉴权链路冒烟失败：${fail} 项未通过`);
    process.exit(1);
  }
  console.log('\n鉴权链路冒烟通过');
})();

