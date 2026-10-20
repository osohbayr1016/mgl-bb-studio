/**
 * L1 СЭДВИЙН ЧИГЛҮҮЛЭГЧ (ai/norm-dataset/router + registry/cdc-2025) — шингээлт · нэгтгэл · чиглүүлэлт.
 *
 * Хаалганууд (багцын `CLAUDE_MAX_CONTINUE_PROMPT.md` «Required tests»):
 *   · `evals/topic_router/topic_router_cases.jsonl` — 92 кейс, ЭРЭМБЭЛСЭН registry_id жишиг (topic_lookup.py)-тэй байт-ижил
 *   · `examples/electrical_highrise.json`, `examples/lighting.json` — яг зорилтот зан төлөв
 *   · латин/англи alias · хоёрдмол асуулт → эрэмбэлсэн нэр дэвшигч · мөр бүр URL-тай · төлөв болгоомжтой
 *   · төсөв/хөдөлмөр (81/83) энгийн асуултад ОРОХГҮЙ · заалт/тоо ХЭЗЭЭ Ч гарахгүй · давхардсан норм үгүй
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestRegistry, searchRegistry, lookupRegistryCode, registryCount } from '../src/registry.ts';
import { routeTopics, detectTopics, colloquialTopics, latinTypedFold, codeKey, resolveCuratedKey, topicCatalog, topicRouterCount, type TopicRouteResult } from '../src/topicRouter.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DS = join(HERE, '..', '..', 'norm-dataset');
const readJsonl = (p: string): Record<string, unknown>[] =>
  readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
const readJson = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;

export const L1_PATHS = {
  registry: join(DS, 'registry', 'cdc-2025', 'registry_with_verified_delta.jsonl'),
  catalog: join(DS, 'router', 'topic_catalog.json'),
  aliases: join(DS, 'router', 'topic_aliases.jsonl'),
  assignments: join(DS, 'router', 'document_topic_assignments.jsonl'),
  overlays: join(DS, 'router', 'building_overlays.json'),
  packageMeta: join(DS, 'router', 'PACKAGE.json'),
};

const db = openKnowledgeDb({ path: ':memory:' });
const counts = ingestRegistry(db, {
  norms: join(DS, 'registry', 'norms.jsonl'),
  references: join(DS, 'registry', 'references.jsonl'),
  taxonomy: join(DS, 'taxonomy', 'team_topic_map.json'),
  l1: L1_PATHS,
});
// ЖИШИГ горимын сан (куратор барилгын төрлийн нөхөлтгүй) — 92 кейсийн байт-ижил паритетэд.
const refDb = openKnowledgeDb({ path: ':memory:' });
ingestRegistry(refDb, {
  norms: join(DS, 'registry', 'norms.jsonl'),
  references: join(DS, 'registry', 'references.jsonl'),
  taxonomy: join(DS, 'taxonomy', 'team_topic_map.json'),
  l1: L1_PATHS,
}, { curatedTopics: false });
const curated = readJsonl(join(DS, 'registry', 'norms.jsonl'));
const pkgRows = readJsonl(L1_PATHS.registry);
const cases = readJsonl(join(DS, 'evals', 'topic_router', 'topic_router_cases.jsonl'));

const ELECTRICAL_HIGHRISE_Q = 'Цахилгаантай холбоотой өндөр барилгын бүх норм дүрмийг нэр, код, линктэй нь өг.';
const LIGHTING_Q = 'Гэрэлтүүлэгтэй холбоотой бүх норм дүрмийг өг.';
const COST_OR_LABOUR = /(^|\s)(БНбД|БнбД|БД)\s8[13]-/u;
const codesOf = (r: TopicRouteResult[]): string[] => r.map((x) => x.code_pkg ?? x.code ?? '');
const hasCode = (r: TopicRouteResult[], code: string): boolean => r.some((x) => x.code_pkg === code || x.code === code);

/* ── Шингээлт · нэгтгэл ─────────────────────────────────────────── */

