import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import jwt from 'jsonwebtoken';
import { commitIfCurrent, createAuthSessionGuard } from '../src/authSession.js';

const apiBase = (process.env.BILKARO_API_URL || 'http://localhost:4000').replace(/\/$/, '');

if (process.env.BILKARO_ALLOW_TEST_DATA !== '1') {
  throw new Error('Set BILKARO_ALLOW_TEST_DATA=1 to create disposable auth smoke-test records.');
}

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

function expectStatus(result, expected, label) {
  const detail = typeof result.data?.error === 'string' ? result.data.error : 'no safe error detail';
  assert.equal(result.status, expected, `${label}: expected HTTP ${expected}, got ${result.status}; ${detail}`);
}

function tokenClaims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function assertProductionRequiresSecrets() {
  const authModuleUrl = new URL('../server/middleware/auth.js', import.meta.url).href;
  for (const missingSecret of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.JWT_SECRET;
    delete env.JWT_REFRESH_SECRET;
    delete env.DATABASE_URL;
    env[missingSecret === 'JWT_SECRET' ? 'JWT_REFRESH_SECRET' : 'JWT_SECRET'] = 'test-only-key';
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(authModuleUrl)})`], {
      cwd: tmpdir(),
      env,
      encoding: 'utf8',
    });
    const output = `${result.stderr || ''}${result.stdout || ''}`;
    assert.notEqual(result.status, 0, `${missingSecret} missing: production startup must fail`);
    assert.match(output, /JWT_SECRET and JWT_REFRESH_SECRET must be configured in production/);
    assert.doesNotMatch(output, /test-only-key/);
  }

  for (const nodeEnv of [undefined, 'staging']) {
    const env = { ...process.env, JWT_SECRET: 'test-only-key', JWT_REFRESH_SECRET: 'test-only-refresh-key' };
    delete env.DATABASE_URL;
    if (nodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = nodeEnv;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(authModuleUrl)})`], {
      cwd: tmpdir(),
      env,
      encoding: 'utf8',
    });
    const output = `${result.stderr || ''}${result.stdout || ''}`;
    assert.notEqual(result.status, 0, `NODE_ENV=${nodeEnv || '<missing>'} must fail`);
    assert.match(output, /NODE_ENV must be explicitly set to development, test, or production/);
    assert.doesNotMatch(output, /test-only-(?:refresh-)?key/);
  }

  for (const nodeEnv of ['development', 'test']) {
    const env = { ...process.env, NODE_ENV: nodeEnv };
    delete env.JWT_SECRET;
    delete env.JWT_REFRESH_SECRET;
    delete env.DATABASE_URL;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(authModuleUrl)}).then(() => console.log('AUTH_MODULE_OK'))`], {
      cwd: tmpdir(),
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${nodeEnv} should work without production secrets`);
    assert.match(result.stdout, /AUTH_MODULE_OK/);
  }
}

assertProductionRequiresSecrets();

const sessionGuard = createAuthSessionGuard();
const refreshGeneration = sessionGuard.capture();
let resolvePendingRefresh;
const clientCredentials = { access: null, refresh: null, authorization: null };
const pendingRefresh = new Promise((resolve) => { resolvePendingRefresh = resolve; });
const applyPendingRefresh = pendingRefresh.then(() => commitIfCurrent(sessionGuard, refreshGeneration, () => {
  clientCredentials.access = 'late-access-token';
  clientCredentials.refresh = 'late-refresh-token';
  clientCredentials.authorization = 'Bearer late-access-token';
}));
sessionGuard.invalidate();
resolvePendingRefresh();
assert.equal(await applyPendingRefresh, false, 'logout must make an in-flight refresh stale');
assert.deepEqual(clientCredentials, { access: null, refresh: null, authorization: null }, 'stale refresh must not restore credentials');

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const ownerEmail = `bilkaro_auth_smoke_${suffix}@example.test`;
const managerEmail = `bilkaro_manager_smoke_${suffix}@example.test`;
const staffEmail = `bilkaro_staff_smoke_${suffix}@example.test`;
const ownerPassword = `Owner-${suffix}-Pass!`;
const managerPassword = `Manager-${suffix}-Pass!`;
const staffPassword = `Staff-${suffix}-Pass!`;

const signup = await request('/api/auth/signup', {
  method: 'POST',
  body: {
    businessName: `Auth Smoke ${suffix}`,
    ownerName: 'Auth Smoke Owner',
    email: ownerEmail,
    phone: '9000000000',
    password: ownerPassword,
    category: 'retail',
  },
});
expectStatus(signup, 201, 'signup');

const ownerLogin = await request('/api/auth/login', {
  method: 'POST',
  body: { email: ownerEmail, password: ownerPassword },
});
expectStatus(ownerLogin, 200, 'owner login');

