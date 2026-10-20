/**
 * `revitMatch.ts`-ийн тест — бодит MGL-ийн нэршилтэй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// `revitMatch.ts` нь `./textFold` гэж өргөтгөлгүй импорт бичдэг — Worker-ийн
// bundler шийддэг ч Node-ийн ESM loader шийддэггүй (leaveWindow.test.ts-ийн адил).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { codePrefix, codeNumber, tokenOverlap, suggestBinding, checklistTextForSheet } =
  await import('./revitMatch.ts');

const DRAWINGS = [
  { id: 880, name: 'БА — Архитектур зураг', block_id: 210 },
  { id: 881, name: 'ХАС — Халаалт агаар сэлгэлт', block_id: 210 },
  { id: 882, name: 'БА — Тохижилт', block_id: 211 },
];

const TASKS = [
  { id: 4821, name: '1-3 давхрын план', drawing_id: 880 },
  { id: 4822, name: 'Зүсэлт ба фасад', drawing_id: 880 },
  { id: 4830, name: 'Халаалтын схем', drawing_id: 881 },
  { id: 4840, name: 'Гадна тохижилт', drawing_id: 882 },
];

const sheet = (number: string, name: string) => ({ uid: 'u-' + number, number, name });

test('codePrefix: кирилл ба латин угтвар ижил гарна', () => {
  assert.equal(codePrefix('БА-01'), 'ba');
  assert.equal(codePrefix('BA 01'), 'ba');
  assert.equal(codePrefix('ХАС-12'), 'has');
  assert.equal(codePrefix('БА — Архитектур зураг'), 'ba');
  assert.equal(codePrefix('01'), '', 'угтваргүй бол хоосон');
  assert.equal(codePrefix(''), '');
});

test('codeNumber: цифрэн хэсэг', () => {
  assert.equal(codeNumber('БА-01'), '01');
  assert.equal(codeNumber('ХАС-12'), '12');
  assert.equal(codeNumber('Тохижилт'), '');
});

test('tokenOverlap: хоосон нь юутай ч таарахгүй', () => {
  assert.equal(tokenOverlap('', 'ямар нэг зүйл'), 0);
  assert.equal(tokenOverlap('ямар нэг зүйл', ''), 0);
  assert.equal(tokenOverlap('', ''), 0);
});

test('tokenOverlap: кирилл↔латин давхцлыг олно', () => {
  assert.ok(tokenOverlap('халаалтын схем', 'halaaltin shem') > 0);
});

test('угтвар ганц зурагт таарвал — өндөр итгэлцэл', () => {
  const r = suggestBinding(sheet('ХАС-01', 'Халаалтын схем'), DRAWINGS, TASKS);
  assert.equal(r.drawing_id, 881);
  assert.equal(r.task_id, 4830, 'зургийн ганц ажил автоматаар');
  assert.equal(r.match_source, 'number');
  assert.ok(r.confidence >= 0.8, `confidence=${r.confidence}`);
});

test('угтвар ОЛОН зурагт таарвал — нэрээр ялгана', () => {
  // 'ba' угтвар нь 880 ба 882 хоёуланд байна.
  const r = suggestBinding(sheet('БА-05', 'Гадна тохижилт'), DRAWINGS, TASKS);
  assert.equal(r.drawing_id, 882, 'нэрийн давхцлаар Тохижилт ялах ёстой');
  assert.equal(r.task_id, 4840);
});

test('хуудасны нэр ажлын нэртэй яг давхцвал — 0.95', () => {
  const r = suggestBinding(sheet('БА-01', '1-3 давхрын план'), DRAWINGS, TASKS);
  assert.equal(r.drawing_id, 880);
  assert.equal(r.task_id, 4821);
  assert.equal(r.confidence, 0.95);
});

test('латинаар бичсэн хуудас кирилл зурагт таарна', () => {
  const r = suggestBinding(sheet('BA-01', '1-3 davhriin plan'), DRAWINGS, TASKS);
  assert.equal(r.drawing_id, 880, 'BA ба БА ижил байх ёстой');
});

test('таарахгүй хуудас — юу ч санал болгохгүй, ЗОХИОХГҮЙ', () => {
  const r = suggestBinding(sheet('XYZ-99', 'Огт өөр зүйл'), DRAWINGS, TASKS);
  assert.equal(r.drawing_id, null);
  assert.equal(r.task_id, null);
  assert.equal(r.match_source, null);
  assert.equal(r.confidence, 0);
});

test('зураг олдсон ч ажил тодорхойгүй бол итгэлцэл БУУРНА', () => {
  // 880 дээр хоёр ажил, аль нь ч нэрээр таарахгүй.
  const r = suggestBinding(sheet('БА-77', 'Тодорхойгүй агуулга'), DRAWINGS, TASKS);
  assert.equal(r.drawing_id, 880);
  assert.equal(r.task_id, null);
  assert.ok(r.confidence <= 0.5, `инженер заавал сонгох ёстой (${r.confidence})`);
});

test('нэр дэвшигч огт байхгүй бол уналгүй ажиллана', () => {
  const r = suggestBinding(sheet('БА-01', '1-р давхар'), [], []);
  assert.equal(r.drawing_id, null);
  assert.equal(r.confidence, 0);
});

test('checklistTextForSheet: формат ба уртын таг', () => {
  assert.equal(checklistTextForSheet(sheet('БА-01', '1-р давхрын план'), 300), 'БА-01 — 1-р давхрын план');
  assert.equal(checklistTextForSheet(sheet('', ''), 300), 'Нэргүй хуудас');
  const long = checklistTextForSheet(sheet('БА-01', 'х'.repeat(400)), 50);
  assert.equal(long.length, 50);
  assert.ok(long.endsWith('…'));
});
