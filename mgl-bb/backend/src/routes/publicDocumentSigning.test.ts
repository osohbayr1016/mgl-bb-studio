// RFI/CR + Зохиогчийн хяналтын гаднын (login-гүй) гарын үсгийн link — route-ын бүтэн урсгал.
// БОДИТ SQLite (миграц 0381 файлаас), D1 shim (batch = transaction), санах ойн R2,
// хуурамч PDF рендер (`SigningRenderIo`), Hono `app.request()`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
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

const route = await import('./publicDocumentSigning.ts');
const { sha256Hex } = await import('../lib/publicSigning.ts');

/* ------------------------------------------------------------------ */
/*  Shim-үүд                                                           */
/* ------------------------------------------------------------------ */

interface Hooks {
  beforeBatch?: (db: DatabaseSync) => void;
}

function d1Shim(db: DatabaseSync, hooks: Hooks = {}) {
  const make = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      sql,
      get params() {
        return params;
      },
      bind(...args: unknown[]) {
        params = args;
        return stmt;
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
    };
    return stmt;
  };
  return {
    prepare: make,
    async batch(stmts: ReturnType<typeof make>[]) {
      hooks.beforeBatch?.(db);
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          const r = db.prepare(s.sql).run(...(s.params as never[]));
          out.push({ meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } });
        }
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  } as unknown as D1Database;
}

function r2Shim() {
  const store = new Map<string, { bytes: Uint8Array; meta: Record<string, string> }>();
  return {
    store,
    async put(
      key: string,
      bytes: Uint8Array,
      opts?: { customMetadata?: Record<string, string> },
    ) {
      store.set(key, { bytes: new Uint8Array(bytes), meta: opts?.customMetadata ?? {} });
      return { key };
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return {
        key,
        body: new Blob([o.bytes]).stream(),
        customMetadata: o.meta,
        arrayBuffer: async () => o.bytes.slice().buffer,
      };
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Fixture                                                            */
/* ------------------------------------------------------------------ */

const MIGRATION = readFileSync(new URL('../../migrations/0381_public_document_signing.sql', import.meta.url), 'utf8');

const STAFF_ID = 10; // RFI/ЗХ хүсэгч — төслийн гишүүн, ЗХ-ийн багийн гишүүн
const OTHER_ID = 11; // төслийн гишүүн БИШ, өөр баг
const ADMIN_ID = 1;

function seed(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, full_name TEXT, position TEXT, status TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE project_members (project_id INTEGER, user_id INTEGER);
    CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER);
    CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT);
    CREATE TABLE correspondence_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, author_id INTEGER, log_date TEXT,
      subject TEXT, doc_type TEXT, ref_no TEXT, sign_status TEXT NOT NULL DEFAULT 'none',
      sign_requested_at TEXT, sign_requested_by INTEGER, client_signature_key TEXT,
      client_signed_at TEXT, client_signed_by INTEGER, client_signer_name TEXT,
      pdf_key TEXT, pdf_generated_at TEXT, updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE author_supervision_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, author_id INTEGER, status TEXT,
      seq INTEGER, doc_no TEXT, report_date TEXT,
      sig_arch_name TEXT, sig_arch_url TEXT, sig_arch_date TEXT,
      sig_site_name TEXT, sig_site_url TEXT, sig_site_date TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE author_supervision_report_teams (report_id INTEGER, team_id INTEGER, sort_order INTEGER);
    CREATE TABLE asr_report_companions (report_id INTEGER, user_id INTEGER);
  `);
  db.exec(MIGRATION);
  db.exec(`
    INSERT INTO users VALUES (${ADMIN_ID},'admin','Админ','Захирал','active');
    INSERT INTO users VALUES (${STAFF_ID},'engineer','Б.Бат','Ахлах инженер','active');
    INSERT INTO users VALUES (${OTHER_ID},'engineer','Д.Дорж','Инженер','active');
    INSERT INTO projects VALUES (7,'MGL-260101 Test');
    INSERT INTO project_members VALUES (7,${STAFF_ID});
    INSERT INTO teams VALUES (1,'BA');
    INSERT INTO teams VALUES (2,'HAS');
    INSERT INTO user_teams VALUES (${STAFF_ID},1);
    INSERT INTO user_teams VALUES (${OTHER_ID},2);
    INSERT INTO correspondence_log (id,project_id,author_id,log_date,subject,doc_type,ref_no)
      VALUES (1,7,${STAFF_ID},'2026-10-01','Тулгуурын нарийвчлал','rfi','RFI-001');
    INSERT INTO author_supervision_reports (id,project_id,author_id,status,seq,doc_no,report_date)
      VALUES (5,7,${STAFF_ID},'submitted',1,'DASR-BA-001','2026-10-02');
    INSERT INTO author_supervision_report_teams VALUES (5,1,0);
  `);
}

const PNG = (() => {
  const b = new Uint8Array(200);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < b.length; i++) b[i] = (i * 7) & 0xff;
  return b;
})();
const pngDataUrl = (bytes: Uint8Array = PNG) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

function build(opts: { renderFails?: boolean; hooks?: Hooks; onRender?: (db: DatabaseSync) => void } = {}) {
  const db = new DatabaseSync(':memory:');
  seed(db);
  const meeting = r2Shim();
  const media = r2Shim();
  const renders = { count: 0 };
  const io = {
    async render(_env: unknown, kind: string, entityId: number) {
      renders.count++;
      opts.onRender?.(db);
      if (opts.renderFails) throw new Error('browser down');
      return { bytes: new TextEncoder().encode(`%PDF-fake ${kind} ${entityId} #${renders.count}`), fileName: `${kind}-${entityId}.pdf` };
    },
  };
  const { publicDocumentSigning, signingLinks } = route.createSigningRouters(io as never);
  const app = new Hono();
  app.route('/public/signing', publicDocumentSigning);
  const auth = async (c: any, next: () => Promise<void>) => {
    const u = c.req.header('x-user');
    if (!u) return c.json({ error: 'Unauthorized' }, 401);
    c.set('user', JSON.parse(u));
    await next();
  };
  app.use('/api/signing-links', auth);
  app.use('/api/signing-links/*', auth);
  app.route('/api/signing-links', signingLinks);

  const env = {
    DB: d1Shim(db, opts.hooks),
    MEETING_BUCKET: meeting,
    MEDIA_BUCKET: media,
    FRONTEND_URL: 'https://erp.example',
    JWT_SECRET: 'x',
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} };
  const call = (path: string, init?: RequestInit) => app.request(path, init, env, ctx as never);
  const flush = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };
  const callRaw = (other: Hono, path: string, init?: RequestInit) => other.request(path, init, env, ctx as never);
  return { db, meeting, media, renders, call, callRaw, flush };
}

