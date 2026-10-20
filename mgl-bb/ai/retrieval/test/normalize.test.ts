/**
 * MGL AI retrieval · НОРМЧЛОГЧ — ТЕСТ (§18: «query normalization»).
 *
 * Run with:  node --test retrieval/test/normalize.test.ts
 *
 * ⚠️ ГОЛ АМЛАЛТУУД:
 *      • нэгжийн бүх бичлэг НЭГ хэлбэрт очно (м²/м2/m2/sqm)
 *      • олдоогүй нөхцөл нь `undefined`, 0 БИШ
 *      • «m» нь «m2»/«m3»-ыг ЗАЛГИХГҮЙ
 *      • кирилл ↔ латин галиг НЭГ фолд руу нийлнэ
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { foldText } from '../src/fold.ts';
import {
  normalizeUnits,
  detectScript,
  extractEntities,
  extractDocRef,
  tokenize,
  normalizeQuery,
} from '../src/normalize.ts';

test('фолд нь кирилл ба латин галигийг нийлүүлнэ', () => {
  // ⚠️ Энэ хос нь mn-Latn хайлтын ҮНДЭС.  Зөрвөл 112 латин тест унана.
  assert.equal(foldText('Хавсралтад'), foldText('Khavsraltad'));
  assert.equal(foldText('ГУАТ'), 'guat');
  assert.equal(foldText('GUAT'), 'guat');
});

test('фолд нь ТОО-г хураахгүй', () => {
  // «1200» → «120» болвол нормыг дугаараар нь олох боломжгүй болно.
  assert.match(foldText('1200 м2'), /1200/);
  assert.match(foldText('300'), /300/);
});

test('нэгжийн бүх бичлэг нэг хэлбэрт очно', () => {
  for (const s of ['300 м²', '300 м2', '300 m2', '300 sqm', '300 кв.м', '300 квадрат метр']) {
    assert.match(normalizeUnits(s), /\bm2\b/, `«${s}» → m2 болоогүй`);
  }
  for (const s of ['4 м³', '4 м3', '4 m3', '4 cubic meters']) {
    assert.match(normalizeUnits(s), /\bm3\b/, `«${s}» → m3 болоогүй`);
  }
  assert.match(normalizeUnits('500 кВ'), /\bkV\b/);
  assert.match(normalizeUnits('63 МВА'), /\bMVA\b/);
});

test('бичгийн системийг ялгана', () => {
  assert.equal(detectScript('Галын дохиолол хэрэгтэй юу?'), 'mn-Cyrl');
  assert.equal(detectScript('Galyn dokhiolol kheregtei yu?'), 'mn-Latn');
  assert.equal(detectScript('Does the building require a fire alarm?'), 'en');
  // ⚠️ Холимог нь БОДИТ тохиолдол — «GUAT хэрэгтэй юу?» гэж бичдэг.
  assert.equal(detectScript('GUAT хэрэгтэй юу?'), 'mixed');
});

test('талбай, эзэлхүүн, өндрийг ялган гаргана', () => {
  const e = extractEntities('2500 м² талбайтай 30 м өндөр барилга');
  assert.equal(e.area_m2, 2500);
  assert.equal(e.height_m, 30);
  // ⚠️ Эзэлхүүн БАЙХГҮЙ — `undefined` байх ёстой, 0 БИШ.  0 байвал
  //    «100 м³-ээс их» гэсэн босго ХУДАЛ унана.
  assert.equal(e.volume_m3, undefined);
});

test('«m» нь «m2»-ыг залгихгүй', () => {
  // ⚠️ Хэмжсэн ХАЛТИРГАА: `m` нь `m2`-ын угтвар тул болгоомжгүй regex нь
  //    «2500 м²» дотроос өндөр = 2500 гэж уншина.
  const e = extractEntities('2500 м² зогсоол');
  assert.equal(e.area_m2, 2500);
  assert.equal(e.height_m, undefined);
});

test('зайтай бичсэн том тоог зөв уншина', () => {
  assert.equal(extractEntities('500 000 нэгж 2 500 м²').area_m2, 2500);
});

test('галын ангилал, тэсвэршилтийн зэрэг, бүтээцийн ангилал', () => {
  const e = extractEntities('Гал тэсвэршилтийн IV зэрэгтэй C1 ангиллын битүү авто зогсоол');
  assert.equal(e.fire_resistance_degree, 'IV');
  assert.equal(e.structural_fire_class, 'C1');
  assert.equal(e.parking_type, 'enclosed');
});

test('давхрын байрлалыг ялгана', () => {
  assert.equal(extractEntities('зоорийн давхарт').floor_position, 'basement');
  assert.equal(extractEntities('хагас зоорьт байрлах').floor_position, 'semi_basement');
});

test('эх сурвалжийн шууд хаягийг барина', () => {
  const r = extractDocRef('БНбД 21-04-05 Хүснэгт 3, мөр 9.1.2, хуудас 8');
  assert.equal(r.code, 'БНбД 21-04-05');
  assert.equal(r.table, 3);
  assert.equal(r.row, '9.1.2');
  assert.equal(r.page, 8);
});

test('токенчлол нь богино ҮГИЙГ хаяна, богино ТООГ хадгална', () => {
  const t = tokenize('3 м3 сав нь ба энэ');
  // ⚠️ «3» нь нормын хамгийн ялгамжтай токен — хаявал 3 м³ савны дүрэм
  //    олдохгүй болно.
  assert.ok(t.includes('3'), '«3» хадгалагдах ёстой');
  assert.ok(!t.includes('нь'), '«нь» хаягдах ёстой');
});

test('ГУАТ/ГМДХ-ийн аль нь гэдгийг таана; хоёуланг нь дурдаагүй бол ХОЁУЛАА', () => {
  assert.deepEqual(normalizeQuery('Спринклер хэрэгтэй юу?').asks, { guat: true, gmdh: false });
  assert.deepEqual(normalizeQuery('Галын дохиолол хэрэгтэй юу?').asks, { guat: false, gmdh: true });
  // Нээлттэй асуултад нэгийг нь дуугүй орхих нь ДУТУУ хариу.
  assert.deepEqual(normalizeQuery('300 м² агуулахад юу тавих вэ?').asks, { guat: true, gmdh: true });
});
