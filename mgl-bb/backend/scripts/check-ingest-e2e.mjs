#!/usr/bin/env node
/**
 * check-ingest-e2e.mjs — BIM-AI-ийн ЦУГЛУУЛГЫН ЗАМЫГ ЭХНЭЭС ЭЦЭС ХҮРТЭЛ
 * ЛОКАЛД БАТАЛГААЖУУЛАХ ХААЛГА.  `POST /api/learning/events` → D1.
 *
 * ⚠️ ЯАГААД ЭНЭ СКРИПТ ХЭРЭГТЭЙ ВЭ.  `src/lib/bimEvents.test.ts` нь ЦЭВЭР
 *    туслахуудыг л шалгадаг (маск, bind тоо, чанклалт).  Тэдгээр бүгд
 *    ногоон байхад ч МӨР ОГТ БУУХГҮЙ байж болно: маршрутын валидац,
 *    D1-ийн CHECK/UNIQUE, дэд асуулгын дараалал, GENERATED багана,
 *    `db.batch()` унаж мөр тус бүр рүү шилжих fallback — эдгээрийн аль нь
 *    ч unit тестээр баригдахгүй.  ~20 ажлын байрны цуглуулга ЭДГЭЭР
 *    давхаргаас хамаарна.
 *
 * ⚠️ АЧААЛАЛ НЬ `BimEmitter.BuildBody`-ЫН ТОЛЬ.  Талбарууд нь
 *    `revit-mcp/addin/BimEmitter.cs`-ийн `BuildBody` / `TxnEnvelope` /
 *    `EventEnvelope`-оос ЯГ хуулагдсан — тохиромжтой хэлбэр ЗОХИОХГҮЙ.
 *    Add-in шинэ талбар илгээж эхэлбэл ЭНД ч нэм.
 *
 * ⚠️ ЗӨВХӨН ЛОКАЛ.  `--base` нь loopback байх ЁСТОЙ; эс бөгөөс скрипт
 *    татгалзана.  Продакшн руу ХЭЗЭЭ Ч бичихгүй.
 *
 * Хэрэглээ (backend/-ээс):
 *   npm run dev                        # өөр терминалд, :3000
 *   node scripts/check-ingest-e2e.mjs  # → PASS/FAIL мөрүүд, exit 0/1
 *
 * Тохируулга: `--base=http://127.0.0.1:3000` эсвэл `BIM_E2E_BASE`.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = path.join(backendDir, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');

const argBase = process.argv.find((a) => a.startsWith('--base='));
const BASE = (argBase ? argBase.slice(7) : process.env.BIM_E2E_BASE) || 'http://127.0.0.1:3000';
{
  const h = new URL(BASE).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(h)) {
    console.error(`x ЗӨВХӨН ЛОКАЛ: --base нь loopback байх ёстой (одоо ${h})`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ */
/*  Туслахууд                                                          */
/* ------------------------------------------------------------------ */

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, evidence) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${evidence ? `  — ${evidence}` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${evidence ? `  — ${evidence}` : ''}`);
  }
}

function section(title) {
  console.log(`\n-- ${title} ${'-'.repeat(Math.max(0, 62 - title.length))}`);
}

/** `.dev.vars`-аас түлхүүр уншина (хашилттай ч, хашилтгүй ч). */
function devVar(key) {
  const file = path.join(backendDir, '.dev.vars');
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Локал JWT.  ⚠️ `.dev.vars`-ийн `JWT_SECRET`-ээр — продакшны нууцтай ЯМАР Ч
 * холбоогүй.  `DEV_AUTH_BYPASS` нь `DEV_AUTH_USER` (өгөгдмөл `admin`)
 * хэрэглэгч ЛОКАЛ DB-д БАЙХГҮЙ үед үхмэл тул түүнд түшиглэхгүй.
 */
function mintToken(secret, sub, role) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ sub, role, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64url(sig)}`;
}