test('L1 · шингээлт: 524 мөр, куратор мөртэй таарсан нь НЭГТГЭГДЭЖ, бусад нь шинэ; давхардал үгүй; давхаргын код бүр шийдэгдсэн', () => {
  assert.ok(counts.l1, 'l1 тоо алга');
  const l1 = counts.l1!;
  assert.equal(l1.package_rows, 524);
  assert.equal(l1.merged_into_curated + l1.inserted_new, 524);
  assert.ok(l1.merged_into_curated >= 28 && l1.merged_into_curated <= 40, `merged ${l1.merged_into_curated}`);
  assert.equal(counts.norms, curated.length + l1.inserted_new);
  assert.deepEqual(l1.overlay_unresolved, []);
  assert.equal(l1.topics, 41);
  assert.equal(l1.assignments, 603 + l1.curated_topic_assignments);
  assert.ok(l1.curated_topic_assignments >= 4 && l1.curated_topic_assignments <= 12, `curated ${l1.curated_topic_assignments}`);
  assert.equal(l1.by_pkg_status.STATUS_REQUIRES_VERIFICATION, 523);
  assert.equal(l1.by_pkg_status.SUPERSEDED, 1);
  // Давхардал: registry_id бүр нэг code_key, code_key бүр нэг registry_id (L1 хүснэгт PK/UNIQUE — SQL-ээр давхар шалгана)
  const n = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT code_key) AS k, COUNT(DISTINCT registry_id) AS r FROM ai_norm_registry_l1').get() as { n: number; k: number; r: number };
  assert.deepEqual({ ...n }, { n: 524, k: 524, r: 524 });
  const rc = registryCount(db)!;
  assert.equal(rc.norms, counts.norms);
  assert.equal(rc.baseline_unverified, l1.inserted_new - 1, 'шинэ мөр = STATUS_REQUIRES_VERIFICATION + 1 SUPERSEDED');
  assert.equal(topicRouterCount(db)?.merged, l1.merged_into_curated);
});

test('L1 · нэгтгэсэн мөр: куратор төлөв/нотолгоо/холбоос ХЭВЭЭР — багц ACTIVE-ийг дарахгүй, ACTIVE-ийг ч чимээгүй өгөхгүй', () => {
  const merged = db.prepare('SELECT l.registry_id, l.canonical_code_pkg, l.pkg_status, r.canonical_code, r.status, r.source_url, r.registry_version FROM ai_norm_registry_l1 l JOIN ai_norm_registry r ON r.code_key = l.code_key WHERE l.merged_into_curated = 1').all() as Array<{ registry_id: string; canonical_code_pkg: string | null; pkg_status: string; canonical_code: string; status: string; source_url: string | null; registry_version: string }>;
  assert.ok(merged.length >= 28);
  const byCode = new Map(curated.map((c) => [String(c.canonical_code), c] as const));
  for (const m of merged) {
    const c = byCode.get(m.canonical_code);
    assert.ok(c, `${m.canonical_code}: куратор мөр алга`);
    assert.equal(m.status, c.status, `${m.canonical_code}: төлөв өөрчлөгдөв`);
    assert.equal(m.source_url, c.source_url, `${m.canonical_code}: холбоос өөрчлөгдөв`);
    assert.equal(m.registry_version, 'norm-registry/1');
  }
  // 31-17-10 MCIS-ээр ACTIVE хэвээр; багцын мөр нь STATUS_REQUIRES_VERIFICATION гэж хадгалагдсан (дээшлүүлээгүй, дарагдаагүй)
  const h = merged.find((m) => m.canonical_code === 'БНбД 31-17-10')!;
  assert.equal(h.status, 'ACTIVE');
  assert.equal(h.pkg_status, 'STATUS_REQUIRES_VERIFICATION');
  // Куратор CANDIDATE мөр (БД 43-102-07) ACTIVE болоогүй
  assert.equal(merged.find((m) => m.canonical_code === 'БД 43-102-07')?.status, 'CANDIDATE_NEEDS_STATUS_CHECK');
  // ШИНЭ мөр ХЭЗЭЭ Ч ACTIVE биш
  const newActive = db.prepare("SELECT COUNT(*) AS n FROM ai_norm_registry_l1 l JOIN ai_norm_registry r ON r.code_key = l.code_key WHERE l.merged_into_curated = 0 AND r.status = 'ACTIVE'").get() as { n: number };
  assert.equal(newActive.n, 0);
});

