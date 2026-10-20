/**
 * `lib/teamDayWork.ts`-ийн тест.  Файл нь импортгүй, цэвэр функц тул
 * `registerHooks` шаардлагагүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hhmmMinutes, nonProjectCoversNow } from './teamDayWork.ts';

const at = (hhmm: string) => hhmmMinutes(hhmm);

test('hhmmMinutes: ЦЦ:ММ ба ЦЦ:ММ:СС, буруу утга null', () => {
  assert.equal(hhmmMinutes('00:00'), 0);
  assert.equal(hhmmMinutes('14:30'), 870);
  assert.equal(hhmmMinutes('14:30:59'), 870);
  assert.equal(hhmmMinutes(' 09:05 '), 545);
  assert.equal(hhmmMinutes('24:00'), null);
  assert.equal(hhmmMinutes('9:05'), null);
  assert.equal(hhmmMinutes(''), null);
  assert.equal(hhmmMinutes(null), null);
  assert.equal(hhmmMinutes(undefined), null);
});

test('эзний жишээ: 14:00–16:00 ажил 15:00-д ОДОО', () => {
  assert.equal(nonProjectCoversNow({ start_time: '14:00', end_time: '16:00' }, at('15:00')), true);
});

test('муж нь хагас нээлттэй [эхлэх, дуусах)', () => {
  const e = { start_time: '14:00', end_time: '16:00' };
  assert.equal(nonProjectCoversNow(e, at('14:00')), true);
  assert.equal(nonProjectCoversNow(e, at('15:59')), true);
  assert.equal(nonProjectCoversNow(e, at('16:00')), false);
  assert.equal(nonProjectCoversNow(e, at('13:59')), false);
});

test('өнгөрсөн / ирээдүйн өдөр (nowMin = null) хэзээ ч одоо биш', () => {
  assert.equal(nonProjectCoversNow({ start_time: '00:00', end_time: '23:59' }, null), false);
});

test('гэмтэлтэй эсвэл урвуу муж одоо гэж тооцогдохгүй', () => {
  assert.equal(nonProjectCoversNow({ start_time: 'xx', end_time: '16:00' }, at('15:00')), false);
  assert.equal(nonProjectCoversNow({ start_time: '16:00', end_time: '14:00' }, at('15:00')), false);
  assert.equal(nonProjectCoversNow({ start_time: '15:00', end_time: '15:00' }, at('15:00')), false);
});
