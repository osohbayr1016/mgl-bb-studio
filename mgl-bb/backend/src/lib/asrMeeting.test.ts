/**
 * `lib/asrMeeting.ts` — оффис уулзалтын маягт (0367).  Цэвэр функц + миграцыг
 * `node:sqlite` дээр бодитоор ажиллуулна.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import type { D1Database } from '@cloudflare/workers-types';
import { MAX_ASR_COMPANIONS, planCompanionReplace } from './asrCompanions.ts';

// `asrCompanionStore.ts` ба `asrMeeting.ts` (→ `./mediaUrl`) нь өргөтгөлгүй импорт
// бичдэг — `asrNo.test.ts`-ийн адил hook-ийн ДАРАА динамикаар импортлоно.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const {
  MAX_MEETING_PARTICIPANTS,
  MEETING_PLACE_MAX,
  MEETING_REQUEST_MAX_ITEMS,
  hasMeetingRequests,
  meetingPatch,
  normMeetingTime,
  parseMeetingDoc,
  parseMeetingRequests,
  sanitizeMeetingDoc,
  sanitizeMeetingRequests,
  usesMeetingForm,
} = await import('./asrMeeting.ts');
const { fillMeetingTeams, listCompanionCandidates, replaceCompanions } = await import(
  './asrCompanionStore.ts'
);

/** `D1Database`-ийн хэрэглэдэг хэсэг — `asrNo.test.ts`-ийн адаптер. */
function d1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    _exec: () => db.prepare(sql).run(...(args as never[])),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: { _exec: () => unknown }[]) => {
      for (const s of list) s._exec();
      return [];
    },
  } as unknown as D1Database;
}

function staffDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, username TEXT, position TEXT,
                        profile_image TEXT, status TEXT, role TEXT);
    CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT);
    CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER);
    CREATE TABLE asr_report_companions (report_id INTEGER, user_id INTEGER, red_book_photo_url TEXT,
      red_book_verified_by INTEGER, red_book_verified_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (report_id, user_id));
    INSERT INTO teams VALUES (1, 'BA'), (2, 'BB');
    INSERT INTO users VALUES
      (1, 'Зохиогч Архитектор', 'a1', 'Архитектор', NULL, 'active', 'architect'),
      (2, 'Багийн Нөхөр', 'a2', 'Архитектор', NULL, 'active', 'architect'),
      (3, 'Өөр Баг', 'b1', 'Инженер', NULL, 'active', 'engineer'),
      (4, 'Баггүй Захирал', 'ceo', 'Захирал', NULL, 'active', 'admin'),
      (5, 'Идэвхгүй Хүн', 'x', NULL, NULL, 'inactive', 'engineer'),
      (6, 'Захиалагч', 'c', NULL, NULL, 'active', 'client');
    INSERT INTO user_teams VALUES (1, 1), (2, 1), (3, 2);
  `);
  return db;
}

test('зөвхөн оффис уулзалт уулзалтын маягттай', () => {
  assert.equal(usesMeetingForm('office'), true);
  assert.equal(usesMeetingForm('site'), false);
  assert.equal(usesMeetingForm('online'), false);
  assert.equal(usesMeetingForm('drawing_change'), false);
});

test('normMeetingTime: HH:MM, хоосон = null, буруу = false', () => {
  assert.equal(normMeetingTime('13:00'), '13:00');
  assert.equal(normMeetingTime('9:05'), '09:05');
  assert.equal(normMeetingTime(' 15:30:00 '), '15:30');
  assert.equal(normMeetingTime(''), null);
  assert.equal(normMeetingTime(null), null);
  assert.equal(normMeetingTime('24:00'), false);
  assert.equal(normMeetingTime('12:60'), false);
  assert.equal(normMeetingTime('13-00'), false);
  assert.equal(normMeetingTime(1300), false);
});

test('meetingPatch: ирээгүй талбар хөндөгдөхгүй, хоосон нь цэвэрлэнэ', () => {
  assert.deepEqual(meetingPatch({}), { ok: true, cols: [] });
  const r = meetingPatch({
    meeting_start: '13:00',
    meeting_end: '',
    meeting_place: '  MN Tower  ',
    meeting_purpose: null,
  });
  assert.deepEqual(r, {
    ok: true,
    cols: [
      ['meeting_start', '13:00'],
      ['meeting_end', null],
      ['meeting_place', 'MN Tower'],
      ['meeting_purpose', null],
    ],
  });
});

test('meetingPatch: буруу цаг / төрөл → алдаа, урт газрын нэр тайрагдана', () => {
  assert.equal(meetingPatch({ meeting_end: '25:00' }).ok, false);
  assert.equal(meetingPatch({ meeting_parties: 5 }).ok, false);
  const long = meetingPatch({ meeting_place: 'x'.repeat(MEETING_PLACE_MAX + 50) });
  assert.ok(long.ok);
  assert.equal(long.ok && long.cols[0]![1]!.length, MEETING_PLACE_MAX);
});

test('оролцогчийн хязгаар: оффис уулзалтад 40, талбайд 8', () => {
  const ids = Array.from({ length: 12 }, (_, i) => i + 2);
  assert.equal(planCompanionReplace([], ids).ok, false);
  assert.equal(planCompanionReplace([], ids, MAX_MEETING_PARTICIPANTS).ok, true);
  const tooMany = Array.from({ length: MAX_MEETING_PARTICIPANTS + 1 }, (_, i) => i + 2);
  assert.equal(planCompanionReplace([], tooMany, MAX_MEETING_PARTICIPANTS).ok, false);
});

test('оффис → талбай: 8-аас олон хадгалсан жагсаалт хэвээр үлдэнэ, гэхдээ өсгөхгүй', () => {
  const existing = Array.from({ length: 12 }, (_, i) => ({
    user_id: i + 2,
    red_book_verified_at: null,
  }));
  const same = existing.map((e) => e.user_id);
  assert.deepEqual(planCompanionReplace(existing, same, MAX_ASR_COMPANIONS), {
    ok: true,
    add: [],
    remove: [],
  });
  // Хасах нь болно, нэмэх нь (8-аас дээш хэвээр бол) үгүй.
  assert.equal(planCompanionReplace(existing, same.slice(0, 10), MAX_ASR_COMPANIONS).ok, true);
  assert.equal(planCompanionReplace(existing, [...same, 99], MAX_ASR_COMPANIONS).ok, false);
});

test('нэр дэвшигч: team = өөрийн баг, all = бүх идэвхтэй ажилтан (баггүй захирал ч)', async () => {
  const db = d1(staffDb());
  const team = (await listCompanionCandidates(db, 1)) as { id: number }[];
  assert.deepEqual(team.map((u) => u.id), [2]);
  const all = (await listCompanionCandidates(db, 1, 'all')) as { id: number; position: string }[];
  assert.deepEqual(all.map((u) => u.id).sort(), [2, 3, 4]);
  assert.equal(all.find((u) => u.id === 4)?.position, 'Захирал');
});

test('replaceCompanions: оффис уулзалтад өөр багийн хүнийг нэмнэ, талбайд 400', async () => {
  const raw = staffDb();
  const db = d1(raw);
  const site = await replaceCompanions(db, 10, 1, [3]);
  assert.equal(site.ok, false);
  assert.equal(site.ok === false && site.status, 400);
  const office = await replaceCompanions(db, 10, 1, [3, 4, 2, 1], {
    scope: 'all',
    max: MAX_MEETING_PARTICIPANTS,
  });
  assert.deepEqual(office, { ok: true });
  const rows = raw
    .prepare(`SELECT user_id FROM asr_report_companions WHERE report_id = 10 ORDER BY sort_order`)
    .all() as { user_id: number }[];
  // Зохиогч (1) хасагдана, дараалал хадгалагдана.
  assert.deepEqual(rows.map((r) => r.user_id), [3, 4, 2]);
  // Идэвхгүй / захиалагч — бүх ажилтны горимд ч хориотой.
  const bad = await replaceCompanions(db, 10, 1, [3, 4, 2, 5], { scope: 'all', max: 40 });
  assert.equal(bad.ok, false);
  const client = await replaceCompanions(db, 10, 1, [6], { scope: 'all', max: 40 });
  assert.equal(client.ok, false);
});

test('миграц 0367 — таван багана NULL-тэй нэмэгдэнэ, хуучин мөр хөндөгдөхгүй', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE author_supervision_reports (
    id INTEGER PRIMARY KEY, report_type TEXT NOT NULL DEFAULT 'site', work_report TEXT)`);
  db.exec(`INSERT INTO author_supervision_reports (id, work_report) VALUES (1, 'хуучин')`);
  const sql = readFileSync(
    new URL('../../migrations/0367_asr_office_meeting.sql', import.meta.url),
    'utf8',
  );
  db.exec(sql);
  const cols = (
    db.prepare(`PRAGMA table_info(author_supervision_reports)`).all() as { name: string }[]
  ).map((c) => c.name);
  for (const c of ['meeting_place', 'meeting_start', 'meeting_end', 'meeting_parties', 'meeting_purpose']) {
    assert.ok(cols.includes(c), c);
  }
  const row = db.prepare(`SELECT * FROM author_supervision_reports WHERE id = 1`).get() as Record<
    string,
    unknown
  >;
  assert.equal(row.work_report, 'хуучин');
  assert.equal(row.meeting_place, null);
  // D1 transport дүрэм: блок тайлбаргүй, мөр доторх `;` байхгүй, ≤ 9 statement.
  assert.ok(!sql.includes('/*'));
  const statements = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .filter((s) => s.trim());
  assert.ok(statements.length <= 9, `statements: ${statements.length}`);
});

