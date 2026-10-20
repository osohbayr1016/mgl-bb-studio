// Захиалагчийн гарын үсгийн төлөв — ЗӨВХӨН CR нь захиалагч зурсны ДАРАА л «Батлагдсан»; RFI-д захиалагч
// батлахгүй, манай тал зурсан бол батлагдсан (эзэн, 2026-10-19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientDocKind, clientSignState, parseClientSlots, slotsFromLinks, type ClientSignSlot } from './driveClientSign.ts';

const ours = (key: string, state: ClientSignSlot['state'] = 'erp'): ClientSignSlot => ({ key, client: false, state, external: false });
const clientRow = (key: string, state: ClientSignSlot['state'] = 'empty', external = false): ClientSignSlot => ({ key, client: true, state, external });

test('clientDocKind: компанийн нэршлээр RFI / CR, бусад нь null', () => {
  assert.equal(clientDocKind('261001_RFI_EVGR_图纸答疑-ЗУРАГ ТӨСЛИЙН АСУУЛТ ХАРИУЛТ-023.docx'), 'rfi');
  assert.equal(clientDocKind('261005_ORGIL_SHILTGEEN-RFI_007.docx'), 'rfi');
  assert.equal(clientDocKind('MGL-WT-CR-002.docx'), 'cr');
  assert.equal(clientDocKind('260608_MAX_URGUU_DT_CR_001.docx'), 'cr');
  assert.equal(clientDocKind('Гэрээ_CRANE.docx'), null, 'үгийн дотор биш');
  assert.equal(clientDocKind('Тайлан.docx'), null);
});

test('RFI: захиалагчийн гарын үсэг шаардахгүй — мөр, link байсан ч манай тал баталмагц бүрэн', () => {
  const s = clientSignState([ours('t0r1c3'), ours('t0r2c3'), ours('t0r3c3')], { fileName: '260930_EVGR_RFI_020.docx' });
  assert.deepEqual(s, { required: false, total: 0, signed: 0, complete: true, missing_row: false });
  // admin нэмсэн «Захиалагч хүлээн авсан» мөр хоосон + амьд link — RFI хэвээр бүрэн.
  const withRow = clientSignState([ours('a'), clientRow('t0r9c3')], {
    fileName: '261016_RFI_ORSH_UGSRALT-010.docx',
    linkKeys: new Set(['t0r9c3']),
  });
  assert.equal(withRow.required, false);
  assert.equal(withRow.complete, true);
});

test('CR захиалагчийн мөргүй (загвар өөр): шаардлагатай, мөр алга', () => {
  const s = clientSignState([ours('t0r1c3'), ours('t0r2c3')], { fileName: 'MGL-WT-CR-009.docx' });
  assert.deepEqual(s, { required: true, total: 0, signed: 0, complete: false, missing_row: true });
});

test('CR: захиалагчийн мөр хоосон → дутуу; зурсан (link эсвэл гараар) → бүрэн', () => {
  const name = 'MGL-WT-CR-002.docx';
  assert.deepEqual(clientSignState([ours('a'), clientRow('t0r5c5')], { fileName: name }), {
    required: true,
    total: 1,
    signed: 0,
    complete: false,
    missing_row: false,
  });
  assert.equal(clientSignState([ours('a'), clientRow('t0r5c5', 'erp', true)], { fileName: name }).complete, true);
  // Цаасан дээр зуруулаад сканнердаж оруулсан зураг.
  assert.equal(clientSignState([ours('a'), clientRow('t0r5c5', 'other')], { fileName: name }).complete, true);
});

test('CR: гаднын link-тэй / link-ээр зурсан мөр ч захиалагчийн тал', () => {
  const slots = [ours('g0a'), ours('g0b'), ours('g1a', 'empty'), ours('g1b', 'empty')];
  const name = '260608_MAX_URGUU_DT_CR_001.docx';
  const live = clientSignState(slots, { fileName: name, linkKeys: new Set(['g1a']) });
  assert.deepEqual([live.total, live.signed, live.complete, live.missing_row], [1, 0, false, false]);
  const signed = clientSignState([...slots.slice(0, 2), { key: 'g1a', client: false, state: 'erp', external: true }, slots[3]!], { fileName: name });
  assert.deepEqual([signed.total, signed.signed, signed.complete], [1, 1, true]);
});

test('CR биш Word баримт: захиалагчийн мөр / link байсан ч шаардлагагүй — захирал баталмагц «Батлагдсан»', () => {
  const s = clientSignState([ours('a'), ours('b')], { fileName: 'Албан бичиг_2026.docx' });
  assert.deepEqual(s, { required: false, total: 0, signed: 0, complete: true, missing_row: false });
  const withLink = clientSignState([ours('a'), clientRow('b')], { fileName: 'Албан бичиг_2026.docx', linkKeys: new Set(['b']) });
  assert.equal(withLink.required, false);
  assert.equal(withLink.complete, true);
});

test('slotsFromLinks: мөр тус бүрийн сүүлийн link — зурсны дараа шинэ link (мөр дахин хоосорсон) бол хоосон', () => {
  const s = slotsFromLinks([
    { id: 1, slot_key: 't0r13c5', slot_client: 1, status: 'signed' },
    { id: 3, slot_key: 't0r13c5', slot_client: 1, status: 'pending' },
    { id: 2, slot_key: 't0r11c5', slot_client: 1, status: 'signed' },
  ]);
  assert.deepEqual(
    s.sort((a, b) => a.key.localeCompare(b.key)),
    [
      { key: 't0r11c5', client: true, state: 'erp', external: true },
      { key: 't0r13c5', client: true, state: 'empty', external: false },
    ],
  );
});

test('parseClientSlots: эвдэрсэн JSON → null, танихгүй мөр хаягдана', () => {
  assert.equal(parseClientSlots('not json'), null);
  assert.equal(parseClientSlots(null), null);
  assert.equal(parseClientSlots('{"a":1}'), null);
  assert.deepEqual(parseClientSlots('[{"key":"k","client":true,"state":"erp","external":true},{"x":1},{"key":"z","state":"weird"}]'), [
    { key: 'k', client: true, state: 'erp', external: true },
    { key: 'z', client: false, state: 'empty', external: false },
  ]);
});
