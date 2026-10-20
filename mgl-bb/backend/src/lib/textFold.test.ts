/**
 * `textFold.ts`-ийн тест.
 *
 * ⚠️ Доорх КОРПУС нь `frontend/src/shared/lib/search/normalize.ts`-ийн
 * `foldSearchText`-тэй байгуулсан ГЭРЭЭ.  Хоёрын аль нэгийг өөрчилвөл
 * нөгөөг нь БОЛОН энэ корпусыг зэрэг шинэчил.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { foldText, foldCode, foldCodeVariants } from './textFold.ts';

/** Frontend-ийн `foldSearchText`-тэй ижил гарах ёстой хосууд. */
const CORPUS: Array<[input: string, expected: string]> = [
  ['Илүү цаг', 'ilu cag'],
  ['iluu tsag', 'ilu cag'],
  ['ilu cag', 'ilu cag'],
  ['Тайлан', 'tailan'],
  ['taylan', 'tailan'],
  ['Хөшигтийн', 'hoshigtin'],
  ['khoshigtiin', 'hoshigtin'],
  ['MGL-260101_Хөшиг', 'mgl 260101 hoshig'],
  ['Ирц', 'irc'],
  ['', ''],
];

test('foldText: frontend-ийн foldSearchText-тэй ижил үр дүн (корпус гэрээ)', () => {
  for (const [input, expected] of CORPUS) {
    assert.equal(foldText(input), expected, `foldText(${JSON.stringify(input)})`);
  }
});

test('foldText: МОНГОЛ ҮГИЙГ ГЭМТЭЭХГҮЙ — qtoNormalize-ийн х→x алдааны регресс', () => {
  // `normalizeRawName` нь эдгээрийг 'xалаалт' / 'xac01' болгодог.  foldText
  // кирилл «х»-ийг ҮСЭГ гэж үзэж 'h' болгоно.
  assert.equal(foldText('халаалт'), 'halalt');
  assert.equal(foldText('ХАС'), 'has');
  assert.equal(foldText('хийн хангамж'), 'hin hangamj');
  // Латин 'x' нэг ч гарахгүй.
  for (const w of ['халаалт', 'ХАС-01', 'хийн хангамж', 'Хөшиг']) {
    assert.ok(!foldText(w).includes('x'), `${w} → ${foldText(w)} дотор 'x' байна`);
  }
});

test('foldCode: шифрийн кирилл↔латин таарц — энэ feature-ийн үндсэн шаардлага', () => {
  // Нэг хуудас, хоёр бичлэг — ЗААВАЛ таарах ёстой.
  assert.equal(foldCode('БА-01'), foldCode('BA 01'));
  assert.equal(foldCode('БА-01'), 'ba01');
  assert.equal(foldCode('ХАС-01'), foldCode('HAS_01'));
  assert.equal(foldCode('ХАС-01'), 'has01');
  assert.equal(foldCode('ЭХ-12'), foldCode('EH 12'));
  // Ялгаатай хуудсууд таарч БОЛОХГҮЙ.
  assert.notEqual(foldCode('БА-01'), foldCode('БА-02'));
  assert.notEqual(foldCode('БА-01'), foldCode('ХАС-01'));
});

test('foldCode: дугаарыг хураахгүй — 1200 ≠ 120', () => {
  assert.equal(foldCode('АЗ-1200'), 'az1200');
  assert.notEqual(foldCode('АЗ-1200'), foldCode('АЗ-120'));
  // Давхар ҮСЭГ хураагдана, давхар ТОО хураагдахгүй.
  assert.equal(foldText('aa11'), 'a11');
});

test('foldText/foldCode: хоосон ба тэмдэг л агуулсан оролт', () => {
  assert.equal(foldText('---'), '');
  assert.equal(foldCode('---'), '');
  assert.equal(foldCode('  '), '');
});

/* ══════════════════ foldCodeVariants — глиф хувилбарууд ══════════════════ */

/** Хоёр шифр таарна гэдэг нь тэдгээрийн ХУВИЛБАРЫН ОЛОНЛОГ огтлолцох явдал. */
function codesMatch(a: string, b: string): boolean {
  const left = foldCodeVariants(a);
  return foldCodeVariants(b).some((v) => left.includes(v));
}

test('foldCodeVariants: кирилл↔латин шифр ХОЁР ТАЛААС таарна (продакшны алдаа)', () => {
  // ⚠️ Энэ бол feature-ийн үндсэн шаардлага.  Хадгалагдсан тал латин,
  // хайлтын тал кирилл — БОЛОН ЭСРЭГЭЭР.
  assert.ok(codesMatch('MEC-25/21', 'МЕС-25/21'), 'латин → кирилл');
  assert.ok(codesMatch('МЕС-25/21', 'MEC-25/21'), 'кирилл → латин');
  assert.ok(codesMatch('МЕС24/08', 'MEC24/08'), 'төсөл 36-ийн бичлэг');
  assert.ok(codesMatch('MEC24/08', 'МЕС24/08'), 'эсрэг чиглэл');

  // Зөвхөн индексийн талд хувилбар гаргавал хангалтгүй байсныг батлана:
  // латин мөрийн олонлог ГАНЦ гишүүнтэй тул кирилл фонетик хэлбэр таарахгүй.
  assert.deepEqual(foldCodeVariants('MEC-25/21'), ['mec2521']);
  assert.ok(!foldCodeVariants('MEC-25/21').includes(foldCode('МЕС-25/21')));
});

