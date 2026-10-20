/**
 * L0 нормын бүртгэл (ai/norm-dataset) — runtime `/norm` → `registry` блокийг ЦАГААН ЖАГСААЛТААР л уншина.
 * Хөтөч бол тээвэр: дурын талбар, `http:` URL, танигдахгүй төлөв, 8-аас олон мөр — бүгд хаягдана.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const LN = await import('./localNorm');

const entry = (over: Record<string, unknown> = {}) => ({
  code: 'БНбД 31-17-10',
  title_mn: 'Өндөр барилгын төлөвлөлт',
  status: 'ACTIVE',
  status_note_mn: 'MCIS: Хүчин төгөлдөр',
  capability_level: 'L2',
  source_url: 'https://mcis.gov.mn/main/single/16201345052562',
  legal_source_url: 'https://legalinfo.mn/mn/detail/7524',
  last_verified: '2026-09-16',
  matched: { topics: ['high-rise', 'lighting'], teams: ['electrical'] },
  ...over,
});

test('parseLocalNormRegistry · named + matches цагаан жагсаалтаар, хэмжээ хязгаартай', () => {
  const r = LN.parseLocalNormRegistry({
    named: { ...entry(), deep_ingested: false, injected: 'x' },
    interpretation: { teams: ['electrical'], topics: ['high-rise', 'lighting'], building_types: ['high-rise'] },
    matches: Array.from({ length: 12 }, (_, i) => entry({ code: `БД 43-10${i}-03` })),
    excluded_non_current: 1.9,
    answer_mode: 'LINKS_ONLY',
  });
  assert.ok(r);
  assert.equal(r.named?.code, 'БНбД 31-17-10');
  assert.equal(r.named?.deepIngested, false);
  assert.equal(r.named?.sourceUrl, 'https://mcis.gov.mn/main/single/16201345052562');
  assert.equal((r.named as unknown as Record<string, unknown>).injected, undefined);
  assert.equal(r.matches.length, 8);
  assert.deepEqual(r.interpretation, { teams: ['electrical'], topics: ['high-rise', 'lighting'], buildingTypes: ['high-rise'] });
  assert.equal(r.excludedNonCurrent, 1);
  assert.deepEqual(r.matches[0]?.matchedTopics, ['high-rise', 'lighting']);
});

test('parseLocalNormRegistry · http URL, танигдахгүй төлөв, кодгүй мөр хаягдана', () => {
  const r = LN.parseLocalNormRegistry({
    named: entry({ source_url: 'http://mcis.gov.mn/x', status: 'ACTIVE' }),
    matches: [entry({ status: 'BOGUS' }), entry({ code: '' }), entry({ title_mn: null }), entry({ status: 'DRAFT', code: 'БНбД 31-17-23' })],
  });
  assert.ok(r);
  assert.equal(r.named?.sourceUrl, null);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0]?.status, 'DRAFT');
});

test('parseLocalNorm · registry байхгүй хуучин runtime-д null, байвал уншигдана', () => {
  const base = { status: 'insufficient_evidence', evidence: [], no_match_reason: 'named_document_absent', named_document: { code: 'БНбД 31-17-10', absent: true } };
  assert.equal(LN.parseLocalNorm(base)?.registry, null);
  const withReg = LN.parseLocalNorm({ ...base, registry: { named: { ...entry(), deep_ingested: false }, matches: [] } });
  assert.equal(withReg?.registry?.named?.code, 'БНбД 31-17-10');
  assert.equal(withReg?.namedDocument?.absent, true);
});

/* ── L1 сэдвийн чиглүүлэгч (runtime `registry.topic_router`, 2026-09-18) ── */

const routeRow = (over: Record<string, unknown> = {}) => ({
  registry_id: 'mn-construction:43c7973ecbc6711e97a3',
  code: 'БД 43-104-12',
  code_pkg: 'БД 43-104-12',
  title_mn: 'Цахилгааны хийц арматур, угсралтын галын аюулгүй байдлын шаардлага',
  status: 'STATUS_REQUIRES_VERIFICATION',
  status_note_mn: '2025 оны нормын бүртгэлийн жагсаалтад байсан; 2026 оны хүчин төгөлдөр байдал ШАЛГАГДААГҮЙ',
  status_verified: true, // ⚠️ runtime/хөтөч дур мэдэн true өгсөн ч Worker ДАХИН шийднэ
  superseded_by: null,
  scope_classes: ['technical_or_regulatory'],
  topics: ['electrical', 'fire_safety'],
  url: 'https://www1.gazar.gov.mn/upload/news_files/16-202504161017426.pdf#page=44',
  legal_source_url: null,
  router_score: 99.6,
  router_reason: 'curated_highrise_overlay',
  clause_text: 'ЗОХИОМОЛ ЗААЛТ', // цагаан жагсаалтад байхгүй → хаягдана
  ...over,
});

