/**
 * `revitNoteAi.ts`-ийн тест.
 *
 * Гол инвариант: тэмдэглэл ХЭЗЭЭ Ч хоосон гарахгүй, AI бодит хувиас өөр
 * хувь бичвэл бүхэлд нь хаягдана.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  templateNote,
  isAcceptableNote,
  generateRevitNote,
  groupSentence,
  allowedCountsOf,
  MAX_NOTE_LENGTH,
  REVIT_NOTE_MODEL,
} = await import('./revitNoteAi.ts');

const facts = {
  projectName: 'Гэрэлт-Оффис',
  taskName: '1-3 давхрын план',
  sheetLabels: ['БА-01', 'БА-02', 'БА-03'],
  previousPercent: 47,
  percent: 62,
  basisDetail: 'Checklist 8/13 → 62%',
  added: 191,
  modified: 74,
};

test('templateNote: бүх баримтыг агуулсан монгол өгүүлбэр', () => {
  const n = templateNote(facts);
  assert.ok(n.includes('Гэрэлт-Оффис'));
  assert.ok(n.includes('1-3 давхрын план'));
  assert.ok(n.includes('БА-01'));
  assert.ok(n.includes('47% → 62%'));
  // ⚠️ 2026-08-26: түүхий `added`/`modified` тоо ТАЙЛАНД ОРОХОО БОЛЬСОН.
  // Урьд нь энд `n.includes('191')` гэж шалгадаг байв — тэр нь Revit-ийн
  // хөдөлгөөний тоо бөгөөд эвтэйхэн ажилласан хүнийг бага ажилласан юм шиг
  // харагдуулдаг тул хэмжүүр болгон хэрэглэхийг зогсоосон.
  assert.ok(!n.includes('191'), 'хөдөлгөөний түүхий тоо тайланд орох ёсгүй');
  assert.ok(!n.includes('74'), 'хөдөлгөөний түүхий тоо тайланд орох ёсгүй');
});

test('templateNote: хамгийн доод оролт дээр ч хоосон гарахгүй', () => {
  const n = templateNote({
    projectName: '',
    taskName: '',
    sheetLabels: [],
    previousPercent: 0,
    percent: 0,
    basisDetail: '',
  });
  assert.ok(n.length > 0);
  assert.ok(n.includes('Revit'));
});

test('templateNote: явц өөрчлөгдөөгүй бол сум зурахгүй', () => {
  // ⚠️ basisDetail ('Checklist 8/13 → 62%') дотор ч сум байдаг тул
  // «сум байхгүй» гэж бүтнээр нь шалгаж БОЛОХГҮЙ — зөвхөн явцын хэллэгийг.
  const n = templateNote({ ...facts, previousPercent: 62 });
  assert.ok(n.includes('Явц: 62%.'));
  assert.ok(!n.includes('62% → 62%'));
  const noBasis = templateNote({ ...facts, previousPercent: 62, basisDetail: '' });
  assert.ok(!noBasis.includes('→'));
});

test('templateNote: олон хуудас бол товчилж, нийт тоог хэлнэ', () => {
  const many = Array.from({ length: 13 }, (_, i) => `БА-${String(i + 1).padStart(2, '0')}`);
  const n = templateNote({ ...facts, sheetLabels: many });
  assert.ok(n.includes('нийт 13 хуудас'));
});

test('templateNote: уртын таг', () => {
  const n = templateNote({ ...facts, taskName: 'х'.repeat(2000) });
  assert.ok(n.length <= MAX_NOTE_LENGTH);
});

test('ГОЛ ХАМГААЛАЛТ: AI бодит хувиас өөр хувь бичвэл татгалзана', () => {
  assert.equal(isAcceptableNote('Ажил үргэлжилж байна. Явц 85% боллоо.', 62), false);
  assert.equal(isAcceptableNote('Ажил үргэлжилж байна. Явц 62% боллоо.', 62), true);
  // Хувь огт дурдаагүй нь зүгээр — тоо зохиогоогүй.
  assert.equal(isAcceptableNote('Архитектур зургийн планууд дээр ажиллав.', 62), true);
});

test('isAcceptableNote: хоосон, хэт богино, хэт урт', () => {
  assert.equal(isAcceptableNote('', 62), false);
  assert.equal(isAcceptableNote('Богино', 62), false);
  assert.equal(isAcceptableNote('а'.repeat(MAX_NOTE_LENGTH * 2 + 5), 62), false);
});

test('isAcceptableNote: англиар хариулсныг татгалзана', () => {
  assert.equal(
    isAcceptableNote('Worked on the architectural floor plans for the office building today.', 62),
    false,
  );
});

test('generateRevitNote: AI байхгүй бол загвар, fallback=true', async () => {
  const r = await generateRevitNote(null, facts);
  assert.equal(r.fallback, true);
  assert.equal(r.ai_model, null);
  assert.equal(r.note, templateNote(facts));
});

test('generateRevitNote: AI унавал загвар руу чимээгүй шилжинэ', async () => {
  const ai = { run: async () => { throw new Error('AI boom'); } };
  const r = await generateRevitNote(ai as never, facts);
  assert.equal(r.fallback, true);
  assert.equal(r.note, templateNote(facts));
});

test('generateRevitNote: AI сайн бичвэл түүнийг авна', async () => {
  const good = 'Гэрэлт-Оффис төслийн эхний гурван давхрын планыг боловсруулав. Явц 62% хүрлээ.';
  const ai = { run: async () => ({ response: good }) };
  const r = await generateRevitNote(ai as never, facts);
  assert.equal(r.fallback, false);
  assert.equal(r.note, good);
  assert.equal(r.ai_model, REVIT_NOTE_MODEL);
});

test('generateRevitNote: AI буруу хувь бичвэл ХАЯНА', async () => {
  const bad = 'Гэрэлт-Оффис төслийн планууд дээр ажиллав. Явц 90% хүрлээ.';
  const ai = { run: async () => ({ response: bad }) };
  const r = await generateRevitNote(ai as never, facts);
  assert.equal(r.fallback, true, 'буруу тоотой бичвэр хаягдах ёстой');
  assert.equal(r.note, templateNote(facts));
});

test('generateRevitNote: AI хоосон буцаавал загвар', async () => {
  const ai = { run: async () => ({ response: '   ' }) };
  const r = await generateRevitNote(ai as never, facts);
  assert.equal(r.fallback, true);
});

/* ==================================================================== */
/*  Тайлангийн задаргаа — 2026-08-26                                     */
/* ==================================================================== */