const asUser = (id: number, role = 'engineer') => ({ 'x-user': JSON.stringify({ sub: id, role }), 'content-type': 'application/json' });
const json = (body: unknown) => JSON.stringify(body);

async function createLink(h: ReturnType<typeof build>, body: Record<string, unknown>, user = STAFF_ID, role = 'engineer') {
  const res = await h.call('/api/signing-links', { method: 'POST', headers: asUser(user, role), body: json(body) });
  const payload = (await res.json()) as { url?: string; id?: number; error?: string; slot?: string; role_label?: string };
  const token = payload.url ? payload.url.split('/sign/')[1]! : '';
  return { res, payload, token };
}

const signBody = (over: Record<string, unknown> = {}) => ({ signature_data_url: pngDataUrl(), signer_name: 'Ч.Чимэг', consent: true, ...over });
const sign = (h: ReturnType<typeof build>, token: string, body: Record<string, unknown> = signBody()) =>
  h.call(`/public/signing/${token}/sign`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'TestPhone/1.0' }, body: json(body) });
const view = (h: ReturnType<typeof build>, token: string) => h.call(`/public/signing/${token}`);
/** MEETING_BUCKET-ийн объектууд, link үүсгэх үеийн урьдчилсан preview cache-гүйгээр. */
const stored = (h: ReturnType<typeof build>) =>
  [...h.meeting.store.keys()].filter((k) => !String(k).startsWith('public-signing/preview/')).length;

/* ------------------------------------------------------------------ */
/*  RFI / CR                                                           */
/* ------------------------------------------------------------------ */

test('RFI: link creation stores only SHA-256(token), works without login, exposes minimal metadata', async () => {
  const h = build();
  const { res, payload, token } = await createLink(h, { kind: 'correspondence', entity_id: 1, role_label: 'Захиалагчийн төлөөлөгч', signer_name_hint: 'Ч.Чимэг' });
  assert.equal(res.status, 201);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(payload.slot, 'client');

  const rows = h.db.prepare('SELECT * FROM public_document_sign_requests').all() as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.token_hash, await sha256Hex(token));
  assert.ok(!JSON.stringify(rows[0]).includes(token), 'raw token must not be stored');
  assert.equal(h.db.prepare("SELECT sign_status FROM correspondence_log WHERE id=1").get()!.sign_status, 'pending');

  // login-гүй
  const v = await view(h, token);
  assert.equal(v.status, 200);
  assert.equal(v.headers.get('referrer-policy'), 'no-referrer');
  assert.match(v.headers.get('cache-control') ?? '', /no-store/);
  const body = (await v.json()) as any;
  assert.equal(body.request.status, 'pending');
  assert.equal(body.request.role_label, 'Захиалагчийн төлөөлөгч');
  assert.equal(body.request.signer_name_hint, 'Ч.Чимэг');
  assert.equal(body.document.document_no, 'RFI-001');
  assert.equal(body.document.document_type, 'Мэдээлэл хүсэлт');
  assert.equal(body.document.prepared_by, 'Б.Бат');
  assert.equal(body.document.prepared_by_position, 'Ахлах инженер');
  assert.equal(body.document.project_name, 'MGL-260101 Test');
  assert.ok(body.company.name);
  // дотоод ID / түлхүүр ил гарахгүй
  const text = JSON.stringify(body);
  assert.ok(!('id' in body.request));
  assert.ok(!/snapshot|signature_key|token_hash|requested_by|project_id|entity_id/.test(text));
  assert.ok(h.db.prepare('SELECT first_viewed_at FROM public_document_sign_requests').get()!.first_viewed_at);
});

