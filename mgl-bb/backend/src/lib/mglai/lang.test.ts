/**
 * MGL AI · ХЭЛНИЙ ЧИГЛҮҮЛЭЛТ — ТЕСТ (§1, §2, §9).
 *
 * Run with:  node --test src/lib/mglai/lang.test.ts
 *
 * ⚠️ ГОЛ АМЛАЛТ: ЛАТИНААР БИЧСЭН МОНГОЛ НЬ АНГЛИ БОЛОХГҮЙ.
 *    Загвар «chi ymar asuultand hariulj chadah ve» -ыг англи гэж үзээд
 *    англиар хариулдаг байсан.  Хэрэглэгчийн 80% нь монголоор бичдэг
 *    бүтээгдэхүүнд энэ нь ноцтой алдаа.
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

const { detectLanguage, normalizeLatinMongolian, searchText } = await import('./lang.ts');

/* ================================================================== */
/*  1. Латин монгол → монголоор хариулна                               */
/* ================================================================== */

test('латин монгол нь АНГЛИ БИШ', () => {
  // ⚠️ Энэ бол энэ файлын хамгийн чухал тест.
  const d = detectLanguage('chi ymar asuultand hariulj chadah ve');
  assert.equal(d.language, 'mn-Latn');
  assert.equal(d.responseLanguage, 'mn-Cyrl');
});

test('богино латин монгол ч танигдана', () => {
  for (const q of ['bi hen be', 'ene yu ve', 'yaj hiih ve', 'hed heden ve']) {
    const d = detectLanguage(q);
    assert.equal(d.responseLanguage, 'mn-Cyrl', q);
  }
});

test('латин монгол + нэр томьёо = mixed, ГЭХДЭЭ монголоор хариулна', () => {
  const d = detectLanguage('Revit deer ene wall-iin area hed ve?');
  assert.equal(d.language, 'mixed');
  assert.equal(d.responseLanguage, 'mn-Cyrl');
});

test('жинхэнэ англи нь англиар хариулагдана', () => {
  for (const q of ['What can you do?', 'What is the area of this wall?', 'Show me the report']) {
    const d = detectLanguage(q);
    assert.equal(d.language, 'en', q);
    assert.equal(d.responseLanguage, 'en', q);
  }
});

test('кирилл монгол', () => {
  const d = detectLanguage('Чи юу хийж чаддаг вэ?');
  assert.equal(d.language, 'mn-Cyrl');
  assert.equal(d.responseLanguage, 'mn-Cyrl');
});

test('кирилл + англи нэр томьёо = mixed, монголоор хариулна', () => {
  const d = detectLanguage('Revit дээр сонгосон wall-ын area хэд вэ?');
  assert.equal(d.language, 'mixed');
  assert.equal(d.responseLanguage, 'mn-Cyrl');
});

/* ================================================================== */
/*  2. ИЛ ХҮСЭЛТ нь бүхнээс дээгүүр                                    */
/* ================================================================== */

test('«mongoloor hariulaarai» нь монголыг ШААРДАНА', () => {
  const d = detectLanguage('mongoloor hariulaarai');
  assert.equal(d.responseLanguage, 'mn-Cyrl');
  assert.equal(d.explicitRequest, true);
});

test('англи асуулт дээр «монголоор» гэвэл МОНГОЛООР', () => {
  // ⚠️ Ил хүсэлт нь бичвэрийн хэлээс ДЭЭГҮҮР.
  const d = detectLanguage('Answer in Mongolian please');
  assert.equal(d.responseLanguage, 'mn-Cyrl');
  assert.equal(d.explicitRequest, true);
});

test('монгол асуулт дээр «англиар» гэвэл АНГЛИАР', () => {
  const d = detectLanguage('Энэ тайланг англиар бичээд өгөөч');
  assert.equal(d.responseLanguage, 'en');
  assert.equal(d.explicitRequest, true);
});

/* ================================================================== */
/*  3. Нэр томьёо нь «англи нотолгоо» БИШ (§8)                         */
/* ================================================================== */

test('зөвхөн нэр томьёо агуулсан монгол өгүүлбэр англи болохгүй', () => {
  const d = detectLanguage('Revit deer songoson yum yu bna');
  assert.equal(d.responseLanguage, 'mn-Cyrl');
});

test('нэр томьёо давамгайлсан жинхэнэ англи нь англи хэвээр', () => {
  const d = detectLanguage('export the schedule to excel');
  assert.equal(d.responseLanguage, 'en');
});

/* ================================================================== */
/*  4. Хэвийжүүлэлт (§9)                                               */
/* ================================================================== */

test('латин үгс хайлтад зориулж кирилл болно', () => {
  const n = normalizeLatinMongolian('ene tusul yagaad udaad bgaa');
  assert.match(n, /энэ/);
  assert.match(n, /төсөл/);
  assert.match(n, /яагаад/);
  assert.match(n, /байгаа/);
});

