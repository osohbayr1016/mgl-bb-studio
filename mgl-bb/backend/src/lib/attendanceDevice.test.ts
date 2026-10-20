/**
 * `lib/attendanceDevice.ts` — GPU нормчлол, профайлын хэш, шийдвэрийн
 * функц (цэвэр), мөн D1-ийн бодит SQL-ийг `node:sqlite` дээр миграц 0328-ийг
 * ажиллуулж шалгана (`resolveAttendanceDevice` / `revokeAllDevices`).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  normalizeGpu,
  normalizeHwProfile,
  hwProfileUsable,
  hwCanonical,
  hwHash,
  decideDevice,
  resolveAttendanceDevice,
  revokeAllDevices,
  loadActiveDevices,
  browserLabel,
  type DeviceRow,
} from './attendanceDevice.ts';

/* ------------------------------------------------------------------ */
/*  GPU normalisation                                                  */
/* ------------------------------------------------------------------ */

describe('normalizeGpu', () => {
  test('Chrome / Edge / Firefox / old-ANGLE spellings of one card collapse to one model', () => {
    const chrome =
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)';
    const firefox = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)';
    const old = 'ANGLE (NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)';
    assert.equal(normalizeGpu(chrome), 'nvidia geforce rtx 3070');
    assert.equal(normalizeGpu(firefox), 'nvidia geforce rtx 3070');
    assert.equal(normalizeGpu(old), 'nvidia geforce rtx 3070');
  });

  test('Intel iGPU keeps its model, drops PCI id and backend', () => {
    assert.equal(
      normalizeGpu('ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
      'intel(r) uhd graphics 630',
    );
  });

  test('software / VM renderers are not a GPU', () => {
    assert.equal(normalizeGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'), null);
    assert.equal(normalizeGpu('Microsoft Basic Render Driver'), null);
    assert.equal(normalizeGpu('ANGLE (VMware, VMware SVGA 3D Direct3D11 vs_5_0 ps_5_0, D3D11)'), null);
  });

  test('garbage input → null', () => {
    assert.equal(normalizeGpu(undefined), null);
    assert.equal(normalizeGpu(42), null);
    assert.equal(normalizeGpu('   '), null);
    assert.equal(normalizeGpu('ab'), null);
  });
});

/* ------------------------------------------------------------------ */
/*  Profile + hash                                                     */
/* ------------------------------------------------------------------ */

const CHROME = {
  gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  cores: 20,
  screen: '2560x1440',
  platform: 'Win32',
  tz: 'Asia/Ulaanbaatar',
  memory: 8,
};
const EDGE = { ...CHROME, memory: undefined }; // memory is informational only
const FIREFOX = {
  ...CHROME,
  gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)',
  memory: undefined,
};

