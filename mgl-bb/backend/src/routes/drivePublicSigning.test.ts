// «Баримт бичиг» (Drive) Word баримтын гаднын (login-гүй) гарын үсгийн link — бүтэн урсгал.
// БОДИТ SQLite (0371 + 0397 миграц файлаас), D1 shim (batch = transaction), санах ойн R2,
// хуурамч Drive IO (жинхэнэ нь `lib/driveSigningIo.ts`), Hono `app.request()`.
// Ажилтны замууд (`mountDriveSigning` → link үүсгэх/цуцлах) + public router + 0381-ийн
// router руу `next()`-ээр унах зам — бүгд index.ts-тэй ижил дарааллаар mount хийгдэнэ.
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

const route = await import('./driveSigning.ts');
const pub = await import('./drivePublicSigning.ts');
const { loadProjectDriveRoot, loadMainProjectDriveRoot } = await import('../lib/projectDrive.ts');
const zp = await import('../lib/zipPatch.ts');
const dsf = await import('../lib/docxSignFile.ts');

const enc = new TextEncoder();

/* ------------------------------------------------------------------ */
/*  Shim-үүд                                                           */
/* ------------------------------------------------------------------ */

function d1Shim(db: DatabaseSync) {
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
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    store,
    async put(key: string, bytes: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { bytes: new Uint8Array(bytes), contentType: opts?.httpMetadata?.contentType });
      return { key };
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return { key, size: o.bytes.length, body: o.bytes.slice(), arrayBuffer: async () => o.bytes.slice().buffer };
    },
    async head(key: string) {
      const o = store.get(key);
      return o ? { key, size: o.bytes.length } : null;
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Туршилтын Word баримт (driveSigning.test.ts-ийн загвар)             */
/* ------------------------------------------------------------------ */

function cell(text = '', extra = ''): string {
  const run = text ? `<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>` : '';
  return `<w:tc><w:tcPr>${extra}</w:tcPr><w:p>${run}</w:p></w:tc>`;
}
function row(cells: string[]): string {
  return `<w:tr><w:trPr><w:trHeight w:val="700" w:hRule="atLeast"/></w:trPr>${cells.join('')}</w:tr>`;
}

/** MGL-WT-CR-002 хэлбэр: ажилтны 3 мөр + захирал + ЗАХИАЛАГЧИЙН батлах блок. */
function crDocx(): Promise<Uint8Array> {
  const navy = '<w:shd w:val="clear" w:fill="0F243E"/>';
  const span = (n: number, more = '') => `<w:gridSpan w:val="${n}"/>${more}`;
  const person = (role: string, pos: string, name: string) =>
    row([
      role ? cell(role, navy) : cell('', `<w:vMerge/>${navy}`),
      cell(pos, span(3)),
      cell(name),
      cell('mail@mglenc.com', span(4)),
      cell('', span(3)),
      cell('2026/10/09', span(4)),
    ]);
  const tbl =
    `<w:tbl><w:tblPr/><w:tblGrid>${[2430, 810, 450, 195, 1515, 450, 105, 360, 510, 390, 330, 660, 510, 300, 540, 450].map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    row([
      cell('Хариу илгээсэн: (Replied by)', `<w:vMerge w:val="restart"/>${navy}`),
      cell('Албан тушаал: (Position)', span(3, navy)),
      cell('Овог нэр: (Perpared by)', navy),
      cell('Хариу өгсөн хаяг: (Revision submition mail)', span(4, navy)),
      cell('Гарын үсэг: (Sign)', span(3, navy)),
      cell('Огноо: (Date)', span(4, navy)),
    ]) +
    person('', 'Бүтээцийн инженер', 'Д.Далайбуян') +
    person('', 'Төслийн менежер', 'М.Монголжин') +
    person('Хянасан (Approved by:)', 'Захирал', 'Б.Билгүүн') +
    row([
      cell('Захиалагчаас баталасан: (Approved by client)', `<w:vMerge w:val="restart"/>${navy}`),
      cell('Албан тушаал: (Position)', span(3, navy)),
      cell('Овог нэр: (Perpared by)', navy),
      cell('Гарын үсэг: (Sign)', span(7, navy)),
      cell('Огноо: (Date)', span(4, navy)),
    ]) +
    row([cell('', `<w:vMerge/>${navy}`), cell('', span(3)), cell(), cell('', span(7)), cell('', span(4))]) +
    `</w:tbl>`;
  return packDocx(tbl);
}

/**
 * RFI — захиалагч асууж, манай тал хариулсан загвар (бодит 261001_EVGR_RFI_022 хэлбэр):
 * гарын үсгийн хүснэгтэд ЗАХИАЛАГЧИЙН мөр байхгүй.
 */
function rfiNoClientDocx(): Promise<Uint8Array> {
  const navy = '<w:shd w:val="clear" w:fill="0F243E"/>';
  const label = (t: string) => `<w:tc><w:tcPr>${navy}</w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p></w:tc>`;
  const tbl =
    `<w:tbl><w:tblPr/><w:tblGrid>${[1800, 1400, 1600, 1800, 1300].map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    row([label('Хариу илгээсэн: (Replied by)').replace('<w:tcPr>', '<w:tcPr><w:vMerge w:val="restart"/>'), cell('Албан тушаал: (Position)', navy), cell('Овог нэр: (Full name)', navy), cell('Гарын үсэг (Signature)', navy), cell('Огноо: (Date)', navy)]) +
    row([cell('', `<w:vMerge/>${navy}`), cell('Архитектор'), cell('Б.Эрдэнэжин'), cell(), cell('2026.10.01')]) +
    row([label('Хянасан: (Approved by)'), cell('Захирал'), cell('Б.Билгүүн'), cell(), cell('2026.10.01')]) +
    `</w:tbl>`;
  return packDocx(tbl);
}

function packDocx(tbl: string): Promise<Uint8Array> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>CR</w:t></w:r></w:p>${tbl}<w:sectPr/></w:body></w:document>`;
  const ct = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const empty = new Uint8Array(22);
  new DataView(empty.buffer).setUint32(0, 0x06054b50, true);
  return zp.rewriteZip(empty, {
    add: [
      { name: '[Content_Types].xml', data: enc.encode(ct) },
      { name: 'word/document.xml', data: enc.encode(document) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(rels) },
    ],
  });
}

/** 120×40 RGB PNG: голд нь хар зураас (утсан дээр зурсан гарын үсэг). */
async function sigPng(): Promise<Uint8Array> {
  const w = 120;
  const h = 40;
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const v = y >= 15 && y < 22 && x >= 10 && x < 105 ? 10 : 255;
      raw.set([v, v, v], y * (1 + w * 3) + 1 + x * 3);
    }
  }
  const cs = new CompressionStream('deflate');
  const wr = cs.writable.getWriter();
  void wr.write(raw);
  void wr.close();
  const idat = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, zp.crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function sigDataUrl(): Promise<string> {
  const bytes = await sigPng();
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(raw)}`;
}

/* ------------------------------------------------------------------ */
/*  Хуурамч Drive                                                       */
/* ------------------------------------------------------------------ */

const ROOT = 'rootFolder000001';
const PARENT = 'parentFolder0001';
const FILE_CR = 'fileCr0000000001';
const FILE_GDOC = 'fileGoogleDoc001';
const FILE_RFI = 'fileRfiNoClient1';

interface FakeFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  version: number;
}

