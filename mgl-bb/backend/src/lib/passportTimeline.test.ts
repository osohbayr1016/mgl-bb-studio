/**
 * `lib/passportTimeline.ts`-ийн тест — «1.3 Төслийн хугацаа»-ны БАГАНА ↔
 * JSON хөрвүүлэг.  Файл нь импортгүй, цэвэр функц тул `registerHooks`
 * шаардлагагүй (`leaveOverlap.test.ts`-тэй ижил).
 *
 * Энэ тестийн гол зорилго: `routes/timeline.ts` (багана → хүснэгт) ба
 * `routes/projects.ts` (хүснэгт → багана) ХОЁР ЧИГЛЭЛ нь тойрог хаадаг
 * эсэх — эс бөгөөс нэг төсөл гүйцэтгэлийн тайлан дээр нэг, захиалагчийн
 * PDF дээр өөр хугацаа хэвлэнэ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyScheduleToTimelineRows,
  columnsFromTimelineRows,
  defaultTimelineRows,
  normaliseTimelineRows,
  parseTimelineJson,
  type PassportTimelineRow,
} from './passportTimeline.ts';

const row = (
  id: string,
  date: string,
  labelMn = 'Сунгалт',
  labelEn = 'Extension',
): PassportTimelineRow => ({ id, labelEn, labelMn, date });

/* ------------------------------------------------------------------ */
/*  ХҮСНЭГТ → БАГАНА                                                   */
/* ------------------------------------------------------------------ */

test('хүснэгт хоосон бол null — дуудагч шууд талбарууд руугаа унана', () => {
  assert.equal(columnsFromTimelineRows([]), null);
});

test('тогтмол id-гаар буудна', () => {
  const cols = columnsFromTimelineRows([
    row('tl-start', '2026-01-05', 'Эхлэх', 'Start'),
    row('tl-finish', '2026-06-30', 'Дуусах', 'Finish'),
    row('tl-ext', '2026-08-15'),
  ]);
  assert.deepEqual(cols, {
    start_date: '2026-01-05',
    finish_date: '2026-06-30',
    extension_date: '2026-08-15',
  });
});

test('тогтмол id байхгүй бол БАЙРЛАЛААР (хуучин tl-0/tl-1 мөрүүд)', () => {
  const cols = columnsFromTimelineRows([
    row('tl-0', '2026-01-05', 'Эхлэх', 'Start'),
    row('tl-1', '2026-06-30', 'Дуусах', 'Finish'),
    row('tl-2', '2026-08-15'),
  ]);
  assert.deepEqual(cols, {
    start_date: '2026-01-05',
    finish_date: '2026-06-30',
    extension_date: '2026-08-15',
  });
});

test('⚠️ сунгалт нь ОГНООТОЙ СҮҮЛИЙН tl-ext* мөр (эхнийх нь хоосон байсан ч)', () => {
  // Жишиг баримт дээр Сунгалт ХОЁР мөртэй.  `find` хийвэл эхний хоосон мөр
  // ялж, захиалагчийн тайлангаас «Сунгалт» чимээгүй алга болно.
  const cols = columnsFromTimelineRows([
    row('tl-start', '2026-01-05', 'Эхлэх', 'Start'),
    row('tl-finish', '2026-06-30', 'Дуусах', 'Finish'),
    row('tl-ext', ''),
    row('tl-ext-a1b2c3', '2026-09-30'),
  ]);
  assert.equal(cols?.extension_date, '2026-09-30');
});

test('хоосон огноо нь null болно ("" БИШ)', () => {
  const cols = columnsFromTimelineRows(defaultTimelineRows());
  assert.deepEqual(cols, { start_date: null, finish_date: null, extension_date: null });
});

test('баталгаажаагүй чөлөөт текстийг ХЭВЭЭР дамжуулна', () => {
  // Продакшнд '-' ба '2026.07.09' хоёул байдаг — цэвэрлэх нь энэ давхаргын
  // ажил БИШ (`timeline.ts` нь зөвхөн ДАРААЛАЛ шалгахдаа ISO болгодог).
  const cols = columnsFromTimelineRows([
    row('tl-start', '2026.07.09', 'Эхлэх', 'Start'),
    row('tl-finish', '-', 'Дуусах', 'Finish'),
  ]);
  assert.deepEqual(cols, {
    start_date: '2026.07.09',
    finish_date: '-',
    extension_date: null,
  });
});

/* ------------------------------------------------------------------ */
/*  БАГАНА → ХҮСНЭГТ                                                   */
/* ------------------------------------------------------------------ */

