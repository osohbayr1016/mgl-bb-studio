import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReprText, hasPythonRepr, VARIANT_LABELS_MN } from '../src/reprText.ts';
import { cleanPythonRepr, legalinfoChunks, fireHazardChunks } from '../src/datasetProfiles.ts';

/** GAP-023 — Python repr нь хэрэглэгчид харагдах/хайгдах бичвэрт ОРОХГҮЙ. */

test('харьцуулагч dict → тэмдэгт; өмнөх «=» давхардахгүй', () => {
  assert.equal(
    normalizeReprText("В1 ангилал: хувийн галын ачаалал g = {'gt': 2200} МДж/м²; тохирох арга: normalization_not_required."),
    'В1 ангилал: хувийн галын ачаалал g > 2200 МДж/м²; тохирох арга: normalization_not_required.',
  );
  assert.equal(normalizeReprText("g = {'min': 1401, 'max': 2200} МДж/м²"), 'g = 1401–2200 МДж/м²');
  assert.equal(normalizeReprText("x {'gte': 5} y {'lt': 7.5} z {'lte': 9}"), 'x ≥ 5 y < 7.5 z ≤ 9');
  assert.equal(normalizeReprText("t = {'lt': 28}"), 't < 28');
});

test('нэрлэсэн хувилбар → монгол шошго + эх түлхүүр хаалтанд; хувь нэгж', () => {
  const out = normalizeReprText(
    "Үхэр-саалийн уяатай, 400 үнээ, сүрэгт үнээ 50–60%: нөхцөлт хувилбарууд {'without_used_attic': 51, 'with_used_attic': 45}.",
    { percentVariants: true },
  );
  assert.equal(
    out,
    'Үхэр-саалийн уяатай, 400 үнээ, сүрэгт үнээ 50–60%: нөхцөлт хувилбарууд: дээврийн хөндий ашиглахгүй (without_used_attic): 51 %; дээврийн хөндий ашиглана (with_used_attic): 45 %.',
  );
  // Утга алдагдаагүй: тоо, түлхүүр бүр хэвээр.
  for (const k of ['without_used_attic', 'with_used_attic', '51', '45']) assert.ok(out.includes(k), k);
  assert.equal(hasPythonRepr(out), false);
});

test('мэдэхгүй түлхүүр шошгогүй ч repr биш болно; хувь нэгжгүй горим', () => {
  assert.equal(normalizeReprText("хувилбарууд {'foo_bar': 12, 'baz': None}"), 'хувилбарууд: foo_bar: 12; baz: —');
});

test('үүрлэсэн dict ХӨНДӨГДӨХГҮЙ — hasPythonRepr барина', () => {
  const s = "x {'foo': {'a': 1}} y";
  assert.equal(normalizeReprText(s), s);
  assert.equal(hasPythonRepr(s), true);
});

test('repr-гүй бичвэр ЯГ хэвээр (JSON, тоо, хаалт)', () => {
  for (const s of ['{"a": 1}', 'Хүснэгт 4 {1401–2200}', 'g = 1800 МДж/м²', '', '{}', "{'a'}"]) {
    assert.equal(normalizeReprText(s), s);
    assert.equal(hasPythonRepr(s), false, s);
  }
});

test('СНиП хавсралтын бүх хувилбарын түлхүүр шошготой', () => {
  const keys = [
    'without_used_attic', 'with_used_attic', 'adult', 'replacement', 'commercial', 'parent', 'incubator', 'slaughter',
    'commercial_multistorey', 'commercial_single', 'replacement_multistorey', 'replacement_single', 'incubator_multistorey',
    'incubator_single', 'slaughter_multistorey', 'slaughter_single', 'wide_span', 'pavilion', 'rough_feed_under_shed', 'rough_feed_in_stacks',
  ];
  for (const k of keys) assert.ok(typeof VARIANT_LABELS_MN[k] === 'string' && VARIANT_LABELS_MN[k]!.length > 0, k);
});

test('шингээлт: legalinfo (СНиП) ба fire_hazard (БД) адаптер repr-ийг санд оруулахгүй', () => {
  const snip = legalinfoChunks([
    {
      chunk_id: 'SNIP-II-97-76-MNG:appendix:001',
      doc_id: 'SNIP-II-97-76-MNG',
      kind: 'appendix_row',
      section: 'Хавсралт',
      text_mn: "Үхэр-саалийн уяатай: нөхцөлт хувилбарууд {'without_used_attic': 51, 'with_used_attic': 45}.",
      text_latin: "Ukher: {'without_used_attic': 51}",
      answer_source: { locator: 'Хавсралт, мөр 1' },
    },
  ]);
  for (const c of snip) {
    assert.equal(hasPythonRepr(c.text_mn), false, 'text_mn');
    assert.equal(hasPythonRepr(c.text_latin ?? ''), false, 'text_latin');
    assert.equal(hasPythonRepr(c.search_text), false, 'search_text');
    assert.ok(c.text_mn.includes('51 %'));
  }
  const bd = fireHazardChunks([
    {
      chunk_id: 'BD-21-101-12-2012:room:V2:g',
      kind: 'classification_rule',
      page: 13,
      section: 'Хүснэгт 4',
      table: 4,
      text_mn: "В2 ангилал: хувийн галын ачаалал g = {'min': 1401, 'max': 2200} МДж/м²",
      search_text: "g = {'min': 1401, 'max': 2200}",
    },
  ]);
  assert.equal(bd[0]!.text_mn, 'В2 ангилал: хувийн галын ачаалал g = 1401–2200 МДж/м²');
  assert.equal(hasPythonRepr(bd[0]!.search_text), false);
  assert.equal(cleanPythonRepr("{'gt': 2200}"), '> 2200');
});