const ownerToken = ownerLogin.data.token;
const signupClaims = tokenClaims(signup.data.token);
const signupRefreshClaims = tokenClaims(signup.data.refreshToken);
const ownerClaims = tokenClaims(ownerLogin.data.token);
const ownerRefreshClaims = tokenClaims(ownerLogin.data.refreshToken);
assert.ok(signupClaims.jti && signupRefreshClaims.jti, 'signup tokens must have jti values');
assert.ok(ownerClaims.jti && ownerRefreshClaims.jti, 'login tokens must have jti values');
assert.notEqual(signupClaims.jti, signupRefreshClaims.jti, 'access and refresh jti values must differ');
assert.notEqual(ownerClaims.jti, ownerRefreshClaims.jti, 'access and refresh jti values must differ');
assert.notEqual(signupClaims.sid, ownerClaims.sid, 'separate authentication sessions must have different family IDs');
assert.equal(ownerClaims.sid, ownerRefreshClaims.sid, 'access and refresh tokens must share a family ID');
const anonymousDashboard = await request('/api/dashboard');
expectStatus(anonymousDashboard, 401, 'anonymous protected-route rejection');

const ownerDashboard = await request('/api/dashboard', { token: ownerToken });
expectStatus(ownerDashboard, 200, 'protected dashboard');

const ownerProduct = await request('/api/products', {
  method: 'POST',
  token: ownerToken,
  body: { name: 'Owner Permission Smoke Product', sellingPrice: 1, currentStock: 1 },
});
expectStatus(ownerProduct, 201, 'owner product create permission');

const managerInvite = await request('/api/team/invite', {
  method: 'POST',
  token: ownerToken,
  body: { name: 'Auth Smoke Manager', email: managerEmail, password: managerPassword, role: 'manager' },
});
expectStatus(managerInvite, 201, 'owner manager invite permission');

const staffInvite = await request('/api/team/invite', {
  method: 'POST',
  token: ownerToken,
  body: { name: 'Auth Smoke Staff', email: staffEmail, password: staffPassword, role: 'staff' },
});
expectStatus(staffInvite, 201, 'owner staff invite permission');

const managerLogin = await request('/api/auth/login', {
  method: 'POST',
  body: { email: managerEmail, password: managerPassword },
});
expectStatus(managerLogin, 200, 'manager login');

const managerDashboard = await request('/api/dashboard', { token: managerLogin.data.token });
expectStatus(managerDashboard, 200, 'manager protected dashboard');

const managerTeamRead = await request('/api/team', { token: managerLogin.data.token });
expectStatus(managerTeamRead, 403, 'manager team restriction');

const managerOwnerInvite = await request('/api/team/invite', {
  method: 'POST',
  token: managerLogin.data.token,
  body: { name: 'Unauthorized Owner', email: `unauthorized_${suffix}@example.test`, password: 'NotAllowed-123!', role: 'owner' },
});
expectStatus(managerOwnerInvite, 403, 'manager owner-invite restriction');

const staffLogin = await request('/api/auth/login', {
  method: 'POST',
  body: { email: staffEmail, password: staffPassword },
});
expectStatus(staffLogin, 200, 'staff login');

const staffDashboard = await request('/api/dashboard', { token: staffLogin.data.token });
expectStatus(staffDashboard, 200, 'staff dashboard permission');

const staffProductsRead = await request('/api/products', { token: staffLogin.data.token });
expectStatus(staffProductsRead, 200, 'staff product read permission');

const staffProductCreate = await request('/api/products', {
  method: 'POST',
  token: staffLogin.data.token,
  body: { name: 'Unauthorized Staff Product', sellingPrice: 1, currentStock: 1 },
});
expectStatus(staffProductCreate, 403, 'staff product-create restriction');

const staffTeamRead = await request('/api/team', { token: staffLogin.data.token });
expectStatus(staffTeamRead, 403, 'staff team restriction');

const refresh = await request('/api/auth/refresh', {
  method: 'POST',
  body: { refreshToken: ownerLogin.data.refreshToken },
});
expectStatus(refresh, 200, 'refresh');
const rotatedClaims = tokenClaims(refresh.data.token);
const rotatedRefreshClaims = tokenClaims(refresh.data.refreshToken);
assert.equal(rotatedClaims.sid, ownerClaims.sid, 'rotation must retain the token family ID');
assert.notEqual(rotatedClaims.jti, ownerClaims.jti, 'rotated access token must have a new jti');
assert.notEqual(rotatedRefreshClaims.jti, ownerRefreshClaims.jti, 'rotated refresh token must have a new jti');

const replay = await request('/api/auth/refresh', {
  method: 'POST',
  body: { refreshToken: ownerLogin.data.refreshToken },
});
expectStatus(replay, 401, 'refresh-token replay rejection');

const successorProtected = await request('/api/dashboard', { token: refresh.data.token });
expectStatus(successorProtected, 401, 'replay invalidates successor access token');
const successorRefresh = await request('/api/auth/refresh', {
  method: 'POST',
  body: { refreshToken: refresh.data.refreshToken },
});
expectStatus(successorRefresh, 401, 'replay invalidates successor refresh token');