test('RFI: document preview is rendered once, then served from the private cache; refreshed when the document changes', async () => {
  const h = build();
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  // Link үүсгэх агшинд cache урьдчилан бөглөгдөнө (2026-10-12) — гаднын хүний ЭХНИЙ
  // нээлт ч браузер асаахгүй.
  await h.flush();
  assert.equal(h.renders.count, 1, 'link creation warms the preview');
  const a = await h.call(`/public/signing/${token}/document`);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('content-type'), 'application/pdf');
  assert.match(await a.text(), /^%PDF-fake correspondence 1 #1/);
  await h.flush();
  const b = await h.call(`/public/signing/${token}/document`);
  assert.match(await b.text(), /#1/);
  assert.equal(h.renders.count, 1, 'second view must not spawn another browser');

  h.db.exec("UPDATE correspondence_log SET subject = 'Өөрчилсөн', updated_at = '2030-01-01 00:00:00' WHERE id = 1");
  const c = await h.call(`/public/signing/${token}/document`);
  assert.match(await c.text(), /#2/);
});

test('RFI: invalid, non-PNG, empty, oversized payloads and missing name/consent are rejected without touching the document', async () => {
  const h = build();
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  const untouched = () => {
    const row = h.db.prepare('SELECT sign_status, client_signature_key FROM correspondence_log WHERE id=1').get() as any;
    assert.equal(row.sign_status, 'pending');
    assert.equal(row.client_signature_key, null);
  };

  assert.equal((await sign(h, token, signBody({ signer_name: '   ' }))).status, 400, 'missing name');
  assert.equal((await sign(h, token, signBody({ signer_name: undefined }))).status, 400, 'name required even when staff supplied a hint');
  assert.equal((await sign(h, token, signBody({ consent: false }))).status, 400, 'missing consent');
  assert.equal((await sign(h, token, signBody({ consent: 'true' }))).status, 400, 'consent must be literal true');
  assert.equal((await sign(h, token, signBody({ signature_data_url: undefined }))).status, 400, 'no signature');
  assert.equal((await sign(h, token, signBody({ signature_data_url: 'data:image/png;base64,AAAA' }))).status, 400, 'too small / empty');
  assert.equal((await sign(h, token, signBody({ signature_data_url: pngDataUrl(new Uint8Array(300).fill(1)) }))).status, 400, 'bad magic (client MIME is not trusted)');
  assert.equal((await sign(h, token, signBody({ signature_data_url: 'https://evil.example/x.png' }))).status, 400, 'URLs are never accepted');
  const big = new Uint8Array(600 * 1024);
  big.set(PNG);
  assert.equal((await sign(h, token, signBody({ signature_data_url: pngDataUrl(big) }))).status, 400, 'oversized PNG');
  const huge = await h.call(`/public/signing/${token}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(5 * 1024 * 1024) },
    body: '{}',
  });
  assert.equal(huge.status, 413);
  untouched();
  assert.equal(stored(h), 0, 'no stray objects after rejections');
});

test('RFI: successful signature binds to the existing fields, stores evidence, immutable PDF snapshot + hash, notifies requester', async () => {
  const h = build();
  const { token, payload } = await createLink(h, { kind: 'correspondence', entity_id: 1, role_label: 'Захиалагч' });
  h.db.exec("UPDATE correspondence_log SET pdf_key = 'old-pdf' WHERE id = 1");
  await h.meeting.put('old-pdf', new Uint8Array([1]));

  const res = await sign(h, token);
  assert.equal(res.status, 200);
  const out = (await res.json()) as any;
  assert.equal(out.status, 'signed');
  assert.equal(out.signed_name, 'Ч.Чимэг');
  await h.flush();

  const corr = h.db.prepare('SELECT * FROM correspondence_log WHERE id = 1').get() as any;
  assert.equal(corr.sign_status, 'signed');
  assert.equal(corr.client_signed_by, null);
  assert.equal(corr.client_signer_name, 'Ч.Чимэг');
  assert.ok(corr.client_signed_at);
  assert.ok(corr.client_signature_key);
  assert.equal(corr.pdf_key, null, 'stale PDF cache invalidated');
  assert.equal(h.meeting.store.has('old-pdf'), false);
  const sigObj = h.meeting.store.get(corr.client_signature_key)!;
  assert.deepEqual([...sigObj.bytes], [...PNG], 'signature lives in the PRIVATE bucket');
  assert.equal(h.media.store.size, 0, 'RFI signature is never put in the public bucket');

  const req = h.db.prepare('SELECT * FROM public_document_sign_requests WHERE id = ?').get(payload.id!) as any;
  assert.equal(req.status, 'signed');
  assert.equal(req.signed_name, 'Ч.Чимэг');
  assert.equal(req.signature_key, corr.client_signature_key);
  assert.equal(req.signature_sha256, await sha256Hex(PNG));
  assert.equal(req.signed_user_agent, 'TestPhone/1.0');
  assert.ok(req.document_snapshot_key);
  assert.match(req.document_snapshot_key, /^public-signing\/snapshots\//);
  const snap = h.meeting.store.get(req.document_snapshot_key)!;
  assert.equal(req.document_sha256, await sha256Hex(snap.bytes));
  assert.equal(snap.meta.sha256, req.document_sha256);
  assert.ok(h.db.prepare("SELECT 1 AS x FROM notifications WHERE user_id = ? AND type = 'client_signed'").get(STAFF_ID));

  // staff list never leaks storage keys; shows evidence flags
  const list = (await (await h.call('/api/signing-links?kind=correspondence&entity_id=1', { headers: asUser(STAFF_ID) })).json()) as any;
  assert.equal(list.requests[0].snapshot_ready, 1);
  assert.equal(list.requests[0].document_sha256, req.document_sha256);
  assert.ok(!JSON.stringify(list).match(/signature_key|document_snapshot_key|token_hash/));

  // staff can download the immutable snapshot; its hash header matches
  const dl = await h.call(`/api/signing-links/${payload.id}/snapshot`, { headers: asUser(STAFF_ID) });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-document-sha256'), req.document_sha256);
  assert.equal(await sha256Hex(new Uint8Array(await dl.arrayBuffer())), req.document_sha256);
  const denied = await h.call(`/api/signing-links/${payload.id}/snapshot`, { headers: asUser(OTHER_ID) });
  assert.equal(denied.status, 403);
});

test('RFI: the same link cannot sign twice; signed/closed links stop serving the document', async () => {
  const h = build();
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  assert.equal((await sign(h, token)).status, 200);
  assert.equal((await sign(h, token, signBody({ signer_name: 'Хэн нэгэн' }))).status, 409);
  const v = (await (await view(h, token)).json()) as any;
  assert.equal(v.request.status, 'signed');
  assert.equal(v.request.signed_name, 'Ч.Чимэг');
  assert.equal(v.document.prepared_by, null, 'terminal view stays minimal');
  assert.equal((await h.call(`/public/signing/${token}/document`)).status, 410);
});

test('RFI: a new link revokes the previous pending link; creation is atomic', async () => {
  const h = build();
  const a = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  const b = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  assert.notEqual(a.token, b.token);
  const statuses = h.db.prepare('SELECT status FROM public_document_sign_requests ORDER BY id').all().map((r: any) => r.status);
  assert.deepEqual(statuses, ['revoked', 'pending']);
  assert.equal(((await (await view(h, a.token)).json()) as any).request.status, 'revoked');
  assert.equal((await sign(h, a.token)).status, 410);
  assert.equal((await sign(h, b.token)).status, 200);

  // quick double submit of "create": exactly one pending survives
  const h2 = build();
  await Promise.all([createLink(h2, { kind: 'correspondence', entity_id: 1 }), createLink(h2, { kind: 'correspondence', entity_id: 1 })]);
  const pending = h2.db.prepare("SELECT COUNT(*) AS n FROM public_document_sign_requests WHERE status='pending'").get() as any;
  assert.equal(pending.n, 1);
});

test('RFI: expiry — default 7 days, max 30, expired links are terminal', async () => {
  const h = build();
  const { payload, token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  const days = (Date.parse(payload.expires_at as never) - Date.now()) / 86400000;
  assert.ok(days > 6.99 && days <= 7.01);
  const long = await createLink(h, { kind: 'correspondence', entity_id: 1, expires_in_days: 999 });
  const longDays = (Date.parse(long.payload.expires_at as never) - Date.now()) / 86400000;
  assert.ok(longDays <= 30.01);

  h.db.exec("UPDATE public_document_sign_requests SET expires_at = '2020-01-01T00:00:00.000Z'");
  const v = (await (await view(h, long.token)).json()) as any;
  assert.equal(v.request.status, 'expired');
  assert.equal((await sign(h, long.token)).status, 410);
  assert.equal((await h.call(`/public/signing/${long.token}/document`)).status, 410);
  void token;
});

test('RFI: removed project access / disabled requester kill the link, even for a page that is already open', async () => {
  const h = build();
  const a = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  assert.equal((await view(h, a.token)).status, 200);
  h.db.exec(`DELETE FROM project_members WHERE user_id = ${STAFF_ID}`);
  assert.equal((await sign(h, a.token)).status, 410, 'signing from an already-open page is refused');
  assert.equal(h.db.prepare('SELECT sign_status FROM correspondence_log WHERE id=1').get()!.sign_status, 'pending');
  assert.equal(((await (await view(h, a.token)).json()) as any).request.status, 'revoked');
  assert.equal(h.db.prepare('SELECT status FROM public_document_sign_requests').get()!.status, 'revoked');

  const h2 = build();
  const b = await createLink(h2, { kind: 'correspondence', entity_id: 1 });
  h2.db.exec(`UPDATE users SET status = 'inactive' WHERE id = ${STAFF_ID}`);
  assert.equal((await h2.call(`/public/signing/${b.token}/document`)).status, 410);
  assert.equal((await sign(h2, b.token)).status, 410);
});

test('RFI: staff authorization — non-members, clients and workers cannot create/list/revoke', async () => {
  const h = build();
  assert.equal((await createLink(h, { kind: 'correspondence', entity_id: 1 }, OTHER_ID)).res.status, 403);
  assert.equal((await createLink(h, { kind: 'correspondence', entity_id: 1 }, 99, 'client')).res.status, 403);
  assert.equal((await createLink(h, { kind: 'correspondence', entity_id: 1 }, 99, 'worker')).res.status, 403);
  assert.equal((await createLink(h, { kind: 'correspondence', entity_id: 999 }, ADMIN_ID, 'admin')).res.status, 404);
  assert.equal((await h.call('/api/signing-links', { method: 'POST', body: '{}' })).status, 401);
  h.db.exec("UPDATE correspondence_log SET doc_type = 'letter' WHERE id = 1");
  assert.equal((await createLink(h, { kind: 'correspondence', entity_id: 1 })).res.status, 400);
  h.db.exec("UPDATE correspondence_log SET doc_type = 'rfi' WHERE id = 1");

  const { payload } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  assert.equal((await h.call('/api/signing-links?kind=correspondence&entity_id=1', { headers: asUser(OTHER_ID) })).status, 403);
  assert.equal((await h.call(`/api/signing-links/${payload.id}`, { method: 'DELETE', headers: asUser(OTHER_ID) })).status, 403);
  assert.equal((await h.call(`/api/signing-links/${payload.id}`, { method: 'DELETE', headers: asUser(STAFF_ID) })).status, 200);
  assert.equal(h.db.prepare('SELECT status FROM public_document_sign_requests').get()!.status, 'revoked');
});

test('RFI: signed RFI refuses new links; malformed tokens are 404 without a DB hit leak', async () => {
  const h = build();
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  await sign(h, token);
  assert.equal((await createLink(h, { kind: 'correspondence', entity_id: 1 })).res.status, 409);
  assert.equal((await view(h, 'short')).status, 404);
  assert.equal((await view(h, 'A'.repeat(43))).status, 404);
  assert.equal((await sign(h, 'A'.repeat(43))).status, 404);
});

test('race: staff revokes exactly while the signer submits — the document must NOT be signed', async () => {
  let fired = false;
  const h = build({
    hooks: {
      beforeBatch(db) {
        if (fired) return;
        fired = true; // staff pressed “revoke” between the pre-checks and the commit
        db.exec("UPDATE public_document_sign_requests SET status = 'revoked' WHERE status = 'pending'");
      },
    },
  });
  // The hook also fires on link creation's batch → arm it after creating the link.
  fired = true;
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  fired = false;
  const res = await sign(h, token);
  assert.equal(res.status, 410);
  const corr = h.db.prepare('SELECT sign_status, client_signature_key FROM correspondence_log WHERE id=1').get() as any;
  assert.equal(corr.sign_status, 'pending');
  assert.equal(corr.client_signature_key, null);
  assert.equal(stored(h), 0, 'signature object cleaned up');
});

test('race: ERP/portal signs between the public pre-check and commit — first signer wins, public link closes consistently', async () => {
  let armed = false;
  const h = build({
    hooks: {
      beforeBatch(db) {
        if (!armed) return;
        armed = false;
        db.exec("UPDATE correspondence_log SET sign_status = 'signed', client_signature_key = 'portal-key', client_signer_name = 'Портал' WHERE id = 1");
      },
    },
  });
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  armed = true;
  const res = await sign(h, token);
  assert.equal(res.status, 409);
  const corr = h.db.prepare('SELECT client_signature_key, client_signer_name FROM correspondence_log WHERE id=1').get() as any;
  assert.equal(corr.client_signature_key, 'portal-key', 'portal signature is never overwritten');
  assert.equal(stored(h), 0);
  // public link now reads as signed (by the portal) rather than offering another canvas
  const v = (await (await view(h, token)).json()) as any;
  assert.equal(v.request.status, 'signed');
  assert.equal(v.request.signed_name, 'Портал');
});

test('race: two simultaneous submissions on one link — exactly one wins', async () => {
  const h = build();
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  const [a, b] = await Promise.all([sign(h, token), sign(h, token, signBody({ signer_name: 'Хоёрдахь' }))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM public_document_sign_requests WHERE status='signed'").get()!.n, 1);
  await h.flush();
  assert.equal([...h.meeting.store.keys()].filter((k) => k.startsWith('client/')).length, 1, 'exactly one signature object remains');
});

test('snapshot failure never rolls back a successful signature; staff can retry', async () => {
  const h = build({ renderFails: true });
  const { token, payload } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  const res = await sign(h, token);
  assert.equal(res.status, 200);
  await h.flush();
  const req = h.db.prepare('SELECT status, document_snapshot_key FROM public_document_sign_requests').get() as any;
  assert.equal(req.status, 'signed');
  assert.equal(req.document_snapshot_key, null);
  assert.equal(h.db.prepare('SELECT sign_status FROM correspondence_log WHERE id=1').get()!.sign_status, 'signed');

  // retry with a working renderer
  const h2 = build();
  const l2 = await createLink(h2, { kind: 'correspondence', entity_id: 1 });
  h2.db.exec("UPDATE public_document_sign_requests SET status='signed', signature_key='k', signature_sha256='h'");
  h2.db.exec("UPDATE correspondence_log SET sign_status='signed', client_signature_key='k' WHERE id=1");
  const retry = await h2.call(`/api/signing-links/${l2.payload.id}/snapshot`, { method: 'POST', headers: asUser(STAFF_ID) });
  assert.equal(retry.status, 200);
  assert.ok(h2.db.prepare('SELECT document_snapshot_key FROM public_document_sign_requests').get()!.document_snapshot_key);
  void payload;
});

test('snapshot is skipped (not mislabeled as evidence) when the document keeps changing during render', async () => {
  let n = 0;
  const h = build({
    onRender(db) {
      n++;
      db.exec(`UPDATE correspondence_log SET updated_at = '2031-01-0${(n % 9) + 1} 00:00:00' WHERE id = 1`);
    },
  });
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  assert.equal((await sign(h, token)).status, 200);
  await h.flush();
  assert.equal(h.db.prepare('SELECT document_snapshot_key FROM public_document_sign_requests').get()!.document_snapshot_key, null);
});

/* ------------------------------------------------------------------ */
/*  Author supervision                                                 */
/* ------------------------------------------------------------------ */

test('ASR: arch and site links work, custom display role is preserved, status is NOT auto-approved', async () => {
  const h = build();
  const arch = await createLink(h, { kind: 'asr', entity_id: 5, slot: 'arch', role_label: 'Хяналт хийсэн инженер' });
  const site = await createLink(h, { kind: 'asr', entity_id: 5, slot: 'site', role_label: 'Захиалагч тал' });
  assert.equal(arch.res.status, 201);
  assert.equal(site.res.status, 201);
  assert.equal(((await (await view(h, arch.token)).json()) as any).request.role_label, 'Хяналт хийсэн инженер');

  assert.equal((await sign(h, arch.token, signBody({ signer_name: 'Ж.Жаргал' }))).status, 200);
  assert.equal((await sign(h, site.token, signBody({ signer_name: 'З.Заяа' }))).status, 200);
  await h.flush();

  const r = h.db.prepare('SELECT * FROM author_supervision_reports WHERE id = 5').get() as any;
  assert.equal(r.status, 'submitted', 'external signature is NOT an ERP approval');
  assert.equal(r.sig_arch_name, 'Ж.Жаргал');
  assert.equal(r.sig_site_name, 'З.Заяа');
  assert.match(r.sig_arch_url, /^\/media\/public-sign-\d+-[a-f0-9]{32}\.png$/);
  assert.match(r.sig_arch_date, /^\d{4}-\d{2}-\d{2}$/);
  const key = (r.sig_arch_url as string).replace('/media/', '');
  assert.deepEqual([...h.media.store.get(key)!.bytes], [...PNG]);
  assert.equal(h.meeting.store.size >= 2, true, 'two immutable snapshots');
  const reqs = h.db.prepare('SELECT slot, role_label, status, document_sha256 FROM public_document_sign_requests ORDER BY id').all() as any[];
  assert.deepEqual(reqs.map((x) => [x.slot, x.role_label, x.status]), [['arch', 'Хяналт хийсэн инженер', 'signed'], ['site', 'Захиалагч тал', 'signed']]);
  assert.ok(reqs.every((x) => /^[a-f0-9]{64}$/.test(x.document_sha256)));
});

test('ASR: renderer runs only AFTER the signature is committed (snapshot contains the signature)', async () => {
  const seen: (string | null)[] = [];
  const h = build({ onRender: (db) => seen.push((db.prepare('SELECT sig_site_url FROM author_supervision_reports WHERE id=5').get() as any).sig_site_url) });
  const { token } = await createLink(h, { kind: 'asr', entity_id: 5, slot: 'site' });
  // Link үүсгэх үеийн урьдчилсан preview (гарын үсэггүй, cache) — snapshot биш.
  await h.flush();
  seen.length = 0;
  await sign(h, token);
  await h.flush();
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((u) => typeof u === 'string' && u.startsWith('/media/public-sign-')));
});

test('ASR: an occupied slot cannot be overwritten (create, view, sign)', async () => {
  const h = build();
  h.db.exec("UPDATE author_supervision_reports SET sig_site_url='/media/existing.png', sig_site_name='Өмнөх' WHERE id=5");
  assert.equal((await createLink(h, { kind: 'asr', entity_id: 5, slot: 'site' })).res.status, 409);
  assert.equal((await createLink(h, { kind: 'asr', entity_id: 5, slot: 'client' })).res.status, 400);

  // link made while empty, then someone fills the slot in the editor
  const h2 = build();
  const { token } = await createLink(h2, { kind: 'asr', entity_id: 5, slot: 'arch' });
  h2.db.exec("UPDATE author_supervision_reports SET sig_arch_url='/media/editor.png', sig_arch_name='Редактор' WHERE id=5");
  assert.equal((await sign(h2, token)).status, 409);
  const r = h2.db.prepare('SELECT sig_arch_url, sig_arch_name FROM author_supervision_reports WHERE id=5').get() as any;
  assert.equal(r.sig_arch_url, '/media/editor.png');
  assert.equal(h2.media.store.size, 0);
  const v = (await (await view(h2, token)).json()) as any;
  assert.equal(v.request.status, 'signed', 'link closes instead of showing a second canvas');
  assert.equal(v.request.signed_name, 'Редактор');
});

test('ASR: visibility rules — only someone who can already see the report may issue a link', async () => {
  const h = build();
  assert.equal((await createLink(h, { kind: 'asr', entity_id: 5, slot: 'site' }, OTHER_ID)).res.status, 403, 'different team');
  assert.equal((await createLink(h, { kind: 'asr', entity_id: 5, slot: 'site' }, 99, 'client')).res.status, 403);
  assert.equal((await createLink(h, { kind: 'asr', entity_id: 5, slot: 'site' }, ADMIN_ID, 'admin')).res.status, 201);
  assert.equal((await createLink(h, { kind: 'asr', entity_id: 404, slot: 'site' }, ADMIN_ID, 'admin')).res.status, 404);

  // requester loses visibility (leaves the team) → link dies
  const h2 = build();
  const { token } = await createLink(h2, { kind: 'asr', entity_id: 5, slot: 'site' });
  h2.db.exec(`DELETE FROM user_teams WHERE user_id = ${STAFF_ID}`);
  h2.db.exec(`UPDATE author_supervision_reports SET author_id = 999 WHERE id = 5`);
  assert.equal((await sign(h2, token)).status, 410);
  assert.equal(h2.db.prepare('SELECT sig_site_url FROM author_supervision_reports WHERE id=5').get()!.sig_site_url, null);
});

test('ASR: deleting the report is handled — preview of a vanished document is 404, pending links are not signable', async () => {
  const h = build();
  const { token } = await createLink(h, { kind: 'asr', entity_id: 5, slot: 'site' });
  h.db.exec('DELETE FROM author_supervision_reports WHERE id = 5');
  const res = await sign(h, token);
  assert.ok(res.status === 404 || res.status === 410);
});

/* ------------------------------------------------------------------ */
/*  Хуучин (logged-in client portal + staff cancel) урсгалтай уялдаа   */
/*  — БОДИТ routes/correspondenceSignature.ts                           */
/* ------------------------------------------------------------------ */

const legacy = await import('./correspondenceSignature.ts');
const CLIENT_ID = 77;

function buildWithLegacy() {
  const h = build();
  h.db.exec(`
    CREATE TABLE project_client_access (project_id INTEGER, org_id INTEGER, access_level TEXT, revoked_at TEXT);
    CREATE TABLE client_contacts (org_id INTEGER, user_id INTEGER);
    CREATE TABLE client_events (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, kind TEXT, ref_id INTEGER, title_mn TEXT, actor_user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO users VALUES (${CLIENT_ID},'client','Портал Захиалагч','Захиалагч','active');
    INSERT INTO project_members VALUES (7,${CLIENT_ID});
  `);
  const router = new Hono();
  const canRead = async () => true;
  const canWrite = async (db: D1Database, projectId: number, v: { sub: number; role: string }) =>
    v.role === 'admin' || (v.role !== 'client' && !!(await db.prepare('SELECT 1 AS x FROM project_members WHERE project_id=? AND user_id=?').bind(projectId, v.sub).first()));
  legacy.registerCorrespondenceSignatureRoutes(router as never, canRead as never, canWrite as never);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user' as never, JSON.parse(c.req.header('x-user') ?? '{}') as never);
    await next();
  });
  app.route('/api/correspondence', router);
  // Re-use the same env/ctx as the signing harness
  const call = (path: string, init?: RequestInit) => h.callRaw(app, path, init);
  return { ...h, legacy: call };
}

const asClient = () => ({ 'x-user': JSON.stringify({ sub: CLIENT_ID, role: 'client' }), 'content-type': 'application/json' });
const portalSign = (h: ReturnType<typeof buildWithLegacy>) =>
  h.legacy('/api/correspondence/1/sign', { method: 'POST', headers: asClient(), body: json({ signature_data_url: pngDataUrl() }) });

test('legacy staff cancel revokes the public link in the same transaction', async () => {
  const h = buildWithLegacy();
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  assert.equal(h.db.prepare('SELECT sign_status FROM correspondence_log WHERE id=1').get()!.sign_status, 'pending');
  const res = await h.legacy('/api/correspondence/1/signature-request', { method: 'DELETE', headers: asUser(STAFF_ID) });
  assert.equal(res.status, 200);
  await h.flush();
  assert.equal(h.db.prepare('SELECT sign_status FROM correspondence_log WHERE id=1').get()!.sign_status, 'none');
  assert.equal(h.db.prepare('SELECT status FROM public_document_sign_requests').get()!.status, 'revoked');
  assert.equal((await sign(h, token)).status, 410);
});

test('client portal signs BEFORE the public link → link closes as signed and cannot show a canvas again', async () => {
  const h = buildWithLegacy();
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  const res = await portalSign(h);
  assert.equal(res.status, 200, await res.clone().text());
  await h.flush();
  const req = h.db.prepare('SELECT status, signed_name, signature_key FROM public_document_sign_requests').get() as any;
  assert.equal(req.status, 'signed');
  assert.equal(req.signed_name, 'Портал Захиалагч');
  assert.ok(req.signature_key);
  const v = (await (await view(h, token)).json()) as any;
  assert.equal(v.request.status, 'signed');
  assert.equal((await sign(h, token)).status, 409);
  assert.equal((await h.call(`/public/signing/${token}/document`)).status, 410);
  const corr = h.db.prepare('SELECT client_signed_by, client_signer_name FROM correspondence_log WHERE id=1').get() as any;
  assert.equal(corr.client_signed_by, CLIENT_ID, 'portal keeps recording the ERP user who signed');
});

test('public link signs BEFORE the client portal → portal cannot overwrite', async () => {
  const h = buildWithLegacy();
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  assert.equal((await sign(h, token)).status, 200);
  const keyBefore = (h.db.prepare('SELECT client_signature_key FROM correspondence_log WHERE id=1').get() as any).client_signature_key;
  const res = await portalSign(h);
  assert.equal(res.status, 409);
  const after = h.db.prepare('SELECT client_signature_key, client_signer_name, client_signed_by FROM correspondence_log WHERE id=1').get() as any;
  assert.equal(after.client_signature_key, keyBefore);
  assert.equal(after.client_signer_name, 'Ч.Чимэг');
  assert.equal(after.client_signed_by, null);
});

test('signed-field lock still protects an externally signed RFI (staff edits cannot rewrite signed content via the signature routes)', async () => {
  const h = buildWithLegacy();
  const { token } = await createLink(h, { kind: 'correspondence', entity_id: 1 });
  await sign(h, token);
  // Legacy cancel of a signed RFI is refused.
  const cancel = await h.legacy('/api/correspondence/1/signature-request', { method: 'DELETE', headers: asUser(STAFF_ID) });
  assert.equal(cancel.status, 409);
  assert.equal(h.db.prepare('SELECT sign_status FROM correspondence_log WHERE id=1').get()!.sign_status, 'signed');
  // …and re-requesting is refused too.
  const again = await h.legacy('/api/correspondence/1/signature-request', { method: 'POST', headers: asUser(STAFF_ID), body: '{}' });
  assert.ok(again.status === 409 || again.status === 400);
});
