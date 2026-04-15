/**
 * RBAC 角色矩阵冒烟（关键接口）
 *
 * 默认宽松模式：缺角色账号时仅跳过该角色（便于本地不完整数据集运行）
 * 严格模式：RBAC_STRICT=true 时，要求 admin/head_nurse/doctor/nurse/quality 五角色均可登录
 *
 * 环境变量：
 * - PORT（默认 3080）
 * - SMOKE_PASSWORD（默认 Shangu@2026）
 * - RBAC_STRICT=true（CI 建议开启）
 */
require('dotenv').config();

const base = `http://127.0.0.1:${process.env.PORT || 3080}`;
const password = process.env.SMOKE_PASSWORD || 'Shangu@2026';
const strict = String(process.env.RBAC_STRICT || '').toLowerCase() === 'true';

const roleCandidates = {
  admin: ['renjige'],
  head_nurse: ['yangchen', 'headnurse01'],
  doctor: ['doctor01'],
  nurse: ['nurse01'],
  quality: ['qc01'],
};

const requiredRoles = Object.keys(roleCandidates);

const cases = [
  { label: 'users list', method: 'GET', path: '/api/users', allow: ['admin'] },
  { label: 'users nursing-staff', method: 'GET', path: '/api/users/nursing-staff', allow: ['admin', 'doctor'] },
  { label: 'infection overdue', method: 'GET', path: '/api/infection/screenings/overdue', allow: ['admin', 'head_nurse'] },
  { label: 'vascular cvc-all', method: 'GET', path: '/api/vascular/cvc-all', allow: ['admin', 'head_nurse', 'doctor'] },
  { label: 'cqi user-options', method: 'GET', path: '/api/cqi/user-options', allow: ['admin', 'head_nurse'] },
  { label: 'labs overdue', method: 'GET', path: '/api/labs/overdue', allow: ['admin', 'head_nurse', 'doctor', 'nurse', 'quality'] },
  { label: 'alerts run-checks', method: 'POST', path: '/api/alerts/run-checks', body: {}, allow: ['admin'] },
];

function printResult(label, pass, detail) {
  console.log(`${pass ? '✓' : '✗'} ${label}: ${detail}`);
}

async function login(username) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await response.json().catch(() => ({}));
  return {
    ok: response.status === 200 && json.code === 200 && Boolean(json?.data?.token),
    status: response.status,
    code: json.code,
    token: json?.data?.token || null,
    role: json?.data?.user?.role || null,
  };
}

function roleMatches(expectedRole, actualRole) {
  const aliases = expectedRole === 'quality' ? ['quality', 'qc'] : [expectedRole];
  return aliases.includes(actualRole || '');
}

async function authedRequest(method, path, token, body) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, code: json.code };
}

async function resolveRoleTokens() {
  const roleToken = {};
  const roleUser = {};

  for (const role of requiredRoles) {
    for (const candidate of roleCandidates[role]) {
      const lr = await login(candidate);
      if (lr.ok && roleMatches(role, lr.role)) {
        roleToken[role] = lr.token;
        roleUser[role] = candidate;
        break;
      }
    }
  }

  // 用 admin 查询实际用户，尝试补齐缺失角色（默认密码）
  if (roleToken.admin) {
    const usersRes = await authedRequest('GET', '/api/users', roleToken.admin);
    if (usersRes.status === 200 && usersRes.code === 200) {
      const response = await fetch(`${base}/api/users`, {
        headers: { Authorization: `Bearer ${roleToken.admin}` },
      });
      const json = await response.json().catch(() => ({}));
      const users = Array.isArray(json?.data) ? json.data : [];

      for (const role of requiredRoles) {
        if (roleToken[role]) continue;
        const roleAliases = role === 'quality' ? ['quality', 'qc'] : [role];
        const candidateUser = users.find((u) => roleAliases.includes(u.role) && u.is_active !== false && u.username);
        if (!candidateUser) continue;
        const lr = await login(candidateUser.username);
        if (lr.ok && roleMatches(role, lr.role)) {
          roleToken[role] = lr.token;
          roleUser[role] = candidateUser.username;
        }
      }
    }
  }

  return { roleToken, roleUser };
}

(async () => {
  const { roleToken, roleUser } = await resolveRoleTokens();
  const missingRoles = requiredRoles.filter((r) => !roleToken[r]);

  if (missingRoles.length > 0) {
    const detail = `缺少角色账号登录：${missingRoles.join(', ')}`;
    if (strict) {
      printResult('rbac role readiness', false, detail);
      process.exit(1);
    } else {
      printResult('rbac role readiness', true, `${detail}（宽松模式已跳过）`);
    }
  } else {
    printResult(
      'rbac role readiness',
      true,
      requiredRoles.map((r) => `${r}=${roleUser[r]}`).join(', '),
    );
  }

  let fail = 0;
  let checked = 0;

  for (const c of cases) {
    for (const role of requiredRoles) {
      const token = roleToken[role];
      if (!token) continue;
      checked += 1;
      const expectedAllow = c.allow.includes(role);
      const res = await authedRequest(c.method, c.path, token, c.body);
      const pass = expectedAllow
        ? (res.status === 200 || res.status === 201)
        : res.status === 403;
      const expectText = expectedAllow ? 'allow' : 'deny(403)';
      printResult(
        `rbac ${c.label} [${role}]`,
        pass,
        `expect=${expectText} actual=${res.status} code=${res.code}`,
      );
      if (!pass) fail += 1;
    }
  }

  if (checked === 0) {
    console.error('未执行任何 RBAC 用例，请检查登录账号或环境配置');
    process.exit(1);
  }

  if (fail > 0) {
    console.error(`\nRBAC 矩阵冒烟失败：${fail}/${checked} 项未通过`);
    process.exit(1);
  }

  console.log(`\nRBAC 矩阵冒烟通过：${checked} 项`);
})();

