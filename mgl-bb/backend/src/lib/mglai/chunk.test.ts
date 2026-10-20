/**
 * MGL AI · ХЭСЭГЛЭХ — ТЕСТ (§16).
 *
 * Run with:  node --test src/lib/mglai/chunk.test.ts
 *
 * ⚠️ ГОЛ АМЛАЛТ: «Never destroy page references» + заалт хугарахгүй.
 *    Эшлэл нь мэргэжлийн баримт бичигт хэрэглэгдэх тул «ойролцоогоор зөв»
 *    гэдэг нь хангалтгүй.
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

const { chunkDocument, chunkStructured, estimateTokens } = await import('./chunk.ts');

/* ================================================================== */
/*  1. Заалтаар хуваах                                                 */
/* ================================================================== */

const NORM = `
БҮЛЭГ 4. ГАЛЫН АЮУЛГҮЙ БАЙДАЛ

--- 17 ---

4.2.1 Олон нийтийн барилгын нэг давхарт 50-аас дээш хүн байх тохиолдолд
эвакуацын гарц хоёроос доошгүй байна.

4.2.2 Эвакуацын гарцын өргөн 1.2 м-ээс багагүй байх ёстой.

--- 18 ---

4.2.3 Эвакуацын замын урт 40 м-ээс хэтрэхгүй.
`;

test('заалт бүр ТУСДАА хэсэг болно', () => {
  const c = chunkDocument({ text: NORM });
  const clauses = c.map((x) => x.clauseNo);
  assert.deepEqual(clauses, ['4.2.1', '4.2.2', '4.2.3']);
});

test('ХУУДАСНЫ дугаар алдагдахгүй бөгөөд ЗӨВ хэсэгт очно', () => {
  const c = chunkDocument({ text: NORM });
  assert.equal(c[0]!.pageNo, 17);
  assert.equal(c[1]!.pageNo, 17);
  // 18-р хуудасны тэмдэглэгээний ДАРААХ заалт нь 18.
  assert.equal(c[2]!.pageNo, 18);
});

test('хуудасны тэмдэглэгээ АГУУЛГАД ОРОХГҮЙ', () => {
  const c = chunkDocument({ text: NORM });
  for (const x of c) {
    assert.equal(/^\s*-{0,3}\s*\d+\s*-{0,3}\s*$/m.test(x.text), false, x.text);
  }
});

test('гарчиг өвлөгдөнө, агуулгад орохгүй', () => {
  const c = chunkDocument({ text: NORM });
  assert.ok(c[0]!.heading?.includes('БҮЛЭГ 4'));
  assert.equal(c[0]!.text.includes('БҮЛЭГ 4'), false);
});

test('«хуудас 17» хэлбэрийг ч уншина', () => {
  const c = chunkDocument({ text: '[хуудас 42]\n5.1 Заалтын текст энд байна.' });
  assert.equal(c[0]!.pageNo, 42);
});

/* ================================================================== */
/*  2. Заалт БИШ тоог заалт гэж уншихгүй                               */
/* ================================================================== */

test('ХЭМЖЭЭ, ОН нь заалтын дугаар болохгүй', () => {
  const text = [
    '4.1 Хананы зузаан 1.5 м байна.',
    '',
    '2026 оны байдлаар энэ норм хүчинтэй.',
    '',
    '0.85 коэффициент хэрэглэнэ.',
  ].join('\n');
  const c = chunkDocument({ text });
  // Зөвхөн НЭГ заалт — «2026», «0.85» нь заалт БИШ.
  assert.deepEqual(
    c.map((x) => x.clauseNo).filter(Boolean),
    ['4.1'],
  );
});

test('мөрийн ДУНД байгаа дугаар нь шинэ заалт эхлүүлэхгүй', () => {
  const text = '4.1 Энэ заалт нь 4.2.1-д заасантай адил шаардлагатай.';
  const c = chunkDocument({ text });
  assert.equal(c.length, 1);
  assert.equal(c[0]!.clauseNo, '4.1');
});

test('ганц тоо (цэггүй) нь заалт болохгүй', () => {
  const c = chunkDocument({ text: '7 Энэ бол жагсаалтын мөр байж болно гэсэн урт текст.' });
  assert.equal(c[0]!.clauseNo, null);
});

/* ================================================================== */
/*  3. Урт заалт таслах                                                */
/* ================================================================== */

test('урт заалт таслагдахдаа ЗААЛТЫН ДУГААРАА хадгална', () => {
  const long = '4.9 ' + 'Энэ бол маш урт заалтын текст юм. '.repeat(80);
  const c = chunkDocument({ text: long, maxChars: 400 });
  assert.ok(c.length > 1, 'таслагдаагүй');
  for (const x of c) assert.equal(x.clauseNo, '4.9');
  // Хоёр дахь хэсгээс эхлээд үргэлжлэл гэдгийг ИЛ хэлнэ.
  assert.ok(c[1]!.text.startsWith('[4.9 үргэлжлэл]'));
});

test('таслалт нь өгүүлбэрийн хилээр явахыг оролдоно', () => {
  const long = '5.1 ' + 'Богино өгүүлбэр. '.repeat(60);
  const c = chunkDocument({ text: long, maxChars: 300 });
  // Ихэнх хэсэг нь цэгээр төгсөх ёстой (үг дундуур биш).
  const endsClean = c.filter((x) => /[.!?]\s*$/.test(x.text)).length;
  assert.ok(endsClean >= c.length - 1, `${endsClean}/${c.length} цэвэр төгссөн`);
});

test('богино дуу чимээ хаягдана', () => {
  const c = chunkDocument({ text: 'а\n\nб\n\nв' });
  assert.equal(c.length, 0);
});

/* ================================================================== */
/*  4. Фолд — кирилл/латин хайлт                                       */
/* ================================================================== */

test('фолдлогдсон текст нь латин галигаар хайхад тохирно', () => {
  const c = chunkDocument({ text: '4.1 Эвакуацын гарц хоёроос доошгүй байна.' });
  assert.ok(c[0]!.textFolded.length > 0);
  // Кирилл биш байх ёстой — латин галиг.
  assert.equal(/[Ѐ-ӿ]/.test(c[0]!.textFolded), false);
});

/* ================================================================== */
/*  5. Бүтэцтэй оролт                                                  */
/* ================================================================== */

test('бүтэцтэй мөрийг ДАХИН задлахгүй', () => {
  const rows = [
    { clause_no: '4.2.1', page_no: 17, text: 'Эвакуацын гарц хоёроос доошгүй байна.' },
    { clause_no: '4.2.2', page_no: 17, text: 'Гарцын өргөн 1.2 м-ээс багагүй.' },
  ];
  const c = chunkStructured(rows);
  assert.equal(c.length, 2);
  assert.equal(c[0]!.clauseNo, '4.2.1');
  assert.equal(c[1]!.pageNo, 17);
});

test('бүтэцтэй оролтын хоосон мөр хаягдана', () => {
  assert.equal(chunkStructured([{ text: '   ' }, { text: 'x' }]).length, 0);
});

test('seq нь 0-ээс дараалалтай', () => {
  const c = chunkDocument({ text: NORM });
  assert.deepEqual(
    c.map((x) => x.seq),
    c.map((_, i) => i),
  );
});

/* ================================================================== */
/*  6. Токены таамаг                                                   */
/* ================================================================== */

test('кирилл нь латинаас илүү токен иднэ гэж тооцно', () => {
  assert.ok(estimateTokens('барилгын ажлын зураг') > estimateTokens('construction drawing'));
});
