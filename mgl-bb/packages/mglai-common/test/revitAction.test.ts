/**
 * R4.2 — RevitActionCandidate: итгэмжлэгдээгүй загварын саналын ХАТУУ схем + блокийн салгалт.
 *   node --test test/revitAction.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractActionCandidate, validateCandidate, ACTION_BLOCK_START, ACTION_BLOCK_END } from '../src/turn/revitAction.ts';

const block = (o: unknown) => `${ACTION_BLOCK_START}${JSON.stringify(o)}${ACTION_BLOCK_END}`;
const good = { schema_version: 1, action_type: 'SET_PARAMETER', target: { reference: 'CURRENT_SELECTION' }, arguments: { parameter: 'Comments', value: 'AI санал тест' }, reason_mn: 'хэрэглэгчийн хүсэлт', confidence: 'high' };

test('extract: блок текстээс салгагдаж, санал схемд тэнцэнэ; блокгүй текст өөрчлөгдөхгүй', () => {
  const ex = extractActionCandidate(`Comments-ийг «AI санал тест» болгох санал.\n\n${block(good)}`);
  assert.equal(ex.found, true);
  assert.equal(ex.text, 'Comments-ийг «AI санал тест» болгох санал.');
  assert.deepEqual(ex.candidate?.arguments, { parameter: 'Comments', value: 'AI санал тест' });
  assert.equal(ex.rejected, null);
  const none = extractActionCandidate('Энгийн хариулт 200 мм.');
  assert.equal(none.found, false);
  assert.equal(none.text, 'Энгийн хариулт 200 мм.');
  assert.equal(none.candidate, null);
});

test('schema: итгэмжлэгдсэн талбар байвал бүхэлд нь хаягдана (action_id, binding_hash, confirmed, evidence, element_id, safety_level)', () => {
  for (const [k, v] of [['action_id', 'act_1'], ['binding_hash', 'abc'], ['confirmed', true], ['evidence', []], ['safety_level', 'SAFE_AUTOFIX'], ['proposal_source', 'USER_UI']] as const) {
    const r = validateCandidate({ ...good, [k]: v });
    assert.equal(r.candidate, null, k);
    assert.match(r.reason ?? '', /forbidden_field/);
  }
  const arg = validateCandidate({ ...good, arguments: { parameter: 'Comments', value: 'x', element_id: '2786' } });
  assert.equal(arg.candidate, null);
  assert.match(arg.reason ?? '', /forbidden_field:element_id/);
});

test('schema: зорилт ЗӨВХӨН CURRENT_SELECTION; танихгүй талбар/аргумент хаягдана; параметр цагаан жагсаалт', () => {
  assert.equal(validateCandidate({ ...good, target: { reference: 'wall 123' } }).candidate, null);
  assert.equal(validateCandidate({ ...good, target: { reference: 'CURRENT_SELECTION', id: 5 } }).candidate, null);
  assert.equal(validateCandidate({ ...good, extra: 1 }).candidate, null);
  assert.equal(validateCandidate({ ...good, arguments: { parameter: 'Area', value: '5' } }).candidate, null);
  assert.equal(validateCandidate({ ...good, arguments: { parameter: 'Comments', value: 'x', unit: 'mm' } }).candidate, null);
  assert.equal(validateCandidate({ ...good, action_type: 'DELETE_ELEMENT' }).candidate, null);
  assert.equal(validateCandidate({ ...good, action_type: 'CREATE_WALL' }).candidate, null);
  assert.equal(validateCandidate({ ...good, schema_version: 2 }).candidate, null);
});

test('schema: MOVE зөвхөн тоон дельта; CHANGE_TYPE type_name заавал; confidence хэвийжинэ', () => {
  const mv = validateCandidate({ ...good, action_type: 'MOVE_ELEMENT', arguments: { dy_mm: '100' }, confidence: 'weird' });
  assert.deepEqual(mv.candidate?.arguments, { dy_mm: '100' });
  assert.equal(mv.candidate?.confidence, 'low');
  assert.equal(validateCandidate({ ...good, action_type: 'MOVE_ELEMENT', arguments: { dy_mm: 'жаахан' } }).candidate, null);
  assert.equal(validateCandidate({ ...good, action_type: 'MOVE_ELEMENT', arguments: {} }).candidate, null);
  assert.equal(validateCandidate({ ...good, action_type: 'CHANGE_TYPE', arguments: { type_name: 'MGL-AI-TEST Wall 1 Test Alt' } }).candidate?.arguments.type_name, 'MGL-AI-TEST Wall 1 Test Alt');
  assert.equal(validateCandidate({ ...good, action_type: 'CHANGE_TYPE', arguments: { type_name: ' ' } }).candidate, null);
});

test('extract: гажуудсан JSON / олон блок / төгсгөлгүй блок — текст цэвэрлэгдэж, санал хаягдана', () => {
  const bad = extractActionCandidate(`Хариулт. ${ACTION_BLOCK_START}{not json${ACTION_BLOCK_END}`);
  assert.equal(bad.found, true);
  assert.equal(bad.candidate, null);
  assert.equal(bad.rejected, 'json_parse');
  assert.equal(bad.text, 'Хариулт.');
  const two = extractActionCandidate(`A ${block(good)} B ${block({ ...good, arguments: { parameter: 'Mark', value: '2' } })}`);
  assert.equal(two.candidate?.arguments.parameter, 'Comments', 'эхнийх л');
  assert.equal(two.text, 'A  B');
  const open = extractActionCandidate(`Хариулт ${ACTION_BLOCK_START}{"schema_version":1`);
  assert.equal(open.text, 'Хариулт');
  assert.equal(open.candidate, null);
});
