// R2 аудитын цэвэр хэсгүүд: түлхүүр ялгах regex + D1 лавлагааны хайлт.
// D1-ийг `node:sqlite` дээр prepare/bind/all/batch-тэй жижиг shim-ээр орлуулна —
// PRAGMA table_info, LIKE урьдчилсан шүүлт, batch дараалал бүгд бодит SQL-ээр явна.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { extractKeys, keyFamily, collectReferences } = await import('./storageAudit.ts');

test('extractKeys — /media/ URL, decode хийсэн хувилбар, JSON доторх түүхий түлхүүр', () => {
  const out = new Set<string>();
  extractKeys('/media/5-1725000000000-abc123def456-photo.jpg', out);
  extractKeys('{"url":"https://x.workers.dev/media/7-1725000000001-a%20b.pdf","r2_key":"email/3/abc/att-0-x.pdf"}', out);
  extractKeys('client/9-1725000000002-deadbeef0000-plan.dwg', out);
  extractKeys('bim_' + 'a'.repeat(64), out);
  extractKeys('meetings/12/transcript.json', out);
  assert.ok(out.has('5-1725000000000-abc123def456-photo.jpg'));
  assert.ok(out.has('7-1725000000001-a%20b.pdf'));
  assert.ok(out.has('7-1725000000001-a b.pdf'));
  assert.ok(out.has('email/3/abc/att-0-x.pdf'));
  assert.ok(out.has('client/9-1725000000002-deadbeef0000-plan.dwg'));
  assert.ok(out.has('bim_' + 'a'.repeat(64)));
  assert.ok(out.has('meetings/12/transcript.json'));
});

test('extractKeys — энгийн бичвэр, тоо, огноо түлхүүр болохгүй', () => {
  const out = new Set<string>();
  extractKeys('Уулзалт 2026-09-13 10:00, media/x биш, 12-3456-7', out);
  assert.equal(out.size, 0);
});

test('keyFamily', () => {
  assert.equal(keyFamily('5-1725000000000-abc-photo.jpg'), 'upload');
  assert.equal(keyFamily('email/3/abc/att-0-x.pdf'), 'email/');
  assert.equal(keyFamily('client/5-1-a.pdf'), 'client/');
  assert.equal(keyFamily('bim_abc'), 'bim_');
  assert.equal(keyFamily('revit-addin/RevitMcpAddin-Revit2027.zip'), 'revit-addin/');
});

/** D1-ийн prepare/bind/all/batch-ийн хамгийн бага shim. */
function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string) => {
    const params: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        params.push(...args);
        return stmt;
      },
      async all() {
        return { results: db.prepare(sql).all(...(params as never[])) };
      },
      async first() {
        return db.prepare(sql).get(...(params as never[])) ?? null;
      },
      _run() {
        return { results: db.prepare(sql).all(...(params as never[])) };
      },
    };
    return stmt;
  };
  return {
    prepare,
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      return stmts.map((s) => s._run());
    },
  } as unknown as D1Database;
}

test('collectReferences — бүх хүснэгтийн текст баганаас түлхүүр цуглуулна', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, profile_image TEXT, password_hash TEXT);
    CREATE TABLE asr (id INTEGER PRIMARY KEY, photos_json TEXT, note TEXT);
    CREATE TABLE email_attachments (id INTEGER PRIMARY KEY, r2_key TEXT, size_bytes INTEGER);
    CREATE TABLE meeting_transcripts (id INTEGER PRIMARY KEY, body TEXT);
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO users VALUES (1, 'a', '/media/1-1725000000000-aaaaaaaaaaaa-me.jpg', 'x');
    INSERT INTO users VALUES (2, 'b', NULL, 'y');
    INSERT INTO asr VALUES (1, '[{"url":"/media/3-1725000000001-bbbbbbbbbbbb-site.jpg"},{"url":"/media/3-1725000000002-cc-2.jpg"}]', 'Тэмдэглэл');
    INSERT INTO email_attachments VALUES (1, 'email/2/gm1/att-0-scan.pdf', 10);
    INSERT INTO meeting_transcripts VALUES (1, 'урт бичвэр ... media/ биш');
    INSERT INTO d1_migrations VALUES (1, '0001_x.sql');
  `);
  const index = await collectReferences(d1Shim(db));
  assert.equal(index.tables, 4, 'd1_migrations алгасагдана');
  assert.deepEqual(
    [...index.refs.keys()].sort(),
    [
      '1-1725000000000-aaaaaaaaaaaa-me.jpg',
      '3-1725000000001-bbbbbbbbbbbb-site.jpg',
      '3-1725000000002-cc-2.jpg',
      'email/2/gm1/att-0-scan.pdf',
    ],
  );
  assert.deepEqual([...index.refs.get('1-1725000000000-aaaaaaaaaaaa-me.jpg')!], ['users.profile_image']);
  assert.deepEqual([...index.refs.get('3-1725000000001-bbbbbbbbbbbb-site.jpg')!], ['asr.photos_json']);
  assert.deepEqual([...index.refs.get('email/2/gm1/att-0-scan.pdf')!], ['email_attachments.r2_key']);
});
