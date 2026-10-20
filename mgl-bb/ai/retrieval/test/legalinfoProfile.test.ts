/**
 * MGL AI retrieval · LEGALINFO ПРОФАЙЛ (БНбД 11-03-21, MCIS GOLD v2) — ТЕСТ.
 *
 * Run with:  node --test retrieval/test/legalinfoProfile.test.ts
 *
 * ⚠️ ДӨРӨВ ДЭХ БАГЦЫН ГУРВАН ШИНЭ ОЙЛГОЛТ энд баригдана:
 *      • `_min`/`_max` хос → ГАНЦ `between` (хагас хос → нэг талт хэвээр)
 *      • `=` харьцуулагч ЯГ тэнцүү (0.6 нь 0.5-ын алхмыг ХАНГАХГҮЙ)
 *      • лавлах хүснэгтийн утга тоон мөртэй ЗӨРВӨЛ дүрэм гүйцэтгэгдэхгүй
 *    мөн заалтын дугаар баримт ХООРОНД давхцахад нэрлэсэн баримт ялна.
 *
 * ⚠️ Бодит багц олдохгүй бол шингээлтийн тестүүд АЛГАСНА (унахгүй).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectProfile,
  normalizeAliasGroups,
  legalinfoConditions,
  legalinfoTables,
  legalinfoNumericRows,
  normalizeAliasMap,
  normalizeEffectiveStatus,
} from '../src/datasetProfiles.ts';
import { compare, evaluateRule, isExecutableVerification, type NormRule } from '../src/rules.ts';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset } from '../src/ingest.ts';
import { askNorm } from '../src/pipeline.ts';
import { structuredCandidates, namedDocuments } from '../src/search.ts';
import { normalizeQuery } from '../src/normalize.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', 'data-train-files');
// ⚠️ v3 — v2-той ижил мэдлэг + хэсэг бүрд `answer_source` (URL).  Хоёулаа
//    нэг `doc_id` тул хамт шингээвэл сүүлийнх нь ялна.
const GEO = join(ROOT, 'MCIS_MGL_AI_BNbD_11-03-21_GOLD_v3_SOURCED_COMPLETE');
const GUIDE = join(ROOT, 'MGL_AI_UBB_11_201_00_dataset');
const GEODESY = join(ROOT, 'MCIS_MGL_AI_BNbD_11-08-23_GOLD_v3_SOURCED_COMPLETE');
const HAVE_GEODESY = existsSync(join(GEODESY, 'legal_status_graph.json'));
const SNIP = join(ROOT, 'MCIS_MGL_AI_SNiP_II-97-76_GOLD_v3_SOURCED_COMPLETE');
const HAVE_SNIP = existsSync(join(SNIP, 'legal_status_graph.json'));
const skipSnip = HAVE_SNIP ? false : 'СНиП II-97-76 багц олдсонгүй';
const FOREMAN = join(ROOT, 'MGL_AI_UBB_12_204_01_dataset');
const HAVE_FOREMAN = existsSync(join(FOREMAN, 'duty_rules.jsonl'));
const skipForeman = HAVE_FOREMAN ? false : 'УББ 12-204-01 багц олдсонгүй';
const skipGeodesy = HAVE_GEODESY ? false : 'БНбД 11-08-23 багц олдсонгүй';
const HAVE_GEO = existsSync(join(GEO, 'legal_status_graph.json'));
const HAVE_GUIDE = existsSync(join(GUIDE, 'general_principles.jsonl'));
const skipGeo = HAVE_GEO ? false : 'БНбД 11-03-21 багц олдсонгүй';
const skipBoth = HAVE_GEO && HAVE_GUIDE ? false : 'хоёр багцын аль нэг олдсонгүй';

/* ── Хэлбэр таних ────────────────────────────────────────────────── */

