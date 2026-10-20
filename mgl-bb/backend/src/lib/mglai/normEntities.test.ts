/**
 * MGL AI · НОРМЫН ХЭМЖИГДЭХҮҮН ГАРГАХ — ТЕСТ.
 *
 * Run with:  node --test src/lib/mglai/normEntities.test.ts
 *
 * ⚠️ ЭНЭ НЬ ШИЙДВЭРИЙН ГИНЖНИЙ ЭХНИЙ ХОЛБООС.  Энд буруу тоо гарвал
 *    доод талын бүх тооцоо буруу — тиймээс кирилл, латин, холимог
 *    бичлэгийг тус тусад нь шалгана.
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

const { extractNormEntities } = await import('./normEntities.ts');

/* ================================================================== */
/*  1. g — гурван бичлэгээр                                            */
/* ================================================================== */

test('латин: g=1800 MJ/m2', () => {
  assert.equal(extractNormEntities('g=1800 MJ/m2 bol V2 yu V3 yu').gMjM2, 1800);
});

test('кирилл: 1800 МДж/м²', () => {
  assert.equal(
    extractNormEntities('Хувийн галын ачаалал 1800 МДж/м² бол ямар ангилал вэ?').gMjM2,
    1800,
  );
});

test('холимог: кирилл өгүүлбэр + латин нэгж', () => {
  assert.equal(extractNormEntities('Хувийн галын ачаалал 1800 MJ/m2 bol?').gMjM2, 1800);
});

test('нэрлэсэн хэмжигдэхүүн нэгжгүй ч олдоно', () => {
  assert.equal(extractNormEntities('хувийн галын ачаалал 950 байвал?').gMjM2, 950);
});

test('м² өргөтгөсөн ба энгийн тэмдэгт ХОЁУЛАА', () => {
  assert.equal(extractNormEntities('1500 МДж/м2').gMjM2, 1500);
  assert.equal(extractNormEntities('1500 МДж/м²').gMjM2, 1500);
});

test('аравтын бутархай', () => {
  assert.equal(extractNormEntities('g=180.5 МДж/м²').gMjM2, 180.5);
});

/* ================================================================== */
/*  2. Q, S, H                                                         */
/* ================================================================== */

test('Q ба S тусад нь гарна', () => {
  const e = extractNormEntities('Галын ачаалал Q=18000 МДж, талбай S=20 м² бол?');
  assert.equal(e.qMj, 18000);
  assert.equal(e.sM2, 20);
});

test('H өндөр гарна', () => {
  assert.equal(extractNormEntities('H=11 м бол зай хэд вэ?').hM, 11);
  assert.equal(extractNormEntities('өндөр 6 м').hM, 6);
});

test('⚠️ «МДж/м²»-ийн «МДж»-ыг Q гэж УНШИХГҮЙ', () => {
  // ⚠️ Энэ бол хамгийн нарийн урхи: «1800 МДж/м²» нь ХУВИЙН ачаалал,
  //    нийт ачаалал БИШ.  Андуурвал өөр дүрэм, өөр хариу гарна.
  const e = extractNormEntities('Хувийн галын ачаалал 1800 МДж/м²');
  assert.equal(e.gMjM2, 1800);
  assert.equal(e.qMj, undefined, 'МДж/м²-ыг Q гэж уншсан!');
});

test('g ба Q ХОЁУЛАА байвал хоёуланг нь гаргана', () => {
  const e = extractNormEntities('g=1800 МДж/м², Q=50000 МДж, H=6 м');
  assert.equal(e.gMjM2, 1800);
  assert.equal(e.qMj, 50000);
  assert.equal(e.hM, 6);
});

/* ================================================================== */
/*  3. Бусад хэмжигдэхүүн                                              */
/* ================================================================== */

test('тэсрэлтийн даралт ба авалцан асах хэм', () => {
  const e = extractNormEntities('25°C авалцан асах хэмтэй шингэний ΔP 7 кПа');
  assert.equal(e.flashPointC, 25);
  assert.equal(e.deltaPKpa, 7);
});

/* ================================================================== */
/*  4. Дурдагдсан ангилал — кирилл В ба латин V                        */
/* ================================================================== */

