// «Програмын хүсэлт» (/api/engineering-feedback) — БОДИТ Hono router + БОДИТ auth middleware (JWT, tokens_valid_from,
// Revit-ийн төхөөрөмжийн session, tenant хил) + worker/client scope guard + БОДИТ миграц 0328/0374/0375/0410–0414
// node:sqlite дээр, транзакцтай D1 shim (test-support/allocHarness), multipart-тай R2 хуурмаг.
//
// Хамгаалах ёстой зан төлөв (prompt §4, §5 F04/F05, §10):
//   • inbox = ЗӨВХӨН binding (id 75 + usukhbayar + USH) + capability + идэвхтэй + интерактив session;
//     ижил нэртэй өөр хүн, өөр Software Engineer, admin/senior/engineer/architect, цуцлагдсан эрх, идэвхгүй хэрэглэгч,
//     буруу tenant, Revit-ийн төхөөрөмжийн session (admin role-той ч), MCP токен — бүгд ХААЛТТАЙ;
//   • илгээх → хавсралт (кирилл нэр) → submit → reviewer харна, байтыг татна; бусад нь 404;
//   • idempotency: давхар ноорог/submit нэг мөр, өөр агуулга 409;  буруу файл/хэмжээ/хэш/хугацаа/өөрийн бус id;
//   • multipart RVT;  дотоод тэмдэглэл илгээгчид болон мэдэгдэлд ХЭЗЭЭ Ч хүрэхгүй;  optimistic version;  давхардлын
//     тойрог;  мэдэгдэл зөвхөн reviewer-т;  bucket байхгүй бол 503 (MEDIA руу унахгүй);  цэвэрлэгч ready-г хөндөхгүй.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import { d1Shim } from '../../test-support/allocHarness.ts';

/* Workers-ийн `crypto.DigestStream`-ийг Node дээр дуурайна (production нь Workers-ийн native-ийг хэрэглэнэ). */
class DigestStreamPoly extends WritableStream<Uint8Array> {
  digest: Promise<ArrayBuffer>;
  constructor(_alg: string) {
    const h = createHash('sha256');
    let resolve!: (b: ArrayBuffer) => void;
    const p = new Promise<ArrayBuffer>((r) => (resolve = r));
    super({
      write(chunk) {
        h.update(chunk);
      },
      close() {
        const b = h.digest();
        resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      },
    });
    this.digest = p;
  }
}
(globalThis.crypto as unknown as { DigestStream: unknown }).DigestStream = DigestStreamPoly;
/* Workers-ийн edge cache — `/media` route-д хэрэгтэй (Node-д байхгүй тул 500 өгдөг байсан). */
(globalThis as unknown as { caches: unknown }).caches = { default: { match: async () => undefined, put: async () => undefined } };

const router = (await import('./engineeringFeedback.ts')).default;
const { sweepEngineeringFeedback } = await import('./engineeringFeedback.ts');
const { authMiddleware } = await import('../middleware/auth.ts');
const { workerScopeGuard } = await import('../lib/workerScope.ts');
const { clientScopeGuard } = await import('../lib/clientScope.ts');
const { signToken } = await import('../lib/jwt.ts');
const { invalidateTokenCache } = await import('../lib/tokenValidity.ts');
const { invalidateRevitSessionCache, revitSessionPathAllowed } = await import('../lib/revitSessionCheck.ts');
const { runWithTenant } = await import('../lib/requestContext.ts');
const media = (await import('./media.ts')).default;

const JWT_SECRET = 'test-secret-engineering-feedback';
const migration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

const U = {
  ANAND: 1, // admin, OWNER_ID=1 (revit-addin) — reviewer БИШ
  SENIOR: 8,
  ENG: 10,
  ARCH: 11,
  GONE: 12, // inactive
  WORKER: 13,
  CLIENT: 14,
  REVIEWER: 75, // Оюунбүрэн Өсөхбаяр — usukhbayar / USH
  SAME_NAME: 76, // ижил бүтэн нэртэй ӨӨР хүн
  OTHER_SE: 77, // capability-тэй боловч binding-гүй
} as const;

/* ------------------------------------------------------------------ */
/*  R2 хуурмаг (multipart-тай)                                         */
/* ------------------------------------------------------------------ */

async function readAll(v: unknown): Promise<Uint8Array> {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === 'string') return new TextEncoder().encode(v);
  if (v instanceof ReadableStream) {
    const reader = v.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array);
    }
    return concat(chunks);
  }
  throw new Error('r2 fake: unsupported body');
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const n = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

function r2Fake() {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array>; done: boolean }>();
  let seq = 0;
  const obj = (key: string) => {
    const o = store.get(key)!;
    return {
      key,
      size: o.bytes.byteLength,
      httpEtag: '"e"',
      body: new Blob([o.bytes]).stream(),
      writeHttpMetadata() {},
      arrayBuffer: async () => o.bytes.slice().buffer,
    };
  };
  const bucket = {
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      const bytes = await readAll(value);
      store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType });
      return { key, size: bytes.byteLength };
    },
    async get(key: string) {
      return store.has(key) ? obj(key) : null;
    },
    async head(key: string) {
      return store.has(key) ? { key, size: store.get(key)!.bytes.byteLength } : null;
    },
    async delete(key: string) {
      store.delete(key);
    },
    async createMultipartUpload(key: string) {
      const uploadId = `up-${++seq}`;
      uploads.set(uploadId, { key, parts: new Map(), done: false });
      return { uploadId, key };
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      return {
        async uploadPart(n: number, value: unknown) {
          const u = uploads.get(uploadId);
          if (!u || u.done || u.key !== key) throw new Error('NoSuchUpload');
          const bytes = await readAll(value);
          u.parts.set(n, bytes);
          return { partNumber: n, etag: `etag-${n}-${bytes.byteLength}` };
        },
        async complete(parts: Array<{ partNumber: number; etag: string }>) {
          const u = uploads.get(uploadId);
          if (!u || u.done) throw new Error('NoSuchUpload');
          const ordered = parts.map((p) => {
            const b = u.parts.get(p.partNumber);
            if (!b || p.etag !== `etag-${p.partNumber}-${b.byteLength}`) throw new Error('InvalidPart');
            return b;
          });
          store.set(key, { bytes: concat(ordered) });
          u.done = true;
          return { key, size: store.get(key)!.bytes.byteLength };
        },
        async abort() {
          uploads.delete(uploadId);
        },
      };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store, uploads };
}

