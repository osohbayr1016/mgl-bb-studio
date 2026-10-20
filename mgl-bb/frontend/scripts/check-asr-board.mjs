/**
 * Зохиогчийн хяналт · төслийн самбар («хэн хэзээ явсан» + хугацаа сонгох)
 * цэвэр дүрмийн шалгалт.
 *
 *   node scripts/check-asr-board.mjs        (frontend/ хавтаснаас)
 *
 * `src/features/asr/lib/asrRange.ts` (хугацаа, ◀ ▶, тэнхлэг) ба
 * `src/features/asr/lib/asrBoard.ts` (очилтын тоо, хүн, баг, сараар бүлэглэх).
 * Frontend-д vitest байхгүй тул бусад `check-*.mjs`-ийн адил node-оор.
 */
import assert from 'node:assert/strict';

const R = await import('../src/features/asr/lib/asrRange.ts');
const B = await import('../src/features/asr/lib/asrBoard.ts');

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const TODAY = '2026-09-30';

console.log('asrRange');
ok('presets are whole calendar months / year', () => {
  assert.deepEqual(R.presetRange('all', TODAY), { from: null, to: null });
  assert.deepEqual(R.presetRange('thisMonth', TODAY), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(R.presetRange('lastMonth', TODAY), { from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(R.presetRange('last3Months', TODAY), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(R.presetRange('thisYear', TODAY), { from: '2026-01-01', to: '2026-12-31' });
  // Оны хил: 1-р сард «өмнөх сар» = өмнөх оны 12-р сар.
  assert.deepEqual(R.presetRange('lastMonth', '2027-01-15'), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(R.presetRange('last3Months', '2027-02-10'), { from: '2026-12-01', to: '2027-02-28' });
});

ok('monthRange covers exactly one calendar month (leap February too)', () => {
  assert.deepEqual(R.monthRange(2026, 9), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(R.monthRange(2028, 2), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(R.describeRange(R.monthRange(2026, 12)).kind, 'month');
});

ok('matchPreset recognises presets, everything else is custom', () => {
  for (const p of R.ASR_RANGE_PRESETS) assert.equal(R.matchPreset(R.presetRange(p, TODAY), TODAY), p);
  assert.equal(R.matchPreset({ from: '2026-09-02', to: '2026-09-30' }, TODAY), 'custom');
  assert.equal(R.matchPreset({ from: '2026-09-01', to: null }, TODAY), 'custom');
});

ok('normalizeRange drops invalid dates and swaps reversed bounds', () => {
  assert.deepEqual(R.normalizeRange('2026-09-30', '2026-09-01'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(R.normalizeRange('2026-02-30', 'x'), { from: null, to: null });
  assert.deepEqual(R.normalizeRange('2026-09-01', null), { from: '2026-09-01', to: null });
  assert.equal(R.isYmd('2028-02-29'), true);
  assert.equal(R.isYmd('2026-02-29'), false);
});

ok('inRange is inclusive on both ends and open when a bound is null', () => {
  const r = { from: '2026-09-01', to: '2026-09-30' };
  assert.equal(R.inRange('2026-09-01', r), true);
  assert.equal(R.inRange('2026-09-30', r), true);
  assert.equal(R.inRange('2026-08-31', r), false);
  assert.equal(R.inRange('2026-10-01', r), false);
  assert.equal(R.inRange('2020-01-01', R.ALL_RANGE), true);
  assert.equal(R.inRange('2026-09-15', { from: null, to: '2026-09-15' }), true);
});

ok('◀ ▶ moves whole months by month, other ranges by their day count', () => {
  assert.deepEqual(R.shiftRange({ from: '2026-09-01', to: '2026-09-30' }, -1), {
    from: '2026-08-01',
    to: '2026-08-31',
  });
  assert.deepEqual(R.shiftRange({ from: '2026-01-01', to: '2026-01-31' }, -1), {
    from: '2025-12-01',
    to: '2025-12-31',
  });
  // 3 сар → 3 сараар, сарын урт ялгаатай ч гулсахгүй.
  assert.deepEqual(R.shiftRange({ from: '2026-07-01', to: '2026-09-30' }, -1), {
    from: '2026-04-01',
    to: '2026-06-30',
  });
  assert.deepEqual(R.shiftRange({ from: '2026-01-01', to: '2026-12-31' }, 1), {
    from: '2027-01-01',
    to: '2027-12-31',
  });
  // 10 хоног → 10 хоногоор.
  assert.deepEqual(R.shiftRange({ from: '2026-09-11', to: '2026-09-20' }, -1), {
    from: '2026-09-01',
    to: '2026-09-10',
  });
  assert.equal(R.shiftRange(R.ALL_RANGE, 1), null);
});

ok('describeRange: month, year, months, days, open ends', () => {
  assert.deepEqual(R.describeRange({ from: '2026-09-01', to: '2026-09-30' }), {
    kind: 'month',
    year: 2026,
    month: 9,
  });
  assert.deepEqual(R.describeRange({ from: '2026-01-01', to: '2026-12-31' }), { kind: 'year', year: 2026 });
  assert.equal(R.describeRange({ from: '2026-07-01', to: '2026-09-30' }).kind, 'months');
  assert.equal(R.describeRange({ from: '2026-09-02', to: '2026-09-30' }).kind, 'days');
  assert.equal(R.describeRange({ from: '2026-09-02', to: null }).kind, 'fromOnly');
  assert.equal(R.describeRange(R.ALL_RANGE).kind, 'all');
});

ok('axisDomain: bounded = exact range; open = data rounded to month edges', () => {
  assert.deepEqual(R.axisDomain({ from: '2026-09-01', to: '2026-09-30' }, [], TODAY), {
    from: '2026-09-01',
    to: '2026-09-30',
    days: 30,
  });
  assert.deepEqual(R.axisDomain(R.ALL_RANGE, ['2026-07-14', '2026-05-05', 'bad'], TODAY), {
    from: '2026-05-01',
    to: '2026-09-30',
    days: 153,
  });
  assert.equal(R.axisDomain(R.ALL_RANGE, [], TODAY), null);
});

ok('positionPct puts a day in the middle of its cell', () => {
  const d = { from: '2026-09-01', to: '2026-09-30', days: 30 };
  assert.equal(R.positionPct('2026-09-01', d), (0.5 / 30) * 100);
  assert.equal(R.positionPct('2026-09-30', d), (29.5 / 30) * 100);
});

ok('axisTicks: weekly (Mondays) for short ranges, monthly otherwise', () => {
  const week = R.axisTicks({ from: '2026-09-01', to: '2026-09-30', days: 30 });
  assert.deepEqual(
    week.map((t) => t.date),
    ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'],
  );
  assert.ok(week.every((t) => t.kind === 'week' && t.showLabel));
  const month = R.axisTicks({ from: '2026-05-01', to: '2026-09-30', days: 153 });
  assert.deepEqual(
    month.map((t) => t.date),
    ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
  );
  assert.equal(month[0].pct, 0);
  // 24 сар → шошго 2 сар тутамд.
  const long = R.axisTicks({ from: '2025-01-01', to: '2026-12-31', days: 730 });
  assert.equal(long.length, 24);
  assert.equal(long.filter((t) => t.showLabel).length, 12);
});

console.log('asrBoard');
let nextId = 1;
const rep = (over) => ({
  id: nextId++,
  report_date: '2026-09-10',
  status: 'approved',
  report_type: 'site',
  author_id: 10,
  author_name: 'Бат Болд',
  companion_ids: null,
  companion_names: null,
  team_codes: 'BB',
  ...over,
});

ok('only submitted/approved SITE reports count as visits', () => {
  const s = B.summarize([
    rep({}),
    rep({ status: 'submitted' }),
    rep({ status: 'draft' }),
    rep({ status: 'rejected' }),
    rep({ report_type: 'online' }),
    rep({ report_type: 'office', status: 'submitted' }),
    rep({ report_type: 'office', status: 'draft' }),
    rep({ report_type: undefined }), // хуучин мөр = талбайн хяналт
  ]);
  assert.equal(s.site, 3);
  assert.equal(s.otherTotal, 2);
  assert.deepEqual(s.other, { office: 1, drawing_change: 0, online: 1 });
  assert.deepEqual(s.byStatus, { draft: 2, submitted: 2, approved: 3, rejected: 1 });
  assert.equal(s.total, 8);
});

ok('people = author + companions once per report; teams deduped; last site date', () => {
  const s = B.summarize([
    rep({ report_date: '2026-09-02', companion_ids: '11,10', team_codes: 'BB,BA' }),
    rep({ report_date: '2026-09-20', author_id: 12, team_codes: 'BA' }),
    rep({ report_date: '2026-09-25', report_type: 'online', author_id: 13 }),
  ]);
  assert.equal(s.people, 3); // 10, 11, 12 — онлайн уулзалтын 13 нь «явсан» биш
  assert.equal(s.teams, 2);
  assert.equal(s.lastSite, '2026-09-20');
});

ok('buildNameMap: author names, positional companions only when counts match, known wins', () => {
  const m = B.buildNameMap(
    [
      rep({ author_id: 10, author_name: 'Бат Болд', companion_ids: '11,12', companion_names: 'А А, Б Б' }),
      rep({ author_id: 13, author_name: 'В В', companion_ids: '14,15', companion_names: 'Г Г' }),
    ],
    [{ user_id: 12, full_name: 'Зөв Нэр' }],
  );
  assert.equal(m.get(10), 'Бат Болд');
  assert.equal(m.get(11), 'А А');
  assert.equal(m.get(12), 'Зөв Нэр');
  assert.equal(m.has(14), false); // 2 id, 1 нэр — байрлалаар холбохгүй
});

ok('peopleOf: counted reports of every type, sorted by site visits', () => {
  const names = new Map([
    [10, 'Бат'],
    [11, 'Дорж'],
  ]);
  const p = B.peopleOf(
    [
      rep({ report_date: '2026-09-02', author_id: 11 }),
      rep({ report_date: '2026-09-03', author_id: 10, companion_ids: '11' }),
      rep({ report_date: '2026-09-03', author_id: 10, team_codes: 'BA', report_type: 'office' }),
      rep({ report_date: '2026-09-04', author_id: 10, status: 'draft' }),
    ],
    names,
  );
  assert.deepEqual(
    p.map((x) => [x.name, x.site, x.other]),
    [
      ['Дорж', 2, 0],
      ['Бат', 1, 1],
    ],
  );
  const bat = p[1];
  assert.deepEqual(bat.teams, ['BB', 'BA']);
  // Нэг өдрийн хоёр тайлан = нэг тэмдэг, ядаж нэг нь талбай тул дүүрэн.
  assert.equal(bat.marks.length, 1);
  assert.equal(bat.marks[0].reports.length, 2);
  assert.equal(bat.marks[0].site, true);
  assert.equal(bat.last, '2026-09-03');
});

ok('allMarks groups counted reports by date; non-site-only day is hollow', () => {
  const m = B.allMarks([
    rep({ report_date: '2026-09-05' }),
    rep({ report_date: '2026-09-05', author_id: 11 }),
    rep({ report_date: '2026-09-01', report_type: 'online' }),
    rep({ report_date: '2026-09-07', status: 'draft' }),
  ]);
  assert.deepEqual(
    m.map((x) => [x.date, x.reports.length, x.site]),
    [
      ['2026-09-01', 1, false],
      ['2026-09-05', 2, true],
    ],
  );
});

ok('teamsOf counts a multi-team visit in every team, sorted by visits then order', () => {
  const t = B.teamsOf(
    [
      rep({ team_codes: 'BB,BA', companion_ids: '11' }),
      rep({ team_codes: 'BA', author_id: 12, report_date: '2026-09-21' }),
      rep({ team_codes: 'HAS', report_type: 'online' }),
      rep({ team_codes: 'HAS', status: 'draft' }),
    ],
    ['BB', 'BA', 'HAS'],
  );
  assert.deepEqual(
    t.map((x) => [x.code, x.site, x.people, x.last]),
    [
      ['BA', 2, 3, '2026-09-21'],
      ['BB', 1, 2, '2026-09-10'],
    ],
  );
});

ok('countSiteVisits matches summarize().site', () => {
  const list = [rep({}), rep({ status: 'draft' }), rep({ report_type: 'office' }), rep({ status: 'submitted' })];
  assert.equal(B.countSiteVisits(list), B.summarize(list).site);
});

ok('groupByMonth: newest month first, newest report first inside', () => {
  const a = rep({ report_date: '2026-08-31' });
  const b = rep({ report_date: '2026-09-02' });
  const c = rep({ report_date: '2026-09-02' });
  const d = rep({ report_date: '2026-09-15' });
  const g = B.groupByMonth([a, b, d, c]);
  assert.deepEqual(
    g.map((x) => [x.key, x.reports.map((r) => r.id)]),
    [
      ['2026-09', [d.id, c.id, b.id]],
      ['2026-08', [a.id]],
    ],
  );
  assert.equal(g[0].month, 9);
});

console.log(`\n${n} checks passed`);
