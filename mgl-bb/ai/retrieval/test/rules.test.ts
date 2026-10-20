/**
 * MGL AI retrieval · ДҮРМИЙН ХӨДӨЛГҮҮР — ТЕСТ (§18: «deterministic calculations»).
 *
 * Run with:  node --test retrieval/test/rules.test.ts
 *
 * ⚠️ ГОЛ АМЛАЛТУУД:
 *      • босго−1 / босго / босго+1 нь ЯГ зөв тасарна
 *      • `>` ба `>=` ХОЛИЛДОХГҮЙ
 *      • баталгаажаагүй дүрэм ХЭЗЭЭ Ч гүйцэтгэгдэхгүй
 *      • дутуу нөхцөл нь «шаардлагагүй» БОЛЖ ХУВИРАХГҮЙ (null, false биш)
 *      • ХУГАЦААНЫ НЭГЖ СОЛИГДОХГҮЙ (хоног ≠ сар)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  compare,
  evaluateRule,
  decisionFlags,
  candidateFields,
  type NormRule,
  type RuleCondition,
} from '../src/rules.ts';

function rule(over: Partial<NormRule> = {}): NormRule {
  return {
    rule_id: 'DOC:T3:R1',
    chunk_id: 'DOC:T3:R1',
    doc_id: 'DOC',
    rule_kind: 'table_row',
    table_no: 3,
    row_no: '1',
    clause_no: null,
    page: 6,
    section: 'Агуулах',
    object_mn: 'А ангиллын агуулахын өрөө',
    object_latin: null,
    actor: null,
    required_context: [],
    conditions: [],
    aliases_mn: [],
    aliases_latin: [],
    aliases_en: [],
    decision_policy: 'evaluate_structured_condition_then_quote_source',
    citation_required: true,
    verification_status: 'verified_from_page_image',
    notes: [],
    ...over,
  };
}

const area = (comparator: '>' | '>=' | '<' | '<=', value: number): RuleCondition => ({
  required: true,
  kind: 'area',
  comparator,
  value,
  unit: 'm2',
  condition_text_mn: null,
});

/* ── Харьцуулагч ─────────────────────────────────────────────────── */

test('«ба түүнээс их» (>=) нь босго дээр ҮНЭН', () => {
  // ⚠️ БҮХ ЗҮЙЛ ЭНД ТОГТОНО.  299 vs 300 нь барилгын бодит шийдвэр.
  assert.equal(compare(299, '>=', 300), false);
  assert.equal(compare(300, '>=', 300), true);
  assert.equal(compare(301, '>=', 300), true);
});

test('«-аас дээш» (>) нь босго дээр ХУДАЛ', () => {
  // ⚠️ УББ 12-01-01-ийн 1.3: «1.0 тэрбумаас ДЭЭШ».  Багцын алтан кейс G002
  //    нь яг 1.0 тэрбум дээр ХУДАЛ гарахыг шаарддаг.
  assert.equal(compare(1_000_000_000, '>', 1_000_000_000), false);
  assert.equal(compare(1_200_000_000, '>', 1_000_000_000), true);
});

test('«хүртэл» (<=) ба «-аас бага» (<) ялгаатай', () => {
  assert.equal(compare(7000, '<=', 7000), true);
  assert.equal(compare(7000, '<', 7000), false);
});

test('«between» нь ХОЁР ТАЛДАА хаалттай', () => {
  assert.equal(compare(4, 'between', [5, 12]), false);
  assert.equal(compare(5, 'between', [5, 12]), true);
  assert.equal(compare(12, 'between', [5, 12]), true);
  assert.equal(compare(13, 'between', [5, 12]), false);
});

/* ── Нэрлэсэн нөхцөл ─────────────────────────────────────────────── */

test('босгын гурван цэг — ГУАТ/ГМДХ хос нөхцөлөөр', () => {
  const r = rule({
    required_context: ['area_m2'],
    conditions: [
      { key: 'GUAT', cond: area('>=', 300) },
      { key: 'GMDH', cond: area('<', 300) },
    ],
  });
  assert.deepEqual(decisionFlags(evaluateRule(r, { area_m2: 299 })), { GUAT: false, GMDH: true });
  assert.deepEqual(decisionFlags(evaluateRule(r, { area_m2: 300 })), { GUAT: true, GMDH: false });
  assert.deepEqual(decisionFlags(evaluateRule(r, { area_m2: 301 })), { GUAT: true, GMDH: false });
});

