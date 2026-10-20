// Revit add-in-ий ТӨХӨӨРӨМЖИЙН КРИПТО ТАНИЛТ (migration 0375) — БОДИТ SQLite (0328 + 0374 + 0375
// миграцыг файлаас нь ажиллуулна), D1 shim, Hono `app.request()`, WebCrypto-оор жинхэнэ ECDSA
// P-256 гарын үсэг (add-in-ий TPM түлхүүрийн оронд).  Халдлагын сценариуд: хуулсан device_id,
// хуулсан токен, replay, өөр хэрэглэгч / төхөөрөмжийн challenge, хуурамч түлхүүр.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const licenseRouter = (await import('./revitLicense.ts')).default;
const deviceRouter = (await import('./revitDevice.ts')).default;
const L = await import('../lib/revitLicense.ts');
const K = await import('../lib/revitDeviceKey.ts');
const { verifyToken } = await import('../lib/jwt.ts');
const { revitLegacyTokenGuard } = await import('../middleware/revitLegacyTokenGuard.ts');
const { authMiddleware } = await import('../middleware/auth.ts');
const { invalidateRevitSessionCache } = await import('../lib/revitSessionCheck.ts');
const { invalidateTokenCache } = await import('../lib/tokenValidity.ts');

const TEST_KEY_JSON =
  '{"kid":"test-0001","kty":"EC","crv":"P-256","d":"bOJ9ULu0YkNP8ywDgnEjRY-9Zwb19Y8ORTDIwF9-Lcs","x":"4u4bnjuUzrYh_tLI0GSzO2rD2ZKO_hAbIrhAZybljuk","y":"n6YABSm6JZQPoQIqNAOQyuXJbCAJJNY0hlOkjBvgqPo"}';
const TEST_PUB = JSON.parse(TEST_KEY_JSON) as { x: string; y: string };
const JWT_SECRET = 'test-jwt-secret-0375';

function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string, params: unknown[] = []) => ({
    bind(...args: unknown[]) {
      return prepare(sql, args);
    },
    async all() {
      return { results: db.prepare(sql).all(...(params as never[])) };
    },
    async first() {
      return db.prepare(sql).get(...(params as never[])) ?? null;
    },
    async run() {
      const r = db.prepare(sql).run(...(params as never[]));
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
    },
  });
  const batch = async (stmts: Array<{ run: () => Promise<unknown> }>) => {
    const out = [];
    for (const st of stmts) out.push(await st.run());
    return out;
  };
  return { prepare, batch } as unknown as D1Database;
}

const migration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

const DEV_A = 'a'.repeat(64);
const DEV_B = 'b'.repeat(64);
const DEV_C = 'c'.repeat(64);
const WORK_HW = { gpus: ['NVIDIA GeForce RTX 3070'], cores: 20, screens: ['3440x1440', '1920x1080'] };
const HOME_HW = { gpus: ['NVIDIA GeForce RTX 4090'], cores: 32, screens: ['2560x1440'] };

const enc = new TextEncoder();

/** Add-in-ий TPM түлхүүрийн оронд — WebCrypto ECDSA P-256. */
async function makeDeviceKey(level: 'tpm' | 'software' = 'tpm') {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const pub = { x: jwk.x as string, y: jwk.y as string };
  const keyId = await K.keyThumbprint(pub);
  const sign = async (message: string) =>
    L.b64urlEncode(
      new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, enc.encode(message))),
    );
  return { pub, keyId, level, sign };
}
type DeviceKey = Awaited<ReturnType<typeof makeDeviceKey>>;

/**
 * `mode` — `revit.enroll_approval`.  Энэ файлын ихэнх тест 2026-10-01-ний «ажлын компьютер / admin зөвшөөрөл» урсгалыг
 * (одоо `auto` сонголт) шалгадаг тул өгөгдмөл нь `auto`; `account` = мөр бичихгүй (жинхэнэ өгөгдмөл бодлого).
 */