test('латин V2/V3 нь кирилл В2/В3 болж хэвийжинэ', () => {
  // ⚠️ Дэлгэц дээр «В» ба «V» ялгагдахгүй; баримт нь кириллээр.
  const e = extractNormEntities('g=1800 MJ/m2 bol V2 yu V3 yu');
  assert.deepEqual(e.mentionedCategories, ['В2', 'В3']);
});

test('кирилл В2 шууд танигдана', () => {
  assert.deepEqual(extractNormEntities('В2 ангилал юу вэ?').mentionedCategories, ['В2']);
});

test('дурдаагүй бол ХООСОН', () => {
  assert.deepEqual(extractNormEntities('g=1800 МДж/м²').mentionedCategories, []);
});

/* ================================================================== */
/*  5. ТААМАГЛАХГҮЙ                                                    */
/* ================================================================== */

test('утга байхгүй бол undefined — ТААМАГЛАХГҮЙ', () => {
  // ⚠️ §15: байхгүй тоог «магадгүй ийм байх» гэж нөхөх нь зохиох замын
  //    эхлэл.  `undefined` нь дараагийн давхаргад «дутуу» гэж хэлэх
  //    боломж өгнө.
  const e = extractNormEntities('Галын аюулын ангилал гэж юу вэ?');
  assert.equal(e.gMjM2, undefined);
  assert.equal(e.qMj, undefined);
  assert.equal(e.hM, undefined);
});

test('хоосон оролт нь УНАХГҮЙ', () => {
  const e = extractNormEntities('');
  assert.equal(e.gMjM2, undefined);
  assert.deepEqual(e.mentionedCategories, []);
});

test('trace нь оношилгоонд юу олсныг харуулна', () => {
  const e = extractNormEntities('g=1800 МДж/м²');
  assert.ok(e.trace.some((t) => t.includes('1800')));
});

/* ── GAP-022 (Session C) · тооны хэлбэрүүд ─────────────────────────── */

test('GAP-022 · «2 200 мдж/м2», «2 200 мджм2», «g ni/нь 2200», «1800,5», «1 401» бүгд уншигдана', () => {
  assert.equal(extractNormEntities('2 200 мдж/м2').gMjM2, 2200);
  assert.equal(extractNormEntities('2 200 мджм2').gMjM2, 2200, 'зураасгүй МДж/м²');
  assert.equal(extractNormEntities('2 200 мджм2').qMj, undefined, 'мджм2 нь Q биш');
  assert.equal(extractNormEntities('g ni 2200').gMjM2, 2200);
  assert.equal(extractNormEntities('g нь 2200').gMjM2, 2200);
  assert.equal(extractNormEntities('g=2200').gMjM2, 2200);
  assert.equal(extractNormEntities('2200MJ/m2').gMjM2, 2200);
  assert.equal(extractNormEntities('g=1800,5 MJ/m2').gMjM2, 1800.5, 'монгол аравтын таслал');
  assert.equal(extractNormEntities('хувийн галын ачаалал 1 401 МДж/м²').gMjM2, 1401);
  assert.equal(extractNormEntities('Q=24,000 МДж, S=30 м²').qMj, 24000);
  assert.equal(extractNormEntities('g = 1800 МДж/м², Q=50000 МДж').qMj, 50000);
});

test('GAP-022 · «1.800» хоёрдмол → утга ӨГӨХГҮЙ, `ambiguous`-д бүртгэнэ (таамаглахгүй)', () => {
  const e = extractNormEntities('g = 1.800 MJ/m2');
  assert.equal(e.gMjM2, undefined);
  assert.deepEqual(e.ambiguous, [{ quantity: 'g', raw: '1.800' }]);
  assert.equal(extractNormEntities('g = 1.8 MJ/m2').gMjM2, 1.8, 'аравтын цэг (3-аас өөр орон) хэвийн');
  assert.equal(extractNormEntities('g = 1800.5 MJ/m2').gMjM2, 1800.5);
  assert.equal(extractNormEntities('g = 1,800 MJ/m2').gMjM2, 1800, 'таслалт мянгат (validator-ийн дүрэм)');
});