test('legalinfo хэлбэр — duty_rules + legal_status_graph хосоор танигдана', () => {
  const files = new Set(['document.json', 'knowledge_chunks.jsonl', 'duty_rules.jsonl', 'legal_status_graph.json']);
  assert.equal(detectProfile((f) => files.has(f)), 'legalinfo_rules');
});

test('УББ 12-204-01-ийн хавтгай duty_rules нь legalinfo БИШ, flat_clause_rules гэж танигдана', () => {
  // `legal_status_graph.json`-гүй → legalinfo биш; duty + qualification хос → хавтгай заалт.
  const files = new Set(['document.json', 'knowledge_chunks.jsonl', 'duty_rules.jsonl', 'qualification_rules.jsonl', 'numeric_requirements.jsonl']);
  assert.equal(detectProfile((f) => files.has(f)), 'flat_clause_rules');
  const legal = new Set([...files, 'legal_status_graph.json']);
  assert.equal(detectProfile((f) => legal.has(f)), 'legalinfo_rules');
});

test('«БНбД»/«УББ» гэсэн баримтын ангиллын угтвар ойлголтын alias болохгүй', () => {
  const out = normalizeAliasGroups([
    { canonical: 'барилгын зураг төсөл', mn: ['зураг төсөл', 'БНбД'], latin: ['zurag tusul', 'BNbD'], en: ['approved design'] },
  ]);
  assert.deepEqual(out.map((a) => a.alias), ['зураг төсөл', 'zurag tusul', 'approved design']);
});

/* ── Тоон мөр → нөхцөл ───────────────────────────────────────────── */

const row = (name: string, operator: string, value: number, unit = 'm') => ({
  rule_id: 'D:clause:9.9',
  name,
  operator,
  value,
  unit,
  verification_status: 'verified_current_text',
});

test('_min/_max хос нь ГАНЦ between нөхцөл болно', () => {
  const conds = legalinfoConditions(
    legalinfoNumericRows([row('active_process_extra_depth_min', '>=', 3), row('active_process_extra_depth_max', '<=', 5)]),
  );
  assert.equal(conds.length, 1);
  assert.equal(conds[0]!.key, 'active_process_extra_depth');
  assert.equal(conds[0]!.cond.comparator, 'between');
  assert.deepEqual(conds[0]!.cond.value, [3, 5]);
  assert.equal(conds[0]!.cond.field, 'extra_depth_m');
  assert.equal(conds[0]!.cond.condition_text_mn, 'идэвхтэй үзэгдлийн нөлөөллийн гүнээс доош нэмэлт гүн — 3–5 м');
});

test('хагас хос нь нэг талт хэвээр — нөгөө талыг ЗОХИОХГҮЙ', () => {
  const conds = legalinfoConditions(legalinfoNumericRows([row('permafrost_min_borehole_depth', '>=', 10)]));
  assert.equal(conds.length, 1);
  assert.equal(conds[0]!.cond.comparator, '>=');
  assert.equal(conds[0]!.cond.value, 10);
  assert.equal(conds[0]!.cond.condition_text_mn, 'цэвдэг баталгаажуулах цооногийн гүн — 10 м-ээс багагүй');
});

test('танигдаагүй нэр нь ӨӨРИЙН НЭРЭЭР талбар болно — өөр нэртэй оролтыг таамаглахгүй, «дутуу» гэнэ', () => {
  const conds = legalinfoConditions(legalinfoNumericRows([row('some_future_requirement', '>=', 7, 'samples')]));
  // Багцын өөрийн тэмдэглэгээ нь талбар: `missing_context` яг тэр нэрийг асууна.
  assert.equal(conds[0]!.cond.field, 'some_future_requirement');
  const rule: NormRule = {
    rule_id: 'D:clause:9.9:numeric',
    chunk_id: 'D:clause:9.9',
    doc_id: 'D',
    rule_kind: 'threshold',
    table_no: null,
    row_no: null,
    clause_no: '9.9',
    page: null,
    section: null,
    object_mn: 'x',
    object_latin: null,
    actor: null,
    required_context: [],
    conditions: conds,
    aliases_mn: [],
    aliases_latin: [],
    aliases_en: [],
    decision_policy: 'evaluate_structured_condition_then_quote_source',
    citation_required: true,
    verification_status: 'verified_current_text',
    notes: [],
  };
  const d = evaluateRule(rule, { sample_count: 100 });
  assert.equal(d.status, 'missing_context');
  assert.deepEqual(d.missing_context, ['some_future_requirement']);
  assert.equal(evaluateRule(rule, { some_future_requirement: 7 }).status, 'evaluated');
});