test('хүснэгт байхгүй бол defaultTimelineRows()-ийн ГУРВАН мөр үүснэ', () => {
  const rows = applyScheduleToTimelineRows([], {
    start_date: '2026-02-01',
    finish_date: '2026-05-01',
  });
  assert.deepEqual(rows, [
    { id: 'tl-start', labelEn: 'Start', labelMn: 'Эхлэх', date: '2026-02-01' },
    { id: 'tl-finish', labelEn: 'Finish', labelMn: 'Дуусах', date: '2026-05-01' },
    { id: 'tl-ext', labelEn: 'Extension', labelMn: 'Сунгалт', date: '' },
  ]);
});

test('⚠️ хүснэгтгүй паспортын СУНГАЛТ «Хуваарь» бичилтийн дараа АМЬД үлдэнэ', () => {
  // Продакшны 30-р төслийн бодит хэлбэр: багана бүрэн, `timeline_json` NULL.
  const rows = applyScheduleToTimelineRows(
    [],
    { start_date: '2025-12-04', finish_date: '2026-08-30' },
    { start_date: '2025-12-04', finish_date: '2026-07-09', extension_date: '2026.07.09' },
  );
  assert.deepEqual(rows, [
    { id: 'tl-start', labelEn: 'Start', labelMn: 'Эхлэх', date: '2025-12-04' },
    { id: 'tl-finish', labelEn: 'Finish', labelMn: 'Дуусах', date: '2026-08-30' },
    { id: 'tl-ext', labelEn: 'Extension', labelMn: 'Сунгалт', date: '2026.07.09' },
  ]);
  // Тойрог: паспорт хадгалахад багана нь ч устахгүй.
  assert.deepEqual(columnsFromTimelineRows(rows), {
    start_date: '2025-12-04',
    finish_date: '2026-08-30',
    extension_date: '2026.07.09',
  });
});

test('⚠️ зөвхөн ДУУСАХ огноог өөрчлөхөд эхлэх огноо баганаас нь ирнэ', () => {
  const rows = applyScheduleToTimelineRows(
    [],
    { finish_date: '2026-08-30' },
    { start_date: '2026.01.05', finish_date: '2026-07-09', extension_date: null },
  );
  assert.equal(rows[0]?.date, '2026.01.05');
  assert.equal(rows[1]?.date, '2026-08-30');
  assert.equal(rows[2]?.date, '');
});

test('ҮР нь БАЙГАА хүснэгтийг ХЭЗЭЭ Ч дарж бичихгүй', () => {
  const before = [
    row('tl-start', '2026-01-05', 'Гэрээ байгуулсан', 'Start'),
    row('tl-ext', '2026-09-30'),
  ];
  const after = applyScheduleToTimelineRows(before, { finish_date: '2026-06-30' }, {
    start_date: '1999-01-01',
    finish_date: '1999-01-01',
    extension_date: '1999-01-01',
  });
  assert.equal(after[0]?.date, '2026-01-05');
  assert.equal(after[0]?.labelMn, 'Гэрээ байгуулсан');
  assert.equal(after.find((r) => r.id === 'tl-ext')?.date, '2026-09-30');
});

test('хоёр огноо хоосон + хүснэгт байхгүй бол ЮУ Ч үүсгэхгүй', () => {
  assert.deepEqual(applyScheduleToTimelineRows([], { start_date: null, finish_date: null }), []);
});

test('байгаа мөрийг БАЙРАН ДЭЭР нь засна — шошго, сунгалт хэвээр', () => {
  const before = [
    row('tl-start', '2026-01-05', 'Гэрээ байгуулсан', 'Start'),
    row('tl-finish', '2026-06-30', 'Дуусах', 'Finish'),
    row('tl-ext', '2026-08-15'),
    row('tl-ext-zz', '2026-09-30'),
  ];
  const after = applyScheduleToTimelineRows(before, { finish_date: '2026-07-15' });
  assert.equal(after.length, 4);
  assert.equal(after[0]?.labelMn, 'Гэрээ байгуулсан'); // гараар бичсэн шошго хэвээр
  assert.equal(after[0]?.date, '2026-01-05'); // хөндөөгүй тал ХЭВЭЭР
  assert.equal(after[1]?.date, '2026-07-15');
  assert.equal(after[3]?.date, '2026-09-30'); // сунгалтад хүрээгүй
  assert.equal(before[1]?.date, '2026-06-30'); // оролтыг мутац хийхгүй
});

test('null = цэвэрлэх (мөрийг устгахгүй, огноог нь хоосолно)', () => {
  const after = applyScheduleToTimelineRows(
    [
      row('tl-start', '2026-01-05', 'Эхлэх', 'Start'),
      row('tl-finish', '2026-06-30', 'Дуусах', 'Finish'),
    ],
    { start_date: null },
  );
  assert.equal(after.length, 2);
  assert.equal(after[0]?.date, '');
  assert.equal(after[1]?.date, '2026-06-30');
});

