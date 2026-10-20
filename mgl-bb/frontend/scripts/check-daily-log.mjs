/**
 * «Өдрийн тайлан» — календарь + contribution heatmap-ын цэвэр дүрмийн шалгалт.
 *
 *   node scripts/check-daily-log.mjs        (frontend/ хавтаснаас)
 *
 * `src/features/daily-log/lib.ts` — Даваагаас эхлэх долоо хоног, сарын тор,
 * heatmap-ын баганууд ба сарын шошго, өнгөний шатлал, хураангуй тоо.
 * Frontend-д vitest байхгүй тул бусад `check-*.mjs`-ийн адил node-оор.
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// `reports/lib/mgmtMatrix.ts` нь `../../daily-log/lib`-ийг өргөтгөлгүй импортолдог.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'daily-log', 'lib.ts');
const L = await import(pathToFileURL(LIB).href);
const J = await import(
  pathToFileURL(join(HERE, '..', 'src', 'features', 'reports', 'lib', 'mgmtJournal.ts')).href
);
const C = await import(
  pathToFileURL(join(HERE, '..', 'src', 'features', 'reports', 'lib', 'mgmtCalendar.ts')).href
);
const F = await import(
  pathToFileURL(join(HERE, '..', 'src', 'features', 'reports', 'lib', 'mgmtFeed.ts')).href
);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

ok('долоо хоног Даваагаас (Лхагва, Ням, Даваа)', () => {
  assert.equal(L.mondayOf('2026-10-07'), '2026-10-05');
  assert.equal(L.mondayOf('2026-10-11'), '2026-10-05');
  assert.equal(L.mondayOf('2026-10-05'), '2026-10-05');
  assert.deepEqual(L.weekDates('2026-10-01'), [
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
  ]);
});

ok('сарын тор: бүтэн долоо хоног, 4–6 мөр, сарын хил давна', () => {
  const oct = L.monthGrid('2026-10'); // 1 = Пүрэв, 31 = Бямба
  assert.equal(oct.length, 5);
  assert.equal(oct[0][0], '2026-09-28');
  assert.equal(oct[4][6], '2026-11-01');
  assert.ok(oct.every((r) => r.length === 7));
  const feb27 = L.monthGrid('2027-02'); // 1 = Даваа, 28 = Ням
  assert.equal(feb27.length, 4);
  assert.equal(feb27[0][0], '2027-02-01');
  assert.equal(feb27[3][6], '2027-02-28');
  const aug26 = L.monthGrid('2026-08'); // 1 = Бямба, 31 = Даваа → 6 мөр
  assert.equal(aug26.length, 6);
  assert.equal(aug26[0][0], '2026-07-27');
  assert.equal(aug26[5][0], '2026-08-31');
});

ok('heatmap: 53 багана, сүүлийнх нь өнөөдрийг агуулна, Даваагаас', () => {
  const cols = L.heatmapColumns('2026-10-07', 53);
  assert.equal(cols.length, 53);
  assert.ok(cols.every((w) => w.length === 7 && L.weekdayOf(w[0]) === 1));
  assert.ok(cols[52].includes('2026-10-07'));
  assert.equal(cols[0][0], '2025-10-06');
  // Баганууд тасралтгүй.
  assert.equal(L.addDays(cols[0][6], 1), cols[1][0]);
});

ok('сарын шошго: сар солигдсон багана, эхнийх давхцвал хасна', () => {
  const cols = L.heatmapColumns('2026-10-07', 53);
  const labels = L.monthStarts(cols);
  assert.deepEqual(labels[0], { col: 0, month: 10 });
  assert.deepEqual(labels[1], { col: 4, month: 11 }); // 2025-11-03
  assert.equal(labels.at(-1).month, 10);
  // Эхний багана сарын төгсгөлд (дараагийн сар 1 баганын дараа) → хасагдана.
  const tight = L.monthStarts([
    ['2026-09-28'],
    ['2026-10-05'],
    ['2026-10-12'],
    ['2026-10-19'],
    ['2026-10-26'],
    ['2026-11-02'],
  ]);
  assert.deepEqual(tight, [
    { col: 1, month: 10 },
    { col: 5, month: 11 },
  ]);
});

ok('өнгөний шатлал: доод тал нь 1·2·3·4+, онцгой өдөр бусдыг бүдгэрүүлэхгүй', () => {
  assert.deepEqual(L.heatScale([]), [1, 2, 3]);
  assert.deepEqual(L.heatScale([1, 2, 3, 0, 0]), [1, 2, 3]);
  assert.deepEqual(L.heatScale(Array(20).fill(8)), [2, 4, 6]);
  const withOutlier = [...Array(20).fill(4), 40];
  const s = L.heatScale(withOutlier);
  assert.deepEqual(s, [1, 2, 3]);
  assert.equal(L.heatLevel(4, s), 4);
  assert.equal(L.heatLevel(40, s), 4);
  // Хил бүр хатуу өснө.
  for (let p = 4; p <= 40; p++) {
    const [a, b, c] = L.heatScale([p]);
    assert.ok(a < b && b < c, `p=${p}`);
  }
});

ok('шатлал → түвшин ба legend-ийн муж', () => {
  const s = [2, 4, 6];
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 99].map((c) => L.heatLevel(c, s)),
    [0, 1, 1, 2, 2, 3, 3, 4, 4],
  );
  assert.deepEqual(L.heatRanges(s), [
    { level: 0, from: 0, to: 0 },
    { level: 1, from: 1, to: 2 },
    { level: 2, from: 3, to: 4 },
    { level: 3, from: 5, to: 6 },
    { level: 4, from: 7, to: null },
  ]);
});

ok('хураангуй: ажил, бичсэн өдөр, өнөөдрөөс хойш ажлын өдөр тоолохгүй', () => {
  const counts = new Map([
    ['2026-10-05', 3],
    ['2026-10-06', 5],
    ['2026-10-04', 2], // Ням (өмнөх долоо хоног)
    ['2026-10-10', 1], // Бямба — ирээдүй, гэхдээ тоологдохгүй
  ]);
  assert.deepEqual(L.rangeStats(counts, '2026-10-05', '2026-10-11', '2026-10-07'), {
    items: 8,
    logged: 2,
    workdays: 3,
  });
  assert.deepEqual(L.rangeStats(counts, '2026-10-03', '2026-10-04', '2026-10-07'), {
    items: 2,
    logged: 1,
    workdays: 0,
  });
});

ok('дугаарлалт (сервертэй ижил дүрэм) хэвээр', () => {
  assert.deepEqual(L.textToItems('1. Хурал\n2) Гэрээ\n\n- 3.5 м хана'), [
    'Хурал',
    'Гэрээ',
    '3.5 м хана',
  ]);
  assert.equal(L.itemsToText(['a', 'b']), '1. a\n2. b');
});

ok('нэгтгэлийн муж: 7 хоног, сар, өмнөх сар, 3 сар, 1 жил', () => {
  assert.deepEqual(L.digestRange('week', '2026-10-07'), { from: '2026-10-05', to: '2026-10-07' });
  assert.deepEqual(L.digestRange('month', '2026-10-07'), { from: '2026-10-01', to: '2026-10-07' });
  assert.deepEqual(L.digestRange('prevMonth', '2026-10-07'), {
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual(L.digestRange('prevMonth', '2026-03-15'), {
    from: '2026-02-01',
    to: '2026-02-28',
  });
  assert.deepEqual(L.digestRange('quarter', '2026-10-07'), {
    from: '2026-07-10',
    to: '2026-10-07',
  });
  assert.deepEqual(L.digestRange('year', '2026-10-07'), { from: '2025-10-08', to: '2026-10-07' });
});

ok('нэгтгэл: мужаас гадуурх / хоосон өдөр хасагдана, шинээс хуучин руу, сараар', () => {
  const g = L.groupDigest(
    [
      { log_date: '2026-09-29', items: ['a'] },
      { log_date: '2026-10-02', items: ['b', 'c'], late: true },
      { log_date: '2026-10-03', items: [] },
      { log_date: '2026-08-01', items: ['x'] },
    ],
    '2026-09-01',
    '2026-10-07',
  );
  assert.equal(g.days, 2);
  assert.equal(g.items, 3);
  assert.equal(g.late, 1);
  assert.deepEqual(
    g.months.map((m) => [m.month, m.logs.map((l) => l.log_date), m.items]),
    [
      ['2026-10', ['2026-10-02'], 2],
      ['2026-09', ['2026-09-29'], 1],
    ],
  );
});

ok('менежмент: хурдан бичлэг — ард залгана, угтвар хасна, олон мөр, хоосон бол null', () => {
  assert.deepEqual(F.appendItems(['Хуучин'], '  Шинэ ажил  '), ['Хуучин', 'Шинэ ажил']);
  assert.deepEqual(F.appendItems([], '1. Нэг\n- Хоёр\n\n'), ['Нэг', 'Хоёр']);
  assert.equal(F.appendItems(['X'], '   \n 3. '), null);
});

ok('менежмент: засах/устгах/буцаах — байрлал зөвлөмж, бичвэрээр хайна, олдохгүй бол null', () => {
  const base = ['А', 'Б', 'В', 'Б'];
  assert.deepEqual(F.applyReplace(base, { index: 99, expected: [], next: ['Г'] }), ['А', 'Б', 'В', 'Б', 'Г']);
  assert.deepEqual(F.applyReplace(base, { index: 1, expected: ['Б'], next: ['Б2'] }), ['А', 'Б2', 'В', 'Б']);
  assert.deepEqual(F.applyReplace(base, { index: 3, expected: ['Б'], next: [] }), ['А', 'Б', 'В']);
  // өөр газраас мөр нэмэгдэж байрлал шилжсэн — бичвэрээр олно
  assert.deepEqual(F.applyReplace(['X', ...base], { index: 2, expected: ['В'], next: ['В2'] }), ['X', 'А', 'Б', 'В2', 'Б']);
  // буцаах: залгасан блок
  assert.deepEqual(F.applyReplace(base, { index: 2, expected: ['В', 'Б'], next: [] }), ['А', 'Б']);
  // өөр газраас засагдсан — дарж бичихгүй
  assert.equal(F.applyReplace(base, { index: 0, expected: ['Z'], next: [] }), null);
});

ok('календарь: долоо хоног/сарын тор, серверийн цонх, ◀ ▶ ирээдүй рүү явахгүй', () => {
  const today = '2026-10-08'; // Пүрэв
  assert.deepEqual(C.viewDates('week', today)[0], ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepEqual(C.fetchWindow('week', today, today), { window: '14d', anchor: today }, 'Ням ирээдүйд тул өнөөдрөөр тайрна');
  assert.deepEqual(C.fetchWindow('week', '2026-09-30', today), { window: '14d', anchor: '2026-10-04' });
  assert.deepEqual(C.fetchWindow('month', '2026-09-15', today), { window: 'month', anchor: '2026-09-30' });
  assert.deepEqual(C.fetchWindow('month', today, today), { window: 'month', anchor: today });
  assert.equal(C.shiftCursor('week', today, 1, today), today, 'дараагийн долоо хоног ирээдүй');
  assert.equal(C.shiftCursor('week', today, -1, today), '2026-09-28');
  assert.equal(C.shiftCursor('month', today, -1, today), '2026-09-01');
  assert.equal(C.shiftCursor('month', '2026-09-01', 1, today), '2026-10-01');
  assert.equal(C.canGoNext('month', today, today), false);
  assert.equal(C.containsToday('week', '2026-10-11', today), true);
  assert.equal(C.viewDates('month', today).length, 5);
});

ok('календарь: нүдний индекс, бичсэн хүмүүс, хайлт, өдөр алхах', () => {
  const idx = C.indexDays([
    { user_id: 1, date: '2026-10-06', count: 2, items: ['Гэрээ', 'Хурал'] },
    { user_id: 2, date: '2026-10-06', count: 1, items: ['Төсөв'] },
    { user_id: 2, date: '2026-10-08', count: 1, items: ['Тайлан'] },
    { user_id: 3, date: '2026-10-07', count: 0, items: [] },
  ]);
  assert.equal(idx.size, 3);
  assert.deepEqual(idx.get(C.cellKey(1, '2026-10-06')), ['Гэрээ', 'Хурал']);
  assert.deepEqual(C.writersOn(idx, '2026-10-06', [2, 1, 3]), [2, 1]);
  assert.equal(C.matchesQuery(['Гэрээ илгээсэн'], 'гэрээ'), true);
  assert.equal(C.matchesQuery(['Хурал'], 'гэрээ'), false);
  assert.equal(C.matchesQuery(['Хурал'], '  '), true);
  const dates = C.viewDates('week', '2026-10-08')[0];
  assert.equal(C.stepDay(idx, dates, '2026-10-06', 1, [2]), '2026-10-08', 'зөвхөн тэр хүний бичсэн өдөр');
  assert.equal(C.stepDay(idx, dates, '2026-10-06', 1, [1]), null);
  assert.equal(C.stepDay(idx, dates, '2026-10-08', -1, [1, 2]), '2026-10-06');
  const tot = C.calTotals(idx, [1, 2, 3], dates);
  assert.deepEqual(tot.byPerson.get(1), { items: 2, days: 1 });
  assert.deepEqual(tot.byPerson.get(2), { items: 2, days: 2 });
  assert.deepEqual(tot.byPerson.get(3), { items: 0, days: 0 });
  assert.deepEqual(tot.byDate.get('2026-10-06'), { people: 2, items: 3 });
  assert.equal(tot.people, 2);
  assert.equal(tot.items, 4);
});

ok('тодруулга, үсэг', () => {
  assert.deepEqual(J.highlightParts('Гэрээ илгээсэн, гэрээ', 'гэрээ'), [
    { text: 'Гэрээ', hit: true },
    { text: ' илгээсэн, ', hit: false },
    { text: 'гэрээ', hit: true },
  ]);
  assert.deepEqual(J.highlightParts('abc', ''), [{ text: 'abc', hit: false }]);
  assert.equal(J.initialsOf('Отгонбаяр Батболд'), 'ОБ');
  assert.equal(J.initialsOf('ceo'), 'C');
  assert.equal(J.initialsOf('  '), '?');
});

console.log(`check-daily-log: ${n} шалгалт OK`);