test('нэрлэсэн ГАНЦ нөхцөл — УББ-ийн босго', () => {
  // ⚠️ Хоёр дахь баримт нь `guat`/`gmdh` гэсэн хосгүй.  Хөдөлгүүр НЭГ
  //    хэвээр үлдэх ёстой — энэ тест тэр гэрээг барина.
  const r = rule({
    rule_id: 'UBB:threshold:1.3:investment',
    rule_kind: 'threshold',
    clause_no: '1.3',
    required_context: ['annual_investment_mnt'],
    conditions: [
      {
        key: 'effect',
        cond: {
          required: true,
          kind: 'field',
          comparator: '>',
          value: 1_000_000_000,
          unit: 'MNT/year',
          condition_text_mn: 'Бие даасан захиалагчийн алба заавал байгуулна.',
          field: 'annual_investment_mnt',
        },
      },
    ],
  });
  assert.equal(decisionFlags(evaluateRule(r, { annual_investment_mnt: 1_200_000_000 })).effect, true);
  assert.equal(decisionFlags(evaluateRule(r, { annual_investment_mnt: 1_000_000_000 })).effect, false);
});

test('«kind: all» нь нөхцөлгүй шаардана', () => {
  const r = rule({
    conditions: [
      {
        key: 'GUAT',
        cond: {
          required: true,
          kind: 'all',
          comparator: null,
          value: null,
          unit: null,
          condition_text_mn: 'Талбайгаас хамаарахгүй',
        },
      },
    ],
  });
  assert.equal(decisionFlags(evaluateRule(r, {})).GUAT, true);
});

/* ── Хугацааны нэгж ──────────────────────────────────────────────── */

const deadline = (unit: string, value: number): RuleCondition => ({
  required: true,
  kind: 'field',
  comparator: '<=',
  value,
  unit,
  condition_text_mn: null,
  field: unit === 'days' ? 'after_permanent_operation' : 'after_handover',
});

test('ЕРӨНХИЙ хоногийн оролт нь ХОНОГИЙН дүрмийг үнэлнэ', () => {
  const r = rule({ rule_kind: 'deadline', conditions: [{ key: 'effect', cond: deadline('days', 15) }] });
  assert.equal(decisionFlags(evaluateRule(r, { elapsed_days: 15 })).effect, true);
  assert.equal(decisionFlags(evaluateRule(r, { elapsed_days: 16 })).effect, false);
});

test('⚠️ хоногийн оролт нь САРЫН дүрмийг үнэлэхгүй — хуанли шаардана', () => {
  // ⚠️ ЭНЭ БОЛ ГОЛ АЮУЛГҮЙ БАЙДЛЫН ШИНЖ.  «2 сар» нь 59-62 хоног байж
  //    болно — 50 хоногийг «багтсан» гэж шийдэх нь ХУДАЛ ИТГЭЛТЭЙ хариу.
  //    Багцын алтан кейс G006 яг үүнийг шаарддаг.
  const r = rule({ rule_kind: 'deadline', conditions: [{ key: 'effect', cond: deadline('months', 2) }] });
  const d = evaluateRule(r, { elapsed_days: 50 });
  assert.equal(d.status, 'missing_context');
  assert.equal(decisionFlags(d).effect, null, 'хоногоор сарын босгыг шийдэж БОЛОХГҮЙ');
});

test('candidateFields нь нэгжийн ерөнхий оролтыг зөвхөн ТААРАХ нэгжид өгнө', () => {
  assert.ok(candidateFields(deadline('days', 15)).includes('elapsed_days'));
  assert.ok(!candidateFields(deadline('months', 2)).includes('elapsed_days'));
});

/* ── Хаалганууд ──────────────────────────────────────────────────── */