function setup(opts: { withKey?: boolean; office?: boolean; mode?: 'auto' | 'account' | 'admin' } = {}) {
  const { withKey = true, mode = 'auto' } = opts;
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, status TEXT,
      remote_access_allowed INTEGER, tokens_valid_from TEXT,
      attendance_device_id TEXT, attendance_device_label TEXT, attendance_device_bound_at TEXT);
    INSERT INTO users (id, username, full_name, role, status) VALUES
      (1, 'admin', 'Админ', 'admin', 'active'),
      (10, 'bat', 'Б.Бат', 'engineer', 'active'),
      (11, 'dorj', 'Д.Дорж', 'architect', 'active'),
      (12, 'gone', 'Гарсан', 'engineer', 'inactive');
    CREATE TABLE office_ips (id INTEGER PRIMARY KEY, ip_address TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER);
  `);
  db.exec(migration('0328_attendance_devices.sql'));
  db.exec(migration('0374_revit_license_devices.sql'));
  db.exec(migration('0375_revit_device_keys.sql'));
  if (mode !== 'account') db.prepare(`INSERT INTO app_settings (key, value) VALUES ('revit.enroll_approval', ?)`).run(mode);
  const workHw = JSON.stringify({
    gpu: 'nvidia geforce rtx 3070',
    cores: 20,
    screen: '3018x1264',
    platform: 'win32',
    tz: 'Asia/Ulaanbaatar',
    memory: 8,
  });
  for (const uid of [10, 11, 12]) {
    db.prepare(
      `INSERT INTO attendance_devices (user_id, browser_id, hw_hash, hw_json, bound_via, bound_at)
       VALUES (?, ?, 'h', ?, 'first', '2026-09-22T08:00:00')`,
    ).run(uid, `br-${uid}`, workHw);
  }

  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/', licenseRouter as never);
  app.route('/', deviceRouter as never);
  const env = {
    DB: d1Shim(db),
    REVIT_LICENSE_KEY: withKey ? TEST_KEY_JSON : undefined,
    JWT_SECRET,
    OFFICE_ACCESS_ENFORCED: opts.office ? '1' : undefined,
  };
  type CallOpts = { iat?: number; purpose?: string; ip?: string };
  const call = async (sub: number, role: string, method: string, path: string, body?: unknown, o: CallOpts = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const res = await app.request(
      path,
      {
        method,
        headers: {
          'x-test-user': JSON.stringify({
            sub,
            role,
            iat: o.iat ?? now,
            exp: now + 86400,
            ...(o.purpose ? { purpose: o.purpose } : {}),
          }),
          ...(o.ip ? { 'cf-connecting-ip': o.ip } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
    );
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };

  const challenge = (sub: number, deviceId: string, purpose: 'enroll' | 'license' | 'session', version = '1.10.0') =>
    call(sub, 'engineer', 'POST', '/device/challenge', { device_id: deviceId, purpose, addin_version: version });

  async function proofFor(
    key: DeviceKey,
    sub: number,
    deviceId: string,
    purpose: 'enroll' | 'license' | 'session',
    keyId = key.keyId,
    version = '1.10.0',
  ) {
    const ch = await challenge(sub, deviceId, purpose, version);
    assert.equal(ch.status, 200, JSON.stringify(ch.json));
    const message = K.proofMessage({
      purpose,
      challengeId: ch.json.challenge_id,
      nonce: ch.json.nonce,
      userId: sub,
      deviceId,
      keyId,
    });
    return { challenge_id: ch.json.challenge_id as string, signature: await key.sign(message) };
  }

  async function enroll(sub: number, deviceId: string, key: DeviceKey, hw: unknown = WORK_HW, o: CallOpts = {}) {
    const proof = await proofFor(key, sub, deviceId, 'enroll');
    return call(
      sub,
      'engineer',
      'POST',
      '/device/enroll',
      {
        device_id: deviceId,
        hw,
        addin_version: '1.10.0',
        revit_year: '2027',
        public_key: key.pub,
        security_level: key.level,
        proof,
      },
      o,
    );
  }

  async function license(sub: number, deviceId: string, key: DeviceKey | null, hw: unknown = WORK_HW, version = '1.10.0', o: CallOpts = {}) {
    const body: Record<string, unknown> = { device_id: deviceId, hw, addin_version: version, revit_year: '2027' };
    if (key) body.proof = await proofFor(key, sub, deviceId, 'license', key.keyId, version);
    return call(sub, 'engineer', 'POST', '/license', body, o);
  }

  async function session(sub: number, deviceId: string, key: DeviceKey | null) {
    const body: Record<string, unknown> = { device_id: deviceId, addin_version: '1.10.0' };
    if (key) body.proof = await proofFor(key, sub, deviceId, 'session');
    return call(sub, 'engineer', 'POST', '/device/session', body);
  }

  const setPolicy = (key: string, value: string) =>
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);

  return { db, app, env, call, challenge, proofFor, enroll, license, session, setPolicy };
}

/* ------------------------------------------------------------------ */
/*  Үндсэн урсгал                                                       */
/* ------------------------------------------------------------------ */

test('бүртгэл → лиценз: TPM түлхүүр + proof → 12 цагийн лиценз, session, credential', async () => {
  const { db, enroll, license } = setup();
  const key = await makeDeviceKey('tpm');
  const e = await enroll(10, DEV_A, key);
  assert.equal(e.status, 200, JSON.stringify(e.json));
  assert.equal(e.json.status, 'auto', 'ажлын компьютертэй таарсан → автомат');
  assert.equal(e.json.key_id, key.keyId);
  assert.equal((await verifyToken(e.json.credential.token, JWT_SECRET))!.purpose, 'revit-refresh');

  const r = await license(10, DEV_A, key);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.via, 'match');
  assert.equal(r.json.sec, 'tpm');
  const payload = await L.verifyLease(r.json.lease, TEST_PUB);
  assert.ok(payload);
  assert.equal(payload!.dk, key.keyId, 'лиценз төхөөрөмжийн түлхүүрт уяатай');
  assert.equal(payload!.sec, 'tpm');
  assert.equal(payload!.exp - payload!.iat, 12 * 3600);
  assert.equal(payload!.rfa - payload!.iat, 3600);

  // session + credential
  const s = await verifyToken(r.json.session.token, JWT_SECRET);
  assert.equal(s!.purpose, 'revit');
  assert.equal(s!.dev, DEV_A);
  assert.equal(s!.kid, key.keyId);
  assert.equal(s!.exp - s!.iat, 30 * 60);
  const cr = await verifyToken(r.json.credential.token, JWT_SECRET);
  assert.equal(cr!.purpose, 'revit-refresh');
  const row = db.prepare('SELECT last_proof_at FROM revit_device_keys').get() as { last_proof_at: string | null };
  assert.ok(row.last_proof_at);
  // Токен, түлхүүр, гарын үсэг үйл явдлын бүртгэлд ОРООГҮЙ.
  const ev = JSON.stringify(db.prepare('SELECT * FROM revit_security_events').all());
  assert.ok(!ev.includes(key.pub.x) && !ev.includes(r.json.lease) && !ev.includes('eyJ'));
});

test('proof-оо орхисон (түлхүүртэй төхөөрөмж): device_id + токен хуулсан халдагч → DEVICE_PROOF_REQUIRED', async () => {
  const { enroll, license } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  const r = await license(10, DEV_A, null); // device_id-г мэднэ, хувийн түлхүүр байхгүй
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'DEVICE_PROOF_REQUIRED');
  assert.equal(r.json.lease, undefined);
});

test('хуурамч түлхүүр: халдагчийн ӨӨРИЙН түлхүүрээр зурсан proof → DEVICE_PROOF_INVALID', async () => {
  const { enroll, license, proofFor, call } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  const attacker = await makeDeviceKey();
  // Халдагч challenge-ийг ӨӨРИЙН түлхүүрээр, түүний key_id-аар зурна.
  const proof = await proofFor(attacker, 10, DEV_A, 'license');
  const r = await call(10, 'engineer', 'POST', '/license', {
    device_id: DEV_A,
    hw: WORK_HW,
    addin_version: '1.10.0',
    proof,
  });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'DEVICE_PROOF_INVALID');
  void license;
});

test('replay: нэг challenge-ийн ХОЁР ДАХЬ хэрэглээ → татгалзана', async () => {
  const { enroll, proofFor, call } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  const proof = await proofFor(key, 10, DEV_A, 'license');
  const body = { device_id: DEV_A, hw: WORK_HW, addin_version: '1.10.0', proof };
  const first = await call(10, 'engineer', 'POST', '/license', body);
  assert.equal(first.status, 200);
  const replay = await call(10, 'engineer', 'POST', '/license', body); // яг ижил гарын үсэг
  assert.equal(replay.status, 403);
  assert.equal(replay.json.code, 'DEVICE_PROOF_INVALID');
});

test('хугацаа дууссан challenge → татгалзана', async () => {
  const { db, enroll, proofFor, call } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  const proof = await proofFor(key, 10, DEV_A, 'license');
  db.prepare('UPDATE revit_device_challenges SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, proof.challenge_id);
  const r = await call(10, 'engineer', 'POST', '/license', { device_id: DEV_A, hw: WORK_HW, addin_version: '1.10.0', proof });
  assert.equal(r.json.code, 'DEVICE_PROOF_INVALID');
});

test('өөр хэрэглэгчийн challenge, өөр төхөөрөмжийн challenge, өөр зорилгын challenge → татгалзана', async () => {
  const { enroll, proofFor, call, challenge } = setup();
  const keyBat = await makeDeviceKey();
  const keyDorj = await makeDeviceKey();
  await enroll(10, DEV_A, keyBat);
  await enroll(11, DEV_B, keyDorj);

  // (1) Доржийн challenge-ийг Бат ашиглана.
  const dorjCh = await challenge(11, DEV_B, 'license');
  const stolen = {
    challenge_id: dorjCh.json.challenge_id,
    signature: await keyBat.sign(
      K.proofMessage({
        purpose: 'license',
        challengeId: dorjCh.json.challenge_id,
        nonce: dorjCh.json.nonce,
        userId: 10,
        deviceId: DEV_A,
        keyId: keyBat.keyId,
      }),
    ),
  };
  let r = await call(10, 'engineer', 'POST', '/license', { device_id: DEV_A, hw: WORK_HW, addin_version: '1.10.0', proof: stolen });
  assert.equal(r.json.code, 'DEVICE_PROOF_INVALID', 'өөр хэрэглэгчийн challenge');

  // (2) Бат DEV_A-д challenge авч, DEV_C дээр ашиглана (device_id эхнээс таарахгүй).
  const proofA = await proofFor(keyBat, 10, DEV_A, 'license');
  r = await call(10, 'engineer', 'POST', '/license', { device_id: DEV_C, hw: WORK_HW, addin_version: '1.10.0', proof: proofA });
  assert.notEqual(r.status, 200, 'өөр төхөөрөмжийн challenge');

  // (3) 'session' зорилгоор авсан challenge-ийг лицензэд.
  const proofS = await proofFor(keyBat, 10, DEV_A, 'session');
  r = await call(10, 'engineer', 'POST', '/license', { device_id: DEV_A, hw: WORK_HW, addin_version: '1.10.0', proof: proofS });
  assert.equal(r.json.code, 'DEVICE_PROOF_INVALID', 'өөр зорилгын challenge');
});

test('идэвхгүй ажилтан, хаагдсан / цуцлагдсан / pending төхөөрөмж → лиценз ҮГҮЙ', async () => {
  const { db, call, enroll, license } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  const rowId = (db.prepare('SELECT id FROM revit_license_devices').get() as { id: number }).id;

  // blocked
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'blocked' });
  // Хаагдсан төхөөрөмжид challenge ч олгогдохгүй (proof авах боломжгүй).
  assert.equal((await call(10, 'engineer', 'POST', '/device/challenge', { device_id: DEV_A, purpose: 'license' })).json.code, 'DEVICE_BLOCKED');
  let r = await license(10, DEV_A, null);
  assert.equal(r.json.code, 'DEVICE_BLOCKED');
  // pending
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'pending' });
  r = await license(10, DEV_A, key);
  assert.equal(r.json.code, 'DEVICE_PENDING');
  // revoked → түлхүүр УСТНА
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'revoked' });
  r = await license(10, DEV_A, null);
  assert.equal(r.json.code, 'DEVICE_REVOKED');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM revit_device_keys').get() as { n: number }).n, 0);
  // revoked төхөөрөмж дахин бүртгүүлж чадахгүй (admin эхлээд pending болгоно)
  const again = await enroll(10, DEV_A, key);
  assert.equal(again.json.code, 'DEVICE_REVOKED');

  // Идэвхгүй ажилтан
  const k2 = await makeDeviceKey();
  const r2 = await call(12, 'engineer', 'POST', '/device/challenge', { device_id: DEV_C, purpose: 'enroll' });
  assert.equal(r2.json.code, 'USER_INACTIVE');
  void k2;
});

test('admin revoke → pending → шинэ түлхүүрээр дахин бүртгэх (төхөөрөмж солих / сэргээх зам)', async () => {
  const { db, call, enroll, license } = setup();
  const oldKey = await makeDeviceKey();
  await enroll(10, DEV_A, oldKey);
  const rowId = (db.prepare('SELECT id FROM revit_license_devices').get() as { id: number }).id;
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'revoked', reason: 'эд хөрөнгө алдагдсан' });
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'pending' });
  const newKey = await makeDeviceKey();
  const e = await enroll(10, DEV_A, newKey); // Windows дахин суулгасан → шинэ түлхүүр
  assert.equal(e.status, 200);
  assert.equal(e.json.status, 'auto');
  assert.equal((await license(10, DEV_A, newKey)).status, 200);
  // Хуучин түлхүүр ажиллахгүй
  assert.equal((await license(10, DEV_A, oldKey)).json.code, 'DEVICE_PROOF_INVALID');
});

test('бүртгэл: нууц үгээр дөнгөж нэвтрээгүй токен (mcp / хуучин session) → REAUTH_REQUIRED', async () => {
  const { enroll } = setup();
  const key = await makeDeviceKey();
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.equal((await enroll(10, DEV_A, key, WORK_HW, { iat: old })).json.code, 'REAUTH_REQUIRED');
  assert.equal((await enroll(10, DEV_A, key, WORK_HW, { purpose: 'mcp' })).json.code, 'REAUTH_REQUIRED');
  assert.equal((await enroll(10, DEV_A, key, WORK_HW, { purpose: 'revit-refresh' })).json.code, 'REAUTH_REQUIRED');
});

test('бүртгэл: ижил түлхүүрийг өөр хүн / төхөөрөмж дээр хуулбал татгалзана; өөр түлхүүр хүчингүй', async () => {
  const { enroll } = setup();
  const key = await makeDeviceKey('software');
  assert.equal((await enroll(10, DEV_A, key)).status, 200);
  const copy = await enroll(11, DEV_B, key); // програмын түлхүүрийг хуулсан
  assert.equal(copy.status, 409);
  assert.equal(copy.json.code, 'DEVICE_KEY_MISMATCH');
  const other = await enroll(10, DEV_A, await makeDeviceKey()); // admin цуцлаагүй байхад өөр түлхүүр
  assert.equal(other.status, 409);
});

test('бүртгэл: ажлын компьютертэй таараагүй (хувийн PC) → pending, лиценз ҮГҮЙ; admin зөвшөөрвөл ажиллана', async () => {
  const { db, call, enroll, license } = setup();
  const key = await makeDeviceKey();
  const e = await enroll(10, DEV_B, key, HOME_HW);
  assert.equal(e.json.status, 'pending');
  assert.equal(e.json.reason, 'not_work_pc');
  assert.equal((await license(10, DEV_B, key, HOME_HW)).json.code, 'DEVICE_PENDING');
  const rowId = (db.prepare('SELECT id FROM revit_license_devices').get() as { id: number }).id;
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'approved' });
  const r = await license(10, DEV_B, key, HOME_HW);
  assert.equal(r.status, 200);
  assert.equal(r.json.via, 'approved');
});

test('төхөөрөмжийн хязгаар (admin тохируулсан үед): 3 дахь төхөөрөмж чимээгүй зөвшөөрөгдөхгүй, pending + DEVICE_LIMIT', async () => {
  const { enroll, call, setPolicy } = setup();
  setPolicy('revit.max_devices', '2'); // 2026-10-02-оос өгөгдмөл нь хязгааргүй
  const k1 = await makeDeviceKey();
  const k2 = await makeDeviceKey();
  const k3 = await makeDeviceKey();
  assert.equal((await enroll(10, DEV_A, k1)).json.status, 'auto');
  assert.equal((await enroll(10, DEV_B, k2)).json.status, 'auto');
  const third = await enroll(10, DEV_C, k3);
  assert.equal(third.json.status, 'pending');
  assert.equal(third.json.reason, 'limit');
  assert.match(String(third.json.message), /тоо дүүрсэн/);
  // Бодлогыг өөрчилбөл (max=3) шинэ төхөөрөмж автомат
  await call(1, 'admin', 'PUT', '/license/admin/policy', { max_devices: 3 });
  const k4 = await makeDeviceKey();
  const k5 = await makeDeviceKey();
  void k4;
  assert.equal((await enroll(10, 'd'.repeat(64), k5)).json.status, 'auto');
});

test('enroll_approval=admin: ажлын компьютертэй таарсан ч автомат зөвшөөрөгдөхгүй; admin зөвшөөрнө', async () => {
  const { db, call, enroll, license } = setup();
  assert.equal((await call(1, 'admin', 'PUT', '/license/admin/policy', { enroll_approval: 'bogus' })).status, 400);
  await call(1, 'admin', 'PUT', '/license/admin/policy', { enroll_approval: 'admin' });
  const key = await makeDeviceKey();
  const e = await enroll(10, DEV_A, key);
  assert.equal(e.json.status, 'pending');
  assert.equal(e.json.reason, 'admin_required');
  assert.equal((await license(10, DEV_A, key)).json.code, 'DEVICE_PENDING');
  const rowId = (db.prepare('SELECT id FROM revit_license_devices').get() as { id: number }).id;
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'approved' });
  assert.equal((await license(10, DEV_A, key)).status, 200);
});

test('TPM шаардсан бодлого: програмын түлхүүр → pending (DEVICE_KEY_WEAK)', async () => {
  const { call, enroll } = setup();
  await call(1, 'admin', 'PUT', '/license/admin/policy', { require_tpm: true });
  const e = await enroll(10, DEV_A, await makeDeviceKey('software'));
  assert.equal(e.json.status, 'pending');
  assert.equal(e.json.reason, 'weak');
  const f = await enroll(11, DEV_B, await makeDeviceKey('tpm'));
  assert.equal(f.json.status, 'auto');
});

/* ------------------------------------------------------------------ */
/*  Хувилбар, унтраалга, бодлого                                        */
/* ------------------------------------------------------------------ */

test('хувилбарын бодлого: min_version, хориглосон хувилбар, global унтраалга', async () => {
  const { call, enroll, license, proofFor } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  assert.equal((await license(10, DEV_A, key)).status, 200);

  // Хуучин хувилбар challenge ч авч чадахгүй; proof-ыг сайн хувилбараар авч, хуучин хувилбараар
  // илгээсэн ч (клиент худлаа хэлсэн) /license нь хувилбарыг дахин шалгана.
  const licenseAs = async (claimed: string | null, goodVersion = '9.9.9') => {
    const proof = await proofFor(key, 10, DEV_A, 'license', key.keyId, goodVersion);
    return call(10, 'engineer', 'POST', '/license', {
      device_id: DEV_A,
      hw: WORK_HW,
      ...(claimed ? { addin_version: claimed } : {}),
      proof,
    });
  };

  await call(1, 'admin', 'PUT', '/license/admin/policy', { min_version: '1.10.4' });
  const oldCh = await call(10, 'engineer', 'POST', '/device/challenge', { device_id: DEV_A, purpose: 'license', addin_version: '1.10.0' });
  assert.equal(oldCh.json.code, 'ADDIN_UPDATE_REQUIRED', 'хуучин хувилбар challenge ч авахгүй');
  assert.match(String(oldCh.json.error), /шинэчлэх/);
  let r = await licenseAs('1.10.0');
  assert.equal(r.json.code, 'ADDIN_UPDATE_REQUIRED');
  assert.equal((await licenseAs('1.10.4')).status, 200);
  assert.equal((await licenseAs('1.11.0')).status, 200);
  assert.equal((await licenseAs(null)).json.code, 'ADDIN_UPDATE_REQUIRED', 'хувилбараа хэлэхгүй клиент = хуучин / өөрчилсөн');

  await call(1, 'admin', 'PUT', '/license/admin/policy', { min_version: '', blocked_versions: ['1.9.2', '1.10.1'] });
  r = await licenseAs('1.10.1', '1.10.2');
  assert.equal(r.json.code, 'ADDIN_VERSION_BLOCKED');
  assert.equal((await licenseAs('1.10.2')).status, 200);

  await call(1, 'admin', 'PUT', '/license/admin/policy', { disabled: true });
  assert.equal((await call(10, 'engineer', 'POST', '/device/challenge', { device_id: DEV_A, purpose: 'license' })).json.code, 'REVIT_LICENSES_DISABLED');
  r = await license(10, DEV_A, null); // proof авах боломжгүй — /license ч шууд татгалзана
  assert.equal(r.json.code, 'REVIT_LICENSES_DISABLED');
  await call(1, 'admin', 'PUT', '/license/admin/policy', { disabled: false });
  assert.equal((await license(10, DEV_A, key)).status, 200);
});

test('бодлогын PUT: шалгалт, admin-д л, үйл явдал бүртгэгдэнэ', async () => {
  const { db, call } = setup();
  assert.equal((await call(10, 'engineer', 'PUT', '/license/admin/policy', { disabled: true })).status, 403);
  assert.equal((await call(1, 'admin', 'PUT', '/license/admin/policy', { min_version: 'abc' })).status, 400);
  assert.equal((await call(1, 'admin', 'PUT', '/license/admin/policy', { max_devices: -1 })).status, 400);
  assert.equal((await call(1, 'admin', 'PUT', '/license/admin/policy', { max_devices: 21 })).status, 400);
  assert.equal((await call(1, 'admin', 'PUT', '/license/admin/policy', { enroll_approval: 'x' })).status, 400);
  assert.equal((await call(1, 'admin', 'PUT', '/license/admin/policy', { legacy_token_policy: 'x' })).status, 400);
  assert.equal((await call(1, 'admin', 'PUT', '/license/admin/policy', {})).status, 400);
  const ok = await call(1, 'admin', 'PUT', '/license/admin/policy', { device_key_policy: 'required', legacy_token_policy: 'log' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.policy.deviceKeyPolicy, 'required');
  const ev = db.prepare(`SELECT event FROM revit_security_events WHERE event = 'policy_changed'`).all();
  assert.equal(ev.length, 1, 'нэг амжилттай өөрчлөлт (хоёр дахь нь нэг PUT)');
  // 0 / null = хязгааргүй; account = бүртгэлээр.
  const back = await call(1, 'admin', 'PUT', '/license/admin/policy', { max_devices: 0, enroll_approval: 'account' });
  assert.equal(back.status, 200);
  assert.equal(back.json.policy.maxDevices, null);
  assert.equal(back.json.policy.enrollApproval, 'account');
});

test('ӨГӨГДМӨЛ (account, 2026-10-02): ажлын PC биш компьютер нууц үгээр нэвтэрмэгц auto → лиценз + session; хязгааргүй; хаасан/цуцалсан хориотой', async () => {
  const { db, call, challenge, enroll, license, session } = setup({ mode: 'account' });
  const key = await makeDeviceKey();
  // Гэрийн компьютер (тулгалт таарахгүй) — admin-ы зөвшөөрөлгүйгээр шууд.
  const e = await enroll(10, DEV_B, key, HOME_HW);
  assert.equal(e.status, 200, JSON.stringify(e.json));
  assert.equal(e.json.status, 'auto');
  const r = await license(10, DEV_B, key, HOME_HW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.via, 'account');
  assert.ok(r.json.session && r.json.credential, 'түлхүүртэй төхөөрөмжид session + credential');
  assert.equal((await session(10, DEV_B, key)).status, 200);
  // Олон компьютер — хязгааргүй (өгөгдмөл).
  for (let i = 0; i < 4; i++) {
    const k = await makeDeviceKey();
    const dev = String(i).repeat(64);
    assert.equal((await enroll(10, dev, k, HOME_HW)).json.status, 'auto', `төхөөрөмж ${i + 3}`);
    assert.equal((await license(10, dev, k, HOME_HW)).status, 200);
  }
  // Ирцийн компьютергүй ажилтан (Дорж) ч шууд.
  const kd = await makeDeviceKey();
  assert.equal((await enroll(11, DEV_C, kd, HOME_HW)).json.status, 'auto');
  // Хуулсан лиценз: өөр түлхүүрээр proof → татгалзана (түлхүүр тухайн компьютерт).
  const thief = await makeDeviceKey();
  assert.equal((await license(10, DEV_B, thief, HOME_HW)).json.code, 'DEVICE_PROOF_INVALID');
  // Идэвхгүй ажилтан — бүртгэлийн эхний алхамд (challenge) л хориотой.
  const gone = await challenge(12, 'e'.repeat(64), 'enroll');
  assert.equal(gone.status, 403);
  assert.equal(gone.json.code, 'USER_INACTIVE');
  // Admin хаавал — хориотой.
  const id = (db.prepare('SELECT id FROM revit_license_devices WHERE device_id = ?').get(DEV_B) as { id: number }).id;
  assert.equal((await call(1, 'admin', 'PATCH', `/license/admin/devices/${id}`, { status: 'blocked' })).status, 200);
  const blocked = await challenge(10, DEV_B, 'license');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'DEVICE_BLOCKED');
});

/* ------------------------------------------------------------------ */
/*  Хуучин (түлхүүргүй) add-in, шилжилт                                  */
/* ------------------------------------------------------------------ */

test('шилжилт: түлхүүргүй хуучин add-in optional үед ажиллана (sec=legacy), required үед DEVICE_KEY_REQUIRED', async () => {
  const { call, license, setPolicy } = setup();
  let r = await license(10, DEV_A, null);
  assert.equal(r.status, 200);
  assert.equal(r.json.sec, 'legacy');
  assert.equal(r.json.session, undefined, 'хуучин замд session / credential байхгүй');
  assert.equal(r.json.credential, undefined);
  setPolicy('revit.device_key_policy', 'required');
  r = await license(10, DEV_A, null);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'DEVICE_KEY_REQUIRED');
  void call;
});

test('downgrade: түлхүүр бүртгэгдсэний дараа proof-ыг орхиход хуучин зам руу ОРОХГҮЙ', async () => {
  const { license, enroll, setPolicy } = setup();
  setPolicy('revit.device_key_policy', 'optional'); // шилжилтийн үе
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  const r = await license(10, DEV_A, null);
  assert.equal(r.json.code, 'DEVICE_PROOF_REQUIRED');
});

test('add-in түлхүүртэй ч сервер мэдэхгүй (цуцлагдсан): proof илгээвэл DEVICE_NOT_ENROLLED → дахин бүртгэх', async () => {
  const { call } = setup();
  const r = await call(10, 'engineer', 'POST', '/license', {
    device_id: DEV_A,
    hw: WORK_HW,
    addin_version: '1.10.0',
    proof: { challenge_id: 'f'.repeat(32), signature: 'x' },
  });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'DEVICE_NOT_ENROLLED');
});

/* ------------------------------------------------------------------ */
/*  Session                                                             */
/* ------------------------------------------------------------------ */

test('session: proof-оор шинэчилнэ; proof-гүй / хуурамч / replay → татгалзана', async () => {
  const { enroll, license, session, proofFor, call } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  await license(10, DEV_A, key);

  const ok = await session(10, DEV_A, key);
  assert.equal(ok.status, 200);
  const t = await verifyToken(ok.json.session.token, JWT_SECRET);
  assert.equal(t!.purpose, 'revit');

  assert.equal((await session(10, DEV_A, null)).json.code, 'DEVICE_PROOF_REQUIRED');
  const proof = await proofFor(key, 10, DEV_A, 'session');
  const body = { device_id: DEV_A, addin_version: '1.10.0', proof };
  assert.equal((await call(10, 'engineer', 'POST', '/device/session', body)).status, 200);
  assert.equal((await call(10, 'engineer', 'POST', '/device/session', body)).json.code, 'DEVICE_PROOF_INVALID', 'replay');
  const attacker = await makeDeviceKey();
  const forged = await proofFor(attacker, 10, DEV_A, 'session');
  assert.equal(
    (await call(10, 'engineer', 'POST', '/device/session', { device_id: DEV_A, addin_version: '1.10.0', proof: forged })).json.code,
    'DEVICE_PROOF_INVALID',
  );
  // түлхүүргүй төхөөрөмжид session ҮГҮЙ
  assert.equal((await session(10, DEV_C, null)).json.code, 'DEVICE_NOT_ENROLLED');
});

test('session: ажлын компьютертэй таарахаа больсон төхөөрөмж (лиценз унасан) session авч чадахгүй', async () => {
  const { db, enroll, license, session } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  // Ирцийн төхөөрөмжийг admin reset хийв.
  db.prepare('UPDATE attendance_devices SET revoked_at = datetime(\'now\')').run();
  const r = await license(10, DEV_A, key);
  assert.equal(r.status, 403);
  const s = await session(10, DEV_A, key);
  assert.equal(s.status, 403);
});

test('challenge: нэг хэрэглэгчийн хүлээгдэж буй challenge хязгаартай (429)', async () => {
  const { enroll, challenge } = setup();
  await enroll(10, DEV_A, await makeDeviceKey());
  let last = 200;
  for (let i = 0; i < 40; i++) last = (await challenge(10, DEV_A, 'license')).status;
  assert.equal(last, 429);
});

/* ------------------------------------------------------------------ */
/*  Fail-closed                                                         */
/* ------------------------------------------------------------------ */

test('FAIL-CLOSED: аюулгүй байдлын хүснэгт уншигдахгүй бол лиценз ОЛГОХГҮЙ (503)', async () => {
  const { db, license } = setup();
  const key = await makeDeviceKey();
  db.exec('DROP TABLE revit_device_keys');
  const r = await license(10, DEV_A, null);
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'SECURITY_CHECK_FAILED');
  assert.equal(r.json.lease, undefined);
  void key;
});

test('FAIL-CLOSED: бодлого (app_settings) уншигдахгүй бол лиценз ОЛГОХГҮЙ', async () => {
  const { db, license } = setup();
  db.exec('DROP TABLE app_settings');
  const r = await license(10, DEV_A, null);
  assert.equal(r.status, 503);
  assert.equal(r.json.lease, undefined);
});

test('FAIL-CLOSED: REVIT_LICENSE_KEY байхгүй → 503, гарын үсэггүй лиценз үгүй', async () => {
  const { license } = setup({ withKey: false });
  const r = await license(10, DEV_A, null);
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'LICENSE_NOT_CONFIGURED');
});

test('сүлжээ: OFFICE_ACCESS_ENFORCED үед оффисын IP эсвэл remote_access_allowed; D1 алдаа → fail-closed', async () => {
  const { db, license, enroll } = setup({ office: true });
  const key = await makeDeviceKey();
  // оффисын IP-гүй, remote эрхгүй
  let r = await enroll(10, DEV_A, key, WORK_HW, { ip: '203.0.113.9' });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'office_network_required');
  // оффисын IP
  db.prepare("INSERT INTO office_ips (ip_address, is_active) VALUES ('198.51.100.0/24', 1)").run();
  r = await enroll(10, DEV_A, key, WORK_HW, { ip: '198.51.100.7' });
  assert.equal(r.status, 200);
  assert.equal((await license(10, DEV_A, key, WORK_HW, '1.10.0', { ip: '198.51.100.7' })).status, 200);
  // гаднаас: proof зөв ч оффисын IP / remote эрхгүй → лиценз ҮГҮЙ (оффисын Wi-Fi ≠ лиценз, мөн эсрэгээр)
  assert.equal((await license(10, DEV_A, key, WORK_HW, '1.10.0', { ip: '203.0.113.9' })).json.code, 'office_network_required');
  // remote_access_allowed
  db.prepare('UPDATE users SET remote_access_allowed = 1 WHERE id = 10').run();
  assert.equal((await license(10, DEV_A, key, WORK_HW, '1.10.0', { ip: '203.0.113.9' })).status, 200);
  // office_ips уншигдахгүй → 503
  db.prepare('UPDATE users SET remote_access_allowed = 0 WHERE id = 10').run();
  db.exec('DROP TABLE office_ips');
  const failed = await license(10, DEV_A, key, WORK_HW, '1.10.0', { ip: '198.51.100.7' });
  assert.equal(failed.status, 503);
  assert.equal(failed.json.lease, undefined);
});

test('оффисын Wi-Fi ГАНЦААРАА лиценз биш: танихгүй компьютер оффисын IP-тэй ч DEVICE_NOT_ENROLLED / pending', async () => {
  const { db, call, license } = setup({ office: true });
  db.prepare("INSERT INTO office_ips (ip_address, is_active) VALUES ('198.51.100.0/24', 1)").run();
  const o = { ip: '198.51.100.7' };
  const r = await call(10, 'engineer', 'POST', '/license', {
    device_id: DEV_C,
    hw: HOME_HW,
    addin_version: '1.10.0',
    proof: { challenge_id: 'a'.repeat(32), signature: 'AAAA' },
  }, o);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'DEVICE_NOT_ENROLLED');
  void license;
});

/* ------------------------------------------------------------------ */
/*  Үйл явдлын бүртгэл, админ харагдац                                  */
/* ------------------------------------------------------------------ */

test('үйл явдал: «яагаад ажиллахгүй вэ» + «танихгүй компьютер оролдсон уу» харагдана', async () => {
  const { call, enroll, license } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  await license(10, DEV_A, null); // proof_required
  await call(10, 'engineer', 'POST', '/license', {
    device_id: DEV_B,
    hw: HOME_HW,
    addin_version: '1.10.0',
  }); // legacy (optional үед) — NOT_WORK_PC
  const ev = await call(1, 'admin', 'GET', '/license/admin/events?user_id=10');
  assert.equal(ev.status, 200);
  const kinds = (ev.json.events as Array<{ event: string }>).map((e) => e.event);
  assert.ok(kinds.includes('enroll_auto'));
  assert.ok(kinds.includes('license_denied') || kinds.includes('unknown_device'));
  assert.equal((await call(10, 'engineer', 'GET', '/license/admin/events')).status, 403);
});

test('админ жагсаалт: түлхүүрийн хамгаалалт, богино код; MachineGuid / түлхүүр / SID ХЭЗЭЭ Ч гарахгүй', async () => {
  const { call, enroll } = setup();
  const key = await makeDeviceKey('tpm');
  await enroll(10, DEV_A, key);
  const list = await call(1, 'admin', 'GET', '/license/admin/users/10/devices');
  assert.equal(list.status, 200);
  const d = list.json.devices[0];
  assert.equal(d.security_level, 'tpm');
  assert.equal(d.key_short_id, key.keyId.slice(0, 8));
  assert.equal(d.short_id, DEV_A.slice(0, 8));
  assert.equal(d.status, 'auto');
  assert.ok(d.enrolled_at && d.last_proof_at);
  const raw = JSON.stringify(list.json);
  assert.ok(!raw.includes(DEV_A), 'түүхий device_id гарахгүй');
  assert.ok(!raw.includes(key.keyId) && !raw.includes(key.pub.x), 'түлхүүр гарахгүй');
  assert.equal(list.json.max_devices, null, 'өгөгдмөл — хязгааргүй (2026-10-02)');
});

/* ------------------------------------------------------------------ */
/*  Лицензийн гарын үсгийн түлхүүр солих (overlap)                      */
/* ------------------------------------------------------------------ */

test('түлхүүр солих: хоёр kid-тэй overlap — хуучин, шинэ лиценз тус тусдаа нийтийн түлхүүрээр шалгагдана', async () => {
  const mk = async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    return priv;
  };
  const a = await mk();
  const b = await mk();
  const toKey = (kid: string, j: JsonWebKey) => L.parseSigningKey(JSON.stringify({ kid, kty: 'EC', crv: 'P-256', d: j.d, x: j.x, y: j.y }))!;
  const keyA = toKey('mgl-2026-10', a);
  const keyB = toKey('mgl-2027-01', b);
  const mkPayload = (kid: string) =>
    L.buildLeasePayload({ kid, user: { id: 1, username: 'u', full_name: 'U', role: 'engineer' }, deviceId: DEV_A, via: 'match', nowSec: 1_800_000_000, sec: 'tpm', dk: 'k' });
  const leaseA = await L.signLease(mkPayload(keyA.kid), keyA);
  const leaseB = await L.signLease(mkPayload(keyB.kid), keyB);
  assert.ok(await L.verifyLease(leaseA, { x: a.x, y: a.y }));
  assert.ok(await L.verifyLease(leaseB, { x: b.x, y: b.y }));
  // Түлхүүр хооронд солилцохгүй
  assert.equal(await L.verifyLease(leaseA, { x: b.x, y: b.y }), null);
  assert.equal(await L.verifyLease(leaseB, { x: a.x, y: a.y }), null);
});

/* ------------------------------------------------------------------ */
/*  Бодит authMiddleware + legacy token guard                           */
/* ------------------------------------------------------------------ */

async function authApp() {
  const s = setup();
  s.db.exec(`CREATE TABLE IF NOT EXISTS _dummy (id INTEGER)`);
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('/api/*', authMiddleware as never);
  app.use('/api/revit/*', revitLegacyTokenGuard as never);
  app.route('/api/revit', licenseRouter as never);
  app.route('/api/revit', deviceRouter as never);
  app.get('/api/projects', (c) => c.json({ ok: true }));
  app.get('/api/users', (c) => c.json({ ok: true }));
  app.get('/api/revit/context', (c) => c.json({ ok: true }));
  const { signToken } = await import('../lib/jwt.ts');
  const get = async (path: string, token: string) => {
    const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } }, s.env);
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  return { ...s, app, get, signToken };
}

test('authMiddleware: revit-refresh credential ЗӨВХӨН лиценз/session замд; бусад /api-д 401', async () => {
  invalidateRevitSessionCache();
  invalidateTokenCache();
  const a = await authApp();
  const cred = await a.signToken({ sub: 10, role: 'engineer', purpose: 'revit-refresh', dev: DEV_A, kid: 'k' }, JWT_SECRET, 24);
  assert.equal((await a.get('/api/projects', cred)).status, 401);
  assert.equal((await a.get('/api/revit/context', cred)).status, 401);
  const res = await a.app.request(
    '/api/revit/device/challenge',
    { method: 'POST', headers: { Authorization: `Bearer ${cred}`, 'content-type': 'application/json' }, body: JSON.stringify({ device_id: 'x', purpose: 'license' }) },
    a.env,
  );
  assert.equal(res.status, 400, 'замд хүрсэн (өөрийн шалгалтаар 400), 401 БИШ');
});

test('authMiddleware: revit session — төхөөрөмж хаагдахад (60 сек кэш цэвэрлэгдсэний дараа) хүчингүй', async () => {
  invalidateRevitSessionCache();
  invalidateTokenCache();
  const a = await authApp();
  const key = await makeDeviceKey();
  await a.enroll(10, DEV_A, key);
  const lic = await a.license(10, DEV_A, key);
  assert.equal(lic.status, 200);
  const tok = lic.json.session.token as string;
  assert.equal((await a.get('/api/projects', tok)).status, 200);
  // Хуурамч kid-тэй session (түлхүүр таарахгүй) хүчингүй
  const bad = await a.signToken({ sub: 10, role: 'engineer', purpose: 'revit', dev: DEV_A, kid: 'f'.repeat(64) }, JWT_SECRET, 0.5);
  assert.equal((await a.get('/api/projects', bad)).status, 401);
  // dev/kid claim-гүй 'revit' токен хүчингүй
  const noClaims = await a.signToken({ sub: 10, role: 'engineer', purpose: 'revit' }, JWT_SECRET, 0.5);
  assert.equal((await a.get('/api/projects', noClaims)).status, 401);
  // admin хаав
  const rowId = (a.db.prepare('SELECT id FROM revit_license_devices').get() as { id: number }).id;
  await a.call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'blocked' }); // кэшийг цэвэрлэнэ
  assert.equal((await a.get('/api/projects', tok)).status, 401);
});

test('authMiddleware: global унтраалга асаахад session токен хүчингүй болно', async () => {
  invalidateRevitSessionCache();
  invalidateTokenCache();
  const a = await authApp();
  const key = await makeDeviceKey();
  await a.enroll(10, DEV_A, key);
  const tok = (await a.license(10, DEV_A, key)).json.session.token as string;
  assert.equal((await a.get('/api/projects', tok)).status, 200);
  await a.call(1, 'admin', 'PUT', '/license/admin/policy', { disabled: true }); // кэшийг цэвэрлэнэ
  assert.equal((await a.get('/api/projects', tok)).status, 401);
});

test('legacy 365 хоногийн mcp токен: allow → ажиллана; deny → /api/revit/*-д 403 (лиценз/төхөөрөмж чөлөөт)', async () => {
  invalidateRevitSessionCache();
  invalidateTokenCache();
  const a = await authApp();
  const mcp = await a.signToken({ sub: 10, role: 'engineer', purpose: 'mcp' }, JWT_SECRET, 24 * 365);
  assert.equal((await a.get('/api/revit/context', mcp)).status, 200);
  await a.call(1, 'admin', 'PUT', '/license/admin/policy', { legacy_token_policy: 'deny' });
  const r = await a.get('/api/revit/context', mcp);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'DEVICE_SESSION_REQUIRED');
  // Бусад (revit биш) /api хэвээр — Claude Desktop, MCP-ийн замууд хөндөгдөхгүй
  assert.equal((await a.get('/api/projects', mcp)).status, 200);
  // Шилжих зам: хуучин токеноор /license, /device/challenge ажиллана
  const res = await a.app.request(
    '/api/revit/device/challenge',
    { method: 'POST', headers: { Authorization: `Bearer ${mcp}`, 'content-type': 'application/json' }, body: JSON.stringify({ device_id: DEV_A, purpose: 'enroll', addin_version: '1.10.0' }) },
    a.env,
  );
  assert.equal(res.status, 200);
});

/* ------------------------------------------------------------------ */
/*  Хараат шинжилгээний (review) олдвор бүрийн регресс тест              */
/* ------------------------------------------------------------------ */

test('C1: /mcp (resolveExternalToken) revit-refresh / revit токеныг татгалзана (эх кодын хамгаалалт)', () => {
  // `index.ts`-ийг шууд импортлох боломжгүй (Worker entry) — тиймээс нэг удаа чимээгүй no-op болсон засварыг
  // эх кодын түвшинд баталгаажуулна.
  const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const i = src.indexOf('resolveExternalToken: async');
  assert.ok(i > 0);
  const body = src.slice(i, i + 4000);
  assert.match(body, /payload\.purpose === 'revit' \|\| payload\.purpose === 'revit-refresh'\) return null/);
  assert.ok(!/payload\.purpose === 'mcp'\) return null/.test(body), "'mcp' purpose ХЭЗЭЭ Ч татгалзагдахгүй");
});

test('C2: purpose-той токен (session, credential, mcp) 365 хоногийн mcp токен ЦОХИЖ ЧАДАХГҮЙ', async () => {
  const { default: authRouter } = await import('./auth.ts');
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    c.set('user', JSON.parse(c.req.header('x-test-user')!));
    await next();
  });
  app.route('/', authRouter as never);
  const mint = async (extra: Record<string, unknown>) => {
    const res = await app.request(
      '/mcp-token',
      { method: 'POST', headers: { 'x-test-user': JSON.stringify({ sub: 10, role: 'engineer', iat: 1, exp: 9e9, ...extra }) } },
      { JWT_SECRET },
    );
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  assert.equal((await mint({})).status, 200, 'нууц үгээр нэвтэрсэн (purpose-гүй) токен цохино');
  assert.equal((await mint({ purpose: 'revit', dev: DEV_A, kid: 'k' })).status, 403);
  assert.equal((await mint({ purpose: 'revit-refresh', dev: DEV_A, kid: 'k' })).status, 403);
  assert.equal((await mint({ purpose: 'mcp' })).status, 403);
});

test('H1: түлхүүр бүртгүүлсэн ажилтан ӨӨР device_id-аар түлхүүргүй хуучин зам руу орж чадахгүй (optional үед ч)', async () => {
  const { enroll, license, call } = setup();
  await enroll(10, DEV_A, await makeDeviceKey());
  // халдагч токентой, хуурамч device_id + жинхэнэ ажлын PC-ийн hw
  const r = await license(10, 'e'.repeat(64), null);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'DEVICE_KEY_REQUIRED');
  assert.equal(r.json.lease, undefined);
  // Түлхүүр бүртгүүлж үзээгүй өөр ажилтан (Дорж) хуучин замаар ажиллана (шилжилтийн үе)
  assert.equal((await license(11, DEV_B, null)).status, 200);
  // Цуцалсан ч (түлхүүр устсан) «түлхүүр шаардлагатай» хэвээр
  const rowId = (await call(1, 'admin', 'GET', '/license/admin/users/10/devices')).json.devices[0].id;
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'revoked' });
  assert.equal((await license(10, 'f'.repeat(64), null)).json.code, 'DEVICE_KEY_REQUIRED');
});

test('H2: ижил түлхүүрийн дахин бүртгэл admin-ы шийдвэрийг (pending / blocked) ДАРАХГҮЙ', async () => {
  const { db, call, enroll } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  const rowId = (db.prepare('SELECT id FROM revit_license_devices').get() as { id: number }).id;
  // admin pending болгов — ажилтан ажлын PC-ийн hw-ээр дахин бүртгүүлээд auto болгож чадахгүй
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'pending' });
  const again = await enroll(10, DEV_A, key);
  assert.equal(again.status, 200);
  assert.equal(again.json.status, 'pending');
  assert.equal((db.prepare('SELECT status FROM revit_license_devices').get() as { status: string }).status, 'pending');
  // blocked мөр дахин бүртгэгдэхгүй
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'blocked' });
  assert.equal((await enroll(10, DEV_A, key)).json.code, 'DEVICE_BLOCKED');
  assert.equal((db.prepare('SELECT status FROM revit_license_devices').get() as { status: string }).status, 'blocked');
});

test('M1: proof-гүй / буруу proof-той /license нь жинхэнэ төхөөрөмжийн last_result, hw-г бохирдуулахгүй', async () => {
  const { db, enroll, license } = setup();
  const key = await makeDeviceKey();
  await enroll(10, DEV_A, key);
  await license(10, DEV_A, key); // ok_match
  const before = db.prepare('SELECT last_result, hw_json FROM revit_license_devices').get() as { last_result: string; hw_json: string };
  assert.equal(before.last_result, 'ok_match');
  await license(10, DEV_A, null, HOME_HW); // халдагч: proof-гүй, өөр hw
  const after = db.prepare('SELECT last_result, hw_json FROM revit_license_devices').get() as { last_result: string; hw_json: string };
  assert.deepEqual(after, before);
  // session (30 мин) үргэлжлэн авагдана
  assert.equal((await license(10, DEV_A, key)).status, 200);
});

test('M4: цуцлагдсан түлхүүр дахин бүртгэгдэхгүй (tombstone) — ижил, өөр төхөөрөмж дээр ч', async () => {
  const { db, call, enroll } = setup();
  const key = await makeDeviceKey('software');
  await enroll(10, DEV_A, key);
  const rowId = (db.prepare('SELECT id FROM revit_license_devices').get() as { id: number }).id;
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'revoked', reason: 'алдагдсан' });
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${rowId}`, { status: 'pending' });
  const same = await enroll(10, DEV_A, key);
  assert.equal(same.status, 409);
  assert.equal(same.json.code, 'DEVICE_KEY_MISMATCH');
  assert.equal((await enroll(11, DEV_B, key)).status, 409, 'өөр хүн / төхөөрөмж дээр ч');
  assert.equal((await enroll(10, DEV_A, await makeDeviceKey())).status, 200, 'ШИНЭ түлхүүр зөвшөөрөгдөнө');
  // мөрийг устгах нь ч түлхүүрийг tombstone-д оруулна
  const k2 = await makeDeviceKey();
  await enroll(11, DEV_C, k2);
  const row2 = (db.prepare('SELECT id FROM revit_license_devices WHERE user_id = 11').get() as { id: number }).id;
  await call(1, 'admin', 'DELETE', `/license/admin/devices/${row2}`);
  assert.equal((await enroll(11, DEV_C, k2)).status, 409);
});