/* ------------------------------------------------------------------ */
/*  Орчин                                                              */
/* ------------------------------------------------------------------ */

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, full_name TEXT, employee_id TEXT, role TEXT NOT NULL,
      status TEXT, position TEXT, remote_access_allowed INTEGER, tokens_valid_from TEXT,
      attendance_device_id TEXT, attendance_device_label TEXT, attendance_device_bound_at TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT, link TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER);
    CREATE TABLE office_ips (id INTEGER PRIMARY KEY, ip_address TEXT, is_active INTEGER DEFAULT 1);
  `);
  const ins = db.prepare(`INSERT INTO users (id, username, full_name, employee_id, role, status, position) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  ins.run(U.ANAND, 'A.Anand', 'Анандбаяр', 'ANA', 'admin', 'active', 'Захирал');
  ins.run(U.SENIOR, 'senior1', 'Ахлах Нэг', 'SN1', 'senior', 'active', 'Ахлах архитектор');
  ins.run(U.ENG, 'bat', 'Б.Бат', 'BAT', 'engineer', 'active', 'Инженер');
  ins.run(U.ARCH, 'dorj', 'Д.Дорж', 'DRJ', 'architect', 'active', 'Архитектор');
  ins.run(U.GONE, 'gone', 'Гарсан', 'GON', 'engineer', 'inactive', 'Инженер');
  ins.run(U.WORKER, 'cleaner', 'Цэвэрлэгч', 'CLN', 'worker', 'active', null);
  ins.run(U.CLIENT, 'client1', 'Захиалагч', null, 'client', 'active', null);
  ins.run(U.REVIEWER, 'usukhbayar', 'Оюунбүрэн Өсөхбаяр', 'USH', 'admin', 'active', 'Software engineer');
  ins.run(U.SAME_NAME, 'usukhbayar2', 'Оюунбүрэн Өсөхбаяр', 'US2', 'admin', 'active', 'Software engineer');
  ins.run(U.OTHER_SE, 'otherse', 'Өөр Програмист', 'OSE', 'admin', 'active', 'Software engineer');
  db.exec(migration('0328_attendance_devices.sql'));
  db.exec(migration('0374_revit_license_devices.sql'));
  db.exec(migration('0375_revit_device_keys.sql'));
  for (const f of [
    '0410_engineering_feedback_access.sql',
    '0411_engineering_requests.sql',
    '0412_engineering_request_attachments.sql',
    '0413_engineering_request_events.sql',
    '0414_engineering_feedback_reviewer_bootstrap.sql',
  ]) {
    db.exec(migration(f));
  }
  // Өөр Software Engineer: capability-тэй (admin олгосон), гэхдээ binding нь 75 — inbox хаалттай байх ёстой.
  db.prepare(`INSERT INTO access_capabilities (user_id, capability, granted_by, note) VALUES (?, 'software_engineer', ?, 'fixture')`).run(U.OTHER_SE, U.ANAND);
  // Revit-ийн төхөөрөмж (reviewer-ийн өөрийнх, admin role) — session нь илгээж чадна, inbox нээхгүй.
  db.prepare(`INSERT INTO revit_license_devices (user_id, device_id, status) VALUES (?, ?, 'auto')`).run(U.REVIEWER, 'd'.repeat(64));
  db.prepare(`INSERT INTO revit_device_keys (device_row_id, key_id, key_x, key_y, security_level) VALUES (1, 'kid-75', 'x', 'y', 'tpm')`).run();
  db.prepare(`INSERT INTO revit_license_devices (user_id, device_id, status) VALUES (?, ?, 'auto')`).run(U.ENG, 'e'.repeat(64));
  db.prepare(`INSERT INTO revit_device_keys (device_row_id, key_id, key_x, key_y, security_level) VALUES (2, 'kid-10', 'x', 'y', 'tpm')`).run();
  return db;
}

function harness(opts: { bucket?: boolean } = {}) {
  invalidateTokenCache();
  invalidateRevitSessionCache();
  const sqlite = freshDb();
  const r2 = r2Fake();
  const mediaFake = r2Fake();
  const env: Record<string, unknown> = {
    DB: d1Shim(sqlite),
    JWT_SECRET,
    MEDIA_BUCKET: mediaFake.bucket,
    MEETING_BUCKET: r2Fake().bucket,
    ...(opts.bucket === false ? {} : { FEEDBACK_BUCKET: r2.bucket }),
  };
  const app = new Hono();
  app.use('/api/*', authMiddleware as never);
  app.use('/api/*', workerScopeGuard as never);
  app.use('/api/*', clientScopeGuard as never);
  app.route('/api/engineering-feedback', router as never);
  app.route('/media', media as never);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };

  const tokens = new Map<string, string>();
  const token = async (sub: number, role: string, extra: Record<string, unknown> = {}) => {
    const k = `${sub}:${role}:${JSON.stringify(extra)}`;
    if (!tokens.has(k)) tokens.set(k, await signToken({ sub, role, ...extra } as never, JWT_SECRET, 1));
    return tokens.get(k)!;
  };
  const roleOf: Record<number, string> = {
    [U.ANAND]: 'admin',
    [U.SENIOR]: 'senior',
    [U.ENG]: 'engineer',
    [U.ARCH]: 'architect',
    [U.GONE]: 'engineer',
    [U.WORKER]: 'worker',
    [U.CLIENT]: 'client',
    [U.REVIEWER]: 'admin',
    [U.SAME_NAME]: 'admin',
    [U.OTHER_SE]: 'admin',
  };
  type CallOpts = { raw?: Uint8Array; extra?: Record<string, unknown>; tenant?: string; tok?: string | null; url?: string };
  const call = async (who: number | null, method: string, path: string, body?: unknown, o: CallOpts = {}) => {
    const headers: Record<string, string> = {};
    const tok = o.tok !== undefined ? o.tok : who === null ? null : await token(who, roleOf[who]!, o.extra ?? {});
    if (tok) headers.authorization = `Bearer ${tok}`;
    let reqBody: BodyInit | undefined;
    if (o.raw) {
      reqBody = o.raw;
      headers['content-type'] = 'application/octet-stream';
    } else if (body !== undefined) {
      reqBody = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const url = o.url ?? `/api/engineering-feedback${path}`;
    const run = () => app.request(url, { method, headers, body: reqBody }, env, ctx as never) as Promise<Response>;
    const res = o.tenant ? await runWithTenant(o.tenant, run) : await run();
    const buf = new Uint8Array(await res.arrayBuffer());
    let json: Record<string, any> | null = null;
    try {
      json = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      json = null;
    }
    return { status: res.status, json: json ?? {}, bytes: buf, headers: res.headers };
  };
  return { sqlite, env, r2, mediaFake, call, token };
}

function bytes(n: number, seed = 7): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const DRAFT = (crid: string, extra: Record<string, unknown> = {}) => ({
  client_request_id: crid,
  source: 'wall_elevation',
  tool_id: 'MglWallElevations',
  type: 'bug',
  title: 'Revit 2027 дээр дэлгээс үүсэхгүй',
  description: 'Өрөө сонгоход алдаа гарав',
  expected: 'Дэлгээс үүснэ',
  actual: 'InvalidOperationException',
  steps: '1. Өрөө сонгох\n2. Үүсгэх',
  revit_year: 2027,
  revit_build: '27.2.0.39',
  addin_version: '1.46.0',
  diagnostics: { schema: 'mgl-diag/1', revit: { year: 2027, build: '27.2.0.39' }, token: 'secret-should-vanish', url: 'https://x/a?sig=abc&ok=1' },
  ...extra,
});

