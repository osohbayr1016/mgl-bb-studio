// Дотоод журмын route-ууд — БОДИТ SQLite (миграц 0330 файлаас), D1 shim,
// санах ойн R2, Hono `app.request()`.  Ажилтны урсгал (унших → баталгаажуулах →
// профайлын гарын үсгээр зурах), хувилбарын дахин зурах дүрэм, эрхийн
// хаалтууд, админы roster бүгд энд.
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

const internalRules = (await import('./internalRules.ts')).default;
const { contentHashOf, sha256HexOf } = await import('../lib/internalRules.ts');

/* ------------------------------------------------------------------ */
/*  Shim-үүд                                                           */
/* ------------------------------------------------------------------ */

function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
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
    prepare,
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;
}

function r2Shim() {
  const store = new Map<string, { bytes: ArrayBuffer; contentType?: string; custom?: Record<string, string> }>();
  const bucket = {
    store,
    async put(key: string, bytes: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
      store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType, custom: opts?.customMetadata });
      return { key };
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return {
        key,
        size: o.bytes.byteLength,
        httpEtag: '"x"',
        body: new Blob([o.bytes]).stream(),
        arrayBuffer: async () => o.bytes.slice(0),
        writeHttpMetadata(h: Headers) {
          if (o.contentType) h.set('Content-Type', o.contentType);
        },
      };
    },
    async head(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return {
        key,
        size: o.bytes.byteLength,
        httpMetadata: { contentType: o.contentType },
        customMetadata: o.custom ?? {},
      };
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  return bucket;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).buffer;

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, status TEXT DEFAULT 'active',
      is_support INTEGER NOT NULL DEFAULT 0, team_id INTEGER, signature_url TEXT
    );
    CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT);
    INSERT INTO teams (id, code) VALUES (1, 'AR'), (2, 'BA');
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(readFileSync(new URL('../../migrations/0330_internal_rules.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/0347_internal_rules_rich_body.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO users (id, username, full_name, role, signature_url, team_id) VALUES
      (1, 'admin1', 'Админ', 'admin', '/media/1-1700000000000-abc-sig.png', 1),
      (2, 'eng1', 'Инженер Батаа', 'engineer', '/media/2-1700000000000-abc-sig.png', 2),
      (3, 'arch1', 'Архитектор Сараа', 'architect', NULL, 1),
      (4, 'senior1', 'Ахлах Дорж', 'senior', '/media/4-1700000000000-abc-sig.png', 2),
      (5, 'client1', 'Захиалагч', 'client', NULL, NULL),
      (6, 'worker1', 'Цэвэрлэгч', 'worker', NULL, NULL),
      (7, 'tv', 'TV', 'engineer', NULL, NULL),
      (8, 'old', 'Гарсан ажилтан', 'engineer', '/media/8-1700000000000-abc-sig.png', 2);
    UPDATE users SET is_support = 1 WHERE id = 7;
    UPDATE users SET status = 'inactive' WHERE id = 8;
  `);
  return db;
}

interface Harness {
  db: DatabaseSync;
  media: ReturnType<typeof r2Shim>;
  priv: ReturnType<typeof r2Shim>;
  waited: Promise<unknown>[];
  req: (
    user: { sub: number; role: string } | null,
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
}

function harness(): Harness {
  const db = freshDb();
  const media = r2Shim();
  const priv = r2Shim();
  for (const id of [1, 2, 4, 8]) media.store.set(`${id}-1700000000000-abc-sig.png`, { bytes: PNG, contentType: 'image/png' });
  const env = { DB: d1Shim(db), MEDIA_BUCKET: media, MEETING_BUCKET: priv } as unknown as Record<string, unknown>;
  const waited: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p), passThroughOnException() {} };

  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/internal-rules', internalRules as never);

  const req: Harness['req'] = (user, method, path, body, headers) =>
    app.request(
      `http://x${path}`,
      {
        method,
        headers: {
          ...(user ? { 'x-test-user': JSON.stringify(user) } : {}),
          ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
          ...(headers ?? {}),
        },
        body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
      ctx as never,
    );
  return { db, media, priv, waited, req };
}

const ADMIN = { sub: 1, role: 'admin' };
const ENG = { sub: 2, role: 'engineer' };
const ARCH = { sub: 3, role: 'architect' };
const SENIOR = { sub: 4, role: 'senior' };
const CLIENT = { sub: 5, role: 'client' };
const WORKER = { sub: 6, role: 'worker' };

async function json<T = Record<string, unknown>>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

/** Админ журам үүсгээд нийтэлнэ — ихэнх тестийн суурь. */
async function publishRule(h: Harness, title = 'Дотоод журам', body = '## Нэг\n\nЗаалт.') {
  const created = await json<{ rule: { id: number } }>(await h.req(ADMIN, 'POST', '/api/internal-rules', { title_mn: title, body_md: body }));
  const pub = await h.req(ADMIN, 'POST', `/api/internal-rules/${created.rule.id}/publish`);
  assert.equal(pub.status, 200);
  await Promise.all(h.waited);
  return created.rule.id;
}

/* ------------------------------------------------------------------ */
/*  Тестүүд                                                            */
/* ------------------------------------------------------------------ */

test('эрх: client/worker хаалттай, ажилтан хоосон жагсаалт, admin route-ууд requireAdmin', async () => {
  const h = harness();
  assert.equal((await h.req(CLIENT, 'GET', '/api/internal-rules')).status, 403);
  assert.equal((await h.req(WORKER, 'GET', '/api/internal-rules')).status, 403);
  const list = await h.req(ENG, 'GET', '/api/internal-rules');
  assert.equal(list.status, 200);
  assert.deepEqual(await json(list), { rules: [], pending_count: 0 });
  assert.equal((await h.req(ENG, 'GET', '/api/internal-rules/admin')).status, 403);
  assert.equal((await h.req(SENIOR, 'POST', '/api/internal-rules', { title_mn: 'x' })).status, 403);
  assert.equal((await h.req(ENG, 'POST', '/api/internal-rules/1/publish')).status, 403);
  assert.equal((await h.req(ENG, 'GET', '/api/internal-rules/1/signatures')).status, 403);
  assert.equal((await h.req(SENIOR, 'GET', '/api/internal-rules/1/signatures')).status, 403, 'roster нь admin-only (эзний шийдвэр)');
});

test('draft нь ажилтанд харагдахгүй; publish → хувилбар 1, мэдэгдэл бүх ажилтанд (нийтлэгч, TV, идэвхгүй, client, worker-гүй)', async () => {
  const h = harness();
  const created = await h.req(ADMIN, 'POST', '/api/internal-rules', { title_mn: 'Дотоод журам', body_md: 'Бие' });
  assert.equal(created.status, 201);
  const { rule } = await json<{ rule: { id: number; status: string; current_version_id: number | null } }>(created);
  assert.equal(rule.status, 'draft');
  assert.equal(rule.current_version_id, null);

  assert.equal((await h.req(ENG, 'GET', `/api/internal-rules/${rule.id}`)).status, 404, 'draft — ажилтанд 404');
  assert.deepEqual((await json(await h.req(ENG, 'GET', '/api/internal-rules'))).rules, []);

  // Хоосон бие нийтлэгдэхгүй
  await h.req(ADMIN, 'PUT', `/api/internal-rules/${rule.id}`, { body_md: '   ' });
  assert.equal((await h.req(ADMIN, 'POST', `/api/internal-rules/${rule.id}/publish`)).status, 400);
  await h.req(ADMIN, 'PUT', `/api/internal-rules/${rule.id}`, { body_md: '## Ерөнхий\n\nЗаалт 1.' });

  const pub = await h.req(ADMIN, 'POST', `/api/internal-rules/${rule.id}/publish`);
  assert.equal(pub.status, 200);
  const p = await json<{ rule: { status: string; current_version_id: number }; version: { version: number; content_hash: string } }>(pub);
  assert.equal(p.rule.status, 'published');
  assert.equal(p.version.version, 1);
  assert.equal(p.version.content_hash, await contentHashOf('Дотоод журам', '## Ерөнхий\n\nЗаалт 1.'));
  await Promise.all(h.waited);

  const notified = h.db.prepare('SELECT user_id, type, link FROM notifications ORDER BY user_id').all() as Array<{ user_id: number; type: string; link: string }>;
  assert.deepEqual(notified.map((n) => n.user_id), [2, 3, 4], 'зөвхөн идэвхтэй ажилтан; нийтлэгч (1), client, worker, TV, идэвхгүй орохгүй');
  assert.ok(notified.every((n) => n.type === 'attendance_announcement' && n.link === `/app/rules/${rule.id}`));

  // Ижил бичвэрийг дахин нийтлэх → 409 UNCHANGED (гарын үсэг хүчингүй болохгүй)
  const again = await h.req(ADMIN, 'POST', `/api/internal-rules/${rule.id}/publish`);
  assert.equal(again.status, 409);
  assert.equal((await json(again)).code, 'UNCHANGED');
});

test('ажилтны урсгал: унших → sign → гарын үсэг хувийн bucket-д хуулбарлагдана, мөр зөв', async () => {
  const h = harness();
  const id = await publishRule(h);

  const detail = await h.req(ENG, 'GET', `/api/internal-rules/${id}`);
  assert.equal(detail.status, 200);
  const d = await json<{
    rule: { version_id: number; version: number; content_hash: string; body_md: string; title_mn: string };
    signature: null;
    previous: null;
    profile_signature_url: string | null;
  }>(detail);
  assert.equal(d.signature, null);
  assert.equal(d.previous, null);
  assert.equal(d.rule.version, 1);
  assert.equal(d.rule.body_md, '## Нэг\n\nЗаалт.');
  assert.equal(d.profile_signature_url, '/media/2-1700000000000-abc-sig.png');

  // confirmed дутуу → 400
  assert.equal(
    (await h.req(ENG, 'POST', `/api/internal-rules/${id}/sign`, { version_id: d.rule.version_id, content_hash: d.rule.content_hash })).status,
    400,
  );
  // буруу хэш → 409 HASH_MISMATCH
  const bad = await h.req(ENG, 'POST', `/api/internal-rules/${id}/sign`, {
    confirmed: true,
    version_id: d.rule.version_id,
    content_hash: 'f'.repeat(64),
  });
  assert.equal(bad.status, 409);
  assert.equal((await json(bad)).code, 'HASH_MISMATCH');

  const signed = await h.req(
    ENG,
    'POST',
    `/api/internal-rules/${id}/sign`,
    { confirmed: true, version_id: d.rule.version_id, content_hash: d.rule.content_hash },
    { 'user-agent': 'TestBrowser/1.0' },
  );
  assert.equal(signed.status, 201);
  const s = await json<{ signature: Record<string, unknown> }>(signed);
  assert.equal(s.signature.user_id, 2);
  assert.equal(s.signature.version_id, d.rule.version_id);
  assert.equal(s.signature.content_hash, d.rule.content_hash);
  assert.equal(s.signature.signature_source, 'profile');
  assert.equal(s.signature.image_url, `/internal-rules/signatures/${s.signature.id}/image`);
  assert.equal('signature_key' in s.signature, false, 'R2 түлхүүр клиент рүү гарахгүй');
  assert.match(String(s.signature.signed_at), /^\d{4}-\d{2}-\d{2}T/);

  // DB мөр: хувийн bucket дахь хуулбар + sha256 + user_agent
  const row = h.db.prepare('SELECT * FROM internal_rule_signatures WHERE id = ?').get(s.signature.id as number) as Record<string, unknown>;
  assert.match(String(row.signature_key), new RegExp(`^rule-signatures/${id}/${d.rule.version_id}-2-\\d+-[0-9a-f]{8}\\.png$`));
  assert.equal(row.user_agent, 'TestBrowser/1.0');
  assert.match(String(row.signature_sha256), /^[0-9a-f]{64}$/);
  const copied = h.priv.store.get(String(row.signature_key));
  assert.ok(copied, 'хуулбар MEETING_BUCKET-д');
  assert.equal(copied.contentType, 'image/png');
  assert.equal(copied.custom?.source_key, '2-1700000000000-abc-sig.png');
  assert.deepEqual(new Uint8Array(copied.bytes), new Uint8Array(PNG));
  assert.equal(h.media.store.size, 4, 'нийтийн bucket хөндөгдөөгүй');

  // Дахин зурах → 409 ALREADY_SIGNED, шинэ объект үүсэхгүй
  const dup = await h.req(ENG, 'POST', `/api/internal-rules/${id}/sign`, {
    confirmed: true,
    version_id: d.rule.version_id,
    content_hash: d.rule.content_hash,
  });
  assert.equal(dup.status, 409);
  assert.equal((await json(dup)).code, 'ALREADY_SIGNED');
  assert.equal(h.priv.store.size, 1);

  // Жагсаалт + дэлгэрэнгүйд гарын үсэг харагдана
  const list = await json<{ rules: Array<{ signature_id: number | null; signed_at: string | null }>; pending_count: number }>(
    await h.req(ENG, 'GET', '/api/internal-rules'),
  );
  assert.equal(list.pending_count, 0);
  assert.equal(list.rules[0]!.signature_id, s.signature.id);
  const d2 = await json<{ signature: { id: number } | null }>(await h.req(ENG, 'GET', `/api/internal-rules/${id}`));
  assert.equal(d2.signature?.id, s.signature.id);

  // Өөр ажилтанд pending хэвээр
  const other = await json<{ pending_count: number }>(await h.req(SENIOR, 'GET', '/api/internal-rules'));
  assert.equal(other.pending_count, 1);
});

test('профайлын гарын үсэггүй → 409 NO_SIGNATURE; объект нь bucket-д байхгүй бол мөн 409; зураг биш бол 409', async () => {
  const h = harness();
  const id = await publishRule(h);
  const d = await json<{ rule: { version_id: number; content_hash: string } }>(await h.req(ARCH, 'GET', `/api/internal-rules/${id}`));
  const body = { confirmed: true, version_id: d.rule.version_id, content_hash: d.rule.content_hash };

  const none = await h.req(ARCH, 'POST', `/api/internal-rules/${id}/sign`, body);
  assert.equal(none.status, 409);
  assert.equal((await json(none)).code, 'NO_SIGNATURE');

  // URL байгаа ч объект устсан (mediaReplace-ийн дараах төлөв)
  h.db.prepare("UPDATE users SET signature_url = '/media/3-1700000000000-abc-gone.png' WHERE id = 3").run();
  const gone = await h.req(ARCH, 'POST', `/api/internal-rules/${id}/sign`, body);
  assert.equal(gone.status, 409);
  assert.equal((await json(gone)).code, 'NO_SIGNATURE');

  // Олон сегменттэй (traversal) URL — mediaKeyOfUrl null → NO_SIGNATURE
  h.db.prepare("UPDATE users SET signature_url = '/media/email%2F5%2Fx.png' WHERE id = 3").run();
  assert.equal((await json(await h.req(ARCH, 'POST', `/api/internal-rules/${id}/sign`, body))).code, 'NO_SIGNATURE');

  // Зураг биш байт
  h.media.store.set('3-1700000000000-abc-html.png', { bytes: new TextEncoder().encode('<html>').buffer, contentType: 'image/png' });
  h.db.prepare("UPDATE users SET signature_url = '/media/3-1700000000000-abc-html.png' WHERE id = 3").run();
  const notImg = await h.req(ARCH, 'POST', `/api/internal-rules/${id}/sign`, body);
  assert.equal(notImg.status, 409);
  assert.equal(h.priv.store.size, 0);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM internal_rule_signatures').get() as { n: number }).n, 0);
});

test('шинэ хувилбар нийтлэхэд бүгд ДАХИН зурна; хуучин гарын үсэг үлдэнэ; previous тайлбар', async () => {
  const h = harness();
  const id = await publishRule(h);
  const v1 = await json<{ rule: { version_id: number; content_hash: string } }>(await h.req(ENG, 'GET', `/api/internal-rules/${id}`));
  const signed = await h.req(ENG, 'POST', `/api/internal-rules/${id}/sign`, { confirmed: true, version_id: v1.rule.version_id, content_hash: v1.rule.content_hash });
  assert.equal(signed.status, 201);

  // Админ ажлын хувийг засна — ажилтан ХУУЧИН бичвэрийг харсаар байна
  await h.req(ADMIN, 'PUT', `/api/internal-rules/${id}`, { body_md: '## Нэг\n\nЗаалт (шинэчилсэн).' });
  const still = await json<{ rule: { version: number; body_md: string }; signature: unknown }>(await h.req(ENG, 'GET', `/api/internal-rules/${id}`));
  assert.equal(still.rule.version, 1);
  assert.equal(still.rule.body_md, '## Нэг\n\nЗаалт.');
  assert.ok(still.signature, 'v1 гарын үсэг хэвээр');
  const adm = await json<{ rules: Array<{ has_unpublished_changes: boolean; signed_count: number; roster_count: number }> }>(await h.req(ADMIN, 'GET', '/api/internal-rules/admin'));
  assert.equal(adm.rules[0]!.has_unpublished_changes, true);
  assert.equal(adm.rules[0]!.signed_count, 1);
  assert.equal(adm.rules[0]!.roster_count, 4, 'admin+senior+engineer+architect идэвхтэй, TV/идэвхгүй/client/worker орохгүй');

  // Ажилтан хуучин хувилбарын id-гаар «зурах» оролдох — энэ хооронд нийтлэгдвэл 409 VERSION_CHANGED
  const pub2 = await h.req(ADMIN, 'POST', `/api/internal-rules/${id}/publish`);
  assert.equal(pub2.status, 200);
  assert.equal((await json<{ version: { version: number } }>(pub2)).version.version, 2);
  await Promise.all(h.waited);
  const stale = await h.req(SENIOR, 'POST', `/api/internal-rules/${id}/sign`, { confirmed: true, version_id: v1.rule.version_id, content_hash: v1.rule.content_hash });
  assert.equal(stale.status, 409);
  assert.equal((await json(stale)).code, 'VERSION_CHANGED');

  // Инженерт дахин pending, previous = v1
  const v2 = await json<{ rule: { version: number; version_id: number; content_hash: string; body_md: string }; signature: unknown; previous: { version: number } | null }>(
    await h.req(ENG, 'GET', `/api/internal-rules/${id}`),
  );
  assert.equal(v2.rule.version, 2);
  assert.equal(v2.rule.body_md, '## Нэг\n\nЗаалт (шинэчилсэн).');
  assert.equal(v2.signature, null);
  assert.equal(v2.previous?.version, 1);
  assert.equal((await json<{ pending_count: number }>(await h.req(ENG, 'GET', '/api/internal-rules'))).pending_count, 1);

  // Админы roster v2: инженер зураагүй ч previous = v1 (огноотой); архитектор огт зураагүй → previous null
  const ro = await json<{
    summary: { signed: number; pending: number; total: number };
    rows: Array<{ user_id: number; signature_id: number | null; previous: { version: number; signed_at: string } | null }>;
  }>(await h.req(ADMIN, 'GET', `/api/internal-rules/${id}/signatures`));
  assert.deepEqual(ro.summary, { signed: 0, pending: 4, total: 4 });
  const eng = ro.rows.find((r) => r.user_id === 2)!;
  assert.equal(eng.signature_id, null);
  assert.equal(eng.previous?.version, 1);
  assert.match(eng.previous!.signed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(ro.rows.find((r) => r.user_id === 3)!.previous, null);
  // v1-ийг сонгоход инженер зурсан, previous null
  const ro1 = await json<{ summary: { signed: number }; rows: Array<{ user_id: number; signature_id: number | null; previous: unknown }> }>(
    await h.req(ADMIN, 'GET', `/api/internal-rules/${id}/signatures?version_id=${v1.rule.version_id}`),
  );
  assert.equal(ro1.summary.signed, 1);
  assert.equal(ro1.rows.find((r) => r.user_id === 2)!.previous, null);

  // Шинэ хувилбарт зурна → хоёр гарын үсэг, хоёр хуулбар
  const s2 = await h.req(ENG, 'POST', `/api/internal-rules/${id}/sign`, { confirmed: true, version_id: v2.rule.version_id, content_hash: v2.rule.content_hash });
  assert.equal(s2.status, 201);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM internal_rule_signatures WHERE user_id = 2').get() as { n: number }).n, 2);
  assert.equal(h.priv.store.size, 2);
  assert.equal((await json<{ rules: Array<{ has_unpublished_changes: boolean }> }>(await h.req(ADMIN, 'GET', '/api/internal-rules/admin'))).rules[0]!.has_unpublished_changes, false);
  // 2 дахь нийтлэлийн мэдэгдлийн гарчиг «шинэчлэгдлээ»
  const titles = h.db.prepare('SELECT DISTINCT title FROM notifications ORDER BY id').all() as Array<{ title: string }>;
  assert.equal(titles.length, 2);
  assert.match(titles[1]!.title, /шинэчлэгдлээ/);
});

test('гарын үсгийн зураг: эзэн + admin уншина, бусад 403, байхгүй 404', async () => {
  const h = harness();
  const id = await publishRule(h);
  const d = await json<{ rule: { version_id: number; content_hash: string } }>(await h.req(ENG, 'GET', `/api/internal-rules/${id}`));
  const s = await json<{ signature: { id: number; image_url: string } }>(
    await h.req(ENG, 'POST', `/api/internal-rules/${id}/sign`, { confirmed: true, version_id: d.rule.version_id, content_hash: d.rule.content_hash }),
  );
  const path = `/api${s.signature.image_url}`;
  const own = await h.req(ENG, 'GET', path);
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('content-type'), 'image/png');
  assert.match(own.headers.get('cache-control') ?? '', /private/);
  assert.deepEqual(new Uint8Array(await own.arrayBuffer()), new Uint8Array(PNG));
  assert.equal((await h.req(ADMIN, 'GET', path)).status, 200);
  assert.equal((await h.req(SENIOR, 'GET', path)).status, 403);
  assert.equal((await h.req(CLIENT, 'GET', path)).status, 403);
  assert.equal((await h.req(ADMIN, 'GET', '/api/internal-rules/signatures/999/image')).status, 404);
});

test('админы roster: зурсан/зураагүй, идэвхгүй болсон хүний гарын үсэг extra-д, версийн жагсаалт', async () => {
  const h = harness();
  const id = await publishRule(h);
  const d = await json<{ rule: { version_id: number; content_hash: string } }>(await h.req(ENG, 'GET', `/api/internal-rules/${id}`));
  const body = { confirmed: true, version_id: d.rule.version_id, content_hash: d.rule.content_hash };
  assert.equal((await h.req(ENG, 'POST', `/api/internal-rules/${id}/sign`, body)).status, 201);
  assert.equal((await h.req(SENIOR, 'POST', `/api/internal-rules/${id}/sign`, body)).status, 201);

  const r = await json<{
    version: { id: number; version: number };
    summary: { signed: number; pending: number; total: number };
    versions: Array<{ id: number; version: number; signed_count: number }>;
    rows: Array<{ user_id: number; signature_id: number | null; signed_at: string | null; full_name: string }>;
    extra: Array<{ user_id: number }>;
  }>(await h.req(ADMIN, 'GET', `/api/internal-rules/${id}/signatures`));
  assert.equal(r.version.version, 1);
  assert.deepEqual(r.summary, { signed: 2, pending: 2, total: 4 });
  assert.deepEqual(r.versions.map((v) => [v.version, v.signed_count]), [[1, 2]]);
  assert.deepEqual(
    r.rows.map((x) => [x.user_id, x.signature_id !== null]),
    [
      [1, false], // Админ (нэрээр эрэмбэ: зураагүй нь эхэнд)
      [3, false], // Архитектор Сараа
      [4, true], // Ахлах Дорж
      [2, true], // Инженер Батаа
    ],
  );
  assert.deepEqual(r.extra, []);
  assert.equal(r.rows.find((x) => x.user_id === 2)!.team_code, 'BA', 'team_code нь teams.code (users.team_id)');
  assert.deepEqual(r.summary, { signed: 2, pending: 2, total: 4 });

  // Инженер идэвхгүй болов → roster-оос гарч, гарын үсэг нь extra-д хадгалагдана
  h.db.prepare("UPDATE users SET status = 'inactive' WHERE id = 2").run();
  const r2 = await json<{ rows: Array<{ user_id: number }>; extra: Array<{ user_id: number; full_name: string }> }>(
    await h.req(ADMIN, 'GET', `/api/internal-rules/${id}/signatures`),
  );
  assert.deepEqual(r2.rows.map((x) => x.user_id), [1, 3, 4]);
  assert.deepEqual(r2.extra.map((x) => [x.user_id, x.full_name]), [[2, 'Инженер Батаа']]);

  // Буруу version_id (өөр журмынх) → 400; хувилбаргүй draft → version null
  const other = await json<{ rule: { id: number } }>(await h.req(ADMIN, 'POST', '/api/internal-rules', { title_mn: 'Өөр', body_md: 'x' }));
  assert.equal((await h.req(ADMIN, 'GET', `/api/internal-rules/${other.rule.id}/signatures?version_id=${d.rule.version_id}`)).status, 400);
  const empty = await json<{ version: null; rows: unknown[]; summary: unknown }>(await h.req(ADMIN, 'GET', `/api/internal-rules/${other.rule.id}/signatures`));
  assert.equal(empty.version, null);
  assert.deepEqual(empty.summary, { signed: 0, pending: 0, total: 0 });
  assert.deepEqual(empty.rows, []);
});

test('archive/unarchive/delete: архив ажилтнаас нуугдана, гарын үсэгтэйг устгахгүй, гарын үсэггүйг устгахад хүүхэд мөр цэвэрлэгдэнэ', async () => {
  const h = harness();
  const id = await publishRule(h);
  const d = await json<{ rule: { version_id: number; content_hash: string } }>(await h.req(ENG, 'GET', `/api/internal-rules/${id}`));
  await h.req(ENG, 'POST', `/api/internal-rules/${id}/sign`, { confirmed: true, version_id: d.rule.version_id, content_hash: d.rule.content_hash });

  const arch = await h.req(ADMIN, 'POST', `/api/internal-rules/${id}/archive`);
  assert.equal(arch.status, 200);
  assert.equal((await h.req(ENG, 'GET', `/api/internal-rules/${id}`)).status, 404);
  assert.deepEqual((await json<{ rules: unknown[] }>(await h.req(ENG, 'GET', '/api/internal-rules'))).rules, []);
  assert.equal((await h.req(ADMIN, 'POST', `/api/internal-rules/${id}/archive`)).status, 409, 'давхар архивлахгүй');

  // archived + ижил бичвэр publish → буцаан нээнэ, хувилбар/гарын үсэг хэвээр (reused)
  const re = await h.req(ADMIN, 'POST', `/api/internal-rules/${id}/publish`);
  assert.equal(re.status, 200);
  assert.equal((await json<{ reused?: boolean }>(re)).reused, true);
  assert.equal((await json<{ signature: unknown }>(await h.req(ENG, 'GET', `/api/internal-rules/${id}`))).signature !== null, true);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM internal_rule_versions').get() !== null, true);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM internal_rule_versions').get() as { n: number }).n, 1);

  // unarchive нь зөвхөн archived дээр
  assert.equal((await h.req(ADMIN, 'POST', `/api/internal-rules/${id}/unarchive`)).status, 409);
  await h.req(ADMIN, 'POST', `/api/internal-rules/${id}/archive`);
  const un = await json<{ rule: { status: string } }>(await h.req(ADMIN, 'POST', `/api/internal-rules/${id}/unarchive`));
  assert.equal(un.rule.status, 'published');

  // Гарын үсэгтэй → устгахгүй
  const del = await h.req(ADMIN, 'DELETE', `/api/internal-rules/${id}`);
  assert.equal(del.status, 409);
  assert.equal((await json(del)).code, 'HAS_SIGNATURES');

  // Гарын үсэггүй нийтлэгдсэн журам → устгахад хувилбар ч цэвэрлэгдэнэ
  const id2 = await publishRule(h, 'Хоёр дахь', 'Бие');
  assert.equal((await h.req(ADMIN, 'DELETE', `/api/internal-rules/${id2}`)).status, 200);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM internal_rule_versions WHERE rule_id = ?').get(id2) as { n: number }).n, 0);
  assert.equal((await h.req(ADMIN, 'GET', `/api/internal-rules/${id2}/signatures`)).status, 404);
});