test('нэгжийн гарах орны нөхцөл — эгшиг зохицол', () => {
  const conds = legalinfoConditions(
    legalinfoNumericRows([
      row('small_building_min_boreholes', '>=', 2, 'boreholes'),
      row('min_samples_per_engineering_geological_element', '>=', 6, 'samples'),
      row('sampled_boreholes_fraction', '>=', 50, 'percent'),
    ]),
  );
  const texts = conds.map((c) => c.cond.condition_text_mn);
  assert.ok(texts[0]!.endsWith('2 цооногоос багагүй'), texts[0]!);
  assert.ok(texts[1]!.endsWith('6 дээжээс багагүй'), texts[1]!);
  assert.ok(texts[2]!.endsWith('50%-иас багагүй'), texts[2]!);
});

/* ── `=` харьцуулагч ─────────────────────────────────────────────── */

test('= нь ЯГ тэнцүү — 0.6 м нь 0.5 м-ийн алхмыг хангахгүй', () => {
  assert.equal(compare(0.5, '=', 0.5), true);
  assert.equal(compare(0.6, '=', 0.5), false);
  assert.equal(compare(0.4, '=', 0.5), false);
});

/* ── Лавлах хүснэгт ↔ тоон мөрийн тулгалт ────────────────────────── */

const spacingTable = {
  borehole_spacing_table_5_1: {
    source_rule: '5.2',
    rows: [
      { engineering_geological_condition: 'simple', building_complexity: 'low', spacing_m_min: 50, spacing_m_max: 60 },
    ],
  },
};

test('хүснэгтийн утга тоон мөртэй таарвал мөрийн баталгаажилтыг өвлөнө, тоон мөр ХЭРЭГЛЭГДСЭН гэж тэмдэглэгдэнэ', () => {
  const numeric = legalinfoNumericRows([
    { ...row('borehole_spacing_simple_geo_low_building_min', '>=', 50), rule_id: 'D:clause:5.2' },
    { ...row('borehole_spacing_simple_geo_low_building_max', '<=', 60), rule_id: 'D:clause:5.2' },
  ]);
  const t = legalinfoTables('D', spacingTable, numeric, () => 'Тав');
  assert.equal(t.chunks.length, 1);
  assert.equal(t.rules.length, 1);
  assert.equal(t.warnings.length, 0);
  assert.equal(t.rules[0]!.verification_status, 'verified_current_text');
  assert.equal(t.consumed.size, 2);
  assert.equal(t.chunks[0]!.chunk_id, 'D:clause:5.2:table:5-1:simple:low');
  assert.equal(t.chunks[0]!.clause_no, '5.2');
  assert.ok(t.chunks[0]!.section_path!.startsWith('Хүснэгт 5-1'));
  assert.deepEqual(t.rules[0]!.conditions[0]!.cond.value, [50, 60]);
});

test('хүснэгтийн утга тоон мөрөөс ЗӨРВӨЛ дүрэм гүйцэтгэгдэхгүй + анхааруулга', () => {
  const numeric = legalinfoNumericRows([
    { ...row('borehole_spacing_simple_geo_low_building_min', '>=', 50), rule_id: 'D:clause:5.2' },
    { ...row('borehole_spacing_simple_geo_low_building_max', '<=', 65), rule_id: 'D:clause:5.2' },
  ]);
  const t = legalinfoTables('D', spacingTable, numeric, () => null);
  assert.equal(t.rules[0]!.verification_status, 'unverified_reference_table');
  assert.equal(isExecutableVerification(t.rules[0]!.verification_status), false);
  assert.equal(t.warnings.length, 1);
  assert.match(t.warnings[0]!, /ЗӨРЖ БАЙНА/);
});

