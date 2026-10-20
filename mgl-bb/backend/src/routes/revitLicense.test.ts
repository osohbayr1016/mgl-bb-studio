// `POST /api/revit/license` + админы замууд — БОДИТ SQLite (0328 + 0374 миграцыг
// файлаас нь ажиллуулна), D1 shim, Hono `app.request()`.  Лицензийг тестийн
// нийтийн түлхүүрээр шалгана (add-in-ий `LicenseLease.Verify`-ийн ижил гэрээ).
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

const router = (await import('./revitLicense.ts')).default;
const L = await import('../lib/revitLicense.ts');

const TEST_KEY_JSON =
  '{"kid":"test-0001","kty":"EC","crv":"P-256","d":"bOJ9ULu0YkNP8ywDgnEjRY-9Zwb19Y8ORTDIwF9-Lcs","x":"4u4bnjuUzrYh_tLI0GSzO2rD2ZKO_hAbIrhAZybljuk","y":"n6YABSm6JZQPoQIqNAOQyuXJbCAJJNY0hlOkjBvgqPo"}';
const TEST_PUB = JSON.parse(TEST_KEY_JSON) as { x: string; y: string };

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

const migration = (name: string) =>
  readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

const DEV_A = 'a'.repeat(64);
const DEV_B = 'b'.repeat(64);
const WORK_HW = { gpus: ['NVIDIA GeForce RTX 3070'], cores: 20, screens: ['3440x1440', '1920x1080'] };
const HOME_HW = { gpus: ['NVIDIA GeForce RTX 4090'], cores: 32, screens: ['2560x1440'] };

/**
 * `mode` — `revit.enroll_approval`.  Энэ файлын ихэнх тест 2026-10-01-ний «зөвхөн ажлын компьютер» дүрмийг (одоо
 * `auto` сонголт) шалгадаг тул өгөгдмөл нь `auto`; `account` = мөр бичихгүй (жинхэнэ өгөгдмөл бодлого).
 */