test('parseLocalNormTopicRoute · мөр бүр код/нэр/URL/төлөвтэй; STATUS_REQUIRES_VERIFICATION ХЭЗЭЭ Ч verified биш; ACTIVE л verified', () => {
  const r = LN.parseLocalNormRegistry({
    matches: [],
    topic_router: {
      detected_topics: ['highrise', 'electrical'],
      detection: 'exact',
      wants_cost: false,
      wants_labour: false,
      count: 3,
      excluded: { cost: 2, labour: 0 },
      results: [
        routeRow(),
        routeRow({ registry_id: 'mn-construction:efa9c834c1f527ec3773', code: 'БНбД 31-17-10', status: 'ACTIVE', status_verified: false, url: 'https://mcis.gov.mn/storage/uploads/x.pdf' }),
        routeRow({ registry_id: 'mn-construction:3a5239949fa5dca93cab', code: 'БД 11-106-08', status: 'SUPERSEDED', superseded_by: 'БНбД 11-106-25' }),
      ],
    },
  });
  assert.ok(r?.topicRouter);
  const tr = r.topicRouter;
  assert.deepEqual(tr.detectedTopics, ['highrise', 'electrical']);
  assert.equal(tr.detection, 'exact');
  assert.equal(tr.total, 3);
  assert.equal(tr.truncated, false);
  assert.deepEqual(tr.excluded, { cost: 2, labour: 0 });
  assert.equal(tr.results.length, 3);
  assert.equal(tr.results[0]?.status, 'STATUS_REQUIRES_VERIFICATION');
  assert.equal(tr.results[0]?.statusVerified, false, 'runtime-ийн true туг ҮЛ ТООГДОНО');
  assert.equal(tr.results[1]?.statusVerified, true, 'ACTIVE = MCIS-ээр баталгаажсан');
  assert.equal(tr.results[2]?.supersededBy, 'БНбД 11-106-25');
  assert.equal((tr.results[0] as unknown as Record<string, unknown>).clause_text, undefined);
  assert.equal((tr.results[0] as unknown as Record<string, unknown>).clauseText, undefined);
  assert.match(tr.results[0]?.statusNoteMn ?? '', /ШАЛГАГДААГҮЙ/);
});

test('parseLocalNormTopicRoute · URL-гүй / http / нэргүй / танигдахгүй төлөвтэй мөр хаягдана; кодгүй (ЗГ-ын тогтоол) мөр нэр+URL-тай бол үлдэнэ; 160-аас дээш тайрагдана', () => {
  const many = Array.from({ length: 170 }, (_, i) => routeRow({ registry_id: `mn-construction:${String(i).padStart(20, '0')}`, code: `БД 81-1${String(i).padStart(2, '0')}-11` }));
  const r = LN.parseLocalNormTopicRoute({
    detected_topics: ['cost_estimation'],
    detection: 'exact',
    wants_cost: true,
    count: 170,
    results: [
      routeRow({ url: null }),
      routeRow({ url: 'http://insecure' }),
      routeRow({ title_mn: '' }),
      routeRow({ status: 'ACTIVE_FOR_SURE' }),
      routeRow({ code: null, title_mn: 'Барилга байгууламжийн норм, нормативын баримт бичгийн ерөнхий тогтолцоо' }),
      ...many,
    ],
  });
  assert.ok(r);
  assert.equal(r.wantsCost, true);
  assert.equal(r.truncated, true);
  assert.equal(r.total, 170);
  assert.ok(r.results.length <= 160 && r.results.length >= 155);
  assert.equal(r.results[0]?.code, null);
  assert.ok(r.results.every((x) => /^https:\/\//.test(x.url) && x.titleMn.length > 0));
  assert.equal(LN.parseLocalNormTopicRoute(null), null);
  assert.equal(LN.parseLocalNormRegistry({ matches: [] })?.topicRouter, null, 'хуучин runtime → null');
});