/* ── Alias объект ба хүчинтэй төлөв ──────────────────────────────── */

test('aliases.json объект хэлбэр → canonical/language/alias мөрүүд', () => {
  const out = normalizeAliasMap({
    'БНбД 11-03-21': [
      { language: 'mn-Latn', alias: 'BNbD 11-03-21', weight: 1 },
      { language: 'mn-Cyrl', alias: 'БНбД11-03-21', weight: 1 },
      { language: 'en', alias: 'geotechnical survey norm', weight: 0.8 },
    ],
  });
  assert.deepEqual(
    out.map((a) => `${a.language}:${a.alias}`),
    ['latin:BNbD 11-03-21', 'mn:БНбД11-03-21', 'en:geotechnical survey norm'],
  );
});

test('current_verified → in_force; бусад төлөв ХЭВЭЭР', () => {
  assert.equal(normalizeEffectiveStatus('current_verified'), 'in_force');
  assert.equal(normalizeEffectiveStatus('unknown_requires_legal_verification'), 'unknown_requires_legal_verification');
  assert.equal(normalizeEffectiveStatus('current_status_not_checked_for_later_amendments'), 'current_status_not_checked_for_later_amendments');
});

/* ── Бодит багц шингээх ──────────────────────────────────────────── */

function fresh(folders: string[]) {
  const db = openKnowledgeDb({ path: ':memory:' });
  const counts = folders.map((f) => ingestDataset(db, f));
  return { db, counts };
}

test('БНбД 11-03-21 — хэсэг, дүрэм, хүснэгтийн мөр бүгд орно, эх хэсэггүй дүрэм ҮГҮЙ', { skip: skipGeo }, () => {
  const { db, counts } = fresh([GEO]);
  const c = counts[0]!;
  assert.equal(c.profile, 'legalinfo_rules');
  // 176 багцын хэсэг + 31 хүснэгтийн мөр (5-1: 9 · 5-2: 13 · 4-1: 3 · 3-1: 6).
  assert.equal(c.chunks, 207);
  assert.equal(c.rulesByKind.obligation, 14);
  assert.equal(c.rulesByKind.right, 6);
  // 4 мэргэшлийн шаардлага + 153 бусад хэсэг (хэсэг бүр дүрэмтэй — pipeline
  // эшлэлийг эхний ДҮРЭМТЭЙ хэсгээс авдаг тул).
  assert.equal(c.rulesByKind.requirement, 157);
  assert.equal(c.rulesByKind.table_row, 31);
  assert.equal(c.rulesByKind.threshold, 9);
  assert.equal(c.orphanRules.length, 0);
  assert.equal(c.tests, 213);
  assert.equal(c.cases, 14);
  // Хүснэгт бүрийн утга тоон мөртэй таарсан — анхааруулга байхгүй.
  assert.deepEqual(c.warnings, []);
  assert.equal(c.unverifiedRules, 0);
  const doc = db.prepare('SELECT effective_status FROM ai_documents WHERE doc_id = ?').get('BNBD-11-03-21-2022') as {
    effective_status: string;
  };
  assert.equal(doc.effective_status, 'in_force');
  db.close();
});

test('хуулийн төлөвийн асуулт нь ТӨЛӨВИЙН хэсгийг эшилнэ, өөр баримтын заалтыг биш', { skip: skipBoth }, () => {
  const { db } = fresh([GEO, GUIDE]);
  const a = askNorm(db, 'БНбД 11-03-01 одоо хүчинтэй юу?');
  assert.equal(a.evidence[0]?.chunk_id.startsWith('BNBD-11-03-21-2022:status:'), true);
  assert.equal(a.rule_id?.startsWith('BNBD-11-03-21-2022:status:'), true, a.rule_id ?? 'null');
  assert.equal(a.citation?.doc_id, 'BNBD-11-03-21-2022');
  db.close();
});