test('M5: role өөрчлөгдсөн хүний session хүчингүй (хуучин role-оор 30 минут үргэлжлэхгүй)', async () => {
  invalidateRevitSessionCache();
  invalidateTokenCache();
  const a = await authApp();
  const key = await makeDeviceKey();
  await a.enroll(10, DEV_A, key);
  const tok = (await a.license(10, DEV_A, key)).json.session.token as string;
  assert.equal((await a.get('/api/projects', tok)).status, 200);
  a.db.prepare("UPDATE users SET role = 'architect' WHERE id = 10").run();
  invalidateRevitSessionCache();
  assert.equal((await a.get('/api/projects', tok)).status, 401);
});

test('session scope: revit session add-in-ий замуудад л хүчинтэй; session_scope=open нь түр нөхөн сэргээнэ', async () => {
  invalidateRevitSessionCache();
  invalidateTokenCache();
  const a = await authApp();
  const key = await makeDeviceKey();
  await a.enroll(10, DEV_A, key);
  const tok = (await a.license(10, DEV_A, key)).json.session.token as string;
  assert.equal((await a.get('/api/projects', tok)).status, 200);
  assert.equal((await a.get('/api/revit/context', tok)).status, 200);
  const out = await a.get('/api/users', tok); // add-in дуудахгүй зам
  assert.equal(out.status, 403);
  assert.equal(out.json.code, 'SESSION_SCOPE');
  await a.call(1, 'admin', 'PUT', '/license/admin/policy', { session_scope: 'open' });
  assert.equal((await a.get('/api/users', tok)).status, 200);
  assert.equal((await a.call(1, 'admin', 'PUT', '/license/admin/policy', { session_scope: 'x' })).status, 400);
});

test('үйл явдлын бүртгэл: ижил үйл явдал 10 минутад нэг л мөр (хүснэгт дүүргэх боломжгүй)', async () => {
  const { db, license } = setup();
  for (let i = 0; i < 6; i++) await license(10, DEV_A, null, HOME_HW);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM revit_security_events WHERE event IN ('license_denied','unknown_device')").get() as { n: number }).n;
  assert.equal(n, 2, 'unknown_device (анхны) + license_denied (мөр үүссэний дараа) — тус бүр нэг л удаа');
  // санамсаргүй device_id-ууд нь цагийн хязгаартай
  for (let i = 0; i < 200; i++) {
    const dev = i.toString(16).padStart(64, '0');
    await license(10, dev, null, HOME_HW);
  }
  const total = (db.prepare('SELECT COUNT(*) AS n FROM revit_security_events').get() as { n: number }).n;
  assert.ok(total <= 120, `цагт ≤ 120 мөр, бодит ${total}`);
});