test('foldCodeVariants: фонетик хэлбэр ҮРГЭЛЖ олонлогт байна', () => {
  assert.equal(foldCode('ХАС-01'), 'has01');
  assert.ok(foldCodeVariants('ХАС-01').includes('has01'), 'фонетик');
  assert.ok(foldCodeVariants('ХАС-01').includes('xac01'), 'глиф');
  assert.equal(foldCodeVariants('ХАС-01')[0], 'has01', 'фонетик нь ЭХЭНД');
  // Латин бичлэгтэй хоёулаа таарна — аль ч гараас бичсэн хүн олно.
  assert.ok(codesMatch('ХАС-01', 'HAS-01'));
  assert.ok(codesMatch('ХАС-01', 'XAC-01'));
});

test('foldCodeVariants: давхардлыг хасна, хоосон мөр буцаахгүй', () => {
  // Кирилл үсэггүй мөрөнд глиф ба фонетик хэлбэр адилхан.
  assert.deepEqual(foldCodeVariants('BA-01'), ['ba01']);
  assert.deepEqual(foldCodeVariants(''), []);
  assert.deepEqual(foldCodeVariants('---'), []);
  assert.deepEqual(foldCodeVariants('   '), []);
  for (const code of ['МЕС-25/21', 'ХАС-01', 'БА-01', 'MEC-25/21', '', '---']) {
    const variants = foldCodeVariants(code);
    assert.equal(new Set(variants).size, variants.length, `${code}: давхардал`);
    assert.ok(!variants.includes(''), `${code}: хоосон гишүүн`);
  }
});

test('foldCodeVariants: ялгаатай шифр таарч БОЛОХГҮЙ', () => {
  assert.ok(!codesMatch('БА-01', 'БА-02'));
  assert.ok(!codesMatch('MEC-25/21', 'MEC-25/22'));
  assert.ok(!codesMatch('MEC-25/21', 'MEC-25/2'));
  assert.ok(!codesMatch('БА-01', 'ХАС-01'));
});

test('foldText/foldCode: глиф нэмэлт нь ТЭДГЭЭРИЙГ ХӨНДӨӨГҮЙ (регресс)', () => {
  // ⚠️ Гарчигт сануулсан монгол үгс — «с → c» нь ЗӨВХӨН шифрийн замд
  // орсон эсэхийг батлана.  Эдгээрийн аль нэг өөрчлөгдвөл teamContext.ts,
  // revitMatch.ts, rulePack.ts болон вэбийн хайлт чимээгүй эвдэрнэ.
  assert.equal(foldText('халаалт'), 'halalt');
  assert.equal(foldText('ХАС-01'), 'has 01');
  assert.equal(foldCode('ХАС-01'), 'has01');
  assert.equal(foldText('цаг'), 'cag');
  assert.equal(foldText('сар'), 'sar');
  assert.notEqual(foldText('сар'), foldText('цар'), '«сар» ба «цар» нэг болж БОЛОХГҮЙ');
  assert.equal(foldCode('МЕС-25/21'), 'mes2521');
  assert.equal(foldCode('MEC-25/21'), 'mec2521');
  // Корпус бүхэлдээ хэвээр.
  for (const [input, expected] of CORPUS) {
    assert.equal(foldText(input), expected, `foldText(${JSON.stringify(input)})`);
  }
});

test('foldCodeVariants: ЧӨЛӨӨТ ТЕКСТЭД ХЭРЭГЛЭЖ БОЛОХГҮЙ — хэмжигдсэн мөргөлдөөн', () => {
  // ⚠️ Энэ бол функцын хэрэглээний хил.  Глиф хэлбэрт «с → c», «р → p» тул
  // «сар» ба «цар» ХОЁУЛАА 'cap' гэсэн гишүүнтэй болж ОГТЛОЛЦОНО.
  // Тиймээс `foldCodeVariants` нь ЗӨВХӨН шифрийн талбарт (drawing_no,
  // doc_no, хуудасны дугаар).  Чөлөөт текстийн хайлт `foldText`-ээр л явна.
  assert.ok(foldCodeVariants('сар').includes('cap'));
  assert.ok(foldCodeVariants('цар').includes('cap'));
  assert.ok(codesMatch('сар', 'цар'), 'чөлөөт текстэд худал таарц үүсдгийг баталгаажуулав');
  // Харин foldText дээр огт таарахгүй — үндсэн хайлт хэвээрээ.
  assert.notEqual(foldText('сар'), foldText('цар'));
  // «ХАС» багийн код глифээр 'xac' болно — багийн кодыг ЭНЭ ФУНКЦЭЭР бүү фолд.
  assert.ok(foldCodeVariants('ХАС').includes('xac'));
});