test('хоёулаа undefined бол хүснэгт хэвээр', () => {
  const before = [row('tl-start', '2026-01-05', 'Эхлэх', 'Start')];
  assert.deepEqual(applyScheduleToTimelineRows(before, {}), before);
});

test('тогтмол id байхгүй хүснэгтэд БАЙРЛАЛААР бичнэ (унших дүрэмтэй тэнцүү)', () => {
  const after = applyScheduleToTimelineRows(
    [row('tl-0', '', 'Эхлэх', 'Start'), row('tl-1', '', 'Дуусах', 'Finish')],
    { start_date: '2026-03-01', finish_date: '2026-04-01' },
  );
  assert.equal(after[0]?.date, '2026-03-01');
  assert.equal(after[1]?.date, '2026-04-01');
});

test('нэг мөртэй хүснэгт — дутуу канон мөр өөрийн БАЙРЛАЛД орж ирнэ', () => {
  const after = applyScheduleToTimelineRows([row('tl-start', '', 'Эхлэх', 'Start')], {
    start_date: '2026-03-01',
    finish_date: '2026-04-01',
  });
  assert.deepEqual(after, [
    { id: 'tl-start', labelEn: 'Start', labelMn: 'Эхлэх', date: '2026-03-01' },
    { id: 'tl-finish', labelEn: 'Finish', labelMn: 'Дуусах', date: '2026-04-01' },
  ]);
});

test('⚠️ СУНГАЛТЫН мөрийг байрлалын нөхөлт хэзээ ч дарж бичихгүй', () => {
  const after = applyScheduleToTimelineRows(
    [row('tl-start', '2026-01-05', 'Эхлэх', 'Start'), row('tl-ext', '2026-09-30')],
    { finish_date: '2026-06-30' },
  );
  assert.deepEqual(after, [
    { id: 'tl-start', labelEn: 'Start', labelMn: 'Эхлэх', date: '2026-01-05' },
    { id: 'tl-finish', labelEn: 'Finish', labelMn: 'Дуусах', date: '2026-06-30' },
    { id: 'tl-ext', labelEn: 'Extension', labelMn: 'Сунгалт', date: '2026-09-30' },
  ]);
  // Тойрог: сунгалт нь дуусах огноо болж хувираагүй байх ЁСТОЙ.
  assert.deepEqual(columnsFromTimelineRows(after), {
    start_date: '2026-01-05',
    finish_date: '2026-06-30',
    extension_date: '2026-09-30',
  });
});

/* ------------------------------------------------------------------ */
/*  ТОЙРОГ: багана → хүснэгт → багана                                  */
/* ------------------------------------------------------------------ */

test('«Хуваарь» цонхны бичилтийг паспортын унших зам ЯГ буцааж өгнө', () => {
  const seeds: PassportTimelineRow[][] = [
    [],
    defaultTimelineRows(),
    [row('tl-start', '2026.07.09', 'Эхлэх', 'Start')],
    [row('tl-0', '-', 'Эхлэх', 'Start'), row('tl-1', '', 'Дуусах', 'Finish')],
    [row('tl-ext', '2026-09-30')],
  ];
  for (const seed of seeds) {
    const rows = applyScheduleToTimelineRows(seed, {
      start_date: '2026-02-01',
      finish_date: '2026-05-01',
    });
    const cols = columnsFromTimelineRows(rows);
    assert.equal(cols?.start_date, '2026-02-01');
    assert.equal(cols?.finish_date, '2026-05-01');
  }
});

/* ------------------------------------------------------------------ */
/*  Normalise / parse                                                  */
/* ------------------------------------------------------------------ */

test('normalise: огноогүй ч ШОШГОТОЙ мөр үлдэнэ, бүрэн хоосон нь хаягдана', () => {
  const rows = normaliseTimelineRows([
    { id: 'tl-start', labelEn: 'Start', labelMn: 'Эхлэх', date: '' },
    { id: '', labelEn: '', labelMn: '', date: '' },
    null,
    'хог',
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, 'tl-start');
});

test('normalise: id байхгүй мөр байрлалаараа tl-N болно', () => {
  const rows = normaliseTimelineRows([{ labelMn: 'Эхлэх', date: '2026-01-01' }]);
  assert.equal(rows[0]?.id, 'tl-0');
});

test('parseTimelineJson: буруу JSON нь хоосон массив (500 БИШ)', () => {
  assert.deepEqual(parseTimelineJson('{['), []);
  assert.deepEqual(parseTimelineJson(null), []);
  assert.deepEqual(parseTimelineJson(undefined), []);
  assert.equal(
    parseTimelineJson('[{"id":"tl-start","labelMn":"Эхлэх","date":"2026-01-01"}]').length,
    1,
  );
});