test('sort_order-оор эрэмбэлнэ; pending_count олон журамд', async () => {
  const h = harness();
  const b = await publishRule(h, 'Б журам', 'x');
  const a = await publishRule(h, 'А журам', 'y');
  await h.req(ADMIN, 'PUT', `/api/internal-rules/${a}`, { sort_order: -1 });
  const list = await json<{ rules: Array<{ id: number; title_mn: string; body_length: number }>; pending_count: number }>(await h.req(ENG, 'GET', '/api/internal-rules'));
  assert.deepEqual(list.rules.map((r) => r.id), [a, b]);
  assert.equal(list.pending_count, 2);
  assert.equal(list.rules[0]!.body_length, 1);
});

/* ------------------------------------------------------------------ */
/*  0347 — HTML бие + файл хавсралт                                    */
/* ------------------------------------------------------------------ */

function fileForm(name: string, text: string): FormData {
  const fd = new FormData();
  fd.append('file', new File([new TextEncoder().encode(text)], name));
  return fd;
}

interface UploadedAttachment {
  id: string;
  key: string;
  name: string;
  size: number;
  content_type: string;
  sha256: string;
}

async function upload(h: Harness, name: string, text: string): Promise<UploadedAttachment> {
  const r = await h.req(ADMIN, 'POST', '/api/internal-rules/files', fileForm(name, text));
  assert.equal(r.status, 201);
  return (await json<{ attachment: UploadedAttachment }>(r)).attachment;
}

