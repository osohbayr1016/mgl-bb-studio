import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  assertOfficeAccess,
  isOfficeGuardPublicPath,
  officeAccessJson,
  OFFICE_NETWORK_CODE,
  invalidateRemoteAccessCache,
} = await import('./officeAccess.ts');
const { ipMatches } = await import('./ip.ts');

test('isOfficeGuardPublicPath — login болон landing алгасна', () => {
  assert.equal(isOfficeGuardPublicPath('/api/auth/login'), true);
  assert.equal(isOfficeGuardPublicPath('/api/auth/me'), true);
  assert.equal(isOfficeGuardPublicPath('/api/auth/logout'), true);
  assert.equal(isOfficeGuardPublicPath('/api/landing/public'), true);
  assert.equal(isOfficeGuardPublicPath('/api/landing/v2/public/project-cards'), true);
  assert.equal(isOfficeGuardPublicPath('/api/projects'), false);
});

test('officeAccessJson — тогтмол код буцаана', () => {
  const body = officeAccessJson({
    ok: false,
    status: 403,
    code: OFFICE_NETWORK_CODE,
    error: 'Оффисын сүлжээнд холбогдоно уу',
    detail: 'IP хаяг (1.2.3.4) зөвшөөрөгдөөгүй байна',
  });
  assert.equal(body.code, 'office_network_required');
  assert.match(body.detail, /1\.2\.3\.4/);
});

test('assertOfficeAccess — client role гаднаас зөвшөөрнө', async () => {
  const verdict = await assertOfficeAccess({
    env: {} as never,
    requestUrl: 'https://example.com/api/auth/me',
    clientIp: '203.0.113.50',
    db: {} as D1Database,
    user: { sub: 5, role: 'client' },
  });
  assert.equal(verdict.ok, true);
});

test('assertOfficeAccess — remote_access_allowed=1 шууд зөвшөөрнө', async () => {
  const verdict = await assertOfficeAccess({
    env: {} as never,
    requestUrl: 'https://example.com/api/auth/me',
    clientIp: '203.0.113.50',
    db: {} as D1Database,
    user: { sub: 7, role: 'engineer', remote_access_allowed: 1 },
  });
  assert.equal(verdict.ok, true);
});

test('assertOfficeAccess — OFFICE_ACCESS_ENFORCED биш бол staff гаднаас нээнэ', async () => {
  const verdict = await assertOfficeAccess({
    env: { OFFICE_ACCESS_ENFORCED: '0' } as never,
    requestUrl: 'https://example.com/api/auth/me',
    clientIp: '203.0.113.50',
    db: {} as D1Database,
    user: { sub: 7, role: 'engineer' },
  });
  assert.equal(verdict.ok, true);
});

test('assertOfficeAccess — staff гаднаас хориглоно', async () => {
  const db = {
    prepare: () => ({
      all: async () => ({ results: [] as { ip_address: string }[] }),
      bind: () => ({
        first: async () => ({ remote_access_allowed: 0 }),
      }),
    }),
  } as unknown as D1Database;

  const verdict = await assertOfficeAccess({
    env: { OFFICE_ACCESS_ENFORCED: '1' } as never,
    requestUrl: 'https://example.com/api/projects',
    clientIp: '203.0.113.50',
    db,
    user: { sub: 7, role: 'engineer' },
  });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, OFFICE_NETWORK_CODE);
});

test('assertOfficeAccess — office IP staff зөвшөөрнө', async () => {
  const db = {
    prepare: () => ({
      all: async () => ({ results: [{ ip_address: '192.168.1.0/24' }] }),
      bind: () => ({
        first: async () => ({ remote_access_allowed: 0 }),
      }),
    }),
  } as unknown as D1Database;

  const verdict = await assertOfficeAccess({
    env: { OFFICE_ACCESS_ENFORCED: '1' } as never,
    requestUrl: 'https://example.com/api/projects',
    clientIp: '192.168.1.42',
    db,
    user: { sub: 7, role: 'engineer' },
  });
  assert.equal(verdict.ok, true);
});

test('ipMatches — CIDR office whitelist', () => {
  assert.equal(ipMatches('192.168.1.100', '192.168.1.0/24'), true);
  assert.equal(ipMatches('10.0.0.5', '192.168.1.0/24'), false);
});

test('invalidateRemoteAccessCache — cache цэвэрлэгдэнэ', async () => {
  invalidateRemoteAccessCache();
  const db = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ remote_access_allowed: 1 }),
      }),
    }),
  } as unknown as D1Database;

  const { userHasRemoteAccess } = await import('./officeAccess.ts');
  assert.equal(await userHasRemoteAccess(db, 99), true);
  invalidateRemoteAccessCache(99);

  const db2 = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ remote_access_allowed: 0 }),
      }),
    }),
  } as unknown as D1Database;
  assert.equal(await userHasRemoteAccess(db2, 99), false);
});