/** Ноорог → хавсралт (нэг файл) → submit.  Буцаана: {id, aid, receipt}. */
async function submitOne(h: ReturnType<typeof harness>, who: number, crid: string, file?: { name: string; data: Uint8Array }) {
  const d = await h.call(who, 'POST', '/drafts', DRAFT(crid));
  assert.equal(d.status, 201, JSON.stringify(d.json));
  const id = d.json.request.id as string;
  const ids: string[] = [];
  if (file) {
    const r = await h.call(who, 'POST', `/drafts/${id}/attachments`, { client_attachment_id: `${crid}-att1`, name: file.name, size: file.data.byteLength, sha256: sha(file.data) });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const aid = r.json.attachment.id as string;
    const up = await h.call(who, 'PUT', `/attachments/${aid}/content`, undefined, { raw: file.data });
    assert.equal(up.status, 200, JSON.stringify(up.json));
    assert.equal(up.json.attachment.state, 'ready');
    ids.push(aid);
  }
  const s = await h.call(who, 'POST', `/drafts/${id}/submit`, { attachment_ids: ids });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  return { id, aid: ids[0], receipt: s.json.receipt };
}

/* ------------------------------------------------------------------ */
/*  Эрх                                                                */
/* ------------------------------------------------------------------ */

test('capabilities: ЗӨВХӨН binding + capability + идэвхтэй reviewer can_review', async () => {
  const h = harness();
  const cap = async (who: number) => (await h.call(who, 'GET', '/capabilities')).json;
  assert.equal((await cap(U.REVIEWER)).can_review, true);
  assert.equal((await cap(U.REVIEWER)).can_submit, true);
  for (const who of [U.ANAND, U.SENIOR, U.ENG, U.ARCH, U.SAME_NAME, U.OTHER_SE]) {
    const c = await cap(who);
    assert.equal(c.can_review, false, `user ${who} inbox-гүй байх ёстой`);
    assert.equal(c.can_submit, true, `user ${who} илгээж чадна`);
  }
  // Хариунд inbox-ийн тоо, мета БАЙХГҮЙ.
  const c = await cap(U.ENG);
  assert.equal('unread' in c, false);
  assert.equal(c.storage_available, true);
});

test('inbox: admin, senior, engineer, architect, ижил нэртэй, өөр SE — бүгд 404 (оршин буйг ч илчлэхгүй)', async () => {
  const h = harness();
  const { id, aid } = await submitOne(h, U.ENG, 'crid-auth-001', { name: 'зураг.png', data: bytes(1000) });
  for (const who of [U.ANAND, U.SENIOR, U.ENG, U.ARCH, U.SAME_NAME, U.OTHER_SE]) {
    for (const [m, p] of [
      ['GET', '/inbox'],
      ['GET', '/inbox/count'],
      ['GET', '/inbox/export'],
      ['GET', `/inbox/${id}`],
      ['GET', `/inbox/${id}/attachments/${aid}`],
      ['HEAD', `/inbox/${id}/attachments/${aid}`],
      ['POST', `/inbox/${id}/read`],
    ] as const) {
      const r = await h.call(who, m, p, m === 'POST' ? {} : undefined);
      assert.equal(r.status, 404, `${who} ${m} ${p} → ${r.status}`);
    }
    const p = await h.call(who, 'PATCH', `/inbox/${id}`, { version: 2, status: 'triaged' });
    assert.equal(p.status, 404);
    const e = await h.call(who, 'POST', `/inbox/${id}/events`, { kind: 'note', body: 'x' });
    assert.equal(e.status, 404);
  }
  // Reviewer л харна.
  const ok = await h.call(U.REVIEWER, 'GET', '/inbox');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.total, 1);
});

test('inbox: цуцлагдсан capability, өөрчлөгдсөн username/employee_id, идэвхгүй болсон reviewer — шууд хаагдана', async () => {
  const h = harness();
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox')).status, 200);
  // employee_id өөрчлөгдвөл binding тулгагдахгүй.
  h.sqlite.prepare(`UPDATE users SET employee_id = 'XXX' WHERE id = ?`).run(U.REVIEWER);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox')).status, 404);
  h.sqlite.prepare(`UPDATE users SET employee_id = 'USH' WHERE id = ?`).run(U.REVIEWER);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox')).status, 200);
  // Capability цуцлагдвал (кэшгүй) дараагийн хүсэлт хаагдана.
  h.sqlite.prepare(`UPDATE access_capabilities SET revoked_at = datetime('now') WHERE user_id = ?`).run(U.REVIEWER);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox')).status, 404);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/capabilities')).json.can_review, false);
  h.sqlite.prepare(`INSERT INTO access_capabilities (user_id, capability, note) VALUES (?, 'software_engineer', 'restore')`).run(U.REVIEWER);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox')).status, 200);
  // Идэвхгүй болсон — auth middleware (tokens_valid_from/status) 401.
  h.sqlite.prepare(`UPDATE users SET status = 'inactive' WHERE id = ?`).run(U.REVIEWER);
  invalidateTokenCache();
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox')).status, 401);
});

test('inbox: Revit төхөөрөмжийн session (admin role-той reviewer-ийнх ч) inbox нээхгүй; илгээх замууд нээлттэй', async () => {
  const h = harness();
  const dev = { purpose: 'revit', dev: 'd'.repeat(64), kid: 'kid-75' };
  // Middleware-ийн хүрээ: inbox → 403 SESSION_SCOPE.
  const r1 = await h.call(U.REVIEWER, 'GET', '/inbox', undefined, { extra: dev });
  assert.equal(r1.status, 403);
  assert.equal(r1.json.code, 'SESSION_SCOPE');
  // Илгээх зам зөвшөөрөгдөнө (channel = revit).
  const d = await h.call(U.REVIEWER, 'POST', '/drafts', DRAFT('crid-dev-0001'), { extra: dev });
  assert.equal(d.status, 201);
  assert.equal(d.json.request.channel, 'revit');
  const cap = await h.call(U.REVIEWER, 'GET', '/capabilities', undefined, { extra: dev });
  assert.equal(cap.json.can_review, false, 'device session-д can_review үргэлж false');
  assert.equal(cap.json.token_kind, 'revit');
  // `revit.session_scope = open` (яаралтай) — middleware нэвтрүүлнэ, router өөрөө 404.
  h.sqlite.prepare(`INSERT INTO app_settings (key, value) VALUES ('revit.session_scope', 'open')`).run();
  invalidateRevitSessionCache();
  const r2 = await h.call(U.REVIEWER, 'GET', '/inbox', undefined, { extra: dev });
  assert.equal(r2.status, 404);
  // Renewal credential — илгээх ч боломжгүй (401).
  const r3 = await h.call(U.REVIEWER, 'POST', '/drafts', DRAFT('crid-dev-0002'), { extra: { purpose: 'revit-refresh' } });
  assert.equal(r3.status, 401);
  // MCP токен (365 хоног) — илгээхгүй, inbox-гүй.
  const r4 = await h.call(U.REVIEWER, 'POST', '/drafts', DRAFT('crid-dev-0003'), { extra: { purpose: 'mcp' } });
  assert.equal(r4.status, 403);
  const r5 = await h.call(U.REVIEWER, 'GET', '/inbox', undefined, { extra: { purpose: 'mcp' } });
  assert.equal(r5.status, 404);
});