test('3.9 — нэг дүрэм, ГУРВАН нэрлэсэн нөхцөл; 8 м гүн нь хангахгүй, 10 м хангана', { skip: skipGeo }, () => {
  const { db } = fresh([GEO]);
  const q = 'Цэвдэгийг баталгаажуулах цооногийн гүн хангалттай юу?';
  const a = askNorm(db, q, { context: { borehole_depth_m: 8, borehole_count: 1, temperature_interval_m: 1 } });
  assert.equal(a.rule_id, 'BNBD-11-03-21-2022:clause:3.9:numeric');
  assert.equal(a.status, 'verified');
  assert.deepEqual(a.decisions, {
    permafrost_min_borehole_depth: false,
    permafrost_temperature_interval: true,
    permafrost_min_borehole_count: true,
  });
  const b = askNorm(db, q, { context: { borehole_depth_m: 10, borehole_count: 1, temperature_interval_m: 1 } });
  assert.equal(b.decisions.permafrost_min_borehole_depth, true);
  // Эшлэл нь ЗААЛТААР — хуудас зохиогдоогүй.
  assert.equal(a.citation?.clause, '3.9');
  assert.equal(a.citation?.page, null);
  assert.equal(a.citation?.legal_review_required, false);
  // GOLD v3 гэрээ: эшлэл нь АЛБАН ЁСНЫ URL-тай, хүнд уншигдах «Эх сурвалж:» мөртэй.
  assert.equal(a.citation?.source_url, 'https://legalinfo.mn/mn/detail?lawId=16390402482361');
  assert.equal(
    a.citation?.source_label_mn,
    'Эх сурвалж: БНбД 11-03-21, Гурав. Судалгааны ажилд тавигдах үндсэн шаардлага, заалт 3.9 — https://legalinfo.mn/mn/detail?lawId=16390402482361',
  );
  db.close();
});

test('дүрэмгүй байсан заалт ч ӨӨРӨӨ эшлэгдэнэ — төлөвийн хэсэг рүү шилжихгүй', { skip: skipGeo }, () => {
  const { db } = fresh([GEO]);
  const a = askNorm(db, 'БНбД 11-03-21 1.1 scope');
  assert.equal(a.rule_id, 'BNBD-11-03-21-2022:clause:1.1:requirement');
  assert.equal(a.citation?.clause, '1.1');
  // Хүчингүй болсон нормын URL (lawId=7585) энд ГАРЧ БОЛОХГҮЙ.
  assert.equal(a.citation?.source_url, 'https://legalinfo.mn/mn/detail?lawId=16390402482361');
  db.close();
});

test('Хүснэгт 5-2 — 700 кН/м, 13 м нь мөрийн хүрээнд; тэр мөр ӨӨРИЙН хэсэг ба эшлэлтэй', { skip: skipGeo }, () => {
  const { db } = fresh([GEO]);
  const a = askNorm(db, 'Шугаман суурийн ачаалал 700 кН/м бол улнаас доош 13 м өрөмдөх нь хүснэгтийн хүрээнд үү?', {
    context: { load_kn_per_m: 700, depth_m: 13 },
  });
  assert.equal(a.rule_id, 'BNBD-11-03-21-2022:clause:5.3:table:5-2:line:700');
  assert.equal(a.decisions.depth_range, true);
  assert.equal(a.decisions.load_ceiling, true);
  assert.match(a.citation?.label_mn ?? '', /Хүснэгт 5-2/);
  assert.match(a.citation?.label_mn ?? '', /заалт 5\.3/);
  db.close();
});