function setup(withKey = true, mode: 'auto' | 'account' = 'auto') {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, status TEXT,
      attendance_device_id TEXT, attendance_device_label TEXT, attendance_device_bound_at TEXT);
    INSERT INTO users (id, username, full_name, role, status) VALUES
      (1, 'admin', 'Админ', 'admin', 'active'),
      (10, 'bat', 'Б.Бат', 'engineer', 'active'),
      (11, 'dorj', 'Д.Дорж', 'architect', 'active'),
      (12, 'gone', 'Гарсан', 'engineer', 'inactive'),
      (13, 'cli', 'Захиалагч', 'client', 'active');
  `);
  db.exec(migration('0328_attendance_devices.sql'));
  db.exec(migration('0374_revit_license_devices.sql'));
  db.exec(migration('0375_revit_device_keys.sql'));
  db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER)`);
  if (mode !== 'account') db.prepare(`INSERT INTO app_settings (key, value) VALUES ('revit.enroll_approval', ?)`).run(mode);
  // Бат-ын ирцийн ажлын компьютер (хөтчөөс): RTX 3070, 20 цөм, 3440×1440 @ 114 %.
  db.prepare(
    `INSERT INTO attendance_devices (user_id, browser_id, hw_hash, hw_json, bound_via, bound_at)
     VALUES (10, 'br-1', 'h', ?, 'first', '2026-09-22T08:00:00')`,
  ).run(
    JSON.stringify({
      gpu: 'nvidia geforce rtx 3070',
      cores: 20,
      screen: '3018x1264',
      platform: 'win32',
      tz: 'Asia/Ulaanbaatar',
      memory: 8,
    }),
  );
  // Дорж: Brave хөтөч — GPU нуугдсан, тулгах боломжгүй.
  db.prepare(
    `INSERT INTO attendance_devices (user_id, browser_id, hw_hash, hw_json, bound_via, bound_at)
     VALUES (11, 'br-2', 'h2', ?, 'first', '2026-09-22T08:00:00')`,
  ).run(JSON.stringify({ gpu: 'brave', cores: 24, screen: '3840x2160', platform: 'win32', tz: 'Asia/Shanghai' }));

  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/', router as never);
  const env = { DB: d1Shim(db), REVIT_LICENSE_KEY: withKey ? TEST_KEY_JSON : undefined };
  const call = async (sub: number, role: string, method: string, path: string, body?: unknown) => {
    const res = await app.request(
      path,
      {
        method,
        headers: {
          'x-test-user': JSON.stringify({ sub, role }),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
    );
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  const lease = (sub: number, role: string, device_id: string, hw: unknown) =>
    call(sub, role, 'POST', '/license', { device_id, hw, addin_version: '1.9.0', revit_year: '2027' });
  return { db, call, lease };
}

test('ажлын компьютер таарвал гарын үсэгтэй 12 цагийн лиценз', async () => {
  const { db, lease } = setup();
  const r = await lease(10, 'engineer', DEV_A, WORK_HW);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.via, 'match');
  const payload = await L.verifyLease(r.json.lease, TEST_PUB);
  assert.ok(payload, 'гарын үсэг тестийн түлхүүрээр шалгагдана');
  assert.equal(payload!.sub, 10);
  assert.equal(payload!.dev, DEV_A);
  assert.equal(payload!.nm, 'Б.Бат');
  assert.equal(payload!.kid, 'test-0001');
  assert.equal(payload!.exp - payload!.iat, 12 * 3600);
  assert.equal(payload!.rfa - payload!.iat, 3600);
  assert.equal(payload!.sec, 'legacy', 'түлхүүргүй хуучин зам');
  const row = db
    .prepare('SELECT status, last_result, bound_attendance_device_id, addin_version, last_lease_at FROM revit_license_devices WHERE user_id = 10')
    .get() as Record<string, unknown>;
  assert.equal(row.status, 'auto');
  assert.equal(row.last_result, 'ok_match');
  assert.equal(row.bound_attendance_device_id, 1);
  assert.equal(row.addin_version, '1.9.0');
  assert.ok(row.last_lease_at);
});

test('ӨГӨГДМӨЛ (account, 2026-10-02): гэрийн/ирцгүй/VM компьютер ч бүртгэлээр лиценз авна; идэвхгүй, client, хаасан нь хориотой', async () => {
  const { db, call, lease } = setup(true, 'account');
  // Ажлын компьютер таарсан ч «match» гэж тэмдэглэгдсээр.
  assert.equal((await lease(10, 'engineer', DEV_A, WORK_HW)).json.via, 'match');
  // Гэрийн компьютер — тулгалт таарахгүй ч бүртгэлээр.
  const home = await lease(10, 'engineer', DEV_B, HOME_HW);
  assert.equal(home.status, 200, JSON.stringify(home.json));
  assert.equal(home.json.via, 'account');
  const p = await L.verifyLease(home.json.lease, TEST_PUB);
  assert.equal(p!.dev, DEV_B, 'лиценз тухайн компьютерт уягдсан хэвээр');
  assert.equal(p!.via, 'account');
  const row = db.prepare('SELECT status, last_result FROM revit_license_devices WHERE device_id = ?').get(DEV_B) as Record<string, unknown>;
  assert.equal(row.status, 'auto');
  assert.equal(row.last_result, 'ok_account');
  // Ирцийн компьютер огт бүртгэлгүй (Дорж — Brave) ба техник шинж уншигдахгүй (VM) — мөн бүртгэлээр.
  assert.equal((await lease(11, 'architect', 'e'.repeat(64), HOME_HW)).status, 200);
  assert.equal((await lease(10, 'engineer', 'f'.repeat(64), { gpus: [], cores: null, screens: [] })).status, 200);
  // Хориг хэвээр.
  assert.equal((await lease(12, 'engineer', '1'.repeat(64), HOME_HW)).json.code, 'USER_INACTIVE');
  assert.equal((await lease(13, 'client', '2'.repeat(64), HOME_HW)).json.code, 'ROLE_NOT_ALLOWED');
  const id = (db.prepare('SELECT id FROM revit_license_devices WHERE device_id = ?').get(DEV_B) as { id: number }).id;
  assert.equal((await call(1, 'admin', 'PATCH', `/license/admin/devices/${id}`, { status: 'blocked' })).status, 200);
  assert.equal((await lease(10, 'engineer', DEV_B, HOME_HW)).json.code, 'DEVICE_BLOCKED');
  // Админы жагсаалт: хязгааргүй, бодлого харагдана.
  const list = await call(1, 'admin', 'GET', '/license/admin/users/10/devices');
  assert.equal(list.json.max_devices, null);
  assert.equal(list.json.enroll_approval, 'account');
});

test('өөр компьютер (гэр) → 403 NOT_WORK_PC, оролдлого бүртгэгдэнэ, лиценз олгохгүй', async () => {
  const { db, lease } = setup();
  const r = await lease(10, 'engineer', DEV_B, HOME_HW);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NOT_WORK_PC');
  assert.equal(r.json.lease, undefined);
  assert.match(String(r.json.error), /ажлын компьютер/);
  const row = db.prepare('SELECT status, last_result, last_lease_at FROM revit_license_devices WHERE device_id = ?').get(DEV_B) as Record<string, unknown>;
  assert.equal(row.last_result, 'NOT_WORK_PC');
  assert.equal(row.last_lease_at, null);
});

test('админ зөвшөөрвөл тулгалт таарахгүй компьютер ажиллана; хаавал таарсан ч ажиллахгүй', async () => {
  const { call, lease } = setup();
  await lease(10, 'engineer', DEV_B, HOME_HW);
  const list = await call(1, 'admin', 'GET', '/license/admin/users/10/devices');
  assert.equal(list.status, 200);
  const home = list.json.devices.find((d: any) => d.last_result === 'NOT_WORK_PC');
  assert.ok(home);
  assert.equal(home.matches_work_pc, false);
  assert.match(home.hw, /nvidia geforce rtx 4090 · 32 цөм · 2560x1440/);
  assert.equal(list.json.work_pcs.length, 1);

  // Ажилтан өөрөө зөвшөөрөх ЭРХГҮЙ.
  const self = await call(10, 'engineer', 'PATCH', `/license/admin/devices/${home.id}`, { status: 'approved' });
  assert.equal(self.status, 403);

  const ok = await call(1, 'admin', 'PATCH', `/license/admin/devices/${home.id}`, { status: 'approved' });
  assert.equal(ok.status, 200);
  const r2 = await lease(10, 'engineer', DEV_B, HOME_HW);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.via, 'approved');

  // Ажлын компьютерыг хаах.
  await lease(10, 'engineer', DEV_A, WORK_HW);
  const list2 = await call(1, 'admin', 'GET', '/license/admin/users/10/devices');
  const work = list2.json.devices.find((d: any) => d.matches_work_pc);
  assert.ok(work);
  await call(1, 'admin', 'PATCH', `/license/admin/devices/${work.id}`, { status: 'blocked' });
  const r3 = await lease(10, 'engineer', DEV_A, WORK_HW);
  assert.equal(r3.status, 403);
  assert.equal(r3.json.code, 'DEVICE_BLOCKED');

  const bad = await call(1, 'admin', 'PATCH', `/license/admin/devices/${work.id}`, { status: 'whatever' });
  assert.equal(bad.status, 400);
  const del = await call(1, 'admin', 'DELETE', `/license/admin/devices/${work.id}`);
  assert.equal(del.status, 200);
  // Устгасны дараа дахин «auto» — тулгалт таарч байгаа тул ажиллана.
  const r4 = await lease(10, 'engineer', DEV_A, WORK_HW);
  assert.equal(r4.status, 200);
});