function fakeDrive() {
  const files = new Map<string, FakeFile>();
  const uploads: string[] = [];
  const records: Array<{ id: string; user: number }> = [];
  let failUpload = false;
  const meta = (id: string) => {
    const f = files.get(id)!;
    return {
      id,
      name: f.name,
      mimeType: f.mimeType,
      size: String(f.bytes.length),
      md5Checksum: `md5-${f.version}`,
      version: String(f.version),
      modifiedTime: new Date(Date.UTC(2026, 9, 12, 0, 0, f.version)).toISOString(),
      parents: [PARENT],
    };
  };
  const io = {
    async resolveFile(_env: unknown, rootId: string, fileId: string) {
      if (rootId !== ROOT || !files.has(fileId)) {
        return { ok: false as const, status: 403 as const, code: 'OUTSIDE_PROJECT', error: 'outside' };
      }
      return { ok: true as const, entry: meta(fileId), parentId: PARENT };
    },
    async download(_env: unknown, fileId: string) {
      return files.get(fileId)!.bytes.slice();
    },
    async upload(_env: unknown, _rootId: string, entry: { id: string }, parentId: string, bytes: Uint8Array) {
      assert.equal(parentId, PARENT);
      if (failUpload) throw new Error('drive down');
      const f = files.get(entry.id)!;
      f.bytes = bytes;
      f.version++;
      uploads.push(entry.id);
      return meta(entry.id);
    },
    async record(_env: unknown, _rootId: string, entry: { id: string }, userId: number) {
      records.push({ id: entry.id, user: userId });
    },
    errorResponse(c: { json: (b: unknown, s: number) => Response }, err: unknown) {
      return c.json({ error: String(err), code: 'DRIVE' }, 502);
    },
  };
  return {
    files,
    uploads,
    records,
    io,
    meta,
    setFailUpload(v: boolean) {
      failUpload = v;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Харness                                                            */
/* ------------------------------------------------------------------ */

const USERS = {
  director: { sub: 2, role: 'admin' },
  // Гаднын link-ийг ЗӨВХӨН admin үүсгэнэ (эзний шийдвэр 2026-10-12) — төслийн менежер admin.
  pm: { sub: 11, role: 'admin' },
  engineer: { sub: 12, role: 'engineer' },
  other: { sub: 16, role: 'senior' },
  client: { sub: 14, role: 'client' },
} as const;

async function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, status TEXT DEFAULT 'active',
      position TEXT, signature_url TEXT
    );
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, google_drive_folder_id TEXT, google_drive_folder_name TEXT, main_project_id INTEGER);
    CREATE TABLE main_projects (id INTEGER PRIMARY KEY, name TEXT, google_drive_folder_id TEXT, google_drive_folder_name TEXT);
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO projects (id, name, google_drive_folder_id, google_drive_folder_name) VALUES (38, 'MGL-250101 WISDOM TOWER', '${ROOT}', 'WT');
    INSERT INTO users (id, username, full_name, role, position, signature_url) VALUES
      (2, 'B.Bilguun', 'Бат-Өлзий Билгүүн', 'admin', 'Захирал', '/media/1-1-Bilguun.png'),
      (11, 'M.Mongoljin', 'Мөнхбат Монголжин', 'admin', 'Төслийн менежер', '/media/11-1-sig.png'),
      (12, 'O.Ochir', 'Отгон Очир', 'engineer', 'Инженер', '/media/12-1-sig.png'),
      (14, 'client1', 'Захиалагч', 'client', NULL, NULL),
      (16, 'D.Dorj', 'Дамдин Дорж', 'senior', 'Ахлах инженер', '/media/16-1-sig.png');
  `);
  db.exec(readFileSync(new URL('../../migrations/0371_drive_doc_signing.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/0397_drive_doc_public_links.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/0415_drive_doc_sign_summaries.sql', import.meta.url), 'utf8'));

  const media = r2Shim();
  const priv = r2Shim();
  const drive = fakeDrive();
  drive.files.set(FILE_CR, { name: 'MGL-WT-CR-002.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: await crDocx(), version: 1 });
  drive.files.set(FILE_GDOC, { name: 'CR-001', mimeType: 'application/vnd.google-apps.document', bytes: new Uint8Array(0), version: 1 });
  drive.files.set(FILE_RFI, { name: '261001_EVGR_RFI_022.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: await rfiNoClientDocx(), version: 1 });

  const env = {
    DB: d1Shim(db),
    MEDIA_BUCKET: media,
    MEETING_BUCKET: priv,
    FRONTEND_URL: 'https://erp.example/',
    JWT_SECRET: 'test-secret-0397',
  } as unknown as Record<string, unknown>;
  const waited: Promise<unknown>[] = [];
  const pdf: { calls: string[]; sources: Uint8Array[]; fail: boolean; bytes: Uint8Array | null } = {
    calls: [],
    sources: [],
    fail: false,
    bytes: null,
  };
  const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p), passThroughOnException() {} };

  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('/api/*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  const projects = new Hono();
  route.mountDriveSigning(projects as never, { label: 'project', resolveRoot: loadProjectDriveRoot, io: drive.io as never });
  app.route('/api/projects', projects as never);
  // index.ts-ийн дараалал: Drive-ын public router ЭХЛЭЭД, дараа нь 0381-ийнх.
  app.route(
    '/public/signing',
    pub.createDrivePublicSigning({
      io: drive.io as never,
      resolveRoot: (d, scope, id) => (scope === 'main' ? loadMainProjectDriveRoot(d, id) : loadProjectDriveRoot(d, id)),
      // Browser Rendering-ийн оронд: `/sign/:token/print` хуудас шиг эх .docx-ийг ТҮР ЭРХЭЭР
      // татаж (эрх ажиллаж байгааг баталгаажуулна), «PDF» буцаана.
      renderPdf: async (_env, url) => {
        pdf.calls.push(url);
        if (pdf.fail) throw new Error('browser rendering down');
        const u = new URL(url);
        assert.equal(u.origin, 'https://erp.example');
        const token = decodeURIComponent(u.pathname.split('/')[2] ?? '');
        assert.match(u.pathname, /^\/sign\/[^/]+\/print$/);
        const src = await app.request(
          `/public/signing/${token}/document?source=1&r=${encodeURIComponent(u.searchParams.get('r') ?? '')}`,
          {},
          env,
          ctx as never,
        );
        assert.equal(src.status, 200, 'рендерлэгч эх .docx-ийг түр эрхээр авна');
        assert.equal(src.headers.get('x-document-state'), 'signed-source');
        const docx = new Uint8Array(await src.arrayBuffer());
        pdf.sources.push(docx);
        return pdf.bytes ?? new TextEncoder().encode(`%PDF-1.7 fake ${docx.length} %%EOF`);
      },
    }) as never,
  );
  const legacy = new Hono();
  legacy.get('/:token', (c) => c.json({ legacy: true }, 404));
  legacy.post('/:token/sign', (c) => c.json({ legacy: true }, 404));
  app.route('/public/signing', legacy as never);

  const req = async (user: { sub: number; role: string } | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (user) headers['x-test-user'] = JSON.stringify(user);
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.request(path, init, env, ctx as never);
  };
  return { db, drive, priv, waited, req, pdf };
}

type Harness = Awaited<ReturnType<typeof harness>>;
const P = (id: string) => `/api/projects/38/drive/files/${id}/signing`;

type Slot = { key: string; client: boolean; approver: boolean; state: string; role: string; signer: { id: number | null; name: string; action: string; sent_by: { id: number } | null } | null };
type State = { slots: Slot[] };
type LinkView = { id: number; status: string; viewing_now: boolean; signed_name: string | null; slot_key: string; snapshot_ready: boolean; first_viewed_at: string | null };

async function slotsOf(h: Harness, user: { sub: number; role: string } = USERS.pm): Promise<Slot[]> {
  const res = await h.req(user, 'GET', P(FILE_CR));
  assert.equal(res.status, 200);
  return ((await res.json()) as State).slots;
}

async function createLink(h: Harness, slotKey: string, user: { sub: number; role: string } = USERS.pm, extra: Record<string, unknown> = {}) {
  const res = await h.req(user, 'POST', `${P(FILE_CR)}/links`, { slot_key: slotKey, ...extra });
  const body = (await res.json()) as { url: string; link: LinkView; code?: string };
  return { res, body, token: body.url ? decodeURIComponent(body.url.split('/sign/')[1]!) : '' };
}

const signBody = async (extra: Record<string, unknown> = {}) => ({
  signature_data_url: await sigDataUrl(),
  signer_name: 'Ж.Болормаа',
  signer_position: 'Захиалагчийн төлөөлөгч',
  consent: true,
  ...extra,
});

/* ------------------------------------------------------------------ */
/*  Тестүүд                                                             */
/* ------------------------------------------------------------------ */

test('Link үүсгэх: захиалагчийн мөр OK, захирлын / бөглөгдсөн мөр биш, эрхийн хаалт', async () => {
  const h = await harness();
  const slots = await slotsOf(h);
  const client = slots.find((s) => s.client)!;
  const appr = slots.find((s) => s.approver)!;
  assert.ok(client, 'CR-ийн захиалагчийн мөр танигдсан');

  const ok = await createLink(h, client.key);
  assert.equal(ok.res.status, 201);
  assert.match(ok.body.url, /^https:\/\/erp\.example\/sign\/[A-Za-z0-9_-]{43}$/);
  assert.equal(ok.body.link.status, 'pending');
  const row = h.db.prepare('SELECT * FROM drive_doc_public_links').get() as Record<string, unknown>;
  assert.equal(row.slot_client, 1);
  assert.equal(row.role_label, 'Захиалагчаас баталасан', 'үүргээс англи тайлбар, «:»-ийг хасна');
  assert.notEqual(row.token_hash, ok.token, 'түүхий токен DB-д хадгалагдахгүй');

  const a = await createLink(h, appr.key);
  assert.equal(a.res.status, 409);
  assert.equal(a.body.code, 'APPROVER_ONLY');
  assert.equal((await createLink(h, 'nope')).res.status, 404);
  assert.equal((await createLink(h, client.key, USERS.client)).res.status, 403);
  const gdoc = await h.req(USERS.pm, 'POST', `${P(FILE_GDOC)}/links`, { slot_key: client.key });
  const notAdmin = await createLink(h, client.key, USERS.engineer);
  assert.equal(notAdmin.res.status, 403, 'зөвхөн admin');
  assert.equal(notAdmin.body.code, 'ADMIN_ONLY');
  assert.equal(gdoc.status, 400);

  const list = (await (await h.req(USERS.engineer, 'GET', `${P(FILE_CR)}/links`)).json()) as { links: LinkView[]; version: number };
  assert.equal(list.links.length, 1);
  assert.equal(list.version, 0);
});

test('Утсаар нээх → баримт → зурах: гарын үсэг ИЖИЛ Drive файлд суугаад самбарт гаднын зурагчаар харагдана', async () => {
  const h = await harness();
  const client = (await slotsOf(h)).find((s) => s.client)!;
  const { token } = await createLink(h, client.key);

  const info = await h.req(null, 'GET', `/public/signing/${token}`);
  assert.equal(info.status, 200);
  assert.equal(info.headers.get('cache-control'), 'no-store, max-age=0');
  const payload = (await info.json()) as {
    request: { status: string; role_label: string };
    document: { format: string; slot: { client: boolean }; ask_position: boolean; project_name: string; document_type: string; prepared_by: string };
  };
  assert.equal(payload.request.status, 'pending');
  assert.equal(payload.document.format, 'docx');
  assert.equal(payload.document.slot.client, true);
  assert.equal(payload.document.ask_position, true);
  assert.equal(payload.document.project_name, 'MGL-250101 WISDOM TOWER');
  assert.equal(payload.document.document_type, 'Өөрчлөлтийн хүсэлт (CR)');
  assert.equal(payload.document.prepared_by, 'Мөнхбат Монголжин');

  // presence → ажилтны цонхонд «яг одоо нээлттэй».
  h.db.prepare('UPDATE drive_doc_public_links SET last_viewed_at = NULL').run();
  assert.equal((await h.req(null, 'POST', `/public/signing/${token}/presence`)).status, 200);
  const live = (await (await h.req(USERS.engineer, 'GET', `${P(FILE_CR)}/links`)).json()) as { links: LinkView[] };
  assert.equal(live.links[0]!.viewing_now, true);
  assert.ok(live.links[0]!.first_viewed_at);

  const doc = await h.req(null, 'GET', `/public/signing/${token}/document`);
  assert.equal(doc.status, 200);
  assert.match(doc.headers.get('content-type') ?? '', /wordprocessingml/);
  assert.equal(doc.headers.get('x-document-state'), 'current');
  assert.deepEqual(new Uint8Array(await doc.arrayBuffer()), h.drive.files.get(FILE_CR)!.bytes);

  // Зөвшөөрөлгүй / нэргүй / зураггүй → 400.
  assert.equal((await h.req(null, 'POST', `/public/signing/${token}/sign`, await signBody({ consent: false }))).status, 400);
  assert.equal((await h.req(null, 'POST', `/public/signing/${token}/sign`, await signBody({ signer_name: '  ' }))).status, 400);
  assert.equal((await h.req(null, 'POST', `/public/signing/${token}/sign`, await signBody({ signature_data_url: 'data:image/png;base64,AAAA' }))).status, 400);
  assert.equal(h.drive.uploads.length, 0);

  const signed = await h.req(null, 'POST', `/public/signing/${token}/sign`, await signBody());
  assert.equal(signed.status, 200);
  const sres = (await signed.json()) as { status: string; signed_name: string; signed_preview: boolean };
  assert.equal(sres.status, 'signed');
  assert.equal(sres.signed_preview, true);
  await Promise.all(h.waited);

  // Drive: ИЖИЛ файлын шинэ хувилбар, ledger-д link илгээсэн ажилтан.
  assert.deepEqual(h.drive.uploads, [FILE_CR]);
  assert.deepEqual(h.drive.records, [{ id: FILE_CR, user: 11 }]);
  const analyzed = await dsf.analyzeDocx(h.drive.files.get(FILE_CR)!.bytes);
  assert.ok(analyzed.ok);
  const after = analyzed.slots.find((s) => s.client)!;
  assert.equal(after.state, 'erp', 'гарын үсэг захиалагчийн мөрөнд суусан');
  assert.equal(after.name, 'Ж.Болормаа');
  assert.equal(after.position, 'Захиалагчийн төлөөлөгч');
  assert.ok(after.date.length > 0, 'огноо бөглөгдсөн');
  const staffRows = analyzed.slots.filter((s) => !s.client && !s.approver);
  assert.ok(staffRows.every((s) => s.state === 'empty'), 'бусад мөр хөндөгдөөгүй');

  // Аудит: үйл явдал, хувийн хуулбар, снапшот, мэдэгдэл.
  const ev = h.db.prepare("SELECT * FROM drive_doc_sign_events WHERE action = 'external'").get() as Record<string, unknown>;
  assert.equal(ev.user_id, 11);
  assert.equal(ev.external_signer_name, 'Ж.Болормаа');
  assert.ok(ev.result_modified_time);
  assert.ok(h.priv.store.has(String(ev.signature_key)));
  const link = h.db.prepare('SELECT * FROM drive_doc_public_links').get() as Record<string, unknown>;
  assert.equal(link.status, 'signed');
  assert.equal(link.sign_event_id, ev.id);
  assert.ok(h.priv.store.has(String(link.document_snapshot_key)));
  const note = h.db.prepare('SELECT * FROM notifications').get() as Record<string, unknown>;
  assert.equal(note.user_id, 11);
  assert.equal(note.type, 'client_signed');
  assert.match(String(note.link), /\/app\/documents\/project\/38\?folder=parentFolder0001&file=fileCr0000000001&sign=1/);

  // Ажилтны самбар: мөр «гаднын link-ээр зурсан», бодит цагийн хувилбар өөрчлөгдсөн.
  const view = (await slotsOf(h)).find((s) => s.client)!;
  assert.equal(view.state, 'erp');
  assert.equal(view.signer?.action, 'external');
  assert.equal(view.signer?.name, 'Ж.Болормаа');
  assert.equal(view.signer?.sent_by?.id, 11);
  const list = (await (await h.req(USERS.engineer, 'GET', `${P(FILE_CR)}/links`)).json()) as { links: LinkView[]; version: number };
  assert.equal(list.links[0]!.status, 'signed');
  assert.equal(list.version, ev.id);
  const st = (await (await h.req(USERS.engineer, 'POST', '/api/projects/38/drive/signing/statuses', { file_ids: [FILE_CR] })).json()) as {
    statuses: Record<string, { signatures: number; links_pending: number }>;
  };
  assert.equal(st.statuses[FILE_CR]!.signatures, 1);
  assert.equal(st.statuses[FILE_CR]!.links_pending, 0);

  // Дахин зурах боломжгүй; баримт → зурсан агшны снапшот.
  assert.equal((await h.req(null, 'POST', `/public/signing/${token}/sign`, await signBody())).status, 409);
  const again = (await (await h.req(null, 'GET', `/public/signing/${token}`)).json()) as { request: { status: string; signed_name: string } };
  assert.equal(again.request.status, 'signed');
  assert.equal(again.request.signed_name, 'Ж.Болормаа');
  const snap = await h.req(null, 'GET', `/public/signing/${token}/document`);
  assert.equal(snap.status, 200);
  assert.equal(snap.headers.get('x-document-state'), 'signed');
  // Зурсан хүнд ЗӨВХӨН PDF — засварлаж болох .docx очихгүй.
  assert.equal(snap.headers.get('content-type'), 'application/pdf');
  assert.match(snap.headers.get('content-disposition') ?? '', /^inline; filename="MGL-WT-CR-002\.pdf"/);
  assert.match(new TextDecoder().decode(new Uint8Array(await snap.arrayBuffer())), /^%PDF-/);
  assert.equal(h.pdf.calls.length, 1);
  assert.match(h.pdf.calls[0]!, /^https:\/\/erp\.example\/sign\/[A-Za-z0-9_-]+\/print\?r=\d+\.[0-9a-f]{64}$/);
  // Рендерлэгч яг зурсан агшны снапшотыг (Drive-ын шинэ хувилбартай ижил) PDF болгосон.
  assert.deepEqual(h.pdf.sources[0], h.drive.files.get(FILE_CR)!.bytes);
  // Хоёр дахь удаа кэшээс — Browser Rendering дахин дуудагдахгүй; татах ч мөн PDF.
  const dl = await h.req(null, 'GET', `/public/signing/${token}/document?download=1`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.match(dl.headers.get('content-disposition') ?? '', /^attachment; filename="MGL-WT-CR-002\.pdf"/);
  assert.equal(h.pdf.calls.length, 1);
  // Эх .docx-ийг токеноор ганцаараа авах боломжгүй.
  assert.equal((await h.req(null, 'GET', `/public/signing/${token}/document?source=1`)).status, 403);
  assert.equal((await h.req(null, 'GET', `/public/signing/${token}/document?source=1&r=1234567890123.${'0'.repeat(64)}`)).status, 403);
  assert.equal(h.drive.uploads.length, 1);
});

test('Хуучин токен 0381-ийн router руу унана; шинэ link хуучныг цуцална; цуцлах эрх', async () => {
  const h = await harness();
  const client = (await slotsOf(h)).find((s) => s.client)!;

  const unknown = await h.req(null, 'GET', `/public/signing/${'x'.repeat(43)}`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { legacy: true }, 'Drive-д байхгүй токен → 0381-ийн handler');

  const first = await createLink(h, client.key);
  const second = await createLink(h, client.key);
  assert.equal(second.res.status, 201);
  const oldInfo = (await (await h.req(null, 'GET', `/public/signing/${first.token}`)).json()) as { request: { status: string }; document: unknown };
  assert.equal(oldInfo.request.status, 'revoked');
  assert.equal(oldInfo.document, null, 'хаагдсан link баримтын мэдээлэл задруулахгүй');
  assert.equal((await h.req(null, 'GET', `/public/signing/${first.token}/document`)).status, 410);
  assert.equal((await h.req(null, 'POST', `/public/signing/${first.token}/sign`, await signBody())).status, 410);

  const linkId = second.body.link.id;
  assert.equal((await h.req(USERS.other, 'DELETE', `/api/projects/38/drive/signing/links/${linkId}`)).status, 403);
  assert.equal((await h.req(USERS.engineer, 'DELETE', `/api/projects/38/drive/signing/links/${linkId}`)).status, 403);
  const del = await h.req(USERS.pm, 'DELETE', `/api/projects/38/drive/signing/links/${linkId}`);
  assert.equal(del.status, 200);
  assert.equal((await h.req(null, 'POST', `/public/signing/${second.token}/sign`, await signBody())).status, 410);
  assert.equal(h.drive.uploads.length, 0);
});

test('Баримт хооронд нь засагдсан: өөр мөр зурагдсан ч link ажиллана; мөр бөглөгдсөн бол хаагдана', async () => {
  const h = await harness();
  const slots = await slotsOf(h);
  const client = slots.find((s) => s.client)!;
  const staffRow = slots.find((s) => !s.client && !s.approver && s.state === 'empty')!;
  const a = await createLink(h, client.key);
  const b = await createLink(h, staffRow.key);

  // Ажилтны мөрийн link-ээр эхэлж зурна → файл шинэ хувилбар болсон, түлхүүр хэвээр.
  assert.equal((await h.req(null, 'POST', `/public/signing/${b.token}/sign`, await signBody({ signer_name: 'Д.Далайбуян', signer_position: '' }))).status, 200);
  assert.equal((await h.req(null, 'POST', `/public/signing/${a.token}/sign`, await signBody())).status, 200);
  assert.equal(h.drive.uploads.length, 2);
  const analyzed = await dsf.analyzeDocx(h.drive.files.get(FILE_CR)!.bytes);
  assert.ok(analyzed.ok);
  assert.equal(analyzed.slots.filter((s) => s.state === 'erp').length, 2);

  // Мөрийг өөр замаар (гараар) бөглөсөн → SLOT_TAKEN, link хаагдана.
  const h2 = await harness();
  const c2 = (await slotsOf(h2)).find((s) => s.client)!;
  const l2 = await createLink(h2, c2.key);
  const pre = await dsf.stampDocx(h2.drive.files.get(FILE_CR)!.bytes, {
    slotKey: c2.key,
    image: { bytes: await sigPng(), info: { ext: 'png', width: 120, height: 40 } },
    mark: 'manual-x',
    descr: 'Word-оор оруулсан',
    fill: {},
  });
  assert.ok(pre.ok);
  h2.drive.files.get(FILE_CR)!.bytes = pre.bytes;
  const taken = await h2.req(null, 'POST', `/public/signing/${l2.token}/sign`, await signBody());
  assert.equal(taken.status, 409);
  assert.equal(((await taken.json()) as { code: string }).code, 'SLOT_TAKEN');
  assert.equal((h2.db.prepare('SELECT status, revoke_reason FROM drive_doc_public_links').get() as { status: string }).status, 'revoked');
  assert.equal(h2.drive.uploads.length, 0);
});

test('Эрх алдах, хугацаа, зэрэг зурах, түгжээ, Drive унах', async () => {
  const h = await harness();
  const client = (await slotsOf(h)).find((s) => s.client)!;

  // Илгээсэн ажилтан идэвхгүй болсон → 410 + link бүрмөсөн хаагдана.
  const l1 = await createLink(h, client.key);
  h.db.prepare("UPDATE users SET status = 'inactive' WHERE id = 11").run();
  assert.equal((await h.req(null, 'GET', `/public/signing/${l1.token}`)).status, 410);
  assert.equal((h.db.prepare('SELECT status FROM drive_doc_public_links WHERE id = ?').get(l1.body.link.id) as { status: string }).status, 'revoked');
  h.db.prepare("UPDATE users SET status = 'active' WHERE id = 11").run();

  // Хугацаа дууссан.
  const l2 = await createLink(h, client.key);
  h.db.prepare("UPDATE drive_doc_public_links SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(l2.body.link.id);
  const exp = (await (await h.req(null, 'GET', `/public/signing/${l2.token}`)).json()) as { request: { status: string } };
  assert.equal(exp.request.status, 'expired');
  assert.equal((await h.req(null, 'POST', `/public/signing/${l2.token}/sign`, await signBody())).status, 410);

  // Яг одоо өөр хүсэлт зурж байна (signing) → 409; хуучирсан signing → дахин pending.
  const l3 = await createLink(h, client.key);
  h.db.prepare("UPDATE drive_doc_public_links SET status = 'signing', signing_started_at = ? WHERE id = ?").run(new Date().toISOString(), l3.body.link.id);
  assert.equal((await h.req(null, 'POST', `/public/signing/${l3.token}/sign`, await signBody())).status, 409);
  const cancelBusy = await h.req(USERS.pm, 'DELETE', `/api/projects/38/drive/signing/links/${l3.body.link.id}`);
  assert.equal(cancelBusy.status, 409, 'зурж буй link-ийг цуцлахгүй');
  h.db.prepare("UPDATE drive_doc_public_links SET signing_started_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(l3.body.link.id);

  // Файлын түгжээг өөр хүн барьж байна → BUSY, link буцаад pending.
  h.db.prepare("INSERT INTO drive_doc_sign_locks (file_id, user_id, token, locked_at) VALUES (?, 2, 'other', ?)").run(FILE_CR, new Date().toISOString());
  const busy = await h.req(null, 'POST', `/public/signing/${l3.token}/sign`, await signBody());
  assert.equal(busy.status, 409);
  assert.equal(((await busy.json()) as { code: string }).code, 'BUSY');
  assert.equal((h.db.prepare('SELECT status FROM drive_doc_public_links WHERE id = ?').get(l3.body.link.id) as { status: string }).status, 'pending');
  h.db.prepare('DELETE FROM drive_doc_sign_locks').run();

  // Drive бичилт унасан → 502, үйл явдал/хуулбар цэвэрлэгдэж link буцаад pending (дахин зурж болно).
  h.drive.setFailUpload(true);
  const down = await h.req(null, 'POST', `/public/signing/${l3.token}/sign`, await signBody());
  assert.equal(down.status, 502);
  assert.doesNotMatch(JSON.stringify(await down.json()), /drive down/, 'түүхий алдаа гаднын хүнд гарахгүй');
  assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM drive_doc_sign_events").get() as { n: number }).n, 0);
  assert.equal([...h.priv.store.keys()].length, 0);
  assert.equal((h.db.prepare('SELECT status FROM drive_doc_public_links WHERE id = ?').get(l3.body.link.id) as { status: string }).status, 'pending');
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM drive_doc_sign_locks').get() as { n: number }).n, 0, 'түгжээ суллагдсан');
  h.drive.setFailUpload(false);
  assert.equal((await h.req(null, 'POST', `/public/signing/${l3.token}/sign`, await signBody())).status, 200);
});

test('Батлах мөр: манай захирлынх биш (гаднын батлагч) бол link болно, захирлынхд болохгүй', async () => {
  const h = await harness();
  const appr = (await slotsOf(h)).find((s) => s.approver)! as Slot & { can_link: boolean };
  assert.equal(appr.can_link, false, 'Б.Билгүүн = манай захирал → ERP-д «Батлах»');
  assert.equal((await createLink(h, appr.key)).res.status, 409);

  // Зөвлөхийн маягт: «Approved by» мөрөнд гаднын хүний нэр (захирал өөр хүн) → link болно.
  h.db.prepare("UPDATE users SET full_name = 'Энхбат Тэмүүжин', username = 'E.Temuujin' WHERE id = 2").run();
  const ext = (await slotsOf(h)).find((s) => s.approver)! as Slot & { can_link: boolean };
  assert.equal(ext.can_link, true);
  const l = await createLink(h, ext.key);
  assert.equal(l.res.status, 201);
  assert.equal((await h.req(null, 'POST', `/public/signing/${l.token}/sign`, await signBody({ signer_name: 'Б.Билгүүн' }))).status, 200);
  const analyzed = await dsf.analyzeDocx(h.drive.files.get(FILE_CR)!.bytes);
  assert.ok(analyzed.ok);
  assert.equal(analyzed.slots.find((s) => s.approver)!.state, 'erp');
  // Бүртгэлгүй нэртэй мөр (Д.Далайбуян) — link болно; бүртгэлтэй ажилтны мөр (М.Монголжин = admin
  // өөрөө) — ERP-д өөрөө зурна, link үгүй.  Admin биш хүнд link хэзээ ч санал болгохгүй.
  const staff = (await slotsOf(h)).filter((s) => !s.approver && !s.client) as Array<Slot & { can_link: boolean; name: string }>;
  assert.equal(staff.find((s) => s.name === 'Д.Далайбуян')?.can_link, true);
  assert.equal(staff.find((s) => s.name === 'М.Монголжин')?.can_link, false);
  const eng = (await slotsOf(h, USERS.engineer)) as Array<Slot & { can_link: boolean }>;
  assert.ok(eng.every((s) => !s.can_link), 'engineer-т link товч алга');
});

test('Цэвэр дүрэм: мөр дахин тулгах, үүргийн шошго, баримтын төрөл', async () => {
  const lib = await import('../lib/drivePublicSigning.ts');
  const slot = (key: string, role: string, position = '', name = '', client = false) =>
    ({ key, role, position, name, client, approver: false, state: 'empty' }) as never;
  const link = { slot_key: 't0r6c3', slot_role: 'Захиалагчаас баталсан: (Approved by client)', slot_position: '', slot_name: '', slot_client: 1 };
  assert.equal(lib.matchLinkSlot([slot('t0r6c3', 'Захиалагчаас баталсан: (Approved by client)', '', '', true)], link)?.key, 't0r6c3');
  // Мөр нэмэгдсэн → түлхүүр шилжсэн ч үүргээрээ ганц → олдоно.
  assert.equal(lib.matchLinkSlot([slot('t0r7c3', 'Захиалагчаас баталсан: (Approved by client)', '', '', true)], link)?.key, 't0r7c3');
  // Ижил түлхүүрт өөр мөр → таамаглахгүй.
  assert.equal(lib.matchLinkSlot([slot('t0r6c3', 'Хянасан'), slot('t1r1c1', 'Хянасан')], { ...link, slot_role: 'Хянасан', slot_client: 0, slot_key: 'x' }), null);
  assert.equal(lib.defaultRoleLabel({ role: 'Хариу илгээсэн: (Replied by)', client: false }), 'Хариу илгээсэн');
  assert.equal(lib.defaultRoleLabel({ role: '', client: true }), 'Захиалагч');
  assert.equal(lib.documentTypeOf('260930_EVGR_RFI_020.docx'), 'Мэдээлэл авах хүсэлт (RFI)');
  assert.equal(lib.documentTypeOf('MGL-WT-CR-002.docx'), 'Өөрчлөлтийн хүсэлт (CR)');
  assert.equal(lib.documentTypeOf('Гэрээ.docx'), 'Word баримт');
  const now = Date.parse('2026-10-12T10:00:00Z');
  assert.equal(lib.effectiveStatus({ status: 'pending', expires_at: '2026-10-12T09:00:00Z', signing_started_at: null }, now), 'expired');
  assert.equal(lib.effectiveStatus({ status: 'signing', expires_at: '2026-10-19T00:00:00Z', signing_started_at: '2026-10-12T09:59:30Z' }, now), 'signing');
  assert.equal(lib.effectiveStatus({ status: 'signing', expires_at: '2026-10-19T00:00:00Z', signing_started_at: '2026-10-12T09:50:00Z' }, now), 'pending');
});

test('RFI захиалагчийн мөргүй: admin «Захиалагч хүлээн авсан» мөр нэмж link үүсгэнэ — давхар нэмэхгүй', async () => {
  const h = await harness();
  const RP = `/api/projects/38/drive/files/${FILE_RFI}/signing`;
  const state = async (u: { sub: number; role: string }) =>
    (await (await h.req(u, 'GET', RP)).json()) as { slots: Array<Slot & { can_link: boolean }>; client_row_addable: boolean; can_manage_links: boolean; history: Array<{ action: string }> };
  const s0 = await state(USERS.pm);
  assert.equal(s0.slots.some((x) => x.client), false);
  assert.equal(s0.client_row_addable, true);
  assert.equal(s0.can_manage_links, true);
  const e0 = await state(USERS.engineer);
  assert.equal(e0.client_row_addable, false, 'admin биш');
  assert.equal(e0.can_manage_links, false);

  assert.equal((await h.req(USERS.engineer, 'POST', `${RP}/links`, { add_client_row: true })).status, 403);
  const created = await h.req(USERS.pm, 'POST', `${RP}/links`, { add_client_row: true, expires_in_days: 3 });
  assert.equal(created.status, 201);
  const body = (await created.json()) as { url: string; link: LinkView & { slot_client: boolean } };
  assert.equal(body.link.slot_client, true);
  assert.equal(h.drive.uploads.length, 1, 'мөр нэмсэн нь Drive-д ИЖИЛ файлын шинэ хувилбар');
  const a1 = await dsf.analyzeDocx(h.drive.files.get(FILE_RFI)!.bytes);
  assert.ok(a1.ok);
  const client = a1.slots.filter((x) => x.client);
  assert.equal(client.length, 1);
  assert.match(client[0]!.role, /Захиалагч хүлээн авсан/);
  assert.equal(client[0]!.state, 'empty');
  assert.equal(a1.slots.filter((x) => !x.client).length, 2, 'бусад мөр хэвээр');
  const s1 = await state(USERS.pm);
  assert.equal(s1.client_row_addable, false);
  assert.ok(s1.history.some((x) => x.action === 'add_client_row'), 'түүхэнд үлдэнэ');

  // Дахин «мөр нэмэх» — шинэ мөр НЭМЭХГҮЙ, байгаа мөрөнд шинэ link (хуучин нь цуцлагдана).
  const again = await h.req(USERS.pm, 'POST', `${RP}/links`, { add_client_row: true });
  assert.equal(again.status, 201);
  assert.equal(h.drive.uploads.length, 1);
  const token = decodeURIComponent(((await again.json()) as { url: string }).url.split('/sign/')[1]!);

  // Захиалагч зурна → тэр мөрөнд.
  assert.equal((await h.req(null, 'POST', `/public/signing/${token}/sign`, await signBody())).status, 200);
  const a2 = await dsf.analyzeDocx(h.drive.files.get(FILE_RFI)!.bytes);
  assert.ok(a2.ok);
  const signed = a2.slots.find((x) => x.client)!;
  assert.equal(signed.state, 'erp');
  assert.equal(signed.name, 'Ж.Болормаа');

  // Зурагдсаны дараа мөр нэмэхийг оролдвол → 409.
  const third = await h.req(USERS.pm, 'POST', `${RP}/links`, { add_client_row: true });
  assert.equal(third.status, 409);
  assert.equal(((await third.json()) as { code: string }).code, 'CLIENT_ROW_SIGNED');

  // Гарын үсэгтэй файл: ажилтан (нотолгоо) ба захиалагч (`?download=1`) хоёулаа татна.
  const links = (await (await h.req(USERS.engineer, 'GET', `${RP}/links`)).json()) as { links: Array<LinkView & { status: string }> };
  const signedLink = links.links.find((l) => l.status === 'signed')!;
  const staffFile = await h.req(USERS.engineer, 'GET', `/api/projects/38/drive/signing/links/${signedLink.id}/signed-file`);
  assert.equal(staffFile.status, 200);
  assert.match(staffFile.headers.get('content-disposition') ?? '', /^attachment; filename="261001_EVGR_RFI_022\.docx"/);
  assert.deepEqual(new Uint8Array(await staffFile.arrayBuffer()), h.drive.files.get(FILE_RFI)!.bytes);
  const revoked = links.links.find((l) => l.status === 'revoked')!;
  assert.equal((await h.req(USERS.engineer, 'GET', `/api/projects/38/drive/signing/links/${revoked.id}/signed-file`)).status, 404);
  const pub = await h.req(null, 'GET', `/public/signing/${token}/document?download=1`);
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('content-type'), 'application/pdf');
  assert.match(pub.headers.get('content-disposition') ?? '', /^attachment; filename="261001_EVGR_RFI_022\.pdf"/);
  assert.match((await h.req(null, 'GET', `/public/signing/${token}/document`)).headers.get('content-disposition') ?? '', /^inline;/);
});

test('Батлах мөрийн дүрэм: захиалагчийн «Баталсан» (нэр, албан тушаал хоосон) link болно, «Захирал» гэсэн нэргүй мөр болохгүй', async () => {
  const lib = await import('../lib/drivePublicSigning.ts');
  const dir = { full_name: 'Бат-Өлзий Билгүүн', username: 'B.Bilguun' };
  const slot = (name: string, position: string) => ({ state: 'empty' as const, approver: true, name, position });
  assert.equal(lib.linkableSlot(slot('', ''), dir), true, 'MGL-RFI-MAK: захиалагчийн «Баталсан»');
  assert.equal(lib.linkableSlot(slot('', 'Захирал'), dir), false, 'манай загварын нэргүй захирлын мөр');
  assert.equal(lib.linkableSlot(slot('Б.Билгүүн', 'Захирал'), dir), false);
  assert.equal(lib.linkableSlot(slot('Э.Цогтбат', ''), dir), true);
  assert.equal(lib.linkableSlot({ state: 'erp', approver: false, name: '', position: '' }, dir), false);
});

test('Зурсны дараах PDF: рендерлэгч унавал 502, кэшлэхгүй, дараа нь дахин оролдоно; PDF биш гаралт хаягдана', async () => {
  const h = await harness();
  const client = (await slotsOf(h)).find((s) => s.client)!;
  const { token } = await createLink(h, client.key);
  assert.equal((await h.req(null, 'POST', `/public/signing/${token}/sign`, await signBody())).status, 200);
  const info = (await (await h.req(null, 'GET', `/public/signing/${token}`)).json()) as {
    document: { signed_preview: boolean; signed_format: string };
  };
  assert.equal(info.document.signed_preview, true);
  assert.equal(info.document.signed_format, 'pdf');

  h.pdf.fail = true;
  const down = await h.req(null, 'GET', `/public/signing/${token}/document`);
  assert.equal(down.status, 502);
  assert.doesNotMatch(String(((await down.json()) as { error: string }).error), /browser rendering/i, 'дотоод алдаа гаднын хүнд гарахгүй');

  // Хоосон / алдааны хуудас PDF биш бол кэшлэгдэхгүй.
  h.pdf.fail = false;
  h.pdf.bytes = new TextEncoder().encode('<html>error</html>');
  assert.equal((await h.req(null, 'GET', `/public/signing/${token}/document`)).status, 502);
  const pdfKeys = () => [...h.priv.store.keys()].filter((k) => k.endsWith('-signed.pdf'));
  assert.equal(pdfKeys().length, 0);

  h.pdf.bytes = null;
  const ok = await h.req(null, 'GET', `/public/signing/${token}/document`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/pdf');
  assert.equal(pdfKeys().length, 1);
  assert.equal(h.pdf.calls.length, 3);

  // Хүлээгдэж буй (зураагүй) link-д эх .docx хэвээр — хөтөч өөрөө харуулна; `source` эрх хэрэггүй.
  const staffRow = (await slotsOf(h)).find((s) => !s.client && !s.approver && s.state === 'empty')!;
  const pending = await createLink(h, staffRow.key);
  const cur = await h.req(null, 'GET', `/public/signing/${pending.token}/document`);
  assert.equal(cur.status, 200);
  assert.equal(cur.headers.get('x-document-state'), 'current');
  assert.match(cur.headers.get('content-type') ?? '', /wordprocessingml/);
});

test('Рендерлэгчийн түр эрх: link-д уяатай, хугацаатай, хуурамчлах боломжгүй', async () => {
  const lib = await import('../lib/drivePublicSigning.ts');
  const now = 1_800_000_000_000;
  const g = await lib.renderGrant('s1', 7, now);
  assert.equal(await lib.verifyRenderGrant('s1', 7, g, now + 1000), true);
  assert.equal(await lib.verifyRenderGrant('s1', 8, g, now + 1000), false, 'өөр link');
  assert.equal(await lib.verifyRenderGrant('s2', 7, g, now + 1000), false, 'өөр нууц');
  assert.equal(await lib.verifyRenderGrant('s1', 7, g, now + lib.RENDER_GRANT_TTL_MS + 1), false, 'хугацаа дууссан');
  const [exp, mac] = g.split('.');
  const longer = `${Number(exp) + 60 * 60 * 1000}.${mac}`;
  assert.equal(await lib.verifyRenderGrant('s1', 7, longer, now + 1000), false, 'хугацааг сунгаж болохгүй');
  assert.equal(await lib.verifyRenderGrant('s1', 7, undefined, now), false);
  assert.equal(await lib.verifyRenderGrant('s1', 7, 'garbage', now), false);
  assert.equal(lib.pdfFileName('260930_EVGR_RFI_020.docx'), '260930_EVGR_RFI_020.pdf');
  assert.equal(lib.pdfFileName('.docx'), 'document.pdf');
});

test('Захирал баталсан CR: захиалагч link-ээр зурмагц «Бүрэн батлагдлаа» — жагсаалт, мэдэгдэл (2026-10-19)', async () => {
  const h = await harness();
  // Манай тал дууссан: Очир захиралд батлуулахаар илгээж, захирал баталсан.
  h.db.exec(`INSERT INTO drive_doc_sign_requests (file_id, root_folder_id, scope, scope_id, parent_id, file_name, status, requested_by, approver_id, decided_by, decided_at)
             VALUES ('${FILE_CR}', '${ROOT}', 'project', 38, 'parentFolder0001', 'MGL-WT-CR-002.docx', 'approved', 12, 2, 2, '2026-10-19T01:00:00.000Z')`);
  const s1 = (await (await h.req(USERS.pm, 'GET', P(FILE_CR))).json()) as { request: { status: string }; client_sign: { complete: boolean; total: number } };
  assert.equal(s1.request.status, 'approved');
  assert.equal(s1.client_sign.complete, false, 'захиалагчийн мөр хоосон — «Батлагдсан» биш');

  const client = (await slotsOf(h)).find((s) => s.client)!;
  const { token } = await createLink(h, client.key);
  type St = { statuses: Record<string, { request_status: string; links_pending: number; client: { complete: boolean; total: number; signed: number } }> };
  const before = (await (await h.req(USERS.engineer, 'POST', '/api/projects/38/drive/signing/statuses', { file_ids: [FILE_CR] })).json()) as St;
  assert.equal(before.statuses[FILE_CR]!.request_status, 'approved');
  assert.equal(before.statuses[FILE_CR]!.links_pending, 1);
  assert.deepEqual([before.statuses[FILE_CR]!.client.total, before.statuses[FILE_CR]!.client.signed, before.statuses[FILE_CR]!.client.complete], [1, 0, false]);

  const signed = await h.req(null, 'POST', `/public/signing/${token}/sign`, await signBody());
  assert.equal(signed.status, 200, await signed.clone().text());
  await Promise.all(h.waited);

  const after = (await (await h.req(USERS.engineer, 'POST', '/api/projects/38/drive/signing/statuses', { file_ids: [FILE_CR] })).json()) as St;
  assert.deepEqual([after.statuses[FILE_CR]!.client.total, after.statuses[FILE_CR]!.client.signed, after.statuses[FILE_CR]!.client.complete], [1, 1, true]);
  assert.equal(after.statuses[FILE_CR]!.links_pending, 0);

  const notes = h.db.prepare("SELECT user_id, title FROM notifications WHERE type = 'client_signed' ORDER BY user_id").all() as Array<{ user_id: number; title: string }>;
  assert.deepEqual(
    notes.map((n) => [n.user_id, n.title]),
    [
      [11, 'Бүрэн батлагдлаа: MGL-WT-CR-002.docx'],
      [12, 'Бүрэн батлагдлаа: MGL-WT-CR-002.docx'],
    ],
    'link илгээсэн ажилтан + батлуулах хүсэлтийн эзэн',
  );
});
