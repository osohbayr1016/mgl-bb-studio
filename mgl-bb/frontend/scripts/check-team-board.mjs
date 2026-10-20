/**
 * Багийн хуудас · «нэг дэлгэцийн самбар»-ын загварын дүрмийн шалгалт.
 *
 *   node scripts/check-team-board.mjs        (frontend/ хавтаснаас)
 *
 * `src/features/teams/lib/teamBoard.ts` — хэн аль төсөл дээр ажиллаж байна,
 * хөдөлгөөнгүй төсөл, гишүүдийн жагсаалт.  Frontend-д vitest байхгүй тул бусад
 * `check-*.mjs`-ийн адил node-оор.
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'teams', 'lib');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : LIB;
      if (existsSync(join(base, `${specifier}.ts`))) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(`${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { buildTeamBoard, daysUntil } = await import(pathToFileURL(join(LIB, 'teamBoard.ts')).href);
const { indexDayWork } = await import(pathToFileURL(join(LIB, 'currentWork.ts')).href);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const member = (id, name, active = []) => ({
  id, username: `u${id}`, full_name: name, role: 'engineer', status: 'active', position: null,
  employee_id: null, profile_image: null, task_count: 0, completed_count: 0, avg_progress: 0,
  active_today: active,
});
const project = (id, name, over = {}) => ({
  id, name, description: null, status: 'active', category: 'AZ', complexity_pct: 50,
  task_count: 10, completed_count: 4, in_progress_count: 3, overdue_count: 0, avg_progress: 40,
  next_due: null, active_today_count: 0, active_today_members: [], ...over,
});
const pick = (id, name, kind = 'project') => ({ project_id: id, project_name: name, kind });

const A = member(1, 'Бат Ангар', [pick(10, 'Alpha')]);
const B = member(2, 'Дорж Баатар', [pick(10, 'Alpha'), pick(20, 'Beta')]);
const C = member(3, 'Сүх Цэцэг'); // юу ч сонгоогүй
const D = member(4, 'Гэрэл Аюур'); // төслийн бус ажил
const E = member(5, 'Эрдэнэ Бумаа', [pick(-3, 'Дотоод засвар', 'repair')]);
const members = [C, A, B, D, E];

const projects = [
  project(10, 'Alpha'),
  project(20, 'Beta'),
  project(30, 'Gamma', { overdue_count: 2 }),
  project(40, 'Delta', { overdue_count: 5 }),
  project(50, 'Old', { status: 'archived' }),
];
const dayWork = indexDayWork({
  date: '2026-09-30',
  non_project: [
    { id: 1, user_id: 4, category: 'other', category_label: 'Бусад', note: 'Уулзалт', start_time: '10:00', end_time: '11:00', minutes: 60, now: false },
  ],
  repair_hours: [],
});

console.log('buildTeamBoard');
const m = buildTeamBoard(members, projects, dayWork);

ok('хүнтэй төслүүд хүний тоогоор буурахаар: Alpha(2) → Beta(1) → засвар(1)', () => {
  assert.deepEqual(m.active.map((r) => r.key), ['p:10', 'p:20', 'r:3']);
  assert.deepEqual(m.active.map((r) => r.people.length), [2, 1, 1]);
});
ok('багийн төсөл тоо баримтаа авна; засварын төсөл project=null', () => {
  assert.equal(m.active[0].project?.id, 10);
  assert.equal(m.active[2].project, null);
  assert.equal(m.active[2].kind, 'repair');
});
ok('хүнгүй идэвхтэй төсөл «quiet» — хоцролт ихтэй нь эхэнд (Delta 5 → Gamma 2)', () => {
  assert.deepEqual(m.quiet.map((r) => r.id), [40, 30]);
  assert.ok(m.quiet.every((r) => r.people.length === 0 && r.kind === 'quiet'));
});
ok('архивласан төсөл quiet-д ОРОХГҮЙ, тусдаа жагсаалтад', () => {
  assert.deepEqual(m.archived.map((r) => r.id), [50]);
  assert.ok(!m.quiet.some((r) => r.id === 50));
});
ok('төслийн бус ажлын нэг мөр', () => {
  assert.equal(m.nonProject?.key, 'np');
  assert.deepEqual(m.nonProject?.people.map((p) => p.member.id), [4]);
});
ok('нэг төсөл хоёр мөрөнд давхардахгүй (active ∩ quiet = ∅)', () => {
  const a = new Set(m.active.filter((r) => r.kind === 'project').map((r) => r.id));
  assert.ok(m.quiet.every((r) => !a.has(r.id)));
});
ok('ажиллаж буй = 4 (A, B, D, E), C чөлөөтэй', () => {
  assert.equal(m.activeCount, 4);
});
ok('жагсаалт: ажиллаж буй нь эхэнд, чөлөөтэй нь төгсгөлд', () => {
  const flags = m.roster.map((r) => r.working);
  assert.deepEqual(flags, [true, true, true, true, false]);
  assert.equal(m.roster.at(-1)?.member.id, 3);
});
ok('жагсаалтын rowKeys: B нь Alpha + Beta, D нь np, C хоосон', () => {
  const by = (id) => m.roster.find((r) => r.member.id === id);
  assert.deepEqual([...by(2).rowKeys].sort(), ['p:10', 'p:20']);
  assert.deepEqual(by(4).rowKeys, ['np']);
  assert.deepEqual(by(3).rowKeys, []);
});
ok('working ⇔ rowKeys.length > 0 (жагсаалт ба самбар зөрөхгүй)', () => {
  for (const r of m.roster) assert.equal(r.working, r.rowKeys.length > 0);
});
ok('засварын цаг төслийн мөрөнд хүнийг оруулна (ирцээр сонгоогүй ч)', () => {
  const dw = indexDayWork({
    date: '2026-09-30',
    non_project: [],
    repair_hours: [
      { id: 1, user_id: 3, kind: 'project', target_id: 20, target_name: 'Beta', task_id: null, task_name: null, hours: 2.5 },
    ],
  });
  const m2 = buildTeamBoard(members, projects, dw);
  const beta = m2.active.find((r) => r.key === 'p:20');
  assert.deepEqual(beta.people.map((p) => p.member.id).sort(), [2, 3]);
  assert.equal(beta.people.find((p) => p.member.id === 3).hours, 2.5);
  assert.equal(m2.roster.find((r) => r.member.id === 3).working, true);
  // A, B (ирц) + C (засварын цаг) + E (засварын төсөл); D-ийн төслийн бус ажил энэ dayWork-д байхгүй.
  assert.equal(m2.activeCount, 4);
  assert.equal(m2.roster.find((r) => r.member.id === 4).working, false);
});
ok('хоосон баг: юу ч унахгүй', () => {
  const e = buildTeamBoard([], [], new Map());
  assert.deepEqual([e.active, e.quiet, e.archived, e.roster], [[], [], [], []]);
  assert.equal(e.nonProject, null);
  assert.equal(e.activeCount, 0);
});

console.log('daysUntil');
const T = new Date(2026, 8, 30); // 2026-09-30
ok('өнөөдөр → 0, маргааш → 1, өчигдөр → -1', () => {
  assert.equal(daysUntil('2026-09-30', T), 0);
  assert.equal(daysUntil('2026-10-01', T), 1);
  assert.equal(daysUntil('2026-09-29', T), -1);
});
ok('сар дамжина, хоосон / буруу → null', () => {
  assert.equal(daysUntil('2026-10-30', T), 30);
  assert.equal(daysUntil(null, T), null);
  assert.equal(daysUntil('2026.10.30', T), null);
});

console.log(`\ncheck-team-board: ${n} passed`);
