// Баримтын гарын үсэг + захирлын баталгаажуулалт — route-ын бүтэн урсгал.
// БОДИТ SQLite (миграц 0371 файлаас), D1 shim, санах ойн R2, хуурамч Drive IO
// (жинхэнэ Drive-ын IO нь `lib/driveSigningIo.ts` — `googleAuth.ts`-ийг
// `node --test` ачаалж чаддаггүй тул энд солигдоно), Hono `app.request()`.
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
const { loadProjectDriveRoot } = await import('../lib/projectDrive.ts');
const zp = await import('../lib/zipPatch.ts');
const dsf = await import('../lib/docxSignFile.ts');

const enc = new TextEncoder();

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
  return { prepare } as unknown as D1Database;
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
      return { key, size: o.bytes.length, arrayBuffer: async () => o.bytes.slice().buffer };
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Туршилтын Word баримт                                              */
/* ------------------------------------------------------------------ */

function cell(text = '', extra = ''): string {
  const run = text ? `<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>` : '';
  return `<w:tc><w:tcPr>${extra}</w:tcPr><w:p>${run}</w:p></w:tc>`;
}
function row(cells: string[]): string {
  return `<w:tr><w:trPr><w:trHeight w:val="700" w:hRule="atLeast"/></w:trPr>${cells.join('')}</w:tr>`;
}

