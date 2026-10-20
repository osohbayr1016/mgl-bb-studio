/**
 * Зохиогчийн хяналт · «Багаар нэгтгэл» бүлэглэлтийн дүрмийн шалгалт.
 *
 *   node scripts/check-asr-team-groups.mjs        (frontend/ хавтаснаас)
 *
 * `src/features/asr/lib/groupReportsByTeam.ts` — админ / захирал нэг хуудсан дээр
 * баг бүрийн DASR-ыг харах бүлэглэлт.  Frontend-д vitest байхгүй тул бусад
 * `check-*.mjs`-ийн адил node-оор.
 */
import assert from 'node:assert/strict';

const { groupReportsByTeam, teamCodesOf } = await import(
  '../src/features/asr/lib/groupReportsByTeam.ts'
);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const TEAMS = [
  { id: 1, code: 'BB', name_mn: 'Барилга', name_en: 'Building' },
  { id: 2, code: 'BA', name_mn: 'Архитектур', name_en: 'Architecture' },
  { id: 3, code: 'HAS', name_mn: 'ХАС', name_en: null },
];
let nextId = 100;
const rep = (over) => ({
  id: nextId++,
  report_date: '2026-09-01',
  status: 'approved',
  team_codes: 'BB',
  ...over,
});

console.log('teamCodesOf');
ok('splits, trims, drops empties and duplicates', () => {
  assert.deepEqual(teamCodesOf({ team_codes: ' BA , BB,,BA ' }), ['BA', 'BB']);
  assert.deepEqual(teamCodesOf({ team_codes: null }), []);
  assert.deepEqual(teamCodesOf({ team_codes: '' }), []);
});

console.log('groupReportsByTeam');
ok('groups follow the project team order and skip teams with no report', () => {
  const g = groupReportsByTeam(
    [rep({ team_codes: 'BA' }), rep({ team_codes: 'BB' }), rep({ team_codes: 'BA' })],
    TEAMS,
  );
  assert.deepEqual(g.map((x) => x.team?.code), ['BB', 'BA']);
  assert.equal(g[0].reports.length, 1);
  assert.equal(g[1].reports.length, 2);
});

ok('a multi-team report lands in EVERY team it covers', () => {
  const both = rep({ team_codes: 'BB,BA' });
  const g = groupReportsByTeam([both, rep({ team_codes: 'BA' })], TEAMS);
  const bb = g.find((x) => x.team?.code === 'BB');
  const ba = g.find((x) => x.team?.code === 'BA');
  assert.deepEqual(bb.reports.map((r) => r.id), [both.id]);
  assert.equal(ba.reports.length, 2);
  // Нийлбэр нийт тайлангаас их — UI үүнийг тайлбарлана.
  assert.equal(g.reduce((s, x) => s + x.counts.total, 0), 3);
});

ok('reports with no team go to a trailing «none» group', () => {
  const g = groupReportsByTeam(
    [rep({ team_codes: null, status: 'draft' }), rep({ team_codes: 'BB' }), rep({ team_codes: '' })],
    TEAMS,
  );
  assert.equal(g.length, 2);
  const last = g[g.length - 1];
  assert.equal(last.key, 'none');
  assert.equal(last.team, null);
  assert.equal(last.counts.total, 2);
  assert.equal(last.counts.draft, 1);
});

ok('a team code missing from the options is kept (nothing is dropped)', () => {
  const g = groupReportsByTeam([rep({ team_codes: 'ZZ' }), rep({ team_codes: 'BB' })], TEAMS);
  assert.deepEqual(g.map((x) => x.team?.code), ['BB', 'ZZ']);
  const zz = g[1];
  assert.equal(zz.team.id, null);
  assert.equal(zz.team.name_mn, 'ZZ');
});

ok('status counts add up to total; unused statuses are 0', () => {
  const g = groupReportsByTeam(
    [
      rep({ status: 'approved' }),
      rep({ status: 'approved' }),
      rep({ status: 'submitted' }),
      rep({ status: 'draft' }),
      rep({ status: 'rejected' }),
    ],
    TEAMS,
  );
  assert.deepEqual(g[0].counts, { total: 5, draft: 1, submitted: 1, approved: 2, rejected: 1 });
  const only = groupReportsByTeam([rep({ status: 'approved' })], TEAMS);
  assert.deepEqual(only[0].counts, { total: 1, draft: 0, submitted: 0, approved: 1, rejected: 0 });
});

ok('reports are newest first (date, then id); lastDate = newest', () => {
  const a = rep({ report_date: '2026-05-05' });
  const b = rep({ report_date: '2026-09-20' });
  const c = rep({ report_date: '2026-09-20' });
  const g = groupReportsByTeam([a, b, c], TEAMS);
  assert.deepEqual(g[0].reports.map((r) => r.id), [c.id, b.id, a.id]);
  assert.equal(g[0].lastDate, '2026-09-20');
});

ok('onlyTeam keeps just that team — a shared report is not repeated under the other team', () => {
  const shared = rep({ team_codes: 'BB,BA' });
  const g = groupReportsByTeam([shared, rep({ team_codes: 'BA' })], TEAMS, 'BA');
  assert.deepEqual(g.map((x) => x.team?.code), ['BA']);
  assert.equal(g[0].reports.length, 2);
  // Шүүлт идэвхтэй үед «баггүй» бүлэг ч гарахгүй (шүүлт багтай тайланг л үлдээдэг).
  assert.equal(groupReportsByTeam([rep({ team_codes: null })], TEAMS, 'BA').length, 0);
  // onlyTeam = null → шүүлтгүй, бүх бүлэг.
  assert.equal(groupReportsByTeam([shared], TEAMS, null).length, 2);
});

ok('does not mutate its input', () => {
  const input = [rep({ report_date: '2026-01-01' }), rep({ report_date: '2026-02-01' })];
  const snapshot = input.map((r) => r.id);
  groupReportsByTeam(input, TEAMS);
  assert.deepEqual(input.map((r) => r.id), snapshot);
});

ok('empty input → no groups', () => {
  assert.deepEqual(groupReportsByTeam([], TEAMS), []);
});

console.log(`\n${n} checks passed`);