describe('normalizeHwProfile / hwHash', () => {
  test('same machine, different browsers → identical hash', async () => {
    const a = await hwHash(normalizeHwProfile(CHROME));
    const b = await hwHash(normalizeHwProfile(EDGE));
    const c = await hwHash(normalizeHwProfile(FIREFOX));
    assert.ok(a && /^[0-9a-f]{64}$/.test(a));
    assert.equal(a, b);
    assert.equal(a, c);
  });

  test('different core count / screen / gpu → different hash', async () => {
    const base = await hwHash(normalizeHwProfile(CHROME));
    assert.notEqual(base, await hwHash(normalizeHwProfile({ ...CHROME, cores: 16 })));
    assert.notEqual(base, await hwHash(normalizeHwProfile({ ...CHROME, screen: '1920x1080' })));
    assert.notEqual(
      base,
      await hwHash(normalizeHwProfile({ ...CHROME, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' })),
    );
  });

  test('profile without a real GPU is unusable → no hash (falls back to exact browser id)', async () => {
    const p = normalizeHwProfile({ ...CHROME, gpu: 'Microsoft Basic Render Driver' });
    assert.ok(p);
    assert.equal(p.gpu, null);
    assert.equal(hwProfileUsable(p), false);
    assert.equal(await hwHash(p), null);
  });

  test('malformed fields are dropped, not trusted', () => {
    const p = normalizeHwProfile({
      gpu: CHROME.gpu,
      cores: '20',
      screen: '2560 × 1440',
      platform: 'x'.repeat(100),
      tz: 12,
      memory: -1,
    });
    assert.ok(p);
    assert.equal(p.cores, 20);
    assert.equal(p.screen, null);
    assert.equal(p.platform, null);
    assert.equal(p.tz, null);
    assert.equal(p.memory, null);
  });

  test('empty / non-object input → null', () => {
    assert.equal(normalizeHwProfile(undefined), null);
    assert.equal(normalizeHwProfile('x'), null);
    assert.equal(normalizeHwProfile({}), null);
  });

  test('canonical string is versioned', () => {
    const p = normalizeHwProfile(CHROME);
    assert.ok(p);
    assert.match(hwCanonical(p), /^hw1\|nvidia geforce rtx 3070\|20\|2560x1440\|win32\|Asia\/Ulaanbaatar$/);
  });
});

/* ------------------------------------------------------------------ */
/*  decideDevice (pure)                                                */
/* ------------------------------------------------------------------ */

const NEVER_LEGACY = () => false;
const ALWAYS_LEGACY = () => true;

function row(over: Partial<DeviceRow>): DeviceRow {
  return {
    id: 1,
    browser_id: 'b1',
    hw_hash: 'h1',
    bound_via: 'first',
    bound_at: '2026-09-01T09:00:00+08:00',
    ...over,
  };
}

describe('decideDevice', () => {
  test('no active devices → bind_first (even without hw)', () => {
    assert.deepEqual(
      decideDevice([], { browserId: 'b1', hwHash: null, hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY }),
      { kind: 'bind_first' },
    );
  });

  test('exact browser id wins regardless of hw', () => {
    const r = row({ hw_hash: 'other' });
    const d = decideDevice([r], { browserId: 'b1', hwHash: 'h1', hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY });
    assert.equal(d.kind, 'known');
  });

  test('new browser, same hardware → bind_hw_match', () => {
    const r = row({ browser_id: 'chrome', hw_hash: 'h1' });
    const d = decideDevice([r], { browserId: 'edge', hwHash: 'h1', hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY });
    assert.equal(d.kind, 'bind_hw_match');
  });

  test('new browser, same hardware, but hw matching disabled → reject', () => {
    const r = row({ browser_id: 'chrome', hw_hash: 'h1' });
    const d = decideDevice([r], { browserId: 'edge', hwHash: 'h1', hwMatchEnabled: false, isLegacyBinding: NEVER_LEGACY });
    assert.equal(d.kind, 'reject');
  });

  test('new browser, different hardware → reject', () => {
    const r = row({ browser_id: 'chrome', hw_hash: 'h1' });
    const d = decideDevice([r], { browserId: 'edge', hwHash: 'h2', hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY });
    assert.equal(d.kind, 'reject');
  });

  test('a legacy row with unlearned hw (NULL) never matches by hardware', () => {
    const r = row({ browser_id: 'old', hw_hash: null, bound_via: 'legacy' });
    const d = decideDevice([r], { browserId: 'edge', hwHash: 'h1', hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY });
    assert.equal(d.kind, 'reject');
  });

  test('client without hw profile can only match its exact browser id', () => {
    const r = row({ browser_id: 'chrome', hw_hash: 'h1' });
    const d = decideDevice([r], { browserId: 'edge', hwHash: null, hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY });
    assert.equal(d.kind, 'reject');
  });

  test('all active rows pre-domain-move → rebind_legacy (one-shot grace)', () => {
    const r = row({ browser_id: 'old', bound_at: '2026-07-01T09:00:00+08:00' });
    const d = decideDevice([r], { browserId: 'new', hwHash: null, hwMatchEnabled: true, isLegacyBinding: ALWAYS_LEGACY });
    assert.equal(d.kind, 'rebind_legacy');
  });

  test('grace does not apply when any active row is post-move', () => {
    const rows = [
      row({ id: 1, browser_id: 'old', bound_at: '2026-07-01T09:00:00+08:00' }),
      row({ id: 2, browser_id: 'newer', bound_at: '2026-09-01T09:00:00+08:00' }),
    ];
    const legacy = (at: string | null | undefined) => (at ?? '') < '2026-08-20';
    const d = decideDevice(rows, { browserId: 'x', hwHash: null, hwMatchEnabled: true, isLegacyBinding: legacy });
    assert.equal(d.kind, 'reject');
  });
});

/* ------------------------------------------------------------------ */
/*  Real SQL on node:sqlite (migration 0328 applied)                    */
/* ------------------------------------------------------------------ */

/** Minimal D1 shim over node:sqlite — enough for the statements the lib runs. */
function fakeD1(db: DatabaseSync): D1Database {
  const mk = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } } as never;
    },
    raw: async () => [] as never,
  });
  return { prepare: (sql: string) => mk(sql) } as unknown as D1Database;
}

function freshDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT,
    attendance_device_id TEXT, attendance_device_label TEXT, attendance_device_bound_at TEXT
  )`);
  db.exec(`INSERT INTO users (id, username, attendance_device_id, attendance_device_label, attendance_device_bound_at)
           VALUES (1, 'legacy', 'old-uuid', 'Mozilla/5.0 Chrome/149', '2026-09-01T08:00:00+08:00'),
                  (2, 'fresh', NULL, NULL, NULL)`);
  const migration = readFileSync(new URL('../../migrations/0328_attendance_devices.sql', import.meta.url), 'utf8');
  db.exec(migration);
  return { db, d1: fakeD1(db) };
}

const NOW = '2026-09-21T09:00:00+08:00';
const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const UA_EDGE = `${UA_CHROME} Edg/149.0.0.0`;

describe('resolveAttendanceDevice (SQL)', () => {
  test('migration copies the users binding into a legacy row', async () => {
    const { d1 } = freshDb();
    const rows = await loadActiveDevices(d1, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.browser_id, 'old-uuid');
    assert.equal(rows[0]?.bound_via, 'legacy');
    assert.equal(rows[0]?.hw_hash, null);
    assert.deepEqual(await loadActiveDevices(d1, 2), []);
  });

  test('fresh user: first clock-in binds + mirrors users columns', async () => {
    const { db, d1 } = freshDb();
    const d = await resolveAttendanceDevice(d1, {
      userId: 2, browserId: 'chrome-uuid', profile: normalizeHwProfile(CHROME), userAgent: UA_CHROME,
      hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY, now: NOW,
    });
    assert.equal(d.kind, 'bind_first');
    const u = db.prepare('SELECT attendance_device_id, attendance_device_bound_at FROM users WHERE id = 2').get() as Record<string, unknown>;
    assert.equal(u.attendance_device_id, 'chrome-uuid');
    assert.equal(u.attendance_device_bound_at, NOW);
    const rows = await loadActiveDevices(d1, 2);
    assert.equal(rows.length, 1);
    assert.ok(rows[0]?.hw_hash);
  });

  test('the whole scenario: Chrome binds → Edge on the same PC auto-joins → other PC rejected → reset clears all', async () => {
    const { db, d1 } = freshDb();
    const base = { userId: 2, hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY, now: NOW };
    await resolveAttendanceDevice(d1, { ...base, browserId: 'chrome-uuid', profile: normalizeHwProfile(CHROME), userAgent: UA_CHROME });

    // Edge: new localStorage id, same hardware.
    const edge = await resolveAttendanceDevice(d1, { ...base, browserId: 'edge-uuid', profile: normalizeHwProfile(EDGE), userAgent: UA_EDGE, now: '2026-09-22T09:00:00+08:00' });
    assert.equal(edge.kind, 'bind_hw_match');
    let rows = await loadActiveDevices(d1, 2);
    assert.deepEqual(rows.map((r) => [r.browser_id, r.bound_via]), [['chrome-uuid', 'first'], ['edge-uuid', 'hw_match']]);
    // users mirror stays the first binding
    const u = db.prepare('SELECT attendance_device_id FROM users WHERE id = 2').get() as Record<string, unknown>;
    assert.equal(u.attendance_device_id, 'chrome-uuid');

    // Back on Chrome → known, last_seen updated.
    const again = await resolveAttendanceDevice(d1, { ...base, browserId: 'chrome-uuid', profile: normalizeHwProfile(CHROME), userAgent: UA_CHROME, now: '2026-09-23T09:00:00+08:00' });
    assert.equal(again.kind, 'known');
    const seen = db.prepare(`SELECT last_seen_at FROM attendance_devices WHERE browser_id = 'chrome-uuid'`).get() as Record<string, unknown>;
    assert.equal(seen.last_seen_at, '2026-09-23T09:00:00+08:00');

    // A colleague's different PC (different GPU/screen) → reject, nothing written.
    const other = await resolveAttendanceDevice(d1, { ...base, browserId: 'other-uuid', profile: normalizeHwProfile({ ...CHROME, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', screen: '1920x1080' }), userAgent: UA_CHROME });
    assert.equal(other.kind, 'reject');
    assert.equal((await loadActiveDevices(d1, 2)).length, 2);

    // Admin reset revokes everything; the users mirror is cleared by the route.
    await revokeAllDevices(d1, 2, '2026-09-24T09:00:00+08:00');
    rows = await loadActiveDevices(d1, 2);
    assert.equal(rows.length, 0);
    const total = db.prepare('SELECT COUNT(*) n FROM attendance_devices WHERE user_id = 2').get() as { n: number };
    assert.equal(total.n, 2); // history kept

    // After reset the other PC binds as the new primary; a previously revoked
    // browser id that comes back is revived through ON CONFLICT (no crash).
    const rebound = await resolveAttendanceDevice(d1, { ...base, browserId: 'other-uuid', profile: null, userAgent: UA_CHROME });
    assert.equal(rebound.kind, 'bind_first');
    await revokeAllDevices(d1, 2, NOW);
    const revived = await resolveAttendanceDevice(d1, { ...base, browserId: 'chrome-uuid', profile: normalizeHwProfile(CHROME), userAgent: UA_CHROME });
    assert.equal(revived.kind, 'bind_first');
    rows = await loadActiveDevices(d1, 2);
    assert.deepEqual(rows.map((r) => r.browser_id), ['chrome-uuid']);
  });

  test('legacy row learns hardware on its own browser, then a new browser matches it', async () => {
    const { d1 } = freshDb();
    const base = { userId: 1, hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY };
    // New browser BEFORE learning → reject (as before 0328).
    const early = await resolveAttendanceDevice(d1, { ...base, browserId: 'edge-uuid', profile: normalizeHwProfile(EDGE), userAgent: UA_EDGE, now: NOW });
    assert.equal(early.kind, 'reject');
    // Old browser clocks in with a profile → learned.
    const learn = await resolveAttendanceDevice(d1, { ...base, browserId: 'old-uuid', profile: normalizeHwProfile(CHROME), userAgent: UA_CHROME, now: NOW });
    assert.equal(learn.kind, 'known');
    assert.ok((await loadActiveDevices(d1, 1))[0]?.hw_hash);
    // Now Edge on the same PC is recognised.
    const late = await resolveAttendanceDevice(d1, { ...base, browserId: 'edge-uuid', profile: normalizeHwProfile(EDGE), userAgent: UA_EDGE, now: NOW });
    assert.equal(late.kind, 'bind_hw_match');
  });

  test('a clock-in without a hw profile never erases a learned one', async () => {
    const { d1 } = freshDb();
    const base = { userId: 2, hwMatchEnabled: true, isLegacyBinding: NEVER_LEGACY, now: NOW };
    await resolveAttendanceDevice(d1, { ...base, browserId: 'chrome-uuid', profile: normalizeHwProfile(CHROME), userAgent: UA_CHROME });
    const before = (await loadActiveDevices(d1, 2))[0]?.hw_hash;
    await resolveAttendanceDevice(d1, { ...base, browserId: 'chrome-uuid', profile: null, userAgent: null });
    assert.equal((await loadActiveDevices(d1, 2))[0]?.hw_hash, before);
  });

  test('pre-domain-move legacy binding is replaced once (grace), then the new id rules', async () => {
    const { db, d1 } = freshDb();
    const legacy = (at: string | null | undefined) => !at || at < '2026-08-20';
    db.prepare(`UPDATE attendance_devices SET bound_at = '2026-07-01T08:00:00+08:00' WHERE user_id = 1`).run();
    const d = await resolveAttendanceDevice(d1, { userId: 1, browserId: 'new-uuid', profile: null, userAgent: UA_CHROME, hwMatchEnabled: true, isLegacyBinding: legacy, now: NOW });
    assert.equal(d.kind, 'rebind_legacy');
    const rows = await loadActiveDevices(d1, 1);
    assert.deepEqual(rows.map((r) => r.browser_id), ['new-uuid']);
    const u = db.prepare('SELECT attendance_device_id FROM users WHERE id = 1').get() as Record<string, unknown>;
    assert.equal(u.attendance_device_id, 'new-uuid');
    const d2 = await resolveAttendanceDevice(d1, { userId: 1, browserId: 'third-uuid', profile: null, userAgent: UA_CHROME, hwMatchEnabled: true, isLegacyBinding: legacy, now: NOW });
    assert.equal(d2.kind, 'reject');
  });
});

describe('browserLabel', () => {
  test('brand precedence and OS', () => {
    assert.equal(browserLabel(UA_CHROME), 'Chrome 149 · Windows');
    assert.equal(browserLabel(UA_EDGE), 'Edge 149 · Windows');
    assert.equal(browserLabel(`${UA_CHROME} OPR/132.0.0.0`), 'Opera 132 · Windows');
    assert.equal(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'), 'Firefox 130 · Windows');
    assert.equal(browserLabel(null), '—');
  });
});