test('L1 · хувилбарын дагавар / нийлмэл код куратор мөрөнд шийдэгдэнэ (22-01-21*/22 · 31-25-22*/24 · 43-101-03 нийлмэл)', () => {
  const keys = new Set(curated.map((c) => String(c.code_key)));
  const alias = new Map<string, string>();
  for (const c of curated) for (const a of c.aliases as string[]) { const k = codeKey(a); if (/\d{2}-\d{2,3}-\d{2}/.test(k) && !alias.has(k)) alias.set(k, String(c.code_key)); }
  // 2026-09-23: canonical «БНбД 22-01-21» (нормын нүүр, тушаал 117/2021); «＊» ба «＊/22» нь alias-аар мөрөндөө шийдэгдэнэ
  assert.equal(resolveCuratedKey('БНбД 22-01-21*/22', keys, alias), 'bnbd22-01-21');
  assert.equal(resolveCuratedKey('БНбД 22-01-21*', keys, alias), 'bnbd22-01-21');
  assert.equal(resolveCuratedKey('БНбД 31-25-22*/24', keys, alias), 'bnbd31-25-22');
  assert.equal(resolveCuratedKey('БД 43-101-03 БД 43-101-03*12', keys, alias), 'bd43-101-03*12');
  assert.equal(resolveCuratedKey('БД 43-104-12', keys, alias), null);
  assert.equal(codeKey('БНбД 3.05.06-90'), 'bnbd3-05-06-90');
  assert.equal(codeKey('БНбД 31-17-10'), 'bnbd31-17-10');
  // нийлмэл код бүртгэлээс alias-аар олдоно
  assert.equal(lookupRegistryCode(db, 'БД 43-101-03 БД 43-101-03*12')?.code, 'БД 43-101-03*12');
  assert.equal(lookupRegistryCode(db, 'БД 43-104-12')?.status, 'STATUS_REQUIRES_VERIFICATION');
  assert.equal(lookupRegistryCode(db, 'БНбД 31-17-10')?.status, 'ACTIVE');
});

/* ── Жишигтэй байт-ижил (92 кейс) ───────────────────────────────── */