const concurrentLogin = await request('/api/auth/login', {
  method: 'POST',
  body: { email: ownerEmail, password: ownerPassword },
});
expectStatus(concurrentLogin, 200, 'login before concurrent refresh');
const concurrentRefreshResults = await Promise.all([
  request('/api/auth/refresh', { method: 'POST', body: { refreshToken: concurrentLogin.data.refreshToken } }),
  request('/api/auth/refresh', { method: 'POST', body: { refreshToken: concurrentLogin.data.refreshToken } }),
]);
assert.deepEqual(
  concurrentRefreshResults.map((result) => result.status).sort(),
  [200, 401],
  'concurrent refresh replay must have one winner and invalidate the family',
);
const concurrentSuccessor = concurrentRefreshResults.find((result) => result.status === 200);
const concurrentSuccessorAccess = await request('/api/dashboard', { token: concurrentSuccessor.data.token });
expectStatus(concurrentSuccessorAccess, 401, 'concurrent replay invalidates winning successor');

for (let attempt = 0; attempt < 3; attempt += 1) {
  const legacyLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: ownerEmail, password: ownerPassword },
  });
  expectStatus(legacyLogin, 200, `legacy race login ${attempt + 1}`);
  const legacyClaims = tokenClaims(legacyLogin.data.refreshToken);
  delete legacyClaims.sid;
  delete legacyClaims.jti;
  delete legacyClaims.tokenUse;
  delete legacyClaims.iat;
  delete legacyClaims.exp;
  const legacyRefreshToken = jwt.sign(legacyClaims, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

  const [legacyRefresh, legacyLogout] = await Promise.all([
    request('/api/auth/refresh', { method: 'POST', body: { refreshToken: legacyRefreshToken } }),
    request('/api/auth/logout', { method: 'POST', body: { refreshToken: legacyRefreshToken } }),
  ]);
  expectStatus(legacyLogout, 200, `legacy concurrent logout ${attempt + 1}`);
  assert.ok([200, 401].includes(legacyRefresh.status), 'legacy refresh may win or lose the serialized race');
  if (legacyRefresh.status === 200) {
    expectStatus(
      await request('/api/dashboard', { token: legacyRefresh.data.token }),
      401,
      `legacy logout invalidates concurrent successor ${attempt + 1}`,
    );
    expectStatus(
      await request('/api/auth/refresh', { method: 'POST', body: { refreshToken: legacyRefresh.data.refreshToken } }),
      401,
      `legacy logout invalidates concurrent successor refresh ${attempt + 1}`,
    );
  }
}

const normalLogoutLogin = await request('/api/auth/login', {
  method: 'POST',
  body: { email: ownerEmail, password: ownerPassword },
});
expectStatus(normalLogoutLogin, 200, 'login before normal logout');
const logout = await request('/api/auth/logout', {
  method: 'POST',
  token: normalLogoutLogin.data.token,
  body: { refreshToken: normalLogoutLogin.data.refreshToken },
});
expectStatus(logout, 200, 'logout');

const protectedAfterLogout = await request('/api/dashboard', { token: normalLogoutLogin.data.token });
expectStatus(protectedAfterLogout, 401, 'access-token rejection after logout');

const refreshAfterLogout = await request('/api/auth/refresh', {
  method: 'POST',
  body: { refreshToken: normalLogoutLogin.data.refreshToken },
});
expectStatus(refreshAfterLogout, 401, 'refresh-token rejection after logout');

const expiredLogoutLogin = await request('/api/auth/login', {
  method: 'POST',
  body: { email: ownerEmail, password: ownerPassword },
});
expectStatus(expiredLogoutLogin, 200, 'login before expired-access logout');
const expiredClaimsSource = tokenClaims(expiredLogoutLogin.data.token);
const { exp: _exp, iat: _iat, jti: _jti, ...expiredPayload } = expiredClaimsSource;
const expiredAccessToken = jwt.sign(
  { ...expiredPayload, jti: randomUUID(), tokenUse: 'access' },
  process.env.JWT_SECRET,
  { expiresIn: -1 },
);
assert.ok(tokenClaims(expiredAccessToken).exp < Math.floor(Date.now() / 1000), 'test access token must be expired');

const expiredAccessLogout = await request('/api/auth/logout', {
  method: 'POST',
  token: expiredAccessToken,
  body: { refreshToken: expiredLogoutLogin.data.refreshToken },
});
expectStatus(expiredAccessLogout, 200, 'logout with expired access token');

const accessAfterExpiredLogout = await request('/api/dashboard', { token: expiredLogoutLogin.data.token });
expectStatus(accessAfterExpiredLogout, 401, 'expired-access logout invalidates family access');
const refreshAfterExpiredLogout = await request('/api/auth/refresh', {
  method: 'POST',
  body: { refreshToken: expiredLogoutLogin.data.refreshToken },
});
expectStatus(refreshAfterExpiredLogout, 401, 'expired-access logout revokes refresh token');

console.log('PASS signup/login/protected route/rotation/replay/logout/expired-access logout');
console.log('PASS unique jti/session family/replay successor invalidation/missing production secrets');
console.log('PASS NODE_ENV enforcement/development modes/client stale-refresh guard/legacy refresh logout race');
console.log('PASS owner permissions/manager restrictions/staff restrictions');