test('хавсралт upload: admin л; хувийн bucket-д sha256-тай; төрөл/хоосон хаалт', async () => {
  const h = harness();
  assert.equal((await h.req(SENIOR, 'POST', '/api/internal-rules/files', fileForm('a.pdf', '%PDF'))).status, 403);
  assert.equal((await h.req(ENG, 'POST', '/api/internal-rules/files', fileForm('a.pdf', '%PDF'))).status, 403);

  const att = await upload(h, 'Дотоод журам.pdf', '%PDF-1.7 журам');
  assert.match(att.key, /^rule-files\/\d+-[0-9a-f]{8}\.pdf$/);
  assert.equal(att.name, 'Дотоод журам.pdf');
  assert.equal(att.content_type, 'application/pdf');
  assert.equal(att.sha256, await sha256HexOf(new TextEncoder().encode('%PDF-1.7 журам')));
  const stored = h.priv.store.get(att.key);
  assert.ok(stored, 'MEETING_BUCKET (хувийн) — нийтийн MEDIA_BUCKET биш');
  assert.equal(h.media.store.has(att.key), false);
  assert.equal(stored.custom?.sha256, att.sha256);

  const bad = await h.req(ADMIN, 'POST', '/api/internal-rules/files', fileForm('x.html', '<script>'));
  assert.equal(bad.status, 400);
  assert.equal((await json(bad)).code, 'FILE_TYPE');
  assert.equal((await h.req(ADMIN, 'POST', '/api/internal-rules/files', fileForm('empty.pdf', ''))).status, 400);
  assert.equal((await h.req(ADMIN, 'POST', '/api/internal-rules/files', new FormData())).status, 400);
});