test('revitSessionPathAllowed: method-aware — inbox ХЭЗЭЭ Ч, илгээх замууд л', () => {
  const id = `efr_${'a'.repeat(26)}`;
  const aid = `efa_${'b'.repeat(26)}`;
  const base = '/api/engineering-feedback';
  assert.equal(revitSessionPathAllowed(`${base}/drafts`, 'POST'), true);
  assert.equal(revitSessionPathAllowed(`${base}/drafts`, 'GET'), false);
  assert.equal(revitSessionPathAllowed(`${base}/drafts/${id}/submit`, 'POST'), true);
  assert.equal(revitSessionPathAllowed(`${base}/attachments/${aid}/content`, 'PUT'), true);
  assert.equal(revitSessionPathAllowed(`${base}/attachments/${aid}/parts/3`, 'PUT'), true);
  assert.equal(revitSessionPathAllowed(`${base}/attachments/${aid}`, 'DELETE'), true);
  assert.equal(revitSessionPathAllowed(`${base}/mine/${id}/retest`, 'POST'), true);
  for (const [p, m] of [
    [`${base}/inbox`, 'GET'],
    [`${base}/inbox/count`, 'GET'],
    [`${base}/inbox/${id}`, 'PATCH'],
    [`${base}/inbox/${id}/attachments/${aid}`, 'GET'],
    [`${base}/inbox/export`, 'GET'],
    [`${base}/drafts/${id}`, 'DELETE'],
    [`${base}/drafts/../inbox`, 'GET'],
  ] as const) {
    assert.equal(revitSessionPathAllowed(p, m), false, `${m} ${p}`);
  }
  // Хуучин угтварын жагсаалт хэвээр.
  assert.equal(revitSessionPathAllowed('/api/revit/license', 'POST'), true);
});

test('илгээгч: worker, client хаалттай; inactive 401; буруу tenant 401', async () => {
  const h = harness();
  assert.equal((await h.call(U.WORKER, 'POST', '/drafts', DRAFT('crid-wrk-0001'))).status, 403);
  assert.equal((await h.call(U.CLIENT, 'POST', '/drafts', DRAFT('crid-cln-0001'))).status, 403);
  assert.equal((await h.call(U.GONE, 'POST', '/drafts', DRAFT('crid-gon-0001'))).status, 401);
  // Tenant хил: «default» токен «acme» контекстэд → 401 (auth.ts tid тулгалт).
  const r = await h.call(U.REVIEWER, 'GET', '/inbox', undefined, { tenant: 'acme' });
  assert.equal(r.status, 401);
  // Нэвтрээгүй → 401.
  assert.equal((await h.call(null, 'GET', '/capabilities')).status, 401);
});

/* ------------------------------------------------------------------ */
/*  Бүтэн урсгал                                                       */
/* ------------------------------------------------------------------ */

test('урсгал: ноорог → кирилл нэртэй хавсралт → submit → reviewer жагсаалт, дэлгэрэнгүй, байт; оношилгоо цэвэрлэгдсэн', async () => {
  const h = harness();
  const data = bytes(5000, 3);
  const { id, aid, receipt } = await submitOne(h, U.ENG, 'crid-flow-0001', { name: 'C:\\Users\\Бат\\Desktop\\Дэлгэцийн зураг (1).png', data });
  assert.equal(receipt.display_number, 'ПХ-0001');
  assert.equal(receipt.status, 'received');
  assert.equal(receipt.attachments.length, 1);
  assert.equal(receipt.attachments[0].name, 'Дэлгэцийн зураг (1).png', 'замын хэсэг хасагдсан, кирилл хэвээр');

  const list = await h.call(U.REVIEWER, 'GET', '/inbox?status=open');
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].unread, true);
  assert.equal(list.json.items[0].attachment_count, 1);
  const count = await h.call(U.REVIEWER, 'GET', '/inbox/count');
  assert.deepEqual({ unread: count.json.unread, open: count.json.open }, { unread: 1, open: 1 });

  const det = await h.call(U.REVIEWER, 'GET', `/inbox/${id}`);
  assert.equal(det.status, 200);
  const diag = det.json.request.diagnostics;
  assert.equal(diag.token, '[хассан]', 'токен оношилгоонд үлдэхгүй');
  assert.match(diag.url, /sig=\[хассан\]/);
  assert.equal(det.json.attachments[0].integrity.mode, 'server_sha256');
  assert.equal(det.json.attachments[0].integrity.server_sha256, sha(data));
  assert.equal(JSON.stringify(det.json).includes('ef/'), false, 'объектын түлхүүр хариунд ХЭЗЭЭ Ч орохгүй');

  const dl = await h.call(U.REVIEWER, 'GET', `/inbox/${id}/attachments/${aid}`);
  assert.equal(dl.status, 200);
  assert.equal(sha(dl.bytes), sha(data));
  assert.equal(dl.headers.get('cache-control'), 'private, no-store');
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.match(dl.headers.get('content-disposition') ?? '', /^attachment;.*filename\*=UTF-8''/);
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream', 'inline=1-гүй бол preview-гүй');
  const inline = await h.call(U.REVIEWER, 'GET', `/inbox/${id}/attachments/${aid}?inline=1`);
  assert.equal(inline.headers.get('content-type'), 'image/png');
  assert.match(inline.headers.get('content-security-policy') ?? '', /sandbox/);
  const head = await h.call(U.REVIEWER, 'HEAD', `/inbox/${id}/attachments/${aid}`);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(data.byteLength));

  // Уншсан тэмдэг.
  await h.call(U.REVIEWER, 'POST', `/inbox/${id}/read`, {});
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox/count')).json.unread, 0);

  // Мэдэгдэл ЗӨВХӨН reviewer-т.
  const notes = h.sqlite.prepare(`SELECT user_id, type, title, link FROM notifications WHERE type LIKE 'engineering_%'`).all() as Array<Record<string, unknown>>;
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.user_id, U.REVIEWER);
  assert.equal(notes[0]!.type, 'engineering_request_new');
  assert.equal(notes[0]!.title, 'Шинэ програмын хүсэлт ПХ-0001');
  assert.equal(notes[0]!.link, `/app/engineering-requests?id=${id}`);

  // Нийтийн /media зам хувийн объектыг ХЭЗЭЭ Ч уншихгүй (түлхүүрийг мэдсэн ч).
  const key = (h.sqlite.prepare(`SELECT object_key FROM engineering_request_attachments WHERE id = ?`).get(aid) as { object_key: string }).object_key;
  assert.ok(h.r2.store.has(key));
  for (const url of [`/media/${encodeURIComponent(key)}`, `/media/${key.split('/').pop()}`]) {
    const m = await h.call(null, 'GET', '', undefined, { url, tok: null });
    assert.equal(m.status, 404, url);
  }
});

