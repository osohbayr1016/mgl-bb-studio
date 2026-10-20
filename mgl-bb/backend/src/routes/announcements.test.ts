// Нийтийн мэдээллийн route-ууд — БОДИТ SQLite (миграц 0338 файлаас), D1 shim,
// санах ойн R2, Hono `app.request()`.  Эрхийн хаалтууд, хүрээний шүүлт,
// баталгаа (чагт / профайлын гарын үсэг), дахин баталгаажуулалт, статистик.
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

const announcements = (await import('./announcements.ts')).default;

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
  return {
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
    async delete(key: string) {
      store.delete(key);
    },
  };
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
  db.exec(readFileSync(new URL('../../migrations/0338_announcements.sql', import.meta.url), 'utf8'));
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
  req: (user: { sub: number; role: string } | null, method: string, path: string, body?: unknown) => Promise<Response>;
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
  app.route('/api/announcements', announcements as never);

  const req: Harness['req'] = (user, method, path, body) =>
    app.request(
      `http://x${path}`,
      {
        method,
        headers: {
          ...(user ? { 'x-test-user': JSON.stringify(user) } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
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

type Head = { id: number; ack_version: number; content_hash: string; ack_mode: string; status: string };

/** Админ мэдээлэл үүсгээд нийтэлнэ — ихэнх тестийн суурь. */
async function publish(h: Harness, extra: Record<string, unknown> = {}) {
  const created = await json<{ announcement: Head }>(
    await h.req(ADMIN, 'POST', '/api/announcements', { title: 'Систем шинэчлэгдлээ', body_html: '<p>Шинэ <b>боломж</b></p>', ...extra }),
  );
  const pub = await h.req(ADMIN, 'POST', `/api/announcements/${created.announcement.id}/publish`);
  assert.equal(pub.status, 200);
  await Promise.all(h.waited.splice(0));
  return (await json<{ announcement: Head; notified: number }>(pub));
}

function notifCount(h: Harness, userId?: number) {
  const row = userId
    ? h.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(userId)
    : h.db.prepare('SELECT COUNT(*) AS n FROM notifications').get();
  return Number((row as { n: number }).n);
}

/* ------------------------------------------------------------------ */
/*  Тестүүд                                                            */
/* ------------------------------------------------------------------ */

test('эрх: client/worker хаалттай, ажилтан хоосон жагсаалт, admin route-ууд requireAdmin', async () => {
  const h = harness();
  assert.equal((await h.req(CLIENT, 'GET', '/api/announcements')).status, 403);
  assert.equal((await h.req(WORKER, 'GET', '/api/announcements')).status, 403);
  const list = await h.req(ENG, 'GET', '/api/announcements');
  assert.equal(list.status, 200);
  assert.deepEqual(await json(list), { announcements: [], pending_count: 0 });
  assert.equal((await h.req(ENG, 'GET', '/api/announcements/admin')).status, 403);
  assert.equal((await h.req(SENIOR, 'POST', '/api/announcements', { title: 'x', body_html: '<p>x</p>' })).status, 403);
  assert.equal((await h.req(SENIOR, 'GET', '/api/announcements/1/acks')).status, 403);
  assert.equal((await h.req(ADMIN, 'GET', '/api/announcements/admin')).status, 200);
});

test('үүсгэх → draft (ажилтанд харагдахгүй) → нийтлэх → мэдэгдэл хүрээний ажилтанд', async () => {
  const h = harness();
  const created = await h.req(ADMIN, 'POST', '/api/announcements', {
    title: 'Систем шинэчлэгдлээ',
    body_html: '<p>Шинэ <b>боломж</b><script>alert(1)</script></p>',
    kind: 'system_update',
    ack_mode: 'confirm',
  });
  assert.equal(created.status, 201);
  const { announcement: a } = await json<{ announcement: Head & { body_html: string; roster_count: number } }>(created);
  assert.equal(a.status, 'draft');
  assert.equal(a.body_html, '<p>Шинэ <b>боломж</b></p>');
  // Roster = admin(1) + eng(2) + arch(3) + senior(4); TV (is_support) ба гарсан ажилтан орохгүй.
  assert.equal(a.roster_count, 4);

  const listBefore = await json<{ announcements: unknown[] }>(await h.req(ENG, 'GET', '/api/announcements'));
  assert.equal(listBefore.announcements.length, 0);
  assert.equal((await h.req(ENG, 'GET', `/api/announcements/${a.id}`)).status, 404);

  const pub = await json<{ notified: number }>(await h.req(ADMIN, 'POST', `/api/announcements/${a.id}/publish`));
  await Promise.all(h.waited.splice(0));
  assert.equal(pub.notified, 3); // нийтлэгчээс бусад 3
  assert.equal(notifCount(h), 3);
  assert.equal(notifCount(h, 7), 0);
  const n = h.db.prepare('SELECT type, link FROM notifications WHERE user_id = 2').get() as { type: string; link: string };
  assert.equal(n.type, 'announcement_published');
  assert.equal(n.link, `/app/announcements/${a.id}`);

  const listAfter = await json<{ announcements: Array<{ id: number; my_ack: unknown; excerpt: string }>; pending_count: number }>(
    await h.req(ENG, 'GET', '/api/announcements'),
  );
  assert.equal(listAfter.announcements.length, 1);
  assert.equal(listAfter.announcements[0]!.excerpt, 'Шинэ боломж');
  assert.equal(listAfter.pending_count, 1);

  assert.equal((await h.req(ADMIN, 'POST', `/api/announcements/${a.id}/publish`)).status, 409);
});

test('хүрээ: баг × role — гадуурх ажилтанд 404, admin харна ч баталгаажуулж чадахгүй', async () => {
  const h = harness();
  const { announcement: a } = await publish(h, { ack_mode: 'confirm', audience: { roles: ['senior', 'engineer'], team_ids: [2] } });
  assert.equal(notifCount(h), 2); // eng(2, BA) + senior(4, BA); arch(3, AR) орохгүй
  assert.equal(notifCount(h, 3), 0);

  const archList = await json<{ announcements: unknown[] }>(await h.req(ARCH, 'GET', '/api/announcements'));
  assert.equal(archList.announcements.length, 0);
  assert.equal((await h.req(ARCH, 'GET', `/api/announcements/${a.id}`)).status, 404);

  const engDetail = await h.req(ENG, 'GET', `/api/announcements/${a.id}`);
  assert.equal(engDetail.status, 200);

  // Admin (team AR, role admin) — хүрээнээс гадуур: харна, гэхдээ ack 403.
  const adminDetail = await json<{ in_audience: boolean }>(await h.req(ADMIN, 'GET', `/api/announcements/${a.id}`));
  assert.equal(adminDetail.in_audience, false);
  const adminList = await json<{ announcements: Array<{ in_audience: boolean }>; pending_count: number }>(await h.req(ADMIN, 'GET', '/api/announcements'));
  assert.equal(adminList.announcements.length, 1);
  assert.equal(adminList.pending_count, 0);
  const ackRes = await h.req(ADMIN, 'POST', `/api/announcements/${a.id}/ack`, { confirmed: true, ack_version: a.ack_version, content_hash: a.content_hash });
  assert.equal(ackRes.status, 403);

  const stats = await json<{ summary: { total: number } }>(await h.req(ADMIN, 'GET', `/api/announcements/${a.id}/acks`));
  assert.equal(stats.summary.total, 2);
});

test('баталгаа (confirm): чагт, хувилбар/хэш тулгалт, давхардал, статистик', async () => {
  const h = harness();
  const { announcement: a } = await publish(h, { ack_mode: 'confirm' });
  const path = `/api/announcements/${a.id}/ack`;

  assert.equal((await h.req(ENG, 'POST', path, { ack_version: a.ack_version, content_hash: a.content_hash })).status, 400);
  const stale = await h.req(ENG, 'POST', path, { confirmed: true, ack_version: 99, content_hash: a.content_hash });
  assert.equal(stale.status, 409);
  assert.equal((await json(stale)).code, 'VERSION_CHANGED');
  const badHash = await h.req(ENG, 'POST', path, { confirmed: true, ack_version: a.ack_version, content_hash: 'f'.repeat(64) });
  assert.equal((await json(badHash)).code, 'HASH_MISMATCH');

  const ok = await h.req(ENG, 'POST', path, { confirmed: true, ack_version: a.ack_version, content_hash: a.content_hash });
  assert.equal(ok.status, 201);
  const { ack } = await json<{ ack: { ack_kind: string; image_url: string | null; content_hash: string } }>(ok);
  assert.equal(ack.ack_kind, 'confirm');
  assert.equal(ack.image_url, null);
  assert.equal(ack.content_hash, a.content_hash);
  assert.equal(h.priv.store.size, 0); // чагтад гарын үсэг хуулагдахгүй

  const dup = await h.req(ENG, 'POST', path, { confirmed: true, ack_version: a.ack_version, content_hash: a.content_hash });
  assert.equal((await json(dup)).code, 'ALREADY_ACKED');

  const detail = await json<{ my_ack: { id: number } | null }>(await h.req(ENG, 'GET', `/api/announcements/${a.id}`));
  assert.ok(detail.my_ack);
  const list = await json<{ pending_count: number }>(await h.req(ENG, 'GET', '/api/announcements'));
  assert.equal(list.pending_count, 0);

  const stats = await json<{ summary: { acked: number; pending: number; total: number }; rows: Array<{ user_id: number; ack_id: number | null }> }>(
    await h.req(ADMIN, 'GET', `/api/announcements/${a.id}/acks`),
  );
  assert.deepEqual(stats.summary, { acked: 1, pending: 3, total: 4 });
  const pendingIds = stats.rows.filter((r) => r.ack_id === null).map((r) => r.user_id).sort();
  assert.deepEqual(pendingIds, [1, 3, 4]);
  assert.equal(stats.rows[0]!.ack_id, null); // зураагүй нь эхэнд
});

test('баталгаа (signature): профайлын гарын үсэг хувийн bucket-д хуулагдана; байхгүй бол 409', async () => {
  const h = harness();
  const { announcement: a } = await publish(h, { ack_mode: 'signature' });
  const path = `/api/announcements/${a.id}/ack`;
  const body = { confirmed: true, ack_version: a.ack_version, content_hash: a.content_hash };

  const noSig = await h.req(ARCH, 'POST', path, body);
  assert.equal(noSig.status, 409);
  assert.equal((await json(noSig)).code, 'NO_SIGNATURE');

  const ok = await h.req(ENG, 'POST', path, body);
  assert.equal(ok.status, 201);
  const { ack } = await json<{ ack: { id: number; ack_kind: string; image_url: string } }>(ok);
  assert.equal(ack.ack_kind, 'signature');
  assert.equal(ack.image_url, `/announcements/acks/${ack.id}/image`);
  assert.equal(h.priv.store.size, 1);
  const key = [...h.priv.store.keys()][0]!;
  assert.match(key, /^announcement-signatures\/\d+\/1-2-\d+-[0-9a-f]{8}\.png$/);
  const row = h.db.prepare('SELECT signature_key, signature_sha256 FROM announcement_acks WHERE id = ?').get(ack.id) as { signature_key: string; signature_sha256: string };
  assert.equal(row.signature_key, key);
  assert.match(row.signature_sha256, /^[0-9a-f]{64}$/);

  // Зураг: өөрөө + admin уншина; өөр ажилтан 403; чагтын мөрөнд 404.
  const mine = await h.req(ENG, 'GET', `/api/announcements/acks/${ack.id}/image`);
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get('content-type'), 'image/png');
  assert.equal((await h.req(ADMIN, 'GET', `/api/announcements/acks/${ack.id}/image`)).status, 200);
  assert.equal((await h.req(SENIOR, 'GET', `/api/announcements/acks/${ack.id}/image`)).status, 403);
  assert.equal((await h.req(CLIENT, 'GET', `/api/announcements/acks/${ack.id}/image`)).status, 403);

  const stats = await json<{ rows: Array<{ user_id: number; image_url: string | null }> }>(await h.req(ADMIN, 'GET', `/api/announcements/${a.id}/acks`));
  assert.equal(stats.rows.find((r) => r.user_id === 2)!.image_url, `/announcements/acks/${ack.id}/image`);
});

test('ack_mode none: баталгаа шаардахгүй, pending 0, статистик хоосон', async () => {
  const h = harness();
  const { announcement: a } = await publish(h);
  const res = await h.req(ENG, 'POST', `/api/announcements/${a.id}/ack`, { confirmed: true, ack_version: 1, content_hash: a.content_hash });
  assert.equal(res.status, 400);
  const list = await json<{ pending_count: number }>(await h.req(ENG, 'GET', '/api/announcements'));
  assert.equal(list.pending_count, 0);
  const stats = await json<{ summary: { total: number }; rows: unknown[] }>(await h.req(ADMIN, 'GET', `/api/announcements/${a.id}/acks`));
  assert.equal(stats.summary.total, 0);
  assert.equal((await h.req(ADMIN, 'POST', `/api/announcements/${a.id}/remind`)).status, 409);
});

test('засвар: reack=true → ack_version +1, бүгд дахин; хуучин баталгаа түүхэнд', async () => {
  const h = harness();
  const { announcement: a } = await publish(h, { ack_mode: 'confirm' });
  const ackBody = { confirmed: true, ack_version: a.ack_version, content_hash: a.content_hash };
  assert.equal((await h.req(ENG, 'POST', `/api/announcements/${a.id}/ack`, ackBody)).status, 201);

  // Энгийн засвар (reack байхгүй): hash солигдоно, баталгаа хэвээр, мэдэгдэл байхгүй.
  const before = notifCount(h);
  const edit1 = await json<{ announcement: Head; reacked: boolean }>(
    await h.req(ADMIN, 'PUT', `/api/announcements/${a.id}`, { body_html: '<p>Бага зэрэг засвар</p>' }),
  );
  assert.equal(edit1.reacked, false);
  assert.equal(edit1.announcement.ack_version, 1);
  assert.notEqual(edit1.announcement.content_hash, a.content_hash);
  assert.equal(notifCount(h), before);
  const still = await json<{ my_ack: unknown }>(await h.req(ENG, 'GET', `/api/announcements/${a.id}`));
  assert.ok(still.my_ack);
  // Хуучин хэштэй хүсэлт — 409 HASH_MISMATCH (хуудсаа дахин ачаална).
  const staleAck = await h.req(SENIOR, 'POST', `/api/announcements/${a.id}/ack`, ackBody);
  assert.equal((await json(staleAck)).code, 'HASH_MISMATCH');

  // reack → шинэ хувилбар, ENG дахин баталгаажуулах ёстой, мэдэгдэл дахин.
  const edit2 = await json<{ announcement: Head & { acked_count: number }; reacked: boolean }>(
    await h.req(ADMIN, 'PUT', `/api/announcements/${a.id}`, { body_html: '<p>Чухал өөрчлөлт</p>', reack: true }),
  );
  await Promise.all(h.waited.splice(0));
  assert.equal(edit2.reacked, true);
  assert.equal(edit2.announcement.ack_version, 2);
  assert.equal(edit2.announcement.acked_count, 0);
  assert.equal(notifCount(h), before + 3);

  const detail = await json<{ my_ack: unknown; previous: { ack_version: number } | null }>(await h.req(ENG, 'GET', `/api/announcements/${a.id}`));
  assert.equal(detail.my_ack, null);
  assert.equal(detail.previous?.ack_version, 1);

  const statsV2 = await json<{ summary: { acked: number }; rows: Array<{ user_id: number; previous: { ack_version: number } | null }>; versions: Array<{ ack_version: number; acked_count: number }> }>(
    await h.req(ADMIN, 'GET', `/api/announcements/${a.id}/acks`),
  );
  assert.equal(statsV2.summary.acked, 0);
  assert.equal(statsV2.rows.find((r) => r.user_id === 2)!.previous?.ack_version, 1);
  assert.deepEqual(statsV2.versions, [{ ack_version: 1, acked_count: 1, first_at: statsV2.versions[0]!.first_at, last_at: statsV2.versions[0]!.last_at }]);
  const statsV1 = await json<{ summary: { acked: number } }>(await h.req(ADMIN, 'GET', `/api/announcements/${a.id}/acks?ack_version=1`));
  assert.equal(statsV1.summary.acked, 1);

  // Шинэ хувилбарт дахин баталгаажуулж болно (UNIQUE нь хувилбар тус бүр).
  const again = await h.req(ENG, 'POST', `/api/announcements/${a.id}/ack`, { confirmed: true, ack_version: 2, content_hash: edit2.announcement.content_hash });
  assert.equal(again.status, 201);
});

test('remind: зөвхөн баталгаажуулаагүй хүмүүст, нийтлэгчээс бусад', async () => {
  const h = harness();
  const { announcement: a } = await publish(h, { ack_mode: 'confirm' });
  assert.equal((await h.req(ENG, 'POST', `/api/announcements/${a.id}/ack`, { confirmed: true, ack_version: 1, content_hash: a.content_hash })).status, 201);
  const before = notifCount(h);
  const r = await json<{ reminded: number }>(await h.req(ADMIN, 'POST', `/api/announcements/${a.id}/remind`));
  await Promise.all(h.waited.splice(0));
  assert.equal(r.reminded, 2); // arch(3) + senior(4); eng баталгаажуулсан, admin нийтлэгч
  assert.equal(notifCount(h), before + 2);
  assert.equal(notifCount(h, 2), 1); // ENG-д дахин ирэхгүй (зөвхөн эхний нийтлэл)
});

test('unpublish / archive / unarchive / delete', async () => {
  const h = harness();
  const { announcement: a } = await publish(h, { ack_mode: 'confirm' });
  assert.equal((await h.req(ADMIN, 'POST', `/api/announcements/${a.id}/unpublish`)).status, 200);
  assert.equal((await h.req(ENG, 'GET', `/api/announcements/${a.id}`)).status, 404);
  const rePub = await json<{ notified: number }>(await h.req(ADMIN, 'POST', `/api/announcements/${a.id}/publish`, { notify: false }));
  assert.equal(rePub.notified, 0);
  assert.equal((await h.req(ENG, 'GET', `/api/announcements/${a.id}`)).status, 200);

  assert.equal((await h.req(ADMIN, 'POST', `/api/announcements/${a.id}/archive`)).status, 200);
  assert.equal((await h.req(ENG, 'GET', `/api/announcements/${a.id}`)).status, 404);
  const un = await json<{ announcement: Head }>(await h.req(ADMIN, 'POST', `/api/announcements/${a.id}/unarchive`));
  assert.equal(un.announcement.status, 'published');

  // Баталгаагүй → устгана.
  assert.equal((await h.req(ADMIN, 'DELETE', `/api/announcements/${a.id}`)).status, 200);
  assert.equal((await h.req(ADMIN, 'GET', `/api/announcements/${a.id}/acks`)).status, 404);
  assert.equal((await h.req(ADMIN, 'DELETE', `/api/announcements/${a.id}`)).status, 404);
});

test('баталгаатай мэдээлэл ч устгана: баталгаа, гарын үсгийн хуулбар, мэдэгдэл хамт арилна', async () => {
  const h = harness();
  const { announcement: keep } = await publish(h, { ack_mode: 'confirm' });
  const { announcement: b } = await publish(h, { ack_mode: 'signature' });
  const body = { confirmed: true, ack_version: 1, content_hash: b.content_hash };
  assert.equal((await h.req(ENG, 'POST', `/api/announcements/${b.id}/ack`, body)).status, 201);
  assert.equal((await h.req(SENIOR, 'POST', `/api/announcements/${b.id}/ack`, body)).status, 201);
  assert.equal(h.priv.store.size, 2);
  const notifsBefore = notifCount(h);

  assert.equal((await h.req(SENIOR, 'DELETE', `/api/announcements/${b.id}`)).status, 403);
  const del = await h.req(ADMIN, 'DELETE', `/api/announcements/${b.id}`);
  assert.equal(del.status, 200);
  assert.deepEqual(await json(del), { ok: true, deleted_acks: 2 });
  await Promise.all(h.waited.splice(0));

  const left = h.db.prepare('SELECT COUNT(*) AS n FROM announcement_acks WHERE announcement_id = ?').get(b.id) as { n: number };
  assert.equal(Number(left.n), 0);
  assert.equal(h.priv.store.size, 0);
  // Зөвхөн устгасан мэдээллийн мэдэгдэл (3) арилна; нөгөөх нь хэвээр.
  assert.equal(notifCount(h), notifsBefore - 3);
  const kept = h.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE link = ?').get(`/app/announcements/${keep.id}`) as { n: number };
  assert.equal(Number(kept.n), 3);
  assert.equal((await h.req(ENG, 'GET', `/api/announcements/${b.id}`)).status, 404);
  assert.equal((await h.req(ADMIN, 'GET', `/api/announcements/${keep.id}/acks`)).status, 200);
});

test('жагсаалтын дараалал: pinned эхэнд, дараа нь шинэ нь; admin жагсаалт draft-ыг ч харуулна', async () => {
  const h = harness();
  const { announcement: a } = await publish(h, { title: 'Эхнийх' });
  const { announcement: b } = await publish(h, { title: 'Хоёр дахь' });
  const { announcement: p } = await publish(h, { title: 'Тогтоосон', pinned: true });
  await h.req(ADMIN, 'POST', '/api/announcements', { title: 'Ноорог', body_html: '<p>x</p>' });
  const list = await json<{ announcements: Array<{ id: number }> }>(await h.req(ENG, 'GET', '/api/announcements'));
  assert.deepEqual(list.announcements.map((x) => x.id), [p.id, b.id, a.id]);
  const admin = await json<{ announcements: Array<{ status: string }> }>(await h.req(ADMIN, 'GET', '/api/announcements/admin'));
  assert.equal(admin.announcements.length, 4);
  assert.equal(admin.announcements[3]!.status, 'draft');
});