/** Оффис уулзалтын баг — маягтад чагтгүй тул хүмүүсээс (эзэн 2026-10-08). */
function teamsDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT, sort_order INTEGER);
    CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER, is_primary INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE asr_report_companions (report_id INTEGER, user_id INTEGER, PRIMARY KEY (report_id, user_id));
    CREATE TABLE author_supervision_report_teams (report_id INTEGER NOT NULL, team_id INTEGER NOT NULL,
      work_note TEXT, sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (report_id, team_id));
    INSERT INTO teams VALUES (1, 'BA', 1), (2, 'BB', 2), (3, 'MGMT', 9), (4, 'EZ', 4);
    -- 1 = зохиогч (үндсэн MGMT, нэмэлт BA); 2 = оролцогч (үндсэн BB, нэмэлт EZ); 3 = баггүй
    INSERT INTO user_teams VALUES (1, 3, 1), (1, 1, 0), (2, 2, 1), (2, 4, 0);
    INSERT INTO asr_report_companions VALUES (10, 2), (10, 3);
  `);
  return db;
}
const teamCodes = (db: DatabaseSync, reportId: number) =>
  (
    db
      .prepare(
        `SELECT t.code FROM author_supervision_report_teams rt JOIN teams t ON t.id = rt.team_id
          WHERE rt.report_id = ? ORDER BY rt.sort_order, rt.team_id`,
      )
      .all(reportId) as { code: string }[]
  ).map((r) => r.code);

test('fillMeetingTeams: зохиогчийн баг эхэнд (үндсэн нь түрүүлж), дараа нь оролцогчдын ҮНДСЭН баг', async () => {
  const raw = teamsDb();
  const n = await fillMeetingTeams(d1(raw), 10, 1);
  assert.equal(n, 3);
  // EZ = оролцогчийн НЭМЭЛТ баг — орохгүй.
  assert.deepEqual(teamCodes(raw, 10), ['MGMT', 'BA', 'BB']);
});

test('fillMeetingTeams: баг аль хэдийн байвал юу ч өөрчлөхгүй', async () => {
  const raw = teamsDb();
  raw.exec(`INSERT INTO author_supervision_report_teams VALUES (10, 4, 'тэмдэглэл', 0)`);
  assert.equal(await fillMeetingTeams(d1(raw), 10, 1), 0);
  assert.deepEqual(teamCodes(raw, 10), ['EZ']);
});

test('fillMeetingTeams: хэн нь ч багт байхгүй бол хоосон хэвээр (баггүй илгээнэ)', async () => {
  const raw = teamsDb();
  raw.exec(`DELETE FROM asr_report_companions WHERE user_id = 2`);
  assert.equal(await fillMeetingTeams(d1(raw), 10, 3), 0);
  assert.deepEqual(teamCodes(raw, 10), []);
});

/* ------------------------------------------------------------------ */
/*  0396 — хүсэлтийн хүснэгтүүд                                         */
/* ------------------------------------------------------------------ */

test('sanitizeMeetingRequests: хоосон = NULL, хоосон мөр хадгалагдана, буруу хэлбэр 400', () => {
  assert.deepEqual(sanitizeMeetingRequests(null), { ok: true, json: null });
  // Хоосон хүснэгт ч хадгалагдана — анхны мөрөө устгасныг санана.
  const empty = sanitizeMeetingRequests({});
  assert.equal(empty.ok, true);
  assert.deepEqual(JSON.parse((empty as { json: string }).json), {
    client: { intro: '', items: [] },
    contractor: { intro: '', items: [] },
  });
  const r = sanitizeMeetingRequests({ client: { intro: 'Оршил', items: ['A', ''] } });
  assert.equal(r.ok, true);
  const parsed = JSON.parse((r as { json: string }).json);
  // Хуучин бичвэр мөр `{text, images: []}` болж уншигдана.
  assert.deepEqual(parsed.client, {
    intro: 'Оршил',
    items: [
      { text: 'A', images: [] },
      { text: '', images: [] },
    ],
  });
  assert.deepEqual(parsed.contractor, { intro: '', items: [] });

  for (const bad of [
    'x',
    [],
    { client: [] },
    { client: { items: 'A' } },
    { client: { items: [1] } },
    { client: { items: [{ text: 'A', images: ['https://evil/x.png'] }] } },
    { client: { items: [{ text: 'A', images: ['/media/a%2Fb.png'] }] } },
  ]) {
    assert.equal(sanitizeMeetingRequests(bad).ok, false, JSON.stringify(bad));
  }
  const many = Array.from({ length: MEETING_REQUEST_MAX_ITEMS + 1 }, () => 'x');
  assert.equal(sanitizeMeetingRequests({ contractor: { items: many } }).ok, false);
});

test('parse / hasMeetingRequests: эвдэрсэн JSON = хоосон, зөвхөн хоосон мөр = биет биш', () => {
  assert.deepEqual(parseMeetingRequests('{bad'), {
    client: { intro: '', items: [] },
    contractor: { intro: '', items: [] },
  });
  assert.equal(hasMeetingRequests(null), false);
  assert.equal(hasMeetingRequests(JSON.stringify({ client: { intro: '', items: ['  '] } })), false);
  assert.equal(hasMeetingRequests(JSON.stringify({ contractor: { intro: '', items: ['157 зогсоол'] } })), true);
  assert.equal(hasMeetingRequests(JSON.stringify({ client: { intro: 'Хэлэлцэв', items: [] } })), true);
  // Зөвхөн зурагтай мөр ч биет.
  assert.equal(
    hasMeetingRequests(
      JSON.stringify({ client: { intro: '', items: [{ text: '', images: ['/media/1-a.png'] }] } }),
    ),
    true,
  );
});

test('миграц 0396 — meeting_requests_json NULL-тэй нэмэгдэнэ', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE author_supervision_reports (id INTEGER PRIMARY KEY, status TEXT)');
  db.exec(`INSERT INTO author_supervision_reports (id, status) VALUES (1, 'draft')`);
  db.exec(readFileSync(new URL('../../migrations/0396_asr_meeting_requests.sql', import.meta.url), 'utf8'));
  const row = db.prepare('SELECT meeting_requests_json FROM author_supervision_reports WHERE id = 1').get() as {
    meeting_requests_json: string | null;
  };
  assert.equal(row.meeting_requests_json, null);
});

test('sanitizeMeetingDoc: засварласан мөр user_id-аар, хоосон = NULL, буруу түлхүүр 400', () => {
  assert.deepEqual(sanitizeMeetingDoc(null), { ok: true, json: null });
  assert.deepEqual(sanitizeMeetingDoc({ party_lines: {}, client_org: ' ' }), { ok: true, json: null });
  const r = sanitizeMeetingDoc({
    party_lines: { '12': 'X ХХК-ийн Захирал Б.Бат' },
    client_org: 'Жинди Хуарун ХХК',
    client_position: 'Төслийн менежер',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(parseMeetingDoc((r as { json: string }).json), {
    party_lines: { '12': 'X ХХК-ийн Захирал Б.Бат' },
    client_org: 'Жинди Хуарун ХХК',
    client_position: 'Төслийн менежер',
    note_images: [],
  });
  assert.equal(sanitizeMeetingDoc({ note_images: ['/media/1-a.png'] }).ok, true);
  assert.equal(sanitizeMeetingDoc({ note_images: ['javascript:x'] }).ok, false);
  for (const bad of ['x', { party_lines: [] }, { party_lines: { abc: 'x' } }, { party_lines: { '1': 2 } }, { client_org: 5 }]) {
    assert.equal(sanitizeMeetingDoc(bad).ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(parseMeetingDoc('{bad'), {
    party_lines: {},
    client_org: '',
    client_position: '',
    note_images: [],
  });
});