test('L1 · evals/topic_router_cases.jsonl — 92 кейс: жишиг горим (stemFallback:false) ЭРЭМБЭЛСЭН registry_id-тай байт-ижил', () => {
  assert.equal(cases.length, 92);
  const failures: string[] = [];
  for (const c of cases) {
    const r = routeTopics(refDb, String(c.query), { stemFallback: false });
    const ids = r.results.map((x) => x.registry_id);
    if (JSON.stringify(ids) !== JSON.stringify(c.expected_registry_ids)) failures.push(`${String(c.query).slice(0, 50)}: ${ids.length} ≠ ${c.expected_count}`);
    if (JSON.stringify(r.detected_topics) !== JSON.stringify(c.detected_topics)) failures.push(`${String(c.query).slice(0, 50)}: topics ${r.detected_topics.join(',')} ≠ ${(c.detected_topics as string[]).join(',')}`);
    if (c.must_include_source_url && r.results.some((x) => !/^https:\/\//.test(x.url))) failures.push(`${String(c.query).slice(0, 50)}: URL-гүй мөр`);
  }
  assert.deepEqual(failures, []);
});

test('L1 · өгөгдмөл горим (морфологи): 91 кейс ижил; ганц сэдэвгүй кейс «Холбоо дохиоллын…» сэдэв рүү ЗОРИУД дээшилнэ', () => {
  const diffs: string[] = [];
  for (const c of cases) {
    const r = routeTopics(refDb, String(c.query));
    if (JSON.stringify(r.results.map((x) => x.registry_id)) !== JSON.stringify(c.expected_registry_ids)) diffs.push(String(c.query));
  }
  assert.deepEqual(diffs, ['Холбоо дохиоллын зураг төслийн норм']);
  const r = routeTopics(refDb, 'Холбоо дохиоллын зураг төслийн норм');
  assert.equal(r.detection, 'stem');
  assert.deepEqual(r.detected_topics, ['telecom_signal']);
  assert.ok(hasCode(r.results, 'БД 43-108-24'), 'Барилгын холбоо, дохиоллын зураг төсөл төлөвлөлт орох ёстой');
  assert.ok(r.results.every((x) => x.router_reason.startsWith('topic_match')));
  // жишгийн лексик нөөц (7 мөр) нь «зураг төслийн» гэсэн ерөнхий үгээр таарсан чимээ байв
  const ref = routeTopics(refDb, 'Холбоо дохиоллын зураг төслийн норм', { stemFallback: false });
  assert.equal(ref.detection, 'none');
  assert.ok(ref.results.every((x) => x.router_reason === 'lexical_fallback'));
});

test('L1 · куратор барилгын төрлөөс сэдэв НӨХӨХ (өгөгдмөл): сургууль → БНбД 31-25-22, олон нийтийн барилга → 31-03-03*/11 нэмэгдэнэ; техникийн сэдэв нөхөгдөхгүй', () => {
  // Багц 31-25-22 / 31-03-03*/11-д сэдэв ОГТ оноогоогүй → жишиг горимд «Сургуулийн барилгад ямар норм?» = 0.
  assert.equal(routeTopics(refDb, 'Сургуулийн барилгад ямар норм дүрэм хамаарах вэ?').count, 0, 'жишиг: 0');
  const school = routeTopics(db, 'Сургуулийн барилгад ямар норм дүрэм хамаарах вэ?');
  assert.deepEqual(school.detected_topics, ['school']);
  assert.ok(hasCode(school.results, 'БНбД 31-25-22') && school.results[0]?.status === 'ACTIVE', 'сургуулийн норм');
  const pub = routeTopics(db, 'Олон нийтийн барилга-тай холбоотой ямар норм дүрэм байна?');
  for (const c of ['БНбД 31-03-03*/11', 'БНбД 31-23-12', 'БНбД 31-24-22', 'БНбД 31-25-22', 'БНбД 23-04-07']) assert.ok(hasCode(pub.results, c), c);
  const refPub = routeTopics(refDb, 'Олон нийтийн барилга-тай холбоотой ямар норм дүрэм байна?');
  assert.ok(pub.count > refPub.count, 'дээд олонлог');
  // Техникийн сэдэв нөхөгдөөгүй: гэрэлтүүлэг 3 хэвээр (31-17-10-ын 29 куратор сэдэв орж ирэхгүй)
  assert.equal(routeTopics(db, LIGHTING_Q).count, 3);
  assert.equal(routeTopics(db, 'Цахилгаантай холбоотой ямар норм дүрэм байна?').count, routeTopics(refDb, 'Цахилгаантай холбоотой ямар норм дүрэм байна?').count);
});

/* ── Хоёр гол асуулт (examples/) ─────────────────────────────────── */

test('L1 · «Цахилгаантай холбоотой өндөр барилгын бүх норм дүрмийг нэр, код, линктэй нь өг.» — examples/electrical_highrise.json', () => {
  const ex = readJson(join(DS, 'evals', 'topic_router', 'electrical_highrise.json'));
  const r = routeTopics(db, ELECTRICAL_HIGHRISE_Q);
  assert.deepEqual(r.detected_topics, ['highrise', 'electrical']);
  assert.equal(r.count, ex.count);
  assert.deepEqual(r.results.map((x) => x.registry_id), (ex.results as Array<{ registry_id: string }>).map((x) => x.registry_id));
  for (const c of ['БНбД 31-17-10', 'БД 43-102-07', 'БД 43-103-08', 'БД 43-107-19', 'БНбД 23-02-08', 'БД 43-101-03 БД 43-101-03*12', 'БНбД 21-04-05*/18', 'БНбД 3.05.06-90']) assert.ok(hasCode(r.results, c), c);
  assert.ok(!codesOf(r.results).some((c) => COST_OR_LABOUR.test(' ' + c)), 'төсөв/хөдөлмөрийн мөр гоожив');
  assert.equal(r.excluded.cost, 0);
  assert.ok(r.results.every((x) => x.router_reason === 'curated_highrise_overlay'));
  for (const x of r.results) {
    assert.match(x.url, /^https:\/\//, `${x.code}: URL`);
    assert.ok(x.title_mn.length > 0);
    assert.ok(x.status_note_mn.length > 0);
  }
  // Куратор мөр: MCIS-ээр баталгаажсан төлөв + MCIS-ийн PDF холбоос; шинэ мөр: болгоомжтой төлөв
  const h = r.results.find((x) => x.code === 'БНбД 31-17-10')!;
  assert.equal(h.status, 'ACTIVE');
  assert.equal(h.merged_into_curated, true);
  assert.match(h.url, /^https:\/\/mcis\.gov\.mn\/storage\//);
  const n = r.results.find((x) => x.code === 'БД 43-104-12')!;
  assert.equal(n.status, 'STATUS_REQUIRES_VERIFICATION');
  assert.equal(n.status_verified, false);
  assert.match(n.status_note_mn, /ШАЛГАГДААГҮЙ/);
  assert.equal(n.merged_into_curated, false);
});

test('L1 · «Гэрэлтүүлэгтэй холбоотой бүх норм дүрмийг өг.» — examples/lighting.json', () => {
  const ex = readJson(join(DS, 'evals', 'topic_router', 'lighting.json'));
  const r = routeTopics(db, LIGHTING_Q);
  assert.deepEqual(r.detected_topics, ['lighting']);
  assert.equal(r.count, ex.count);
  assert.deepEqual(r.results.map((x) => x.registry_id), (ex.results as Array<{ registry_id: string }>).map((x) => x.registry_id));
  assert.ok(hasCode(r.results, 'БНбД 23-02-08'));
  assert.ok(hasCode(r.results, 'БД 31-110-11'));
  assert.ok(hasCode(r.results, 'БД 30-102-11'));
  assert.ok(r.results.every((x) => x.router_reason === 'topic_match:lighting' && /^https:\/\//.test(x.url)));
});

/* ── Латин/англи alias ───────────────────────────────────────────── */

test('L1 · латин/англи alias: high-rise electrical · lighting · grounding · fire alarm', () => {
  const a = routeTopics(db, 'high-rise electrical');
  assert.deepEqual(a.detected_topics, ['electrical', 'highrise']);
  assert.equal(a.count, 11);
  const b = routeTopics(db, 'lighting');
  assert.deepEqual(b.detected_topics, ['lighting']);
  assert.equal(b.count, 3);
  const c = routeTopics(db, 'grounding');
  assert.deepEqual(c.detected_topics, ['grounding']);
  assert.ok(c.count >= 1 && hasCode(c.results, 'БД 43-107-19'));
  const d = routeTopics(db, 'fire alarm');
  assert.ok(d.detected_topics.includes('fire_alarm'));
  assert.ok(hasCode(d.results, 'БНбД 21-04-05*/18'));
  // латин галиг (fold) — жишигт байхгүй, морфологийн нөөцөөр («gereltuulgiin» ← «гэрэлтүүлэг»).
  // «undur barilga»: L1 каталогт латин alias байхгүй (fold «ondor» ≠ бичдэг «undur») → `latinTypedFold` (ө→u)
  //    нөөцөд тулгана (2026-09-21).  Өндөр барилга + гэрэлтүүлэг → давхаргын гэрэлтүүлгийн мөр л (жишгийн ижил дүрэм).
  const e = routeTopics(db, 'undur barilgiin gereltuulgiin norm');
  assert.equal(e.detection, 'stem');
  assert.deepEqual(e.detected_topics, ['highrise', 'lighting']);
  const eCyr = routeTopics(db, 'өндөр барилгын гэрэлтүүлгийн норм');
  assert.deepEqual(e.results.map((x) => x.registry_id), eCyr.results.map((x) => x.registry_id), 'латин ба кирилл ижил үр дүн');
});

test('L1 · латинаар бичсэн ө («undur») — эзний тестийн асуулт латинаар кирилл хувилбартай БАЙТ-ИЖИЛ; жишиг горим хөндөгдөөгүй', () => {
  const cyr = routeTopics(db, 'Цахилгаантай холбоотой өндөр барилгын норм дүрэм юу вэ?');
  assert.deepEqual(cyr.detected_topics, ['highrise', 'electrical']);
  assert.equal(cyr.count, 11);
  const lat = routeTopics(db, 'Tsahilgaantai holbootoi undur barilgiin norm durem yu ve?');
  assert.equal(lat.detection, 'stem');
  assert.deepEqual(lat.detected_topics, ['highrise', 'electrical']);
  assert.deepEqual(lat.results.map((x) => x.registry_id), cyr.results.map((x) => x.registry_id));
  // «öndör» (диакритиктэй) → NFD → «ondor» — үндсэн fold-оор аль хэдийн таардаг байсан; хэвээр.
  assert.deepEqual(routeTopics(db, 'öndör barilgiin norm').detected_topics, ['highrise']);
  // ө-гүй alias-д нэмэлт fold үүсэхгүй; ө-тэй alias-д зөвхөн ө солигдоно.
  assert.equal(latinTypedFold('цахилгаан'), null);
  assert.equal(latinTypedFold('өндөр барилга'), 'undur barilga');
  assert.equal(latinTypedFold('төсөв'), 'tusuv');
  // Латинаар «tusviin norm» → төсвийн мөр ОРНО (кирилл «төсвийн норм»-той ижил тоо); жишиг горимд хэвээр хасагдана.
  const tusv = routeTopics(db, 'Tusviin norm');
  assert.ok(tusv.detected_topics.includes('cost_estimation') && tusv.wants_cost && tusv.count >= 100, `tusviin: ${tusv.count}`);
  assert.equal(tusv.count, routeTopics(db, 'төсвийн норм').count);
  assert.equal(tusv.count, routeTopics(db, 'төсөв норм').count, 'харьяалахын «төсвийн» = «төсөв»');
  assert.equal(routeTopics(refDb, 'Tusviin norm', { stemFallback: false }).wants_cost, false);
  assert.equal(routeTopics(db, 'Hudulmur zartsuulaltiin norm').wants_labour, true);
  // Жишиг горим (stemFallback:false) латин асуултад сэдэв олдоггүй хэвээр — байт-ижил парите хөндөгдөөгүй.
  const ref = routeTopics(refDb, 'Tsahilgaantai holbootoi undur barilgiin norm durem yu ve?', { stemFallback: false });
  assert.equal(ref.detection, 'none');
  // Кирилл асуултад нэмэлт fold ХУДАЛ ЭЕРЭГ өгөхгүй: «тусув»/«урук» гэх мэт үг байхгүй тул төсөв/өрөг сэдэв асахгүй.
  assert.deepEqual(routeTopics(db, 'Цахилгаантай холбоотой өндөр барилгын норм дүрэм юу вэ?').detected_topics, ['highrise', 'electrical']);
});

/* ── Хоёрдмол асуулт · төлөв · төсөв/хөдөлмөр · LINKS_ONLY ───────── */

test('L1 · хоёрдмол асуулт → эрэмбэлсэн ОЛОН нэр дэвшигч (ганц «эцсийн» норм зохиохгүй)', () => {
  const r = routeTopics(db, 'Барилгын зураг төслийн норм дүрэм');
  assert.equal(r.detected_topics.length, 0);
  assert.equal(r.detection, 'none');
  assert.ok(r.count >= 2, `нэр дэвшигч ${r.count}`);
  assert.ok(r.results.every((x) => x.router_reason === 'lexical_fallback' && x.router_score === 50));
  assert.equal(r.answer_mode, 'LINKS_ONLY');
  // хамааралгүй асуулт → хоосон, алдаагүй
  const none = routeTopics(db, 'сайн байна уу');
  assert.equal(none.count, 0);
});

test('L1 · төлөв болгоомжтой: STATUS_REQUIRES_VERIFICATION ХЭЗЭЭ Ч ACTIVE болохгүй; SUPERSEDED нь solигдсон гэж ИЛ', () => {
  const r = routeTopics(db, 'Геодези, зураглал-тай холбоотой ямар норм дүрэм байна?');
  const old = r.results.find((x) => x.code === 'БД 11-106-08')!;
  assert.equal(old.status, 'SUPERSEDED');
  assert.equal(old.superseded_by, 'БНбД 11-106-25');
  assert.match(old.status_note_mn, /Солигдсон/);
  const neu = r.results.find((x) => x.code === 'БНбД 11-106-25')!;
  assert.equal(neu.status, 'ACTIVE', 'куратор бүртгэл MCIS-ээр баталгаажуулсан');
  for (const x of r.results) {
    if (x.status === 'ACTIVE') assert.equal(x.merged_into_curated, true, `${x.code}: ACTIVE атлаа кураторгүй`);
    if (!x.merged_into_curated) assert.ok(['STATUS_REQUIRES_VERIFICATION', 'SUPERSEDED'].includes(x.status), `${x.code}: ${x.status}`);
  }
});

test('L1 · төсөв (81) / хөдөлмөр (83) энгийн асуултад ОРОХГҮЙ, ил асуувал орно', () => {
  const el = routeTopics(db, 'Цахилгаантай холбоотой ямар норм дүрэм байна?');
  assert.ok(el.count >= 5);
  assert.ok(!codesOf(el.results).some((c) => COST_OR_LABOUR.test(' ' + c)));
  const cost = routeTopics(db, 'Төсөв, үнэ бүрдэл-тай холбоотой ямар норм дүрэм байна?');
  assert.ok(cost.wants_cost);
  assert.ok(cost.count >= 100 && codesOf(cost.results).some((c) => /8[1]-/.test(c)));
  const lab = routeTopics(db, 'Хөдөлмөр зарцуулалт-тай холбоотой ямар норм дүрэм байна?');
  assert.ok(lab.wants_labour && lab.count === 33);
  // Бүтээцийн асуулт: 81-ийн бүтээцийн төсвийн мөр хасагдсан нь `excluded.cost`-д ИЛ тоологдоно
  const st = routeTopics(db, 'Барилгын бүтээц-тай холбоотой ямар норм дүрэм байна?');
  assert.ok(!codesOf(st.results).some((c) => COST_OR_LABOUR.test(' ' + c)));
  const withCost = routeTopics(db, 'Барилгын бүтээц-тай холбоотой ямар норм дүрэм байна?', { includeCost: true });
  assert.ok(withCost.count >= st.count);
});

test('L1 · LINKS_ONLY: үр дүнд заалт/тоо/шаардлагын талбар БАЙХГҮЙ; мөр бүр код-эсвэл-нэр + URL + төлөв', () => {
  const r = routeTopics(db, ELECTRICAL_HIGHRISE_Q);
  for (const x of r.results) {
    const keys = Object.keys(x);
    assert.ok(!keys.some((k) => /text|clause|value|requirement|threshold|formula|table/i.test(k)), keys.join(','));
    assert.ok((x.code ?? x.title_mn).length > 0);
    assert.match(x.url, /^https:\/\//);
    assert.ok(x.status.length > 0 && x.status_note_mn.length > 0);
  }
  // кодгүй баримт (ЗГ-ын тогтоол) ч URL + нэртэй
  const codeless = db.prepare("SELECT COUNT(*) AS n FROM ai_norm_registry_l1 l JOIN ai_norm_registry r ON r.code_key = l.code_key WHERE r.canonical_code = '' AND l.source_url NOT LIKE 'https://%'").get() as { n: number };
  assert.equal(codeless.n, 0);
});

test('L1 · сэдвийн каталог 41; detectTopics хамгийн урт alias-аар эрэмбэлнэ', () => {
  const cat = topicCatalog(db);
  assert.equal(cat.length, 41);
  assert.ok(cat.find((t) => t.topic_id === 'electrical')!.documents >= 20);
  assert.deepEqual(detectTopics(db, 'Цахилгааны аюулгүй байдал-тай холбоотой ямар норм дүрэм байна?').topics, ['electrical_safety', 'electrical']);
});

/* ── L0 хайлт нэгтгэсэн бүртгэл дээр хэвээр ─────────────────────── */

test('L1 · searchRegistry: куратор кейс (BNbD_31-17-10/tests/registry.jsonl) 524 мөр нэмэгдсэн ч хэвээр', () => {
  const rc = readJsonl(join(DS, 'documents', 'BNbD_31-17-10', 'tests', 'registry.jsonl'));
  const failures: string[] = [];
  for (const c of rc) {
    const q = String(c.query);
    if (c.kind === 'draft_visible_only_with_flag') {
      if (searchRegistry(db, q).matches.some((m) => m.code === c.must_include_code_when_include_drafts)) failures.push(`${c.test_id}: DRAFT өгөгдмөлөөр гарав`);
      continue;
    }
    const r = searchRegistry(db, q, { limit: 8 });
    const codes = r.matches.map((m) => m.code);
    if (c.must_include_code && !codes.includes(String(c.must_include_code))) failures.push(`${c.test_id}: ${c.must_include_code} алга (${codes.join(', ')})`);
    if (Array.isArray(c.must_include_any) && !c.must_include_any.some((x) => codes.includes(String(x)))) failures.push(`${c.test_id}: ${(c.must_include_any as string[]).join('|')} алга`);
  }
  assert.deepEqual(failures, []);
  // шинэ мөрийн төлөвийн тэмдэглэл болгоомжтой
  const m = searchRegistry(db, 'БД 43-104-12').matches.find((x) => x.code === 'БД 43-104-12')!;
  assert.equal(m.status, 'STATUS_REQUIRES_VERIFICATION');
  assert.match(m.status_note_mn, /ШАЛГАГДААГҮЙ/);
});

test('L1 · багцын мөр бүр бүртгэлд байгаа (registry_id ↔ ai_norm_registry_l1) ба провенанс (pdf хуудас/мөр/sha) хадгалагдсан', () => {
  const ids = new Set((db.prepare('SELECT registry_id FROM ai_norm_registry_l1').all() as Array<{ registry_id: string }>).map((r) => r.registry_id));
  for (const r of pkgRows) assert.ok(ids.has(String(r.registry_id)), String(r.registry_id));
  const row = db.prepare("SELECT baseline_source_json, dataset_id FROM ai_norm_registry_l1 WHERE canonical_code_pkg = 'БД 43-104-12'").get() as { baseline_source_json: string; dataset_id: string };
  const b = JSON.parse(row.baseline_source_json) as Record<string, unknown>;
  assert.ok(typeof b.pdf_page === 'number' && typeof b.pdf_sha256 === 'string' && (b.pdf_sha256 as string).length === 64);
  assert.equal(row.dataset_id, 'MCIS_NORM_REGISTRY_L1_TOPIC_ROUTER_2026-09-18');
});

test('L1 · ярианы нэр «тог», «ус», «дулаан» (2026-09-28, эзний бодит чат) — фолдсон БҮТЭН токен, жишиг горим хөндөгдөхгүй', () => {
  // Эзний асуулт: латин ба кирилл ИЖИЛ сэдэв (өмнө нь сэдэвгүй → «энэ төрлийн барилгад норм санд алга»).
  const lat = routeTopics(db, 'Mongold hudaldaanii tov barilaa gehed, tog us avah norm durem baidag uu');
  const cyr = routeTopics(db, 'Худалдааны төв барихад тог, ус авах норм дүрэм байдаг уу');
  assert.deepEqual(lat.detected_topics, ['electrical', 'water_supply']);
  assert.deepEqual(cyr.detected_topics, ['electrical', 'water_supply']);
  assert.ok(lat.count > 0);
  assert.deepEqual(lat.results.map((x) => x.registry_id), cyr.results.map((x) => x.registry_id));
  // Албан alias + ярианы нэр хамт: «цахилгаан, ус» → цахилгаан (alias, түрүүлнэ) + ус хангамж.
  assert.deepEqual(routeTopics(db, 'цахилгаан, ус авах норм').detected_topics, ['electrical', 'water_supply']);
  // Жишиг горим (topic_lookup.py-тай байт-ижил) ярианы нэрийг ҮЛ ТООНО.
  assert.deepEqual(routeTopics(db, 'тог ус авах норм', { stemFallback: false }).detected_topics, []);
  // Дэд мөр БИШ: тогтоол, тоглоом, хус, усан сан → зөвхөн «усан» (ус) таарна.
  assert.deepEqual(colloquialTopics('тогтоол тоглоомын талбай хус мод'), []);
  // Англи «us» — туслах үгтэй англи асуултад ус хангамж БИШ.
  assert.deepEqual(colloquialTopics('Tell us which norms apply to a shopping center'), []);
  // «дулаан хамгаалалт» = эрчим хүчний хэмнэлт (alias) — hvac болохгүй; «дулаан авах» = hvac.
  assert.deepEqual(colloquialTopics('дулаан хамгаалалтын норм'), []);
  assert.deepEqual(colloquialTopics('тог, ус, дулаан авах'), ['electrical', 'water_supply', 'hvac']);
});
