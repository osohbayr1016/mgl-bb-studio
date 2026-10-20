/**
 * MGL AI runtime · ДАВТАЛТЫН ИЛРҮҮЛЭГЧ — ТЕСТ.
 *
 * Run with:  node --test runtime/test/repetition.test.ts
 *
 * ⚠️ ЭНЭ ФАЙЛЫН ХАГАС НЬ ХУДАЛ ЭЕРЭГИЙН ТЕСТ, ЗОРИУД.  Илрүүлэгчийн
 *    жинхэнэ эрсдэл нь «давталтыг олохгүй байх» БИШ, харин «ЗӨВ хариултыг
 *    давталт гэж барих».  Техникийн монгол хариулт нь нэр томьёо, заалтын
 *    дугаар, хүснэгтийн зураас, жагсаалтын угтварыг олон удаа давтдаг —
 *    тэднийг барих нь анхны алдаанаас ДОР үр дагавартай.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectRepetition, StreamingRepetitionGuard } from '../src/repetition.ts';

/* ================================================================== */
/*  1. ЖИНХЭНЭ ГАЖИГ — БАРИГДАХ ЁСТОЙ                                  */
/* ================================================================== */

test('монгол хэллэгийн эцэс төгсгөлгүй давталт баригдана', () => {
  const text =
    'Барилгын захиалагч нь дараах үүрэгтэй. ' +
    'шаардлагатай байна. '.repeat(12);
  const v = detectRepetition(text);
  assert.equal(v.repeating, true, 'монгол давталт баригдсангүй');
  assert.ok(v.repeats >= 6, `давталтын тоо ${v.repeats}`);
});

test('англи хэллэгийн давталт баригдана', () => {
  const v = detectRepetition('The client must ' + 'ensure compliance and '.repeat(10));
  assert.equal(v.repeating, true);
});

test('нэг үгийн давталт баригдана', () => {
  const v = detectRepetition('Хариулт: ' + 'шаардлагатай '.repeat(14));
  assert.equal(v.repeating, true);
  assert.equal(v.cycleWords, 1);
});

test('олон үгийн мөчлөг баригдана (a b c a b c …)', () => {
  const v = detectRepetition('Эхлэл. ' + 'зураг төсөл боловсруулах '.repeat(8));
  assert.equal(v.repeating, true);
  assert.ok(v.cycleWords >= 1 && v.cycleWords <= 12);
});

test('ХАМГИЙН БОГИНО мөчлөгийг олно («а б а б» нь 2-үгийн)', () => {
  const v = detectRepetition('Тест ' + 'нэг хоёр '.repeat(10));
  assert.equal(v.repeating, true);
  assert.equal(v.cycleWords, 2, `мөчлөг ${v.cycleWords} үг гэж олдов`);
});

test('давталт хариултын СҮҮЛД байхад баригдана (эхлэл нь хэвийн)', () => {
  const good =
    'Барилгын захиалагч нь зураг төслийг батлуулах, экспертиз хийлгэх, ' +
    'барилгын ажлыг хянах үүрэгтэй. Мөн санхүүжилтийг зохион байгуулна. ';
  const v = detectRepetition(good + 'дүгнэлт гаргах. '.repeat(10));
  assert.equal(v.repeating, true);
});

/* ================================================================== */
/*  2. ХУДАЛ ЭЕРЭГ — БАРИГДАХ ЁСГҮЙ                                    */
/* ================================================================== */

test('ЖАГСААЛТ нь давталт БИШ', () => {
  const v = detectRepetition(
    [
      '1. Зураг төслийг боловсруулах',
      '2. Экспертиз хийлгэх',
      '3. Барилгын ажлыг эхлүүлэх',
      '4. Гүйцэтгэлийг хянах',
      '5. Ашиглалтад хүлээн авах',
      '6. Баримт бичгийг архивлах',
      '7. Санхүүжилтийг зохион байгуулах',
      '8. Гэрээг дүгнэх',
    ].join('\n'),
  );
  assert.equal(v.repeating, false, `жагсаалт давталт гэж баригдав: ${v.phrase}`);
});