test('БАТАЛГААЖААГҮЙ дүрэм ГҮЙЦЭТГЭГДЭХГҮЙ', () => {
  // ⚠️ БОДЛОГЫН ХААЛГА.  Багцын 6 мөр «needs_human_review» — тэднийг
  //    итгэлтэйгээр тооцоолох нь ХУДАЛ норм гаргана.
  const r = rule({
    verification_status: 'needs_human_review',
    required_context: ['area_m2'],
    conditions: [{ key: 'GUAT', cond: area('>=', 300) }],
  });
  const d = evaluateRule(r, { area_m2: 5000 });
  assert.equal(d.status, 'blocked_unverified');
  assert.deepEqual(d.outcomes, {}, 'баталгаажаагүй дүрэм үнэлгээ ГАРГАХГҮЙ');
});

test('НӨХЦӨЛГҮЙ дүрэм нь «дутуу» БИШ — үүрэг, эрх нь тоогүй', () => {
  // ⚠️ УББ-ийн 33 үүрэг, 5 эрх, 1 хариуцлагад босго БАЙХГҮЙ.  Тэднийг
  //    «тооцоолж чадсангүй» гэж тэмдэглэвэл ЗӨВ хариу эргэлзээтэй харагдана.
  const r = rule({ rule_kind: 'obligation', actor: 'захиалагч', conditions: [] });
  const d = evaluateRule(r, {});
  assert.equal(d.status, 'no_conditions');
  assert.deepEqual(d.missing_context, []);
});

test('дутуу нөхцөл нь «шаардлагагүй» болж хувирахгүй', () => {
  // ⚠️ Талбайг мэдэхгүй байхад GUAT=false гэж хариулах нь ХАМГИЙН
  //    АЮУЛТАЙ гаралт — барилга нормгүй үлдэнэ.
  const r = rule({ required_context: ['area_m2'], conditions: [{ key: 'GUAT', cond: area('>=', 300) }] });
  const d = evaluateRule(r, {});
  assert.equal(d.status, 'missing_context');
  assert.deepEqual(d.missing_context, ['area_m2']);
  assert.equal(decisionFlags(d).GUAT, null, 'мэдэхгүйг null-аар илэрхийлнэ, false-ээр БИШ');
});

test('null утга нь 0 болж хувирахгүй', () => {
  // `Number(null) === 0` нь JS-ийн урхи — 0 м² нь бүх босгыг унагана.
  const r = rule({ required_context: ['area_m2'], conditions: [{ key: 'GUAT', cond: area('>=', 300) }] });
  assert.equal(evaluateRule(r, { area_m2: null }).status, 'missing_context');
});

test('«external_norm» нь тоон хариу ГАРГАХГҮЙ', () => {
  const r = rule({
    conditions: [
      {
        key: 'GUAT',
        cond: {
          required: true,
          kind: 'external_norm',
          comparator: null,
          value: null,
          unit: null,
          condition_text_mn: 'ШТС-ын нормын дагуу',
        },
      },
    ],
  });
  const d = evaluateRule(r, { area_m2: 900 });
  assert.equal(d.outcomes.GUAT?.state, 'external_norm');
  assert.equal(decisionFlags(d).GUAT, null, 'өөр нормд шилжсэнийг true/false гэж хэлэхгүй');
});

test('гүйцэтгэлд хэрэглэсэн утга бүртгэгдэнэ (аудит)', () => {
  const r = rule({
    required_context: ['area_m2', 'fire_hazard_category'],
    conditions: [{ key: 'GUAT', cond: area('>=', 300) }],
  });
  const d = evaluateRule(r, { area_m2: 310, fire_hazard_category: 'A' });
  assert.equal(d.inputs_used.area_m2, 310);
  assert.equal(d.inputs_used.fire_hazard_category, 'A');
});

test('«power» нь хоёр талбарын алийг нь ч хүлээж авна', () => {
  // ⚠️ Багцад нэг ойлголт хоёр нэртэй — хоёуланг нь дэмжихгүй бол
  //    трансформаторын дүрэм мөнхөд «дутуу нөхцөл» гэж хариулна.
  const r = rule({
    conditions: [
      {
        key: 'GUAT',
        cond: {
          required: true,
          kind: 'power',
          comparator: '>=',
          value: 63,
          unit: 'MVA',
          condition_text_mn: null,
        },
      },
    ],
  });
  assert.equal(decisionFlags(evaluateRule(r, { power_mva: 63 })).GUAT, true);
  assert.equal(decisionFlags(evaluateRule(r, { transformer_power_mva: 63 })).GUAT, true);
});