const digestFacts = {
  projectName: 'MGL-260804 Хүй долоон худаг-Стадион',
  taskName: 'Картограмм',
  sheetLabels: [],
  previousPercent: 0,
  percent: 0,
  basisDetail: '',
  // ⚠️ Revit-ийн ТҮҮХИЙ тоо — задаргаа байгаа үед тэмдэглэлд ГАРАХ ЁСГҮЙ.
  added: 0,
  modified: 155,
  visibleTotal: 18,
  moreGroups: 0,
  groups: [
    {
      categoryLabel: 'Хана',
      typeName: 'Basic Wall · Хана 200мм',
      level: '1-р давхар',
      kind: 'modified',
      kindLabel: 'зассан',
      ops: ['зөөсөн'],
      count: 9,
      sheets: ['БА101'],
    },
    {
      categoryLabel: 'Хана',
      typeName: 'Basic Wall · Хана 200мм',
      level: '1-р давхар',
      kind: 'added',
      kindLabel: 'нэмсэн',
      ops: [],
      count: 3,
      sheets: ['БА101'],
    },
    {
      categoryLabel: 'Шал',
      typeName: 'Нийлмэл шал 150мм',
      level: '1-р давхар',
      kind: 'modified',
      kindLabel: 'зассан',
      ops: [],
      count: 2,
      sheets: [],
    },
  ],
};

test('groupSentence: нэмсэн — хуудас · давхар · төрөл', () => {
  const g = digestFacts.groups[1]!;
  assert.equal(groupSentence(g), 'БА101 хуудас · 1-р давхар · Basic Wall · Хана 200мм — 3 ширхэг нэмэв.');
});