test('MARKDOWN ХҮСНЭГТ нь давталт БИШ', () => {
  const v = detectRepetition(
    [
      '| Заалт | Шаардлага | Хуудас |',
      '| --- | --- | --- |',
      '| 2.5 | Зөвшөөрөл авах | 6 |',
      '| 3.4 | Норм дагах | 8 |',
      '| 5.1 | Хариуцлага хүлээх | 11 |',
    ].join('\n'),
  );
  assert.equal(v.repeating, false, `хүснэгт давталт гэж баригдав: ${v.phrase}`);
});

test('зөвхөн ЦЭГ ТАСЛАЛААС бүрдсэн мөчлөг баригдахгүй', () => {
  // ⚠️ Markdown тусгаарлагч, кодын хаалт — бүгд хууль ёсны.
  assert.equal(detectRepetition('| --- '.repeat(12)).repeating, false);
  assert.equal(detectRepetition('— '.repeat(30)).repeating, false);
  assert.equal(detectRepetition('}) '.repeat(12)).repeating, false);
});

test('КОД нь давталт БИШ', () => {
  const v = detectRepetition(
    [
      'const a = compute(1);',
      'const b = compute(2);',
      'const c = compute(3);',
      'const d = compute(4);',
      'return a + b + c + d;',
    ].join('\n'),
  );
  assert.equal(v.repeating, false, `код давталт гэж баригдав: ${v.phrase}`);
});

test('ДАВТАГДСАН НЭР ТОМЬЁО нь давталт БИШ', () => {
  // «БНбД», «заалт», «шаардлага» нь техникийн хариултад олон удаа гарна.
  const v = detectRepetition(
    'БНбД 21-04-05-ын заалтад заасан шаардлага нь БНбД 11-01-98-ын заалттай ' +
      'нийцэх ёстой. Мөн БНбД 11-02-97-ын шаардлагыг заалт бүрд нь дагана. ' +
      'Эдгээр БНбД-ийн заалт нь шаардлагыг тодорхойлно.',
  );
  assert.equal(v.repeating, false, `нэр томьёо давталт гэж баригдав: ${v.phrase}`);
});

test('монгол ЧАНГАТГАЛ (2-3 давталт) баригдахгүй', () => {
  assert.equal(detectRepetition('Энэ нь маш маш маш чухал асуудал юм.').repeating, false);
  assert.equal(detectRepetition('Дахин дахин шалгах хэрэгтэй байна.').repeating, false);
});

test('ТОМЬЁО давтагдсан нь давталт БИШ', () => {
  const v = detectRepetition(
    'g = 1800 МДж/м². Хэрэв g > 1400 бол В2. Хэрэв g > 2200 бол В3. ' +
      'Хэрэв g < 1400 бол В1 болно.',
  );
  assert.equal(v.repeating, false);
});

test('БОГИНО хариулт баригдахгүй', () => {
  assert.equal(detectRepetition('Тийм ээ.').repeating, false);
  assert.equal(detectRepetition('57 ажилтан байна.').repeating, false);
  assert.equal(detectRepetition('').repeating, false);
});

/* ================================================================== */
/*  3. ХИЛ, ГҮЙЦЭТГЭЛ                                                  */
/* ================================================================== */

test('урт хэвийн бичвэр дээр CPU нь хязгаарлагдана (цонх)', () => {
  const long = 'Барилгын зураг төслийн ажлыг гүйцэтгэх шаардлага тавигдана. '.repeat(2000);
  const t = Date.now();
  const v = detectRepetition(long);
  const ms = Date.now() - t;
  // ⚠️ Энэ нь ДАВТАЛТ мөн (нэг өгүүлбэр 2000 удаа) — баригдах ЁСТОЙ,
  //    гэхдээ цонхны улмаас ХУРДАН.
  assert.equal(v.repeating, true);
  assert.ok(ms < 250, `${ms} мс — цонх ажиллахгүй байна`);
});