test('илгээгчийн баримт: өөрийнхөө л; бусдын ноорог/хүсэлт 404; дотоод тэмдэглэл ХЭЗЭЭ Ч харагдахгүй', async () => {
  const h = harness();
  const { id } = await submitOne(h, U.ENG, 'crid-mine-0001');
  assert.equal((await h.call(U.ARCH, 'GET', `/mine/${id}`)).status, 404);
  assert.equal((await h.call(U.ARCH, 'GET', `/drafts/${id}`)).status, 404);
  assert.equal((await h.call(U.ARCH, 'GET', '/mine')).json.items.length, 0);

  const det = await h.call(U.REVIEWER, 'GET', `/inbox/${id}`);
  const v = det.json.request.version as number;
  const p = await h.call(U.REVIEWER, 'PATCH', `/inbox/${id}`, {
    version: v,
    status: 'in_progress',
    priority: 'high',
    note: 'ДОТООД: шалтгаан нь CropBox transform',
    reply: 'Шалгаж байна, баярлалаа',
  });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const mine = await h.call(U.ENG, 'GET', `/mine/${id}`);
  const text = JSON.stringify(mine.json);
  assert.equal(text.includes('ДОТООД'), false, 'дотоод тэмдэглэл илгээгчид');
  assert.equal(text.includes('high'), false, 'ач холбогдол илгээгчид');
  assert.ok(text.includes('Шалгаж байна'), 'хариу харагдана');
  assert.equal(mine.json.request.status_label, 'Шийдвэрлэж байна');
  const notes = h.sqlite.prepare(`SELECT user_id, type, title, body FROM notifications WHERE type = 'engineering_request_update'`).all() as Array<Record<string, string>>;
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.user_id as unknown as number, U.ENG);
  assert.equal(JSON.stringify(notes).includes('ДОТООД'), false, 'мэдэгдэлд дотоод тэмдэглэл');
});

test('idempotency: давхар ноорог нэг мөр; давхар submit нэг дугаар; өөр агуулга 409; зэрэг submit давхар мэдэгдэлгүй', async () => {
  const h = harness();
  const a = await h.call(U.ENG, 'POST', '/drafts', DRAFT('crid-idem-0001'));
  const b = await h.call(U.ENG, 'POST', '/drafts', DRAFT('crid-idem-0001', { title: 'өөр гарчиг' }));
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.json.reused, true);
  assert.equal(a.json.request.id, b.json.request.id);
  const id = a.json.request.id;
  const [s1, s2] = await Promise.all([
    h.call(U.ENG, 'POST', `/drafts/${id}/submit`, { attachment_ids: [] }),
    h.call(U.ENG, 'POST', `/drafts/${id}/submit`, { attachment_ids: [] }),
  ]);
  const statuses = [s1.status, s2.status].sort();
  assert.deepEqual(statuses, [200, 201]);
  const again = await h.call(U.ENG, 'POST', `/drafts/${id}/submit`, { attachment_ids: [] });
  assert.equal(again.status, 200);
  assert.equal(again.json.already_submitted, true);
  assert.equal(again.json.receipt.number, 1);
  const changed = await h.call(U.ENG, 'POST', `/drafts/${id}/submit`, { attachment_ids: [], title: 'Өөрчилсөн гарчиг', description: 'x y z', type: 'bug', source: 'wall_elevation' });
  assert.equal(changed.status, 409);
  assert.equal(changed.json.code, 'IDEMPOTENCY_CONFLICT');
  const n = h.sqlite.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE type = 'engineering_request_new'`).get() as { n: number };
  assert.equal(n.n, 1, 'нэг л мэдэгдэл');
  const ev = h.sqlite.prepare(`SELECT COUNT(*) AS n FROM engineering_request_events WHERE kind = 'submitted'`).get() as { n: number };
  assert.equal(ev.n, 1);
  // Өөр хоёр ноорог дараалан → давхардаагүй дугаар.
  const r2 = await submitOne(h, U.ARCH, 'crid-idem-0002');
  const r3 = await submitOne(h, U.SENIOR, 'crid-idem-0003');
  assert.deepEqual([r2.receipt.number, r3.receipt.number], [2, 3]);
});

/* ------------------------------------------------------------------ */
/*  Хавсралтын шалгалт                                                 */
/* ------------------------------------------------------------------ */

test('хавсралт: буруу төрөл, хэмжээ, хэш, өөрийн бус, хугацаа дууссан, дахин ашигласан id — аюулгүй татгалзана', async () => {
  const h = harness();
  const d = await h.call(U.ENG, 'POST', '/drafts', DRAFT('crid-att-0001'));
  const id = d.json.request.id;
  const reserve = (body: Record<string, unknown>) => h.call(U.ENG, 'POST', `/drafts/${id}/attachments`, body);
  assert.equal((await reserve({ client_attachment_id: 'att-exe-0001', name: 'virus.exe', size: 10 })).status, 422);
  assert.equal((await reserve({ client_attachment_id: 'att-svg-0001', name: 'x.svg', size: 10 })).status, 422);
  assert.equal((await reserve({ client_attachment_id: 'att-htm-0001', name: 'x.html', size: 10 })).status, 422);
  assert.equal((await reserve({ client_attachment_id: 'att-big-0001', name: 'big.png', size: 30 * 1024 * 1024 })).status, 413);
  assert.equal((await reserve({ client_attachment_id: 'att-ctl-0001', name: 'a\u202Egnp.exe', size: 10 })).status, 422, 'bidi override-оор өргөтгөл нуух');

  // Мэдүүлснээс ИХ байт → 413, объект үлдэхгүй.
  const r = await reserve({ client_attachment_id: 'att-log-0001', name: 'revit.log', size: 100 });
  assert.equal(r.status, 201);
  const aid = r.json.attachment.id;
  const big = await h.call(U.ENG, 'PUT', `/attachments/${aid}/content`, undefined, { raw: bytes(150) });
  assert.equal(big.status, 413);
  // Бага байт → 400, объект устгагдсан, дахин оролдож болно.
  const small = await h.call(U.ENG, 'PUT', `/attachments/${aid}/content`, undefined, { raw: bytes(50) });
  assert.equal(small.status, 400);
  assert.equal(h.r2.store.size, 0);
  const good = await h.call(U.ENG, 'PUT', `/attachments/${aid}/content`, undefined, { raw: bytes(100) });
  assert.equal(good.status, 200);
  assert.equal(good.json.attachment.state, 'ready');

  // Хэш зөрвөл 422, объект устгагдана.
  const data = bytes(64, 9);
  const r2 = await reserve({ client_attachment_id: 'att-sha-0001', name: 'a.json', size: 64, sha256: sha(bytes(64, 1)) });
  const bad = await h.call(U.ENG, 'PUT', `/attachments/${r2.json.attachment.id}/content`, undefined, { raw: data });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.code, 'HASH_MISMATCH');
  assert.equal(h.r2.store.size, 1, 'зөвхөн өмнөх зөв файл');

  // Ижил client_attachment_id өөр хэмжээгээр → 409.
  assert.equal((await reserve({ client_attachment_id: 'att-log-0001', name: 'revit.log', size: 101 })).status, 409);
  // Ижил утгаар → өмнөхийг буцаана (давтах аюулгүй).
  const same = await reserve({ client_attachment_id: 'att-log-0001', name: 'revit.log', size: 100 });
  assert.equal(same.status, 200);
  assert.equal(same.json.attachment.id, aid);

  // Өөр хэрэглэгч бусдын хавсралт руу байт илгээх / устгах — 404.
  const r3 = await reserve({ client_attachment_id: 'att-oth-0001', name: 'b.txt', size: 5 });
  const foreign = await h.call(U.ARCH, 'PUT', `/attachments/${r3.json.attachment.id}/content`, undefined, { raw: bytes(5) });
  assert.equal(foreign.status, 404);
  assert.equal((await h.call(U.ARCH, 'DELETE', `/attachments/${r3.json.attachment.id}`)).status, 404);
  // Өөр хүний ноорогт хавсралт нөөцлөх — 404.
  assert.equal((await h.call(U.ARCH, 'POST', `/drafts/${id}/attachments`, { client_attachment_id: 'att-zzz-0001', name: 'c.txt', size: 5 })).status, 404);
  // Хуурамч id, R2 түлхүүр — 404.
  assert.equal((await h.call(U.ENG, 'PUT', `/attachments/efa_${'z'.repeat(26)}/content`, undefined, { raw: bytes(5) })).status, 404);
  assert.equal((await h.call(U.ENG, 'PUT', `/attachments/${encodeURIComponent('ef/default/2026/10/x')}/content`, undefined, { raw: bytes(5) })).status, 404);

  // Хугацаа дууссан нөөц → 410.
  h.sqlite.prepare(`UPDATE engineering_request_attachments SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).run(r3.json.attachment.id);
  assert.equal((await h.call(U.ENG, 'PUT', `/attachments/${r3.json.attachment.id}/content`, undefined, { raw: bytes(5) })).status, 410);

  // Дуусаагүй хавсралтыг submit-д жагсаавал 409; жагсаагүй бэлэн бус хавсралт submit үед aborted.
  const pend = await reserve({ client_attachment_id: 'att-pnd-0001', name: 'p.txt', size: 5 });
  const s = await h.call(U.ENG, 'POST', `/drafts/${id}/submit`, { attachment_ids: [pend.json.attachment.id] });
  assert.equal(s.status, 409);
  assert.equal(s.json.code, 'ATTACHMENTS_PENDING');
  const ok = await h.call(U.ENG, 'POST', `/drafts/${id}/submit`, { attachment_ids: [aid] });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.receipt.attachments.length, 1);
  const states = h.sqlite.prepare(`SELECT id, state FROM engineering_request_attachments WHERE request_id = ? ORDER BY id`).all(id) as Array<{ id: string; state: string }>;
  assert.equal(states.find((x) => x.id === aid)!.state, 'ready');
  assert.ok(states.filter((x) => x.id !== aid).every((x) => x.state === 'aborted' || x.state === 'deleted' || x.state === 'reserved'));
  assert.equal(states.find((x) => x.id === pend.json.attachment.id)!.state, 'aborted');
  // Илгээсний дараа байт нэмэх боломжгүй.
  assert.equal((await h.call(U.ENG, 'PUT', `/attachments/${pend.json.attachment.id}/content`, undefined, { raw: bytes(5) })).status, 409);
});