/** EVGR-020-ийн «Хариу илгээсэн» хүснэгт + нэмэлт «Хянасан: Ахлах инженер» мөр. */
function rfiDocx(): Promise<Uint8Array> {
  const grid = [1400, 1300, 1600, 2000, 1200];
  const tbl =
    `<w:tbl><w:tblPr/><w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    row([cell('Хариу илгээсэн: (Replied by)', '<w:vMerge w:val="restart"/>'), cell('Албан тушаал: (Position)'), cell('Овог нэр: (Full name)'), cell('Гарын үсэг (Signature)'), cell('Огноо: (Date)')]) +
    row([cell('', '<w:vMerge/>'), cell('Архитектор'), cell('Б.Эрдэнэжин'), cell(), cell('2026.09.30')]) +
    row([cell('Бэлтгэсэн: (Prepared by)'), cell('Төслийн менежер'), cell(), cell(), cell()]) +
    row([cell('Хянасан: (Checked by)'), cell('Ахлах инженер'), cell('Д.Дорж'), cell(), cell()]) +
    row([cell('Баталсан: (Approved by)'), cell('Захирал'), cell('Б.Билгүүн'), cell(), cell()]) +
    `</w:tbl>`;
  return packDocx(tbl);
}

/**
 * MGL-WT-CR-002 (прод, 2026-10-12) — Өөрчлөлтийн хүсэлтийн загвар: хар-хөх толгой
 * «Гарын үсэг: (Sign)» + захиалагчийн батлах блок.  `strayInHead` — өмнөх хувилбарын
 * буруу гарын үсэг толгой нүдэнд (Google дахин хадгалж тэмдгийг нь устгасан).
 */
function crDocx(strayInHead: boolean): Promise<Uint8Array> {
  const navy = '<w:shd w:val="clear" w:fill="0F243E"/>';
  const span = (n: number, more = '') => `<w:gridSpan w:val="${n}"/>${more}`;
  const stray =
    '<w:p><w:pPr><w:spacing w:after="40" w:before="40" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:drawing><wp:inline><wp:extent cx="234775" cy="486000"/><wp:docPr descr="MGL ERP · Мөнхбат Монголжин · Төслийн менежер · 2026-10-12T00:36:15.815Z" id="19" name="image2.png"/></wp:inline></w:drawing></w:r><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr></w:r></w:p>';
  const head = cell('Гарын үсэг: (Sign)', span(3, navy)).replace('</w:tc>', `${strayInHead ? stray : ''}</w:tc>`);
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
      head,
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

function packDocx(tbl: string): Promise<Uint8Array> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>RFI</w:t></w:r></w:p>${tbl}<w:sectPr/></w:body></w:document>`;
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

/** 40×20 RGB PNG: голд нь хар зураас (гарын үсэг). */
async function sigPng(): Promise<Uint8Array> {
  const w = 40;
  const h = 20;
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const v = y >= 8 && y < 12 && x >= 5 && x < 35 ? 10 : 255;
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

/* ------------------------------------------------------------------ */
/*  Хуурамч Drive                                                       */
/* ------------------------------------------------------------------ */

const ROOT = 'rootFolder000001';
const PARENT = 'parentFolder0001';
const FILE_A = 'fileRfiA00000001';
const FILE_B = 'fileRfiB00000001';
const FILE_GDOC = 'fileGoogleDoc001';

interface FakeFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  version: number;
}

function fakeDrive() {
  const files = new Map<string, FakeFile>();
  const uploads: string[] = [];
  const records: string[] = [];
  const meta = (id: string) => {
    const f = files.get(id)!;
    return {
      id,
      name: f.name,
      mimeType: f.mimeType,
      size: String(f.bytes.length),
      md5Checksum: `md5-${f.version}`,
      version: String(f.version),
      modifiedTime: new Date(Date.UTC(2026, 9, 1, 0, 0, f.version)).toISOString(),
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
      const f = files.get(entry.id)!;
      f.bytes = bytes;
      f.version++;
      uploads.push(entry.id);
      return meta(entry.id);
    },
    async record(_env: unknown, _rootId: string, entry: { id: string }) {
      records.push(entry.id);
    },
    errorResponse(c: { json: (b: unknown, s: number) => Response }, err: unknown) {
      return c.json({ error: String(err), code: 'DRIVE' }, 502);
    },
  };
  return { files, uploads, records, io, meta };
}

/* ------------------------------------------------------------------ */
/*  Харness                                                            */
/* ------------------------------------------------------------------ */

const USERS = {
  director: { sub: 2, role: 'admin' },
  architect: { sub: 10, role: 'architect' },
  pm: { sub: 11, role: 'admin' },
  engineer: { sub: 12, role: 'engineer' },
  nosig: { sub: 13, role: 'engineer' },
  client: { sub: 14, role: 'client' },
  worker: { sub: 15, role: 'worker' },
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
    INSERT INTO projects (id, name, google_drive_folder_id, google_drive_folder_name) VALUES (41, 'MGL-251006 EVERGREEN', '${ROOT}', 'DOC-251006');
    INSERT INTO projects (id, name) VALUES (42, 'Хавтасгүй төсөл');
    INSERT INTO users (id, username, full_name, role, position, signature_url) VALUES
      (2, 'B.Bilguun', 'Бат-Өлзий Билгүүн', 'admin', 'Захирал', '/media/1-1786414345067-Bilguun.png'),
      (10, 'B.Erdenejin', 'Батбаяр Эрдэнэжин', 'architect', 'Архитектор', '/media/10-1700000000000-sig.png'),
      (11, 'M.Mongoljin', 'Мөнхбат Монголжин', 'admin', 'Төслийн менежер', '/media/11-1700000000000-sig.png'),
      (12, 'O.Ochir', 'Отгон Очир', 'engineer', 'Инженер', '/media/12-1700000000000-sig.png'),
      (13, 'N.Nosig', 'Нэргүй Тэмүүлэн', 'engineer', 'Инженер', NULL),
      (14, 'client1', 'Захиалагч', 'client', NULL, NULL),
      (15, 'worker1', 'Цэвэрлэгч', 'worker', NULL, NULL),
      (16, 'D.Dorj', 'Дамдин Дорж', 'senior', 'Ахлах инженер', '/media/16-1700000000000-sig.png');
  `);
  db.exec(readFileSync(new URL('../../migrations/0371_drive_doc_signing.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/0397_drive_doc_public_links.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/0415_drive_doc_sign_summaries.sql', import.meta.url), 'utf8'));

  const media = r2Shim();
  const priv = r2Shim();
  const png = await sigPng();
  for (const k of ['1-1786414345067-Bilguun.png', '10-1700000000000-sig.png', '11-1700000000000-sig.png', '12-1700000000000-sig.png', '16-1700000000000-sig.png']) {
    media.store.set(k, { bytes: png, contentType: 'image/png' });
  }
  const drive = fakeDrive();
  drive.files.set(FILE_A, { name: '260930_EVGR_RFI_020.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: await rfiDocx(), version: 1 });
  drive.files.set(FILE_B, { name: '261001_EVGR_RFI_023.docx', mimeType: 'application/octet-stream', bytes: await rfiDocx(), version: 1 });
  drive.files.set(FILE_GDOC, { name: 'RFI-017', mimeType: 'application/vnd.google-apps.document', bytes: new Uint8Array(0), version: 1 });

  const env = { DB: d1Shim(db), MEDIA_BUCKET: media, MEETING_BUCKET: priv } as unknown as Record<string, unknown>;
  const waited: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p), passThroughOnException() {} };

  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  const projects = new Hono();
  route.mountDriveSigning(projects as never, { label: 'project', resolveRoot: loadProjectDriveRoot, io: drive.io as never });
  app.route('/api/projects', projects as never);
  app.route('/api/drive-signing', route.default as never);

  const req = async (user: { sub: number; role: string }, method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { 'x-test-user': JSON.stringify(user), 'content-type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.request(path, init, env, ctx as never);
  };
  return { db, drive, media, priv, waited, req };
}

const base = (h: Awaited<ReturnType<typeof harness>>, id: string) => h.drive.meta(id).modifiedTime;
const P = (id: string) => `/api/projects/41/drive/files/${id}/signing`;

type State = {
  supported: boolean;
  reason: string | null;
  slots: Array<{
    key: string;
    role: string;
    name: string;
    approver: boolean;
    state: string;
    can_sign: boolean;
    needs_name_confirm: boolean;
    mine: boolean;
    signer: { id: number; action: string } | null;
    ask_user: { id: number } | null;
  }>;
  me: { is_approver: boolean };
  approver: { id: number } | null;
  default_approve_slot: string | null;
  request: { status: string; requested_by: { id: number } | null; decision_note: string | null } | null;
  client_sign: { required: boolean; total: number; signed: number; complete: boolean; missing_row: boolean } | null;
  can_request: boolean;
  history: Array<{ action: string; user: { id: number } }>;
  changed_since_signing: boolean;
  requested?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Тестүүд                                                             */
/* ------------------------------------------------------------------ */

test('GET: мөрүүд, миний мөр, захирлын мөр зөвхөн захиралд, эрхийн хаалт', async () => {
  const h = await harness();
  const res = await h.req(USERS.architect, 'GET', P(FILE_A));
  assert.equal(res.status, 200);
  const s = (await res.json()) as State;
  assert.equal(s.supported, true);
  assert.equal(s.slots.length, 4);
  const [mine, prep, checked, appr] = s.slots;
  assert.equal(mine!.name, 'Б.Эрдэнэжин');
  assert.equal(mine!.mine, true);
  assert.equal(mine!.can_sign, true);
  assert.equal(prep!.name, '');
  assert.equal(prep!.can_sign, true);
  assert.equal(prep!.needs_name_confirm, false);
  assert.equal(checked!.approver, false, 'Хянасан + Ахлах инженер = энгийн мөр');
  assert.equal(checked!.needs_name_confirm, true, 'өөр хүний нэртэй');
  assert.equal(checked!.ask_user?.id, 16, 'Д.Дорж ↔ Дамдин Дорж');
  assert.equal(appr!.approver, true);
  assert.equal(appr!.can_sign, false);
  assert.equal(s.approver?.id, 2);
  assert.equal(s.me.is_approver, false);
  assert.equal(s.can_request, true);
  assert.equal(s.default_approve_slot, null, 'зөвхөн захиралд');

  const dir = (await (await h.req(USERS.director, 'GET', P(FILE_A))).json()) as State;
  assert.equal(dir.me.is_approver, true);
  assert.equal(dir.default_approve_slot, appr!.key);
  assert.equal(dir.slots.find((x) => x.approver)!.can_sign, true);
  assert.equal(dir.can_request, false);

  assert.equal((await h.req(USERS.client, 'GET', P(FILE_A))).status, 403);
  assert.equal((await h.req(USERS.worker, 'GET', P(FILE_A))).status, 403);
  assert.equal((await h.req(USERS.architect, 'GET', '/api/projects/42/drive/files/fileRfiA00000001/signing')).status, 409);
  assert.equal((await h.req(USERS.architect, 'GET', P('notInThisProject1'))).status, 403);

  const gdoc = (await (await h.req(USERS.architect, 'GET', P(FILE_GDOC))).json()) as State;
  assert.equal(gdoc.supported, false);
  assert.equal(gdoc.reason, 'NOT_DOCX');
});

test('Зурах: хуучирсан хувилбар 409, амжилттай бол файлд суугаад захиралд хүсэлт + мэдэгдэл', async () => {
  const h = await harness();
  const s0 = (await (await h.req(USERS.architect, 'GET', P(FILE_A))).json()) as State;
  const key = s0.slots[0]!.key;

  const stale = await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: key, base_modified_time: '2020-01-01T00:00:00.000Z' });
  assert.equal(stale.status, 409);
  assert.equal(((await stale.json()) as { code: string }).code, 'STALE_FILE');

  const res = await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: key, base_modified_time: base(h, FILE_A), request_approval: true });
  assert.equal(res.status, 200, await res.clone().text());
  const s = (await res.json()) as State;
  assert.equal(s.requested, true);
  assert.equal(s.slots[0]!.state, 'erp');
  assert.equal(s.slots[0]!.signer?.id, 10);
  assert.equal(s.request?.status, 'pending');
  assert.equal(s.can_request, false);
  assert.deepEqual(h.drive.uploads, [FILE_A]);
  await Promise.all(h.waited);
  assert.deepEqual(h.drive.records, [FILE_A], 'ledger (waitUntil)');

  // Drive дээрх файлд үнэхээр суусан.
  const analyzed = await dsf.analyzeDocx(h.drive.files.get(FILE_A)!.bytes);
  assert.ok(analyzed.ok);
  assert.equal(analyzed.slots[0]!.state, 'erp');
  assert.equal(analyzed.slots.filter((x) => x.state === 'erp').length, 1);

  // Аудит: үйл явдал + хувийн хуулбар.
  const ev = h.db.prepare("SELECT * FROM drive_doc_sign_events WHERE action = 'sign'").get() as Record<string, unknown>;
  assert.equal(ev.user_id, 10);
  assert.ok(ev.result_modified_time);
  assert.equal(ev.result_md5, 'md5-2');
  assert.ok(h.priv.store.has(String(ev.signature_key)));
  assert.equal(String(ev.signature_sha256).length, 64);

  // Захиралд мэдэгдэл.
  const n = h.db.prepare("SELECT * FROM notifications WHERE user_id = 2").all() as Array<Record<string, string>>;
  assert.equal(n.length, 1);
  assert.equal(n[0]!.type, 'doc_sign_requested');
  assert.match(n[0]!.link!, /^\/app\/documents\/project\/41\?folder=parentFolder0001&file=fileRfiA00000001&sign=1$/);

  // Дахин нэг мөрөнд → NOT_EMPTY; захирлын мөр → APPROVER_ONLY.
  const again = await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: key, base_modified_time: base(h, FILE_A) });
  assert.equal(((await again.json()) as { code: string }).code, 'NOT_EMPTY');
  const apprKey = s.slots.find((x) => x.approver)!.key;
  const notMine = await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: apprKey, base_modified_time: base(h, FILE_A) });
  assert.equal(((await notMine.json()) as { code: string }).code, 'APPROVER_ONLY');
});

test('Зурах: хоосон нэрийг бөглөнө, өөр хүний нэртэй мөр баталгаажуулалт шаардана, гарын үсэггүй бол 409', async () => {
  const h = await harness();
  const s0 = (await (await h.req(USERS.pm, 'GET', P(FILE_A))).json()) as State;
  const prep = s0.slots[1]!;
  const r1 = await h.req(USERS.pm, 'POST', `${P(FILE_A)}/sign`, { slot_key: prep.key, base_modified_time: base(h, FILE_A) });
  assert.equal(r1.status, 200);
  const after = await dsf.analyzeDocx(h.drive.files.get(FILE_A)!.bytes);
  assert.ok(after.ok);
  assert.equal(after.slots[1]!.name, 'М.Монголжин', 'хоосон нэр бөглөгдсөн');

  const checked = s0.slots[2]!;
  const r2 = await h.req(USERS.engineer, 'POST', `${P(FILE_A)}/sign`, { slot_key: checked.key, base_modified_time: base(h, FILE_A) });
  assert.equal(((await r2.json()) as { code: string }).code, 'NAME_CONFIRM_REQUIRED');
  const r3 = await h.req(USERS.engineer, 'POST', `${P(FILE_A)}/sign`, {
    slot_key: checked.key,
    base_modified_time: base(h, FILE_A),
    confirm_name_mismatch: true,
  });
  assert.equal(r3.status, 200);
  const ev = h.db.prepare("SELECT name_override FROM drive_doc_sign_events WHERE user_id = 12").get() as { name_override: number };
  assert.equal(ev.name_override, 1);

  const r4 = await h.req(USERS.nosig, 'POST', `${P(FILE_A)}/sign`, { slot_key: s0.slots[0]!.key, base_modified_time: base(h, FILE_A) });
  assert.equal(((await r4.json()) as { code: string }).code, 'NO_SIGNATURE');
});

test('Түгжээ: өөр хүн яг одоо зурж байвал 409 BUSY; 90 секундээс хуучин түгжээг дахин авна', async () => {
  const h = await harness();
  const s0 = (await (await h.req(USERS.architect, 'GET', P(FILE_A))).json()) as State;
  h.db.prepare('INSERT INTO drive_doc_sign_locks (file_id, user_id, token, locked_at) VALUES (?, 11, ?, ?)').run(FILE_A, 'x', new Date().toISOString());
  const busy = await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: s0.slots[0]!.key, base_modified_time: base(h, FILE_A) });
  assert.equal(((await busy.json()) as { code: string }).code, 'BUSY');
  h.db.prepare('UPDATE drive_doc_sign_locks SET locked_at = ? WHERE file_id = ?').run(new Date(Date.now() - 120_000).toISOString(), FILE_A);
  const ok = await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: s0.slots[0]!.key, base_modified_time: base(h, FILE_A) });
  assert.equal(ok.status, 200);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM drive_doc_sign_locks').get() as { n: number }).n, 0, 'түгжээ суллагдсан');
});

test('Захирал батлах: зөвхөн захирал, хүсэлт батлагдаж хүсэгч + зурсан хүмүүст мэдэгдэл', async () => {
  const h = await harness();
  const s0 = (await (await h.req(USERS.architect, 'GET', P(FILE_A))).json()) as State;
  await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: s0.slots[0]!.key, base_modified_time: base(h, FILE_A), request_approval: true });
  await h.req(USERS.pm, 'POST', `${P(FILE_A)}/sign`, { slot_key: s0.slots[1]!.key, base_modified_time: base(h, FILE_A), request_approval: true });
  assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM drive_doc_sign_requests WHERE status = 'pending'").get() as { n: number }).n, 1, 'ганц хүсэлт');
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = 2').get() as { n: number }).n, 1, 'захиралд ганц мэдэгдэл');

  const pend = (await (await h.req(USERS.director, 'GET', '/api/drive-signing/pending')).json()) as {
    is_approver: boolean;
    approvals: Array<{ file_name: string; requested_by: string; project_name: string; link: string }>;
  };
  assert.equal(pend.is_approver, true);
  assert.equal(pend.approvals.length, 1);
  assert.equal(pend.approvals[0]!.requested_by, 'Батбаяр Эрдэнэжин');
  assert.equal(pend.approvals[0]!.project_name, 'MGL-251006 EVERGREEN');

  assert.equal((await h.req(USERS.architect, 'POST', `${P(FILE_A)}/approve`, { base_modified_time: base(h, FILE_A) })).status, 403);
  const res = await h.req(USERS.director, 'POST', `${P(FILE_A)}/approve`, { base_modified_time: base(h, FILE_A) });
  assert.equal(res.status, 200, await res.clone().text());
  const s = (await res.json()) as State;
  assert.equal(s.request?.status, 'approved');
  const appr = s.slots.find((x) => x.approver)!;
  assert.equal(appr.state, 'erp');
  assert.equal(appr.signer?.id, 2);
  assert.equal(appr.signer?.action, 'approve');

  const decided = h.db.prepare("SELECT user_id FROM notifications WHERE type = 'doc_sign_decided' ORDER BY user_id").all() as Array<{ user_id: number }>;
  assert.deepEqual(decided.map((x) => x.user_id), [10, 11]);
  const pend2 = (await (await h.req(USERS.director, 'GET', '/api/drive-signing/pending')).json()) as { approvals: unknown[] };
  assert.equal(pend2.approvals.length, 0);
  // Түүх: шинэ нь эхэнд.
  assert.deepEqual(s.history.map((x) => x.action), ['approve', 'sign', 'sign']);
});

test('Захирал хүсэлтгүйгээр шууд батлах — «батлагдсан» төлөвтэй хүсэлт үүснэ', async () => {
  const h = await harness();
  const res = await h.req(USERS.director, 'POST', `${P(FILE_B)}/approve`, { base_modified_time: base(h, FILE_B) });
  assert.equal(res.status, 200);
  const s = (await res.json()) as State;
  assert.equal(s.request?.status, 'approved');
  assert.equal(s.request?.requested_by?.id, 2);
});

test('Хүсэлт → буцаах (шалтгаантай) → дахин хүсэлт → цуцлах', async () => {
  const h = await harness();
  const r1 = await h.req(USERS.architect, 'POST', `${P(FILE_B)}/request`, { note: 'Хариугаа шалгана уу' });
  assert.equal(r1.status, 200);
  assert.equal(((await r1.json()) as State).request?.status, 'pending');
  assert.equal(((await (await h.req(USERS.architect, 'POST', `${P(FILE_B)}/request`, {})).json()) as { code: string }).code, 'ALREADY_PENDING');

  assert.equal((await h.req(USERS.pm, 'POST', `${P(FILE_B)}/return`, { note: 'x' })).status, 403);
  assert.equal(((await (await h.req(USERS.director, 'POST', `${P(FILE_B)}/return`, {})).json()) as { code: string }).code, 'NOTE_REQUIRED');
  const ret = await h.req(USERS.director, 'POST', `${P(FILE_B)}/return`, { note: 'Хариуны 2-р хэсгийг засна уу' });
  assert.equal(ret.status, 200);
  const rs = (await ret.json()) as State;
  assert.equal(rs.request?.status, 'returned');
  assert.equal(rs.request?.decision_note, 'Хариуны 2-р хэсгийг засна уу');
  const n = h.db.prepare("SELECT title, body FROM notifications WHERE user_id = 10 AND type = 'doc_sign_decided'").get() as { title: string; body: string };
  assert.match(n.title, /^Буцаагдлаа: /);
  assert.match(n.body, /Хариуны 2-р хэсгийг засна уу/);

  assert.equal((await h.req(USERS.architect, 'POST', `${P(FILE_B)}/request`, {})).status, 200);
  assert.equal((await h.req(USERS.engineer, 'POST', `${P(FILE_B)}/cancel`, {})).status, 403);
  const c = await h.req(USERS.architect, 'POST', `${P(FILE_B)}/cancel`, {});
  assert.equal(((await c.json()) as State).request?.status, 'cancelled');
});

test('Гарын үсэг хүсэх: нэр ганц ажилтанд таарвал мэдэгдэл, 30 минутад давтахгүй, хүлээгдэж буй жагсаалтад', async () => {
  const h = await harness();
  const s0 = (await (await h.req(USERS.architect, 'GET', P(FILE_A))).json()) as State;
  const checked = s0.slots[2]!;
  const ask = await h.req(USERS.architect, 'POST', `${P(FILE_A)}/ask`, { slot_key: checked.key });
  assert.equal(ask.status, 200);
  const n = h.db.prepare('SELECT type, title FROM notifications WHERE user_id = 16').get() as { type: string; title: string };
  assert.equal(n.type, 'doc_sign_requested');
  assert.match(n.title, /^Гарын үсэг зурна уу: /);
  assert.equal((await h.req(USERS.architect, 'POST', `${P(FILE_A)}/ask`, { slot_key: checked.key })).status, 429);
  // Хоосон нэртэй мөр → хүсэх хүн алга.
  assert.equal(((await (await h.req(USERS.architect, 'POST', `${P(FILE_A)}/ask`, { slot_key: s0.slots[1]!.key })).json()) as { code: string }).code, 'NO_TARGET');

  const dorj = { sub: 16, role: 'senior' };
  const p1 = (await (await h.req(dorj, 'GET', '/api/drive-signing/pending')).json()) as { asks: Array<{ asked_by: string }> };
  assert.equal(p1.asks.length, 1);
  assert.equal(p1.asks[0]!.asked_by, 'Батбаяр Эрдэнэжин');
  const signed = await h.req(dorj, 'POST', `${P(FILE_A)}/sign`, { slot_key: checked.key, base_modified_time: base(h, FILE_A) });
  assert.equal(signed.status, 200);
  const p2 = (await (await h.req(dorj, 'GET', '/api/drive-signing/pending')).json()) as { asks: unknown[] };
  assert.equal(p2.asks.length, 0, 'зурсны дараа жагсаалтаас гарна');
});

test('Хавтасны тэмдэг: хүсэлтийн төлөв + гарын үсгийн тоо (D1 л, энэ төслийн хавтсаар)', async () => {
  const h = await harness();
  const s0 = (await (await h.req(USERS.architect, 'GET', P(FILE_A))).json()) as State;
  await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: s0.slots[0]!.key, base_modified_time: base(h, FILE_A), request_approval: true });
  const res = await h.req(USERS.engineer, 'POST', '/api/projects/41/drive/signing/statuses', { file_ids: [FILE_A, FILE_B, 'bad id'] });
  const body = (await res.json()) as { statuses: Record<string, { request_status: string | null; signatures: number }> };
  assert.deepEqual(Object.keys(body.statuses), [FILE_A]);
  assert.equal(body.statuses[FILE_A]!.request_status, 'pending');
  assert.equal(body.statuses[FILE_A]!.signatures, 1);
});

test('Байршуулалт унавал үйл явдал + хувийн хуулбар цэвэрлэгдэнэ (тэмдэг Drive-д ороогүй)', async () => {
  const h = await harness();
  const s0 = (await (await h.req(USERS.architect, 'GET', P(FILE_A))).json()) as State;
  h.drive.io.upload = async () => {
    throw new Error('Drive 503');
  };
  const res = await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: s0.slots[0]!.key, base_modified_time: base(h, FILE_A) });
  assert.equal(res.status, 502);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM drive_doc_sign_events').get() as { n: number }).n, 0);
  assert.equal(h.priv.store.size, 0);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM drive_doc_sign_locks').get() as { n: number }).n, 0);
});

test('CR загвар (MGL-WT-CR-002): гарын үсэг өөрийн мөрөнд, толгойн буруу гарын үсэг арилна, захирал батлах мөрөндөө, захиалагчийн мөр саадгүй', async () => {
  const h = await harness();
  const FILE_CR = 'fileCr0000000002';
  h.drive.files.set(FILE_CR, {
    name: 'MGL-WT-CR-002.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: await crDocx(true),
    version: 1,
  });
  // Өмнөх (буруу) зурсан үйл явдал — descr-ийн агшинтай таарна.
  h.db.exec(`INSERT INTO drive_doc_sign_events (file_id, root_folder_id, scope, scope_id, file_name, action, user_id, slot_key, docx_mark, result_modified_time, created_at)
             VALUES ('${FILE_CR}', '${ROOT}', 'project', 41, 'MGL-WT-CR-002.docx', 'sign', 11, 't0r0c9', 'mgl-sign-9b456b83b0dc4894', '2026-10-12T00:36:18.331Z', '2026-10-12 00:36:16')`);

  const s0 = (await (await h.req(USERS.pm, 'GET', P(FILE_CR))).json()) as State & {
    slots: Array<State['slots'][number] & { client: boolean }>;
  };
  assert.equal(s0.supported, true);
  assert.deepEqual(
    s0.slots.map((x) => [x.key, x.name, x.approver, x.client, x.state]),
    [
      ['t0r1c9', 'Д.Далайбуян', false, false, 'empty'],
      ['t0r2c9', 'М.Монголжин', false, false, 'empty'],
      ['t0r3c9', 'Б.Билгүүн', true, false, 'empty'],
      ['t0r5c5', '', false, true, 'empty'],
    ],
    'толгой нүд хайрцаг биш — бүх мөр хоосон, Монголжингийн мөр нээлттэй',
  );
  const mine = s0.slots[1]!;
  assert.equal(mine.mine, true);
  assert.equal(mine.can_sign, true);
  const client = s0.slots[3]!;
  assert.equal(client.can_sign, false);
  assert.equal(client.ask_user, null);
  assert.equal(s0.can_request, true);

  const signed = await h.req(USERS.pm, 'POST', `${P(FILE_CR)}/sign`, { slot_key: mine.key, base_modified_time: base(h, FILE_CR), request_approval: true });
  assert.equal(signed.status, 200, await signed.clone().text());
  const s1 = (await signed.json()) as State;
  assert.equal(s1.slots[1]!.state, 'erp');
  assert.equal(s1.slots[1]!.signer?.id, 11);
  assert.equal(s1.request?.status, 'pending');

  // Drive дээрх файл: толгой нүдэнд зураг үлдээгүй, гарын үсэг Монголжингийн мөрөнд.
  const { parseTables } = await import('../lib/docxSign.ts');
  const { readZipText } = await import('../lib/zipRead.ts');
  const xml1 = (await readZipText(h.drive.files.get(FILE_CR)!.bytes, 'word/document.xml'))!;
  const headCell = parseTables(xml1)[0]!.rows[0]!.cells[4]!;
  assert.equal(headCell.text, 'Гарын үсэг: (Sign)');
  assert.equal(headCell.hasDrawing, false, 'толгойн буруу гарын үсэг арилсан');
  assert.equal(parseTables(xml1)[0]!.rows[2]!.cells[4]!.hasDrawing, true);

  // Захирал: «Батлах» нь «Хянасан — Захирал» мөрөнд, захиалагчийн мөрөнд БИШ.
  const d0 = (await (await h.req(USERS.director, 'GET', P(FILE_CR))).json()) as State;
  assert.equal(d0.default_approve_slot, 't0r3c9');
  const notClient = await h.req(USERS.director, 'POST', `${P(FILE_CR)}/approve`, { slot_key: 't0r5c5', base_modified_time: base(h, FILE_CR) });
  assert.equal(((await notClient.json()) as { code: string }).code, 'CLIENT');
  const approved = await h.req(USERS.director, 'POST', `${P(FILE_CR)}/approve`, { base_modified_time: base(h, FILE_CR) });
  assert.equal(approved.status, 200, await approved.clone().text());
  const d1 = (await approved.json()) as State;
  assert.equal(d1.request?.status, 'approved');
  assert.equal(d1.slots[2]!.state, 'erp');
  assert.equal(d1.slots[2]!.signer?.action, 'approve');
  assert.equal(d1.slots[3]!.state, 'empty', 'захиалагчийн мөр хоосон хэвээр');
  assert.equal(d1.default_approve_slot, null, 'захиалагчийн мөр захиралд дахин «Батлах» гаргахгүй');
  assert.equal(d1.can_request, false);
  const askClient = await h.req(USERS.pm, 'POST', `${P(FILE_CR)}/ask`, { slot_key: 't0r5c5' });
  assert.equal(((await askClient.json()) as { code: string }).code, 'SLOT_NOT_ASKABLE');

  // Google Docs файлыг дахин хадгалж `mgl-sign-…` нэрсийг устгасан ч хэн зурсан нь танигдана.
  const f = h.drive.files.get(FILE_CR)!;
  const DOCPR_MARK_RE = /(<wp:docPr [^>]*name=")mgl-sign-[A-Za-z0-9_-]+"/g;
  const xml2 = (await readZipText(f.bytes, 'word/document.xml'))!.replace(DOCPR_MARK_RE, '$1imageX.png"');
  assert.doesNotMatch(xml2, DOCPR_MARK_RE);
  f.bytes = await zp.rewriteZip(f.bytes, { replace: new Map([['word/document.xml', enc.encode(xml2)]]) });
  f.version++;
  const s2 = (await (await h.req(USERS.pm, 'GET', P(FILE_CR))).json()) as State;
  assert.equal(s2.slots[1]!.state, 'erp');
  assert.equal(s2.slots[1]!.signer?.id, 11, 'descr-ээр Монголжин');
  assert.equal(s2.slots[2]!.signer?.id, 2, 'descr-ээр захирал');
  assert.equal(s2.slots[2]!.signer?.action, 'approve');
});

/* ------------------------------------------------------------------ */
/*  Захиалагчийн гарын үсэг (2026-10-19): RFI / CR нь захиалагч зурсны  */
/*  ДАРАА л «Батлагдсан».                                               */
/* ------------------------------------------------------------------ */

type Statuses = {
  statuses: Record<
    string,
    { request_status: string | null; client: { required: boolean; total: number; signed: number; complete: boolean; missing_row: boolean } | null }
  >;
};

test('RFI: захиалагч батлахгүй — манай тал зурж захирал баталмагц «Батлагдлаа» (самбар, мэдэгдэл, жагсаалт)', async () => {
  const h = await harness();
  const s0 = (await (await h.req(USERS.architect, 'GET', P(FILE_A))).json()) as State;
  assert.deepEqual(s0.client_sign, { required: false, total: 0, signed: 0, complete: true, missing_row: false }, 'RFI — шаардахгүй');
  await h.req(USERS.architect, 'POST', `${P(FILE_A)}/sign`, { slot_key: s0.slots[0]!.key, base_modified_time: base(h, FILE_A), request_approval: true });
  const res = await h.req(USERS.director, 'POST', `${P(FILE_A)}/approve`, { base_modified_time: base(h, FILE_A) });
  assert.equal(res.status, 200, await res.clone().text());
  const s = (await res.json()) as State;
  assert.equal(s.request?.status, 'approved');
  assert.equal(s.client_sign?.complete, true);

  const n = h.db.prepare("SELECT title FROM notifications WHERE user_id = 10 AND type = 'doc_sign_decided'").get() as { title: string };
  assert.match(n.title, /^Батлагдлаа: /);

  const st = (await (await h.req(USERS.engineer, 'POST', '/api/projects/41/drive/signing/statuses', { file_ids: [FILE_A] })).json()) as Statuses;
  assert.equal(st.statuses[FILE_A]!.request_status, 'approved');
  assert.equal(st.statuses[FILE_A]!.client?.complete, true);

  // Хураангуй байхгүй (миграцын өмнө баталсан) — мөн бүрэн.
  h.db.exec('DELETE FROM drive_doc_sign_summaries');
  const st2 = (await (await h.req(USERS.engineer, 'POST', '/api/projects/41/drive/signing/statuses', { file_ids: [FILE_A] })).json()) as Statuses;
  assert.equal(st2.statuses[FILE_A]!.client?.complete, true);

  // 0415-гүй орчин (worker миграцаас түрүүлсэн) — самбар, жагсаалт унахгүй.
  h.db.exec('DROP TABLE drive_doc_sign_summaries');
  assert.equal((await h.req(USERS.architect, 'GET', P(FILE_A))).status, 200);
  assert.equal((await h.req(USERS.engineer, 'POST', '/api/projects/41/drive/signing/statuses', { file_ids: [FILE_A] })).status, 200);
});

test('CR захиалагчийн мөргүй: захирал баталсан ч дутуу — «Манай тал баталлаа», жагсаалт ч дутуу', async () => {
  const h = await harness();
  const FILE_CR9 = 'fileCrNoRow00009';
  h.drive.files.set(FILE_CR9, {
    name: 'MGL-WT-CR-009.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: await rfiDocx(),
    version: 1,
  });
  const s0 = (await (await h.req(USERS.architect, 'GET', P(FILE_CR9))).json()) as State;
  await h.req(USERS.architect, 'POST', `${P(FILE_CR9)}/sign`, { slot_key: s0.slots[0]!.key, base_modified_time: base(h, FILE_CR9), request_approval: true });
  const s = (await (await h.req(USERS.director, 'POST', `${P(FILE_CR9)}/approve`, { base_modified_time: base(h, FILE_CR9) })).json()) as State;
  assert.deepEqual(s.client_sign, { required: true, total: 0, signed: 0, complete: false, missing_row: true });
  const n = h.db.prepare("SELECT title, body FROM notifications WHERE user_id = 10 AND type = 'doc_sign_decided'").get() as { title: string; body: string };
  assert.match(n.title, /^Манай тал баталлаа: /, '«Батлагдлаа» биш');
  assert.match(n.body, /захиалагчийн гарын үсэг хүлээгдэж байна/);
  const st = (await (await h.req(USERS.engineer, 'POST', '/api/projects/41/drive/signing/statuses', { file_ids: [FILE_CR9] })).json()) as Statuses;
  assert.deepEqual(st.statuses[FILE_CR9]!.client, { required: true, total: 0, signed: 0, complete: false, missing_row: true });
});

test('CR: захиалагчийн мөр хоосон бол дутуу; захиалагч link-ээр зурсны дараа бүрэн батлагдсан', async () => {
  const h = await harness();
  const FILE_CR = 'fileCr0000000003';
  h.drive.files.set(FILE_CR, {
    name: 'MGL-WT-CR-003.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: await crDocx(false),
    version: 1,
  });
  const appr = await h.req(USERS.director, 'POST', `${P(FILE_CR)}/approve`, { base_modified_time: base(h, FILE_CR) });
  assert.equal(appr.status, 200, await appr.clone().text());
  const s1 = (await appr.json()) as State;
  assert.equal(s1.request?.status, 'approved');
  assert.deepEqual(s1.client_sign, { required: true, total: 1, signed: 0, complete: false, missing_row: false });

  // Захиалагч гаднын link-ээр «Захиалагчаас баталсан» мөрөнд зурсан (тэмдэг + 'external' үйл явдал).
  const { imageInfo } = await import('../lib/docxSign.ts');
  const png = await sigPng();
  const f = h.drive.files.get(FILE_CR)!;
  const mark = 'mgl-sign-client00000000001';
  const stamped = await dsf.stampDocx(f.bytes, {
    slotKey: 't0r5c5',
    image: { bytes: png, info: imageInfo(png)! },
    mark,
    descr: 'MGL ERP · Захиалагч Бат · 2026-10-19T01:00:00.000Z',
    fill: { name: 'Бат', ymd: '2026-10-19' },
  });
  assert.equal(stamped.ok, true);
  if (!stamped.ok) return;
  f.bytes = stamped.bytes;
  f.version++;
  h.db.exec(`INSERT INTO drive_doc_sign_events (file_id, root_folder_id, scope, scope_id, file_name, action, user_id, slot_key, docx_mark, result_modified_time, external_signer_name)
             VALUES ('${FILE_CR}', '${ROOT}', 'project', 41, 'MGL-WT-CR-003.docx', 'external', 11, 't0r5c5', '${mark}', '${h.drive.meta(FILE_CR).modifiedTime}', 'Бат')`);

  const s2 = (await (await h.req(USERS.pm, 'GET', P(FILE_CR))).json()) as State;
  assert.deepEqual(s2.client_sign, { required: true, total: 1, signed: 1, complete: true, missing_row: false });
  const st = (await (await h.req(USERS.engineer, 'POST', '/api/projects/41/drive/signing/statuses', { file_ids: [FILE_CR] })).json()) as Statuses;
  assert.equal(st.statuses[FILE_CR]!.request_status, 'approved');
  assert.equal(st.statuses[FILE_CR]!.client?.complete, true, 'жагсаалт ч «Батлагдсан»');
});

test('CR биш Word баримт: захирал баталмагц «Батлагдлаа» (хуучин зан төлөв)', async () => {
  const h = await harness();
  const FILE_DOC = 'fileLetter000001';
  h.drive.files.set(FILE_DOC, {
    name: 'Албан бичиг_2026-10.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: await rfiDocx(),
    version: 1,
  });
  const s0 = (await (await h.req(USERS.architect, 'GET', P(FILE_DOC))).json()) as State;
  await h.req(USERS.architect, 'POST', `${P(FILE_DOC)}/sign`, { slot_key: s0.slots[0]!.key, base_modified_time: base(h, FILE_DOC), request_approval: true });
  const s = (await (await h.req(USERS.director, 'POST', `${P(FILE_DOC)}/approve`, { base_modified_time: base(h, FILE_DOC) })).json()) as State;
  assert.deepEqual(s.client_sign, { required: false, total: 0, signed: 0, complete: true, missing_row: false });
  const n = h.db.prepare("SELECT title FROM notifications WHERE user_id = 10 AND type = 'doc_sign_decided'").get() as { title: string };
  assert.match(n.title, /^Батлагдлаа: /);
});