test('groupSentence: зөөсөн нь «байрлалыг өөрчлөв» болно', () => {
  const g = digestFacts.groups[0]!;
  assert.ok(groupSentence(g).includes('9 ширхэгийн байрлалыг өөрчлөв'));
});

test('groupSentence: хуудас тогтоогдоогүй бол давхраар нь бичнэ', () => {
  const g = digestFacts.groups[2]!;
  const line = groupSentence(g);
  assert.ok(!line.includes('хуудас'), 'байхгүй хуудсыг ЗОХИОХ ЁСГҮЙ');
  assert.ok(line.includes('1-р давхар'));
  assert.ok(line.includes('2 ширхэгийг зассан'));
});

test('groupSentence: устгасан', () => {
  const line = groupSentence({
    categoryLabel: 'Багана',
    kind: 'deleted',
    count: 4,
  });
  assert.ok(line.includes('4 ширхэгийг устгав'));
});

test('templateNote: задаргаа байвал ТҮҮХИЙ тоо ГАРАХГҮЙ', () => {
  const n = templateNote(digestFacts);
  // Энэ бол алдааны гол шалгуур: 155 нь Revit-ийн дотоод элементүүдийг
  // оруулсан тоо бөгөөд хүний хийсэн ажлыг ХЭТРҮҮЛЖ харуулдаг.
  assert.ok(!n.includes('155'), 'түүхий тоо тайланд орох ёсгүй');
  assert.ok(n.includes('18 элемент хөдөлсөн'));
  assert.ok(n.includes('БА101'));
  assert.ok(n.includes('Картограмм'));
  assert.ok(n.length <= MAX_NOTE_LENGTH);
});

test('templateNote: задаргаагүй бол хуучин зан төлөв хэвээр', () => {
  const n = templateNote({ ...digestFacts, groups: [], visibleTotal: undefined });
  assert.ok(n.includes('155'), 'өөр хэлэх юм байхгүй үед түүхий тоо л үлдэнэ');
});

test('allowedCountsOf: бүлгийн тоо ба нийт дүн', () => {
  const set = new Set(allowedCountsOf(digestFacts));
  assert.ok(set.has(9) && set.has(3) && set.has(2) && set.has(18));
  assert.ok(!set.has(155));
});

test('isAcceptableNote: AI зохиосон «ширхэг» тоог ХАЯНА', () => {
  const counts = allowedCountsOf(digestFacts);
  const bad = 'БА101 хуудсанд 1-р давхрын хана 19 ширхэгийн байрлалыг өөрчлөв. Явц 0%.';
  assert.equal(isAcceptableNote(bad, 0, counts), false);
});

test('isAcceptableNote: зөв тоотой бичвэрийг хүлээж авна', () => {
  const counts = allowedCountsOf(digestFacts);
  const good =
    'БА101 хуудсанд 1-р давхрын хана 9 ширхэгийн байрлалыг өөрчилж, ' +
    '3 ширхэг шинээр барив. Мөн шал 2 ширхэгийг зассан. Явц 0%.';
  assert.equal(isAcceptableNote(good, 0, counts), true);
});

test('isAcceptableNote: түвшин/төрлийн нэр дэх тоог шалгахгүй', () => {
  const counts = allowedCountsOf(digestFacts);
  // «200мм», «1-р давхар», «150мм» — эдгээр нь тоо агуулсан ч ширхэг БИШ.
  const good =
    '1-р давхрын Хана 200мм 9 ширхэгийн байрлалыг өөрчлөв. ' +
    'Нийлмэл шал 150мм 2 ширхэгийг зассан. Явц 0%.';
  assert.equal(isAcceptableNote(good, 0, counts), true);
});

test('generateRevitNote: тоо гажуудсан AI бичвэрийг ХАЯЖ загвар өгнө', async () => {
  const ai = { run: async () => ({ response: 'Хана 42 ширхэгийг зассан. Явц 0%.' }) };
  const r = await generateRevitNote(ai as never, digestFacts);
  assert.equal(r.fallback, true);
  assert.equal(r.note, templateNote(digestFacts));
});