test('хавсралт: 5-аас олон / нийт 100 MiB-аас их хориотой', async () => {
  const h = harness();
  const id = (await h.call(U.ENG, 'POST', '/drafts', DRAFT('crid-lim-0001'))).json.request.id;
  for (let i = 0; i < 5; i++) {
    const r = await h.call(U.ENG, 'POST', `/drafts/${id}/attachments`, { client_attachment_id: `att-lim-000${i}`, name: `f${i}.txt`, size: 10 });
    assert.equal(r.status, 201);
  }
  const sixth = await h.call(U.ENG, 'POST', `/drafts/${id}/attachments`, { client_attachment_id: 'att-lim-0006', name: 'f6.txt', size: 10 });
  assert.equal(sixth.status, 413);
  const id2 = (await h.call(U.ENG, 'POST', '/drafts', DRAFT('crid-lim-0002'))).json.request.id;
  const big = await h.call(U.ENG, 'POST', `/drafts/${id2}/attachments`, { client_attachment_id: 'att-lim-0100', name: 'model.rvt', size: 101 * 1024 * 1024 });
  assert.equal(big.status, 413);
});

test('multipart RVT: дутуу хэсэг 409, буруу хэмжээ 400, хэсгийн хэш шалгагдана, бүрэн бол ready, reviewer ижил байт татна', async () => {
  const h = harness();
  const size = 26 * 1024 * 1024; // 8 + 8 + 8 + 2 MiB
  const data = bytes(size, 5);
  const id = (await h.call(U.ENG, 'POST', '/drafts', DRAFT('crid-mpu-0001'))).json.request.id;
  const r = await h.call(U.ENG, 'POST', `/drafts/${id}/attachments`, { client_attachment_id: 'att-rvt-0001', name: 'Тест модел.rvt', size, sha256: sha(data) });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const att = r.json.attachment;
  assert.equal(att.mode, 'multipart');
  assert.equal(att.part_count, 4);
  const P = att.part_size as number;
  const part = (n: number) => data.subarray((n - 1) * P, Math.min(size, n * P));
  // Буруу хэмжээ.
  assert.equal((await h.call(U.ENG, 'PUT', `/attachments/${att.id}/parts/1`, undefined, { raw: part(1).subarray(0, 100) })).status, 400);
  assert.equal((await h.call(U.ENG, 'PUT', `/attachments/${att.id}/parts/9`, undefined, { raw: part(1) })).status, 400);
  // Хэсгийн хэш зөрвөл 422.
  const badHash = await h.call(U.ENG, 'PUT', `/attachments/${att.id}/parts/2?sha256=${'0'.repeat(64)}`, undefined, { raw: part(2) });
  assert.equal(badHash.status, 422);
  for (const n of [1, 2, 3]) {
    const p = await h.call(U.ENG, 'PUT', `/attachments/${att.id}/parts/${n}?sha256=${sha(part(n))}`, undefined, { raw: part(n) });
    assert.equal(p.status, 200, JSON.stringify(p.json));
  }
  const early = await h.call(U.ENG, 'POST', `/attachments/${att.id}/complete`, {});
  assert.equal(early.status, 409);
  assert.deepEqual(early.json.missing, [4]);
  assert.equal((await h.call(U.ENG, 'PUT', `/attachments/${att.id}/parts/4`, undefined, { raw: part(4) })).status, 200);
  // Давтан complete (timeout-ийн дараа) — аюулгүй.
  const done = await h.call(U.ENG, 'POST', `/attachments/${att.id}/complete`, {});
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.attachment.state, 'ready');
  const again = await h.call(U.ENG, 'POST', `/attachments/${att.id}/complete`, {});
  assert.equal(again.status, 200);
  const s = await h.call(U.ENG, 'POST', `/drafts/${id}/submit`, { attachment_ids: [att.id] });
  assert.equal(s.status, 201);
  const det = await h.call(U.REVIEWER, 'GET', `/inbox/${id}`);
  assert.equal(det.json.attachments[0].integrity.mode, 'multipart_parts_server_sha256');
  assert.equal(det.json.attachments[0].integrity.client_sha256_reported, sha(data), 'бүтэн файлын хэш = клиентийн мэдүүлсэн (сервер баталгаажуулаагүй)');
  const dl = await h.call(U.REVIEWER, 'GET', `/inbox/${id}/attachments/${att.id}`);
  assert.equal(dl.status, 200);
  assert.equal(sha(dl.bytes), sha(data));
  const parts = h.sqlite.prepare(`SELECT part_number, sha256 FROM engineering_request_attachment_parts WHERE attachment_id = ? ORDER BY part_number`).all(att.id) as Array<{ part_number: number; sha256: string }>;
  assert.deepEqual(parts.map((p) => p.sha256), [1, 2, 3, 4].map((n) => sha(part(n))));
});