test('заалтын дугаар давхцахад НЭРЛЭСЭН баримт ялна (УББ-11-201-00 5.2 ≠ БНбД 5.2)', { skip: skipBoth }, () => {
  const { db } = fresh([GEO, GUIDE]);
  const q = normalizeQuery('УББ-11-201-00-ын 5.2-р заалтад юу гэж заасан бэ?');
  assert.deepEqual(namedDocuments(db, q), ['UBB-11-201-00-2000']);
  const c = structuredCandidates(db, q);
  assert.ok(c.length > 0);
  assert.ok(c.every((x) => x.chunkId.startsWith('UBB-11-201-00-2000:')), JSON.stringify(c));

  // Баримт нэрлэсэн + ганц «1.1» токен → заалтын хаяг, «заалт» гэдэг үггүй ч.
  const bare = structuredCandidates(db, normalizeQuery('БНбД 11-03-21 1.1 scope'));
  assert.equal(bare[0]?.chunkId, 'BNBD-11-03-21-2022:clause:1.1');

  // Баримт нэрлээгүй бол «1.5» нь заалт БИШ (хэмжээ байж болно).
  assert.deepEqual(structuredCandidates(db, normalizeQuery('1.5 м гүн ухах уу')), []);
  db.close();
});

/* ── БНбД 11-08-23 — ижил профайл, ХАВТГАЙ мөр, хаалттай хэсэг ─────── */

test('11-08-23 — хавтгай duty/liability мөр, range/set тоо, хэсэг бүр дүрэмтэй', { skip: skipGeodesy }, () => {
  const { db, counts } = fresh([GEODESY]);
  const c = counts[0]!;
  assert.equal(c.profile, 'legalinfo_rules');
  // 460 багцын хэсэг + 30 хүснэгтийн мөр (7 хүснэгт, холимог утга — нөхцөлгүй).
  assert.equal(c.chunks, 490);
  assert.equal(c.rulesByKind.obligation, 14);
  assert.equal(c.rulesByKind.responsibility, 5);
  assert.equal(c.rulesByKind.table_row, 30);
  assert.equal(c.orphanRules.length, 0);
  assert.equal(c.tests, 508);
  assert.equal(c.cases, 13);
  // 13 хаалттай хэсэг + 12 render_review + 2 хүснэгтийн review мөр + тоон = 32 — БҮГД гүйцэтгэгдэхгүй.
  assert.equal(c.unverifiedRules, 32);

  // `range` → between; масштаб «1:500» → нөхцөл БИШ, зарласан утга.
  const r = db.prepare('SELECT object_mn, conditions_json FROM ai_rules WHERE rule_id = ?').get('BNBD-11-08-23-2023:clause:10.5.1:numeric') as {
    object_mn: string;
    conditions_json: string;
  };
  assert.equal(JSON.parse(r.conditions_json).length, 0);
  assert.match(r.object_mn, /1:500, 1:1000/);
  const rng = db.prepare('SELECT conditions_json FROM ai_rules WHERE rule_id = ?').get('BNBD-11-08-23-2023:clause:10.1.3:numeric') as { conditions_json: string };
  const conds = JSON.parse(rng.conditions_json) as Array<{ key: string; cond: { comparator: string; value: unknown } }>;
  const strip = conds.find((x) => x.key === 'land_strip_normal');
  assert.equal(strip?.cond.comparator, 'between');
  assert.deepEqual(strip?.cond.value, [15, 20]);
  db.close();
});