test('НЭР ТОМЬЁО хөрвүүлэгдэхгүй', () => {
  const n = normalizeLatinMongolian('Revit deer wall songoson');
  assert.match(n, /Revit/);
  assert.match(n, /wall/);
  assert.match(n, /дээр/);
});

test('танихгүй үг ХЭВЭЭР үлдэнэ', () => {
  // ⚠️ Таамаглаж гуйвуулах нь хайлтыг мууруулна.
  const n = normalizeLatinMongolian('zzzqqq ene');
  assert.match(n, /zzzqqq/);
  assert.match(n, /энэ/);
});

test('хайлтын текст нь ЭХ болон ХЭВИЙЖҮҮЛСЭН хоёуланг агуулна', () => {
  const q = 'Revit deer tusul yu bna';
  const s = searchText(q, detectLanguage(q));
  assert.match(s, /Revit/);
  assert.match(s, /төсөл/, 'хэвийжүүлсэн хэлбэр алга');
  assert.match(s, /tusul/, 'эх хэлбэр алга');
});

test('кирилл асуултыг хэвийжүүлэхгүй', () => {
  const q = 'Манай хэдэн төсөл байна?';
  assert.equal(searchText(q, detectLanguage(q)), q);
});

/* ================================================================== */
/*  5. Хилийн тохиолдол                                                */
/* ================================================================== */

test('хоосон оролт нь УНАХГҮЙ', () => {
  const d = detectLanguage('');
  assert.equal(d.responseLanguage, 'en');
  assert.equal(normalizeLatinMongolian(''), '');
});

test('зөвхөн тоо, тэмдэгт нь УНАХГҮЙ', () => {
  const d = detectLanguage('1800 MJ/m2 ???');
  assert.ok(d.language);
});

test('тэмдэг үггүй латин монгол — залгавраар танигдана (2026-09-28, эзний бодит чат англиар хариулагдсан)', () => {
  for (const q of ['Mongold hudaldaanii tov barilaa gehed, tog us avah norm durem baidag uu', 'tsahilgaantai holbootoi undur barilgiin norm', 'hamgiin hetsuu norm durmiin jagsaaltiig beltge']) {
    const d = detectLanguage(q);
    assert.equal(d.responseLanguage, 'mn-Cyrl', q);
  }
  // Англи туслах үгтэй англи асуулт англи хэвээр («us», «engineer», «floor», «need» залгавар мэт харагдана).
  for (const q of ['Tell us which norms apply to a shopping center', 'Which engineer finished the drawings?', 'We need the published schedule', 'Is the floor area above 1500 m2?', 'How many active employees do we have?']) {
    assert.equal(detectLanguage(q).responseLanguage, 'en', q);
  }
});

test('AEC латин монгол асуултыг кирилл ойлголтын хэлбэрт хэвийжүүлнэ', () => {
  const cases = [
    ['undur barilgiin tsahilgaanii norm yu ve', ['өндөр', 'барилгын', 'цахилгааны', 'норм']],
    ['galyn evakuatsiin garc heden baih yostoi ve', ['галын', 'эвакуацын', 'гарц']],
    ['shatnii gishguur hemjee normoor hed ve', ['шатны', 'гишгүүр', 'хэмжээ']],
    ['beton bagana daats yaj tootsoh ve', ['бетон', 'багана', 'даац']],
  ];
  for (const [q, words] of cases) {
    const d = detectLanguage(q);
    assert.equal(d.responseLanguage, 'mn-Cyrl', q);
    const n = normalizeLatinMongolian(q).toLowerCase();
    for (const w of words) assert.ok(n.includes(w), `${q}: ${w} алга → ${n}`);
  }
});

test('AEC currentness/structure/MEP латин үгсийг native retrieval хэлбэрт оруулна', () => {
  const cases = [
    ['31-17-23 huchintei yu esvel 31-17-10 murduh uu', ['хүчинтэй', 'мөрдөх']],
    ['gazar hodlolt salhinii achaalal yaj shalgah ve', ['газар', 'хөдлөлт', 'салхины', 'ачаалал']],
    ['utaa hamgaalalt daralt shaardlagatai yu', ['утаа', 'хамгаалалт', 'даралт', 'шаардлагатай']],
    ['tulguur zangilaa hushuun chanar', ['тулгуур', 'зангилаа', 'хөшүүн']],
    ['nasos bosoo shugamiin daralt', ['насос', 'босоо', 'шугамын', 'даралт']],
  ];
  for (const [q, words] of cases) {
    const d = detectLanguage(q);
    assert.equal(d.responseLanguage, 'mn-Cyrl', q);
    const n = normalizeLatinMongolian(q).toLowerCase();
    for (const w of words) assert.ok(n.includes(w), `${q}: ${w} алга → ${n}`);
  }
});