/* ------------------------------------------------------------------ */
/*  Триаж, retest, давхардал, concurrency                              */
/* ------------------------------------------------------------------ */

test('төлөвийн загвар: зөвшөөрөгдөөгүй шилжилт 409; optimistic version-ий хуучин засвар түүхийг дарахгүй', async () => {
  const h = harness();
  const { id } = await submitOne(h, U.ENG, 'crid-st-00001');
  let v = (await h.call(U.REVIEWER, 'GET', `/inbox/${id}`)).json.request.version as number;
  assert.equal((await h.call(U.REVIEWER, 'PATCH', `/inbox/${id}`, { version: v, status: 'resolved' })).status, 409, 'received → resolved шууд биш');
  assert.equal((await h.call(U.REVIEWER, 'PATCH', `/inbox/${id}`, { version: v, status: 'draft' })).status, 409);
  const ok = await h.call(U.REVIEWER, 'PATCH', `/inbox/${id}`, { version: v, status: 'triaged' });
  assert.equal(ok.status, 200);
  const stale = await h.call(U.REVIEWER, 'PATCH', `/inbox/${id}`, { version: v, status: 'in_progress', note: 'хуучин таб' });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'STALE_VERSION');
  const notes = h.sqlite.prepare(`SELECT COUNT(*) AS n FROM engineering_request_events WHERE kind = 'note'`).get() as { n: number };
  assert.equal(notes.n, 0, 'унасан засварын тэмдэглэл бичигдэхгүй');
  v = ok.json.version;
  assert.equal((await h.call(U.REVIEWER, 'PATCH', `/inbox/${id}`, { status: 'in_progress' })).status, 400, 'version заавал');
  assert.equal((await h.call(U.REVIEWER, 'PATCH', `/inbox/${id}`, { version: v, status: 'in_progress' })).status, 200);
});

test('retest: засвар бэлэн → «засагдаагүй» дахин нээнэ (түүх хэвээр), «ажиллаж байна» шийдэгдэнэ; reviewer-т идэвхийн мэдэгдэл', async () => {
  const h = harness();
  const { id } = await submitOne(h, U.ENG, 'crid-rt-00001');
  const patch = async (body: Record<string, unknown>) => {
    const v = (await h.call(U.REVIEWER, 'GET', `/inbox/${id}`)).json.request.version as number;
    return h.call(U.REVIEWER, 'PATCH', `/inbox/${id}`, { version: v, ...body });
  };
  assert.equal((await patch({ status: 'in_progress' })).status, 200);
  assert.equal((await h.call(U.ENG, 'POST', `/mine/${id}/retest`, { action: 'works' })).status, 409, 'засвар бэлэн болоогүй');
  const fix = await h.call(U.REVIEWER, 'POST', `/inbox/${id}/fixes`, { revit_year: 2027, fixed_version: '1.46.0', commit_sha: 'abcdef1', pr_url: 'https://github.com/o/r/pull/9' });
  assert.equal(fix.status, 201);
  assert.equal((await h.call(U.REVIEWER, 'GET', `/inbox/${id}`)).json.request.status, 'in_progress', 'хувилбар холбосон нь автоматаар хаахгүй');
  assert.equal((await patch({ status: 'ready_for_retest', reply: '1.46.0-д засагдсан, шалгана уу' })).status, 200);
  const mine = await h.call(U.ENG, 'GET', `/mine/${id}`);
  assert.equal(mine.json.can_retest, true);
  const rel = mine.json.events.find((e: Record<string, unknown>) => e.kind === 'release');
  assert.equal(rel.fixed_version, '1.46.0');
  assert.equal(rel.revit_year, 2027);
  assert.equal(JSON.stringify(mine.json).includes('abcdef1'), false, 'commit илгээгчид харагдахгүй');
  const broken = await h.call(U.ENG, 'POST', `/mine/${id}/retest`, { action: 'still_broken', note: 'Одоо ч алдаа гарч байна', client_event_id: 'evt-rt-0001', diagnostics: { revit: { year: 2027 }, password: 'x' } });
  assert.equal(broken.status, 200);
  assert.equal(broken.json.status, 'reopened');
  const dup = await h.call(U.ENG, 'POST', `/mine/${id}/retest`, { action: 'still_broken', client_event_id: 'evt-rt-0001' });
  assert.equal(dup.status, 200);
  assert.equal(dup.json.reused, true, 'давхар товшилт нэг үйл явдал');
  const ev = h.sqlite.prepare(`SELECT meta_json FROM engineering_request_events WHERE kind = 'retest'`).all() as Array<{ meta_json: string }>;
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0]!.meta_json).diagnostics.password, '[хассан]');
  const act = h.sqlite.prepare(`SELECT user_id FROM notifications WHERE type = 'engineering_request_activity'`).all() as Array<{ user_id: number }>;
  assert.deepEqual(act.map((x) => x.user_id), [U.REVIEWER]);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox/count')).json.unread, 1, 'илгээгчийн идэвх уншаагүй болгоно');
  assert.equal((await patch({ status: 'ready_for_retest' })).status, 200);
  const works = await h.call(U.ENG, 'POST', `/mine/${id}/retest`, { action: 'works' });
  assert.equal(works.json.status, 'resolved');
  const all = h.sqlite.prepare(`SELECT kind FROM engineering_request_events WHERE request_id = ? ORDER BY id`).all(id) as Array<{ kind: string }>;
  assert.ok(all.length >= 6, 'түүх устахгүй');
});