test('11-08-23 — хаалттай (эвдэрсэн) заалт хайгдана, ГЭВЧ гүйцэтгэгдэхгүй; хүчинтэй эсэх асуулт төлөвийн хэсэг + тушаалын URL', { skip: skipGeodesy }, () => {
  const { db } = fresh([GEODESY]);
  const gap = askNorm(db, 'БНбД 11-08-23 10.4.5');
  assert.equal(gap.rule_id, 'BNBD-11-08-23-2023:clause:10.4.5:requirement');
  assert.equal(gap.status, 'uncertain');
  assert.match(gap.note_mn, /хүний хяналт/);

  const bound = askNorm(db, 'Хучилтын өндрийн хазайлт зөвшөөрөгдөх үү?', { context: { elevation_deviation_mm: 12.1 } });
  assert.equal(bound.rule_id, 'BNBD-11-08-23-2023:clause:12.5.6:numeric');
  assert.equal(bound.status, 'verified');
  assert.deepEqual(bound.decisions, { pavement_elevation_deviation: false });
  assert.match(bound.rule_object_mn ?? '', /12 мм-ээс ихгүй/);

  const status = askNorm(db, 'БНбД 11-08-23 хүчин төгөлдөр үү, өмнөх норм нь юу болсон бэ?');
  assert.ok(status.evidence.some((e) => e.chunk_id === 'BNBD-11-08-23-2023:status:current'));
  assert.ok(status.evidence.some((e) => e.chunk_id === 'BNBD-11-08-23-2023:status:supersedes'));
  // Төлөвийн хэсгийн эх сурвалж нь БАТЛАХ ТУШААЛ (lawId=17089502661981), нормын бичвэр биш.
  assert.equal(status.citation?.source_url, 'https://legalinfo.mn/mn/detail?lawId=17089502661981');
  db.close();
});

/* ── УББ 12-204-01 — хавтгай заалт + НИЙЛМЭЛ нөхцөл (тоо + үнэн/худал) ── */

test('12-204-01 — 4.3 үйлдвэрлэл зогсоох эрх: гурван нөхцөл ЗЭРЭГ хангагдсан үед л', { skip: skipForeman }, () => {
  const { db, counts } = fresh([FOREMAN]);
  const c = counts[0]!;
  assert.equal(c.profile, 'flat_clause_rules');
  assert.equal(c.rulesByKind.obligation, 16);
  assert.equal(c.rulesByKind.right, 10);
  assert.equal(c.rulesByKind.threshold, 2);
  assert.equal(c.orphanRules.length, 0);

  const ask = (ctx: Record<string, number | boolean>) =>
    askNorm(db, 'УББ 12-204-01 4.3', { context: ctx });
  const all = ask({ formal_proposals_in_month: 2, client_unresolved: true, serious_violation: true });
  assert.equal(all.rule_id, 'UBB-12-204-01-2002:clause:4.3:numeric');
  assert.equal(all.status, 'verified');
  assert.equal(all.decisions.all_conditions, true);
  const noViolation = ask({ formal_proposals_in_month: 2, client_unresolved: true, serious_violation: false });
  assert.equal(noViolation.decisions.serious_violation, false);
  assert.equal(noViolation.decisions.all_conditions, false);
  const one = ask({ formal_proposals_in_month: 1, client_unresolved: true, serious_violation: true });
  assert.equal(one.decisions.proposal_count_condition_met, false);
  assert.equal(one.decisions.all_conditions, false);
  // Туг ӨГӨӨГҮЙ бол таамаглахгүй — шийдэгдээгүй.
  const unknown = ask({ formal_proposals_in_month: 2 });
  assert.equal(unknown.status, 'uncertain');
  assert.equal(unknown.decisions.all_conditions, null);
  assert.ok(unknown.missing_context.includes('client_unresolved'));
  // 2001 оны баримт — хүчин төгөлдөр байдал шалгагдаагүй, эшлэл URL-гүй (зохиогдохгүй).
  assert.equal(all.citation?.legal_review_required, true);
  assert.equal(all.citation?.source_url, null);
  db.close();
});

/* ── СНиП II-97-76* — mirror эх, мөрийн id, хавсралтын 115 мөр ──────── */