test('HTML бие + хавсралт: хадгалах, нийтлэх (зөвхөн файлтай ч), хэш, ажилтанд түлхүүргүй, татах эрх', async () => {
  const h = harness();
  const pdf = await upload(h, 'журам.pdf', '%PDF-1.7 a');
  const docx = await upload(h, 'Журам.docx', 'PK docx');

  // Файл-ОНЛИ журам: бие хоосон ч хавсралттай тул нийтлэгдэнэ
  const created = await h.req(ADMIN, 'POST', '/api/internal-rules', {
    title_mn: 'Хөдөлмөрийн дотоод журам',
    body_format: 'html',
    body_md: '<p><br></p><script>alert(1)</script>',
    attachments: [{ key: pdf.key }, { key: docx.key, name: 'Журам (эх).docx' }],
  });
  assert.equal(created.status, 201);
  const { rule } = await json<{ rule: { id: number; body_md: string; body_format: string; attachments: UploadedAttachment[] } }>(created);
  assert.equal(rule.body_format, 'html');
  assert.equal(rule.body_md, '<p><br></p>', 'script сервер дээр хаягдана');
  assert.deepEqual(rule.attachments.map((a) => [a.name, a.size, a.sha256]), [
    ['журам.pdf', pdf.size, pdf.sha256],
    ['Журам (эх).docx', docx.size, docx.sha256],
  ]);

  // Нийтлэгдээгүй файл — ажилтанд 404, admin урьдчилан харна
  assert.equal((await h.req(ENG, 'GET', `/api/internal-rules/${rule.id}/files/${pdf.id}`)).status, 404);
  assert.equal((await h.req(ADMIN, 'GET', `/api/internal-rules/${rule.id}/files/${pdf.id}`)).status, 200);

  const pub = await h.req(ADMIN, 'POST', `/api/internal-rules/${rule.id}/publish`);
  assert.equal(pub.status, 200);
  await Promise.all(h.waited);
  const version = (await json<{ version: { content_hash: string; body_format: string } }>(pub)).version;
  assert.equal(version.body_format, 'html');
  assert.equal(
    version.content_hash,
    await contentHashOf('Хөдөлмөрийн дотоод журам', '<p><br></p>', {
      format: 'html',
      attachments: [
        { sha256: pdf.sha256, size: pdf.size, name: 'журам.pdf' },
        { sha256: docx.sha256, size: docx.size, name: 'Журам (эх).docx' },
      ],
    }),
    'гарын үсэг файлын sha256-д холбогдоно',
  );

  // Ажилтан: жагсаалтад хавсралтын тоо, дэлгэрэнгүйд R2 түлхүүр ГАРАХГҮЙ
  const list = await json<{ rules: Array<{ attachment_count: number; body_format: string }> }>(await h.req(ENG, 'GET', '/api/internal-rules'));
  assert.equal(list.rules[0]!.attachment_count, 2);
  assert.equal(list.rules[0]!.body_format, 'html');
  const detail = await h.req(ENG, 'GET', `/api/internal-rules/${rule.id}`);
  const raw = await detail.text();
  assert.equal(raw.includes('rule-files/'), false, 'R2 түлхүүр ажилтанд гарахгүй');
  const d = JSON.parse(raw) as { rule: { attachments: Array<{ id: string; name: string }> } };
  assert.deepEqual(d.rule.attachments.map((a) => a.name), ['журам.pdf', 'Журам (эх).docx']);

  // Татах: attachment + nosniff, кирилл нэр RFC 5987
  const dl = await h.req(ENG, 'GET', `/api/internal-rules/${rule.id}/files/${pdf.id}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.match(dl.headers.get('content-disposition') ?? '', /^attachment; .*filename\*=UTF-8''%D0%B6/);
  assert.equal(await dl.text(), '%PDF-1.7 a');

  // Эрх: client/worker 403, буруу id 400, өөр журмын файл 404
  assert.equal((await h.req(CLIENT, 'GET', `/api/internal-rules/${rule.id}/files/${pdf.id}`)).status, 403);
  assert.equal((await h.req(WORKER, 'GET', `/api/internal-rules/${rule.id}/files/${pdf.id}`)).status, 403);
  assert.equal((await h.req(ENG, 'GET', `/api/internal-rules/${rule.id}/files/..%2Fhr`)).status, 400);
  const other = await publishRule(h, 'Өөр журам', 'x');
  assert.equal((await h.req(ENG, 'GET', `/api/internal-rules/${other}/files/${pdf.id}`)).status, 404);

  // Архивласан журмын файл — ажилтанд 404
  await h.req(ADMIN, 'POST', `/api/internal-rules/${rule.id}/archive`);
  assert.equal((await h.req(ENG, 'GET', `/api/internal-rules/${rule.id}/files/${pdf.id}`)).status, 404);
});

test('хавсралт: байхгүй түлхүүр 400; хасахад нийтлэгдээгүй файл устана, нийтлэгдсэн хувилбарынх үлдэнэ; журам устгахад бүгд', async () => {
  const h = harness();
  const ghost = await h.req(ADMIN, 'POST', '/api/internal-rules', {
    title_mn: 'x',
    body_format: 'html',
    body_md: '<p>x</p>',
    attachments: [{ key: 'rule-files/1758000000000-deadbeef.pdf' }],
  });
  assert.equal(ghost.status, 400, 'R2-д байхгүй файл хавсаргахгүй');

  const a = await upload(h, 'a.pdf', '%PDF a');
  const b = await upload(h, 'b.pdf', '%PDF b');
  const c = await upload(h, 'c.pdf', '%PDF c');
  const { rule } = await json<{ rule: { id: number } }>(
    await h.req(ADMIN, 'POST', '/api/internal-rules', {
      title_mn: 'Журам',
      body_format: 'html',
      body_md: '<p>Бие</p>',
      attachments: [{ key: a.key }, { key: b.key }],
    }),
  );
  await h.req(ADMIN, 'POST', `/api/internal-rules/${rule.id}/publish`);
  await Promise.all(h.waited);

  // a (нийтлэгдсэн) + b-г хасаад c нэмнэ → a, b хоёулаа v1-д байгаа тул ҮЛДЭНЭ
  const put = await h.req(ADMIN, 'PUT', `/api/internal-rules/${rule.id}`, { attachments: [{ key: c.key }] });
  assert.equal(put.status, 200);
  await Promise.all(h.waited);
  assert.ok(h.priv.store.has(a.key) && h.priv.store.has(b.key), 'нийтлэгдсэн хувилбарын файл — нотолгоо');
  const admin = await json<{ rules: Array<{ id: number; has_unpublished_changes: boolean; attachments: UploadedAttachment[] }> }>(
    await h.req(ADMIN, 'GET', '/api/internal-rules/admin'),
  );
  const row = admin.rules.find((r) => r.id === rule.id)!;
  assert.equal(row.has_unpublished_changes, true, 'хавсралт солигдвол шинэ хувилбар хэрэгтэй');
  assert.deepEqual(row.attachments.map((x) => x.key), [c.key]);

  // c-г (хэзээ ч нийтлэгдээгүй) хасвал R2-оос устана
  await h.req(ADMIN, 'PUT', `/api/internal-rules/${rule.id}`, { attachments: [] });
  await Promise.all(h.waited);
  assert.equal(h.priv.store.has(c.key), false);

  // Admin хуучин хувилбарын файлыг (ажлын хувьд байхгүй) татаж чадна
  assert.equal((await h.req(ADMIN, 'GET', `/api/internal-rules/${rule.id}/files/${a.id}`)).status, 200);

  // Гарын үсэггүй журам устгахад бүх хувилбарын файл устана
  assert.equal((await h.req(ADMIN, 'DELETE', `/api/internal-rules/${rule.id}`)).status, 200);
  await Promise.all(h.waited);
  assert.equal(h.priv.store.has(a.key) || h.priv.store.has(b.key), false);
});

test('HTML журмын хоосон шалгалт: таг л бол 400, файлгүй', async () => {
  const h = harness();
  const { rule } = await json<{ rule: { id: number } }>(
    await h.req(ADMIN, 'POST', '/api/internal-rules', { title_mn: 'x', body_format: 'html', body_md: '<p>&nbsp;</p>' }),
  );
  assert.equal((await h.req(ADMIN, 'POST', `/api/internal-rules/${rule.id}/publish`)).status, 400);
  await h.req(ADMIN, 'PUT', `/api/internal-rules/${rule.id}`, { body_format: 'html', body_md: '<table><tr><td>1</td></tr></table>' });
  assert.equal((await h.req(ADMIN, 'POST', `/api/internal-rules/${rule.id}/publish`)).status, 200);
});