async function post(token, body) {
  const res = await fetch(`${BASE}/api/learning/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* JSON биш — статус л чухал */
  }
  return { status: res.status, json };
}

/** Миграц бүрэн хийгдсэн локал sqlite файлууд. */
function migratedDbFiles() {
  if (!fs.existsSync(stateDir)) return [];
  const out = [];
  for (const n of fs.readdirSync(stateDir)) {
    if (!n.endsWith('.sqlite') || n === 'metadata.sqlite') continue;
    const p = path.join(stateDir, n);
    try {
      const db = new DatabaseSync(p, { readOnly: true });
      const ok = db
        .prepare(
          "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('learning_events','bim_sessions')",
        )
        .get().n;
      db.close();
      if (ok === 2) out.push(p);
    } catch {
      /* энэ файлд хүснэгт байхгүй */
    }
  }
  return out;
}

/**
 * ⚠️ ИДЭВХТЭЙ sqlite ФАЙЛЫГ АГУУЛГААР НЬ ОЛНО, нэрээр нь БИШ.  miniflare
 *    файлыг `database_id`-ээс гаргасан hash-аар нэрлэдэг бөгөөд хуучин
 *    репликүүд хажууд нь үлддэг (`bootstrap-local-db.mjs` нь `sort()[0]`
 *    авдаг — тэр нь ХООСОН файл байж болно).  Бидний дөнгөж бичсэн
 *    `session_uid` агуулсан файл нь ЦОРЫН ГАНЦ хоёрдмол утгагүй хариулт.
 */
function findDbBySession(sessionUid) {
  for (const p of migratedDbFiles()) {
    try {
      const db = new DatabaseSync(p, { readOnly: true });
      const row = db.prepare('SELECT id FROM bim_sessions WHERE session_uid = ?').get(sessionUid);
      db.close();
      if (row) return p;
    } catch {
      /* дараагийнх */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  АЧААЛАЛ — `BimEmitter.BuildBody`-ЫН ТОЛЬ                           */
/* ------------------------------------------------------------------ */

const RUN = crypto.randomBytes(6).toString('hex');
const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, '.000Z');
const T0 = Date.now() - 60_000;

/** `BuildBody`-ийн `session` объект.  Талбарын нэр, дараалал add-in-тэй ижил. */
function sessionEnvelope(uid, over = {}) {
  return {
    session_uid: uid,
    started_at: iso(T0),
    client_now: iso(Date.now()),
    doc_uid: `doc-${RUN}`,
    doc_title: 'E2E turshilt.rvt',
    is_link: false,
    central_path_hash: crypto.createHash('sha256').update(`central-${RUN}`).digest('hex'),
    machine_hash: crypto.createHash('sha256').update(`machine-${RUN}`).digest('hex'),
    worksharing: 'none',
    revit_version: '2027',
    revit_build: '20260101_1515',
    addin_version: '1.2.1',
    addin_channel: 'prod',
    capture_schema: 1,
    client_tz_offset_min: 480,
    dropped_count: 0,
    ...over,
  };
}

/** `TxnEnvelope`-ийн `b` объект (touches-гүй) — `BuildBody` ингэж хуваадаг. */
function txn(uid, seq, over = {}) {
  return {
    txn_uid: `${uid}:${seq}`,
    seq,
    occurred_at: iso(T0 + seq * 1000),
    op_name: 'Хана байрлуулах',
    op_class: 'edit',
    added_count: 2,
    deleted_count: 0,
    modified_count: 1,
    origin: 'human',
    ...over,
  };
}

/**
 * `TxnEnvelope`-ийн `touches[]` мөр.  ⚠️ `category` ОРООГҮЙ нь ЗӨВ —
 * add-in халуун замд `doc.GetElement(id).Category`-ыг дуудахыг
 * `ChangeTracker`-ийн гэрээ хориглодог.  Үр дагавар нь ХЭМЖИГДСЭН:
 * гүйлгээний `ELEMENT_ATTRS` бит унтарч `parts_missing > 0` болно.
 */
function touch(uid, seq, elementId, change) {
  return { txn_uid: `${uid}:${seq}`, element_id: elementId, change };
}

/** `EventEnvelope`-ийн `b` объект. */
function evt(uid, seq, kind, suffix, over = {}) {
  return {
    event_uid: `${uid}:${suffix}`,
    stream_id: uid,
    seq,
    kind,
    actor_kind: 'system',
    occurred_at: iso(T0 + seq * 1000),
    doc_uid: `doc-${RUN}`,
    provenance: 'MACHINE_GENERATED',
    payload: { revit_version: '2027', addin_version: '1.2.1', is_link: false },
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/*  ГҮЙЛТ                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const secret = devVar('JWT_SECRET');
  if (!secret) {
    console.error('x backend/.dev.vars дотор JWT_SECRET олдсонгүй');
    process.exit(1);
  }

  const files = migratedDbFiles();
  if (files.length === 0) {
    console.error('x Миграц бүрэн хийгдсэн локал D1 олдсонгүй — эхлээд миграцаа гүйцээ');
    process.exit(1);
  }
  let userId = null;
  let userRole = null;
  for (const p of files) {
    const db = new DatabaseSync(p, { readOnly: true });
    const row = db
      .prepare(
        `SELECT id, role FROM users
          WHERE status = 'active' AND role IN ('engineer','architect','senior','admin')
          ORDER BY id LIMIT 1`,
      )
      .get();
    db.close();
    if (row) {
      userId = row.id;
      userRole = row.role;
      break;
    }
  }
  if (!userId) {
    console.error('x Локал DB-д LEARNING_ROLES-ийн идэвхтэй хэрэглэгч алга');
    process.exit(1);
  }
  const token = mintToken(secret, userId, userRole);
  console.log(`base=${BASE}  user=${userId} (${userRole})  run=${RUN}`);

  /* ================================================================ */
  section('1) БАЙРШУУЛАЛТЫН ЗАМ — сесс + гүйлгээ + элемент + үйл явдал');
  /* ================================================================ */

  const S = `e2e-${RUN}`;
  const happy = {
    session: sessionEnvelope(S),
    transactions: [txn(S, 1), txn(S, 2)],
    touches: [
      touch(S, 1, 101, 'add'),
      touch(S, 1, 102, 'add'),
      touch(S, 1, 103, 'modify'),
      touch(S, 2, 201, 'add'),
      touch(S, 2, 202, 'add'),
      touch(S, 2, 203, 'modify'),
    ],
    events: [evt(S, 0, 'SESSION_START', 'start'), evt(S, 1, 'USER_ACTION', 'act')],
  };
  const r1 = await post(token, happy);
  check('POST /api/learning/events -> 200', r1.status === 200, `status=${r1.status}`);
  if (r1.status !== 200) {
    console.error(JSON.stringify(r1.json, null, 2));
    process.exit(1);
  }
  check(
    'сесс үүсэв',
    r1.json.session_id !== null && r1.json.session_created === true,
    `session_id=${r1.json.session_id} created=${r1.json.session_created}`,
  );
  check(
    'accepted = илгээсэн бүх мөр',
    r1.json.accepted.txns === 2 && r1.json.accepted.touches === 6 && r1.json.accepted.events === 2,
    JSON.stringify(r1.json.accepted),
  );
  check(
    'rejected = 0',
    JSON.stringify(r1.json.rejected) === '{"txns":0,"touches":0,"events":0}',
    JSON.stringify(r1.json.rejected),
  );
  check('degraded = false (багц нэг дор орсон)', r1.json.degraded === false);

  const dbFile = findDbBySession(S);
  check(
    'идэвхтэй локал sqlite олдов (мөр ҮНЭХЭЭР буув)',
    dbFile !== null,
    dbFile ? path.basename(dbFile) : 'олдсонгүй',
  );
  if (!dbFile) return report();
  const db = new DatabaseSync(dbFile);

  const ses = db.prepare('SELECT * FROM bim_sessions WHERE session_uid = ?').get(S);
  const nTxn = db
    .prepare('SELECT COUNT(*) n FROM revit_transactions WHERE session_id = ?')
    .get(ses.id).n;
  const nTouch = db
    .prepare('SELECT COUNT(*) n FROM revit_element_touches WHERE session_id = ?')
    .get(ses.id).n;
  const nEvt = db
    .prepare('SELECT COUNT(*) n FROM learning_events WHERE session_id = ?')
    .get(ses.id).n;
  check('revit_transactions = 2', nTxn === 2, `n=${nTxn}`);
  check('revit_element_touches = 6', nTouch === 6, `n=${nTouch}`);
  check('learning_events = 2', nEvt === 2, `n=${nEvt}`);
  check('user_id нь ТОКЕНООС (клиентээс биш)', ses.user_id === userId, `user_id=${ses.user_id}`);
  check('company_id тамгалагдсан', ses.company_id === 'default', `company_id=${ses.company_id}`);
  check(
    'capture_policy серверээс',
    ses.capture_policy === 'full',
    `capture_policy=${ses.capture_policy}`,
  );
  check(
    'perf_json NULL (ХЭМЖЭЭГҮЙ != хоосон объект)',
    ses.perf_json === null,
    `perf_json=${ses.perf_json}`,
  );
  check(
    'txn_count/event_count тоолуур ахив',
    ses.txn_count === 2 && ses.event_count === 2,
    `txn_count=${ses.txn_count} event_count=${ses.event_count}`,
  );

  const touchParent = db
    .prepare(
      `SELECT COUNT(*) n FROM revit_element_touches t
         JOIN revit_transactions x ON x.id = t.txn_id WHERE t.session_id = ?`,
    )
    .get(ses.id).n;
  check(
    'элемент мөр бүр эцэг гүйлгээтэй (дэд асуулга шийдэгдэв)',
    touchParent === 6,
    `n=${touchParent}`,
  );

  /* ================================================================ */
  section('2) parts_missing — DATASET_ELIGIBLE_SQL (bimEvents.ts)');
  /* ================================================================ */

  // ⚠️ `DATASET_ELIGIBLE_SQL`-ийг ЭНД САЛААЛУУЛАХГҮЙ: эх кодоос уншиж
  //    тулгана, дараа нь ЯГ ТЭР мөрөөр асуулга явуулна.
  const src = fs.readFileSync(path.join(backendDir, 'src/lib/bimEvents.ts'), 'utf8');
  const m = src.match(/DATASET_ELIGIBLE_SQL\s*=\s*'([^']+)'/);
  check('DATASET_ELIGIBLE_SQL эх кодод байна', !!m, m ? `"${m[1]}"` : 'олдсонгүй');
  const ELIGIBLE = m ? m[1] : 'parts_missing = 0';

  const evtEligible = db
    .prepare(`SELECT COUNT(*) n FROM learning_events WHERE session_id = ? AND ${ELIGIBLE}`)
    .get(ses.id).n;
  check(
    'SESSION_START + USER_ACTION хоёул сургалтад ЭРХТЭЙ',
    evtEligible === 2,
    `${evtEligible}/2 мөр ${ELIGIBLE}`,
  );

  const txnRows = db
    .prepare(
      'SELECT txn_uid, parts_expected, parts_present, parts_missing FROM revit_transactions WHERE session_id = ? ORDER BY seq',
    )
    .all(ses.id);
  // ELEMENT_ROWS(1) ирсэн; ELEMENT_ATTRS(4) нь `category` байхгүй тул ДУТУУ —
  // add-in-ий МЭДЭГДСЭН хязгаар (BimEmitter.cs / TxnEnvelope-ийн тайлбар).
  check(
    'category-гүй гүйлгээ parts_missing = ELEMENT_ATTRS(4) — ИЛ, чимээгүй биш',
    txnRows.every((r) => r.parts_missing === 4 && r.parts_present === 1),
    txnRows
      .map((r) => `${r.txn_uid}: exp=${r.parts_expected} pres=${r.parts_present} miss=${r.parts_missing}`)
      .join(' | '),
  );

  /* ================================================================ */
  section('3) 0219 — GENERATED VIRTUAL багийн багана + stampTeam');
  /* ================================================================ */

  const teamRows = db
    .prepare(
      'SELECT event_uid, team_code, team_source, payload_json FROM learning_events WHERE session_id = ?',
    )
    .all(ses.id);
  check(
    'мөр бүр team_source-той (§72 — шошгогүй мөр байхгүй)',
    teamRows.length > 0 && teamRows.every((r) => r.team_source !== null),
    teamRows.map((r) => `${r.event_uid}: code=${r.team_code} src=${r.team_source}`).join(' | '),
  );
  check(
    'payload_json дотор stampTeam-ийн 4 түлхүүр',
    teamRows.every((r) => {
      const p = JSON.parse(r.payload_json);
      return (
        'team_code' in p && 'team_source' in p && 'team_confidence' in p && 'attribution_id' in p
      );
    }),
    Object.keys(JSON.parse(teamRows[0].payload_json)).join(','),
  );
  check(
    'GENERATED багана payload-той таарна (JOIN-гүй)',
    teamRows.every((r) => r.team_source === JSON.parse(r.payload_json).team_source),
  );

  /* ================================================================ */
  section('4) bind арифметик — EVENT_BINDS 23 / statement тутам 4 мөр');
  /* ================================================================ */

  const cols = src.match(/EVENT_INSERT_COLUMNS = \[([\s\S]*?)\] as const;/);
  const nCols = cols ? (cols[1].match(/'/g) || []).length / 2 : -1;
  check('EVENT_BINDS = 23', nCols === 23, `EVENT_INSERT_COLUMNS.length=${nCols}`);
  check(
    'EVENT_ROWS_PER_STATEMENT = 4',
    Math.floor(100 / (nCols + 1)) === 4,
    `floor(100/${nCols + 1})=${Math.floor(100 / (nCols + 1))}`,
  );
  const tup = src.match(/EVENT_VALUES_TUPLE\s*=\s*([\s\S]*?)';\r?\n/);
  const nQ = tup ? (tup[1].match(/\?/g) || []).length : -1;
  check('EVENT_VALUES_TUPLE-ийн `?` тоо = EVENT_BINDS', nQ === nCols, `? = ${nQ}`);

  /* ================================================================ */
  section('5) ДАВХАРДАЛ — яг ижил багцыг дахин илгээв (idempotency)');
  /* ================================================================ */

  const r2 = await post(token, happy);
  check('дахин илгээлт -> 200', r2.status === 200, `status=${r2.status}`);
  check(
    'accepted = 0 (юу ч давхардаагүй)',
    r2.json.accepted.txns === 0 && r2.json.accepted.touches === 0 && r2.json.accepted.events === 0,
    JSON.stringify(r2.json.accepted),
  );
  check(
    'duplicates = илгээсэн бүх мөр',
    r2.json.duplicates.txns === 2 &&
      r2.json.duplicates.touches === 6 &&
      r2.json.duplicates.events === 2,
    JSON.stringify(r2.json.duplicates),
  );
  check('session_created = false', r2.json.session_created === false);
  const after = {
    t: db.prepare('SELECT COUNT(*) n FROM revit_transactions WHERE session_id = ?').get(ses.id).n,
    u: db.prepare('SELECT COUNT(*) n FROM revit_element_touches WHERE session_id = ?').get(ses.id)
      .n,
    e: db.prepare('SELECT COUNT(*) n FROM learning_events WHERE session_id = ?').get(ses.id).n,
  };
  check('DB-д шинэ мөр ОРООГҮЙ', after.t === 2 && after.u === 6 && after.e === 2, JSON.stringify(after));

  /* ================================================================ */
  section('6) ХЭТ ТОМ БАГЦ — 413, мөр ОГТ бичихгүй');
  /* ================================================================ */

  const S2 = `e2e-big-${RUN}`;
  const rBig = await post(token, {
    session: sessionEnvelope(S2),
    transactions: Array.from({ length: 201 }, (_, i) => txn(S2, i + 1)),
    touches: [],
    events: [],
  });
  check(
    '201 гүйлгээ -> 413',
    rBig.status === 413,
    `status=${rBig.status} body=${JSON.stringify(rBig.json)}`,
  );
  const bigSes = db.prepare('SELECT id FROM bim_sessions WHERE session_uid = ?').get(S2);
  check('413 үед сесс ч үүсээгүй (эрт таслалт)', !bigSes, bigSes ? `id=${bigSes.id}` : 'мөр алга');

  const S3 = `e2e-bigt-${RUN}`;
  const rBigT = await post(token, {
    session: sessionEnvelope(S3),
    transactions: [txn(S3, 1)],
    touches: Array.from({ length: 2001 }, (_, i) => touch(S3, 1, i + 1, 'add')),
    events: [],
  });
  check('2001 элемент мөр -> 413', rBigT.status === 413, `status=${rBigT.status}`);

  /* ================================================================ */
  section('7) НЭГ МУУ МӨР — сайн мөрүүд АЛДАГДАХГҮЙ');
  /* ================================================================ */

  // (a) ХЭЛБЭРИЙН алдаа: occurred_at хүчингүй, kind танихгүй, seq сөрөг.
  const S4 = `e2e-mix-${RUN}`;
  const r4 = await post(token, {
    session: sessionEnvelope(S4),
    transactions: [
      txn(S4, 1),
      txn(S4, 2, { occurred_at: 'ЭНЭ-БОЛ-ОГНОО-БИШ' }), // <- татгалзана
      txn(S4, 3, { seq: -5 }), //                          <- татгалзана
      txn(S4, 4),
    ],
    touches: [
      touch(S4, 1, 11, 'add'),
      touch(S4, 1, 12, 'ТАНИХГҮЙ'), //                     <- татгалзана
      touch(S4, 4, 41, 'modify'),
    ],
    events: [
      evt(S4, 0, 'SESSION_START', 'start'),
      evt(S4, 1, 'ЖИНХЭНЭ-БИШ-ТӨРӨЛ', 'bad'), //           <- татгалзана
      evt(S4, 2, 'USER_ACTION', 'ok'),
    ],
  });
  check('холимог багц -> 200 (400 БИШ)', r4.status === 200, `status=${r4.status}`);
  check('сайн гүйлгээ 2 орсон', r4.json.accepted.txns === 2, JSON.stringify(r4.json.accepted));
  check('муу гүйлгээ 2 татгалзсан', r4.json.rejected.txns === 2, JSON.stringify(r4.json.rejected));
  check('сайн үйл явдал 2 орсон', r4.json.accepted.events === 2);
  check('муу үйл явдал 1 татгалзсан', r4.json.rejected.events === 1);
  check(
    'сайн элемент мөр 2 орсон',
    r4.json.accepted.touches === 2,
    `accepted.touches=${r4.json.accepted.touches}`,
  );

  // (b) DB-ийн UNIQUE зөрчил: ижил `seq`, ӨӨР `txn_uid` →
  //     `UNIQUE(session_id, seq)` унана.  ⚠️ ЭНЭ НЬ 0203-ын ЗААВАЛ
  //     БИЕЛҮҮЛЭХ FALLBACK-ийн цорын ганц бодит шалгуур: багц бүхэлдээ
  //     унаж, мөр тус бүрээр дахин орох ЁСТОЙ.
  const S5 = `e2e-fb-${RUN}`;
  await post(token, {
    session: sessionEnvelope(S5),
    transactions: [txn(S5, 1)],
    touches: [],
    events: [],
  });
  const r5 = await post(token, {
    session: sessionEnvelope(S5),
    transactions: [
      txn(S5, 2, { txn_uid: `${S5}:2a` }),
      txn(S5, 1, { txn_uid: `${S5}:1-COLLIDE` }), // seq=1 аль хэдийн эзэмшигдсэн
      txn(S5, 3, { txn_uid: `${S5}:3a` }),
    ],
    touches: [],
    events: [],
  });
  check('seq мөргөлдөөнтэй багц -> 200', r5.status === 200, `status=${r5.status}`);
  check(
    'degraded = true (мөр тус бүрийн fallback ажиллав)',
    r5.json.degraded === true,
    `degraded=${r5.json.degraded}`,
  );
  check(
    'мөргөлдөөнгүй 2 гүйлгээ АВРАГДСАН',
    r5.json.accepted.txns === 2,
    JSON.stringify(r5.json.accepted),
  );
  check('мөргөлдсөн 1 гүйлгээ dropped', r5.json.dropped.txns === 1, JSON.stringify(r5.json.dropped));
  const fbSes = db
    .prepare('SELECT id, dropped_count FROM bim_sessions WHERE session_uid = ?')
    .get(S5);
  const fbN = db
    .prepare('SELECT COUNT(*) n FROM revit_transactions WHERE session_id = ?')
    .get(fbSes.id).n;
  check('DB-д 3 гүйлгээ (1 + аврагдсан 2)', fbN === 3, `n=${fbN}`);
  check('dropped_count-д тэмдэглэгдсэн', fbSes.dropped_count >= 1, `dropped_count=${fbSes.dropped_count}`);

  // (в) ЭЗЭНГҮЙ ЭЛЕМЕНТИЙН МӨР — хаягдана, гэхдээ ЧИМЭЭГҮЙ БИШ.
  //     Хоёр зам: эцэг нь ХЭЛБЭРИЙН алдаагаар татгалзсан, ба эцэг нь энэ
  //     POST-д ОГТ байхгүй.  Хоёулаа `rejected.touches` дээр гарах ЁСТОЙ —
  //     тоолуургүй алдагдал нь `bim_sessions.dropped_count`-ыг худал болгоно.
  const S7 = `e2e-orph-${RUN}`;
  const r7 = await post(token, {
    session: sessionEnvelope(S7),
    transactions: [txn(S7, 1), txn(S7, 2, { occurred_at: 'ОГНОО-БИШ' })],
    touches: [touch(S7, 1, 1, 'add'), touch(S7, 2, 2, 'add'), touch(S7, 2, 3, 'add')],
    events: [],
  });
  check(
    'татгалзсан эцгийн элемент мөрүүд ТООЛОГДСОН',
    r7.json.accepted.touches === 1 && r7.json.rejected.touches === 2,
    `accepted=${r7.json.accepted.touches} rejected=${r7.json.rejected.touches}`,
  );

  const S8 = `e2e-orph2-${RUN}`;
  const r8 = await post(token, {
    session: sessionEnvelope(S8),
    transactions: [],
    touches: [touch(S8, 9, 1, 'add'), touch(S8, 9, 2, 'add')],
    events: [],
  });
  check(
    'энэ POST-д эцэггүй элемент мөрүүд ТООЛОГДСОН',
    r8.json.accepted.touches === 0 && r8.json.rejected.touches === 2,
    `accepted=${r8.json.accepted.touches} rejected=${r8.json.rejected.touches}`,
  );
  const orphSes = db
    .prepare('SELECT dropped_count FROM bim_sessions WHERE session_uid = ?')
    .get(S8);
  check(
    'алдагдал нь dropped_count-д хүрэв',
    orphSes && orphSes.dropped_count === 2,
    `dropped_count=${orphSes && orphSes.dropped_count}`,
  );

  /* ================================================================ */
  section('7в) КЛИЕНТ ЭРХЭЭ ӨӨРӨӨ ӨСГӨЖ ЧАДАХГҮЙ');
  /* ================================================================ */

  const S9 = `e2e-spoof-${RUN}`;
  await post(token, {
    session: sessionEnvelope(S9),
    transactions: [],
    touches: [],
    events: [
      evt(S9, 0, 'TEXT', 'spoof', {
        provenance: 'HUMAN_VERIFIED', //           <- дээшлүүлэх оролдлого
        payload: { team_code: 'ХУУРАМЧ', team_source: 'manual' },
      }),
    ],
  });
  const spoof = db
    .prepare('SELECT provenance, team_code, team_source FROM learning_events WHERE event_uid = ?')
    .get(`${S9}:spoof`);
  check(
    'provenance дээшлүүлэх оролдлого UNVERIFIED болов',
    spoof && spoof.provenance === 'UNVERIFIED',
    `provenance=${spoof && spoof.provenance}`,
  );
  check(
    'клиентийн зарласан team_source дарагдав (сервер сүүлд бичнэ)',
    spoof && spoof.team_source !== 'manual' && spoof.team_code !== 'ХУУРАМЧ',
    `team_code=${spoof && spoof.team_code} team_source=${spoof && spoof.team_source}`,
  );

  /* ================================================================ */
  section('8) ГАРЛЫН ТАЛБАР — бичигдсэний дараа ХӨДӨЛӨХГҮЙ (0202-ын толгой)');
  /* ================================================================ */

  const S6 = `e2e-prov-${RUN}`;
  await post(token, {
    session: sessionEnvelope(S6, {
      revit_version: '2027',
      addin_version: '1.2.1',
      model_version: 'model-v1',
      ruleset_version: 'rules-v1',
      prompt_version: 'prompt-v1',
    }),
    transactions: [],
    touches: [],
    events: [],
  });
  const before = db.prepare('SELECT * FROM bim_sessions WHERE session_uid = ?').get(S6);
  await post(token, {
    session: sessionEnvelope(S6, {
      revit_version: '2020',
      addin_version: '9.9.9',
      model_version: 'model-XXX',
      ruleset_version: 'rules-XXX',
      prompt_version: 'prompt-XXX',
      ended_at: iso(Date.now()),
    }),
    transactions: [],
    touches: [],
    events: [],
  });
  const afterS = db.prepare('SELECT * FROM bim_sessions WHERE session_uid = ?').get(S6);
  for (const col of [
    'revit_version',
    'addin_version',
    'model_version',
    'ruleset_version',
    'prompt_version',
  ]) {
    check(`${col} дарж бичигдээгүй`, afterS[col] === before[col], `${before[col]} -> ${afterS[col]}`);
  }
  check(
    'ended_at нь ХАРИН шинэчлэгдэнэ (хувьсдаг талбар)',
    afterS.ended_at !== null,
    `ended_at=${afterS.ended_at}`,
  );
  check('started_at хөдлөөгүй', afterS.started_at === before.started_at);

  db.close();
  report();
}

function report() {
  console.log(`\n${'='.repeat(66)}`);
  console.log(`  ${pass} PASS - ${fail} FAIL`);
  if (fail) console.log(`  Унасан: ${failures.join(' | ')}`);
  console.log(`${'='.repeat(66)}\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('\nx Скрипт өөрөө унав:', e);
  process.exit(1);
});