test('СНиП — мөрийн id хэвээр, хавсралтын мөр нэрээр хэсэгтээ холбогдоно, mirror төлөв', { skip: skipSnip }, () => {
  const { db, counts } = fresh([SNIP]);
  const c = counts[0]!;
  assert.equal(c.profile, 'legalinfo_rules');
  // 209 багцын хэсэг + 33 хүснэгтийн мөр (6 хүснэгт).
  assert.equal(c.chunks, 242);
  assert.equal(c.rulesByKind.threshold, 239);
  // «Хавсралтын тайлбар» гэсэн 1 мөр эх хэсэггүй — ил тайлагнагдана, зохиогдохгүй.
  assert.deepEqual(c.orphanRules, ['SNIP-II-97-76-MNG:APP:conditional_density_reduction:numeric']);
  // 12 хаалттай заалт (Зөвлөлтийн хууль/ГОСТ-ын хамаарал, 2.13/2.14) → гүйцэтгэгдэхгүй.
  assert.equal(c.unverifiedRules, 12);

  const r = db.prepare('SELECT chunk_id, verification_status FROM ai_rules WHERE rule_id = ?').get('SNIP-II-97-76-MNG:APP:density_001_without_used_attic') as {
    chunk_id: string;
    verification_status: string;
  };
  assert.equal(r.chunk_id, 'SNIP-II-97-76-MNG:appendix:001');
  assert.equal(r.verification_status, 'verified_mirror_text_mongolia_listed');
  assert.equal(isExecutableVerification(r.verification_status), true);

  // Баримт нь `in_force` БИШ — mirror, PDF-тэй тулгаагүй → хуулийн хяналтын туг хэвээр.
  const a = askNorm(db, 'СНиП II-97-76* 2.10 эргийн талбайн түвшин', { context: { freeboard_m: 0.49 } });
  assert.equal(a.rule_id, 'SNIP-II-97-76-MNG:2.10:water_freeboard');
  assert.equal(a.status, 'verified');
  assert.deepEqual(a.decisions, { water_freeboard: false });
  assert.equal(a.citation?.legal_review_required, true);
  assert.match(a.citation?.source_url ?? '', /meganorm\.ru/);

  // Хаалттай заалт: хайгдана, гүйцэтгэгдэхгүй.
  const gated = askNorm(db, 'СНиП II-97-76* 2.13');
  assert.equal(gated.rule_id, 'SNIP-II-97-76-MNG:clause:2.13:requirement');
  assert.equal(gated.status, 'uncertain');

  // «Хавсралт, мөр 4» → хавсралтын 4-р мөр; «албан жагсаалт … мөр 4» → БИШ (статусын хэсэг).
  const app = askNorm(db, 'СНиП II-97-76* Хавсралт, мөр 4');
  assert.equal(app.evidence[0]?.chunk_id, 'SNIP-II-97-76-MNG:appendix:004');
  const st = askNorm(db, 'СНиП II-97-76* албан жагсаалт, х.32, Цогцолбор 30, мөр 4 юу гэж заасан бэ?');
  assert.notEqual(st.rule_id?.startsWith('SNIP-II-97-76-MNG:APP:'), true);
  db.close();
});

test('«1.6-ийн» — залгавартай заалтын дугаар нь баримт нэрлээгүй ч хаяг', () => {
  const db = openKnowledgeDb({ path: ':memory:' });
  db.exec(`INSERT INTO ai_documents (doc_id, code, title_mn, effective_status, source_file, source_sha256) VALUES ('D','УББ 12-01-01','t','in_force','','')`);
  db.exec(`INSERT INTO ai_chunks (chunk_id, doc_id, kind, clause_no, text_mn, search_text, verification_status) VALUES ('D:clause:1.6','D','clause','1.6','x','x','verified_from_page_image')`);
  assert.equal(structuredCandidates(db, normalizeQuery('2 жилийн туршлагатай хүн 1.6-ийн шаардлагыг хангах уу?'))[0]?.chunkId, 'D:clause:1.6');
  // «1.5 м» — хэмжээ, заалт биш.
  assert.deepEqual(structuredCandidates(db, normalizeQuery('1.5 м гүн ухах уу')), []);
  db.close();
});