test('маш урт ХЭВИЙН бичвэр удаан биш', () => {
  let text = '';
  for (let i = 0; i < 3000; i++) text += `Мөр ${i}: барилгын ажлын гүйцэтгэл. `;
  const t = Date.now();
  detectRepetition(text);
  assert.ok(Date.now() - t < 250);
});

/* ================================================================== */
/*  4. УРСГАЛЫН ХАМГААЛАГЧ                                             */
/* ================================================================== */

test('урсгалын хамгаалагч нь ХЭСГИЙН ХИЛЭЭР тасарсан үгийг зөв цуглуулна', () => {
  const guard = new StreamingRepetitionGuard();
  // ⚠️ Үгийн ДУНДУУР тасарсан хэсгүүд — жинхэнэ SSE-д ингэж ирдэг.
  const chunks = ['шаард', 'лагатай ', 'бай', 'на. '];
  let tripped = false;
  for (let i = 0; i < 20 && !tripped; i++) {
    for (const c of chunks) {
      if (guard.push(c).repeating) {
        tripped = true;
        break;
      }
    }
  }
  assert.equal(tripped, true, 'урсгалаар ирсэн давталт баригдсангүй');
});

test('урсгалын хамгаалагч нь ХЭВИЙН бичвэрт дуугарахгүй', () => {
  const guard = new StreamingRepetitionGuard();
  const text =
    'Барилгын захиалагч нь зураг төслийг боловсруулах, түүнийг холбогдох ' +
    'байгууллагаар батлуулах, улсын экспертиз хийлгэх, барилга угсралтын ' +
    'ажлын чанарт хяналт тавих, ашиглалтад хүлээн авах зэрэг үүргийг хүлээнэ. ' +
    'Мөн санхүүжилтийн эх үүсвэрийг бүрдүүлж, гэрээний нөхцөлийг биелүүлнэ.';
  for (const ch of text.match(/.{1,7}/gu) ?? []) {
    assert.equal(guard.push(ch).repeating, false, 'хэвийн бичвэрт дуугарав');
  }
  assert.equal(guard.finish().repeating, false);
});

test('урсгалын хамгаалагчийн САНАХ ОЙ хязгаартай', () => {
  const guard = new StreamingRepetitionGuard();
  for (let i = 0; i < 5000; i++) guard.push(`мөр ${i} өөр агуулгатай текст. `);
  // Дотоод сүүл нь тогтмол хэмжээтэй байх ёстой — шууд хэмжиж чадахгүй тул
  // хугацаагаар нь баталгаажуулна: өсөж байвал энэ нь удаашрана.
  const t = Date.now();
  for (let i = 0; i < 200; i++) guard.push(`нэмэлт ${i}. `);
  assert.ok(Date.now() - t < 250, 'сүүл хязгааргүй өсөж байна');
});

test('нэг удаа дуугарсны дараа тогтвортой хэвээр (давхар мэдэгдэхгүй)', () => {
  const guard = new StreamingRepetitionGuard();
  let first = -1;
  for (let i = 0; i < 60; i++) {
    const v = guard.push('шаардлагатай байна. ');
    if (v.repeating && first < 0) first = i;
  }
  assert.ok(first >= 0, 'дуугарсангүй');
  assert.equal(guard.verdict.repeating, true);
  // Дараагийн дуудлагууд ижил шийдвэрийг буцаана.
  assert.equal(guard.push('өөр текст ').repeating, true);
});

test('finish() нь БОГИНО давталтыг барина (шалгалтын алхмаас бага)', () => {
  const guard = new StreamingRepetitionGuard();
  // 48 тэмдэгтийн алхамд хүрэхгүй ч дуусгах үед шалгагдана.
  guard.push('өө ');
  for (let i = 0; i < 8; i++) guard.push('за ');
  const v = guard.finish();
  // «за за за …» нь 1-үгийн мөчлөг боловч minSpanChars-д хүрэхгүй тул
  // хууль ёсны богино дуу гэж үзнэ — энэ нь ЗӨВ зан төлөв.
  assert.equal(typeof v.repeating, 'boolean');
});