test('давхардал: өөрийгөө, тойрог, байхгүй, ноорог — татгалзана; зөв холбоос, дахин нээхэд арилна', async () => {
  const h = harness();
  const a = (await submitOne(h, U.ENG, 'crid-dup-0001')).id;
  const b = (await submitOne(h, U.ARCH, 'crid-dup-0002')).id;
  const draft = (await h.call(U.ENG, 'POST', '/drafts', DRAFT('crid-dup-0003'))).json.request.id;
  const ver = async (id: string) => (await h.call(U.REVIEWER, 'GET', `/inbox/${id}`)).json.request.version as number;
  const dupOf = async (id: string, target: string) => h.call(U.REVIEWER, 'PATCH', `/inbox/${id}`, { version: await ver(id), status: 'duplicate', duplicate_of: target });
  assert.equal((await dupOf(a, a)).status, 422);
  assert.equal((await dupOf(a, `efr_${'q'.repeat(26)}`)).status, 422);
  assert.equal((await dupOf(a, draft)).status, 422, 'ноорогтой холбохгүй');
  const ok = await dupOf(b, a);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.duplicate_of, a);
  assert.equal((await dupOf(a, b)).status, 422, 'тойрог');
  const det = await h.call(U.REVIEWER, 'GET', `/inbox/${a}`);
  assert.equal(det.json.duplicates.length, 1);
  const re = await h.call(U.REVIEWER, 'PATCH', `/inbox/${b}`, { version: await ver(b), status: 'reopened' });
  assert.equal(re.status, 200);
  assert.equal(re.json.duplicate_of, null);
});

test('inbox шүүлт + хайлт + CSV экспорт (формула injection-оос хамгаална)', async () => {
  const h = harness();
  await submitOne(h, U.ENG, 'crid-flt-0001');
  const d = await h.call(U.ARCH, 'POST', '/drafts', DRAFT('crid-flt-0002', { revit_year: 2024, revit_build: '24.1.0.66', title: '=HYPERLINK("x") хортой', tool_id: 'MglCloneDrawings', source: 'revit_tool' }));
  await h.call(U.ARCH, 'POST', `/drafts/${d.json.request.id}/submit`, { attachment_ids: [] });
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox?revit_year=2024')).json.total, 1);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox?revit_year=2027')).json.total, 1);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox?revit_build=27.2')).json.total, 1);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox?source=revit_tool')).json.total, 1);
  assert.equal((await h.call(U.REVIEWER, 'GET', `/inbox?q=${encodeURIComponent('ПХ-0002')}`)).json.total, 1);
  assert.equal((await h.call(U.REVIEWER, 'GET', `/inbox?q=${encodeURIComponent('хортой')}`)).json.total, 1);
  assert.equal((await h.call(U.REVIEWER, 'GET', '/inbox?status=bogus')).status, 400);
  const csv = await h.call(U.REVIEWER, 'GET', '/inbox/export');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
  const text = new TextDecoder().decode(csv.bytes);
  assert.ok(text.includes(`"'=HYPERLINK(""x"") хортой"`), 'томьёо таслагдсан');
});

/* ------------------------------------------------------------------ */
/*  Хадгалалтгүй орчин, цэвэрлэгч                                      */
/* ------------------------------------------------------------------ */

test('FEEDBACK_BUCKET байхгүй: хавсралт 503 (MEDIA руу унахгүй), бичвэр хүсэлт ажиллана', async () => {
  const h = harness({ bucket: false });
  const cap = await h.call(U.ENG, 'GET', '/capabilities');
  assert.equal(cap.json.storage_available, false);
  const id = (await h.call(U.ENG, 'POST', '/drafts', DRAFT('crid-nob-0001'))).json.request.id;
  const r = await h.call(U.ENG, 'POST', `/drafts/${id}/attachments`, { client_attachment_id: 'att-nob-0001', name: 'a.png', size: 10 });
  assert.equal(r.status, 503);
  assert.equal(h.mediaFake.store.size, 0, 'MEDIA_BUCKET хөндөгдөөгүй');
  assert.equal((await h.call(U.ENG, 'POST', `/drafts/${id}/submit`, { attachment_ids: [] })).status, 201);
});

test('цэвэрлэгч: хугацаа дууссан нөөц, aborted-ыг устгана; илгээсэн хүсэлтийн ready хавсралтыг ХЭЗЭЭ Ч хөндөхгүй', async () => {
  const h = harness();
  const { aid: keptAid } = await submitOne(h, U.ENG, 'crid-swp-0001', { name: 'keep.png', data: bytes(300) });
  const id = (await h.call(U.ARCH, 'POST', '/drafts', DRAFT('crid-swp-0002'))).json.request.id;
  const r = await h.call(U.ARCH, 'POST', `/drafts/${id}/attachments`, { client_attachment_id: 'att-swp-0001', name: 'x.txt', size: 20 });
  await h.call(U.ARCH, 'PUT', `/attachments/${r.json.attachment.id}/content`, undefined, { raw: bytes(20) });
  // Ноорог 31 хоног хөдлөөгүй → эхний тикт aborted, хоёр дахь тикт (10 мин grace өнгөрсний дараа) устна.
  h.sqlite.prepare(`UPDATE engineering_requests SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`).run(id);
  const r3 = await h.call(U.ARCH, 'POST', '/drafts', DRAFT('crid-swp-0003'));
  const exp = await h.call(U.ARCH, 'POST', `/drafts/${r3.json.request.id}/attachments`, { client_attachment_id: 'att-swp-0002', name: 'y.txt', size: 5 });
  h.sqlite.prepare(`UPDATE engineering_request_attachments SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).run(exp.json.attachment.id);
  const before = h.r2.store.size;
  const s1 = await sweepEngineeringFeedback(h.env as never);
  assert.ok(s1.aborted >= 1);
  h.sqlite.prepare(`UPDATE engineering_request_attachments SET updated_at = '2000-01-01T00:00:00.000Z' WHERE state = 'aborted'`).run();
  await sweepEngineeringFeedback(h.env as never);
  const kept = h.sqlite.prepare(`SELECT state FROM engineering_request_attachments WHERE id = ?`).get(keptAid) as { state: string };
  assert.equal(kept.state, 'ready');
  const keptKey = (h.sqlite.prepare(`SELECT object_key FROM engineering_request_attachments WHERE id = ?`).get(keptAid) as { object_key: string }).object_key;
  assert.ok(h.r2.store.has(keptKey), 'илгээсэн файл хэвээр');
  assert.equal(h.r2.store.size, before - 1, 'хаягдсан ноорогийн файл устсан');
  const states = (h.sqlite.prepare(`SELECT state FROM engineering_request_attachments WHERE id IN (?, ?)`).all(r.json.attachment.id, exp.json.attachment.id) as Array<{ state: string }>).map((x) => x.state);
  assert.deepEqual(states.sort(), ['deleted', 'deleted']);
});