test('уягдсан компьютер: гадна монитор салгасан ч ажиллана; шинэ компьютер дэлгэцгүй таарахгүй', async () => {
  const { lease } = setup();
  assert.equal((await lease(10, 'engineer', DEV_A, WORK_HW)).status, 200);
  // Зөөврийн компьютер — гадна 3440×1440 монитор салгасан, зөвхөн дотоод дэлгэц.
  const laptopOnly = { ...WORK_HW, screens: ['2560x1600'] };
  const r = await lease(10, 'engineer', DEV_A, laptopOnly);
  assert.equal(r.status, 200, 'уягдсан төхөөрөмж — GPU + цөм хангалттай');
  // Уягдаагүй ӨӨР компьютер ижил GPU/цөмтэй байсан ч дэлгэц таарахгүй бол татгалзана.
  const other = await lease(10, 'engineer', DEV_B, laptopOnly);
  assert.equal(other.status, 403);
  assert.equal(other.json.code, 'NOT_WORK_PC');
  // Уягдсан компьютерын GPU солигдвол (өөр машин руу id хуулсан г.м.) татгалзана.
  const swapped = await lease(10, 'engineer', DEV_A, { ...laptopOnly, gpus: ['NVIDIA GeForce RTX 4060'] });
  assert.equal(swapped.status, 403);
});

test('ирцийн reset (бүх төхөөрөмж revoke) → add-in ч ажлын компьютерыг танихаа болино', async () => {
  const { db, lease } = setup();
  assert.equal((await lease(10, 'engineer', DEV_A, WORK_HW)).status, 200);
  db.exec(`UPDATE attendance_devices SET revoked_at = '2026-10-01T10:00:00' WHERE user_id = 10`);
  const r = await lease(10, 'engineer', DEV_A, WORK_HW);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NO_WORK_PC_PROFILE');
});

test('идэвхгүй хэрэглэгч, client role, Brave-ийн нуусан GPU', async () => {
  const { lease } = setup();
  assert.equal((await lease(12, 'engineer', DEV_A, WORK_HW)).json.code, 'USER_INACTIVE');
  // JWT дээр «engineer» гэж байсан ч DB-ийн role нь client — DB ялна.
  assert.equal((await lease(13, 'engineer', DEV_A, WORK_HW)).json.code, 'ROLE_NOT_ALLOWED');
  const r = await lease(11, 'architect', DEV_A, { gpus: ['NVIDIA GeForce RTX 3080'], cores: 24, screens: ['3840x2160'] });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NOT_WORK_PC');
});

test('хэлбэр буруу бие → 400; түлхүүр тохируулаагүй → 503 (гарын үсэггүй лиценз ХЭЗЭЭ Ч үгүй)', async () => {
  const { call } = setup();
  assert.equal((await call(10, 'engineer', 'POST', '/license', { device_id: 'nope', hw: WORK_HW })).status, 400);
  assert.equal((await call(10, 'engineer', 'POST', '/license', { device_id: DEV_A.toUpperCase(), hw: WORK_HW })).status, 400);
  const noKey = setup(false);
  const r = await noKey.lease(10, 'engineer', DEV_A, WORK_HW);
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'LICENSE_NOT_CONFIGURED');
});

test('админы жагсаалт зөвхөн admin-д', async () => {
  const { call } = setup();
  assert.equal((await call(10, 'engineer', 'GET', '/license/admin/users/10/devices')).status, 403);
  assert.equal((await call(1, 'senior', 'GET', '/license/admin/users/10/devices')).status, 403);
  assert.equal((await call(1, 'admin', 'GET', '/license/admin/users/abc/devices')).status, 400);
});
