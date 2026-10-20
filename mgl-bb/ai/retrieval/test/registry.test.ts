/**
 * L0 НОРМЫН БҮРТГЭЛ (ai/norm-dataset/registry) — шингээлт + чиглүүлэгч.
 *
 * Бодит git файлуудаас (`registry/norms.jsonl`, `references.jsonl`, `taxonomy/`) :memory: санд
 * шингээж, `documents/BNbD_31-17-10/tests/registry.jsonl` + `evals/router_cases.jsonl`-ийн
 * кейсүүдийг ажиллуулна.  Хэмжсэн зүйл: код/нэр/сэдвээр олдох, баг/сэдвийн тайлал, DRAFT нь
 * өгөгдмөлөөр ГАРАХГҮЙ, техникийн шаардлага ХЭЗЭЭ Ч гарахгүй (LINKS_ONLY).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestRegistry, searchRegistry, lookupRegistryCode, referencesFrom, registryCount, aliasMatches, interpretQuery } from '../src/registry.ts';
import { foldText } from '../src/fold.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DS = join(HERE, '..', '..', 'norm-dataset');
const readJsonl = (p: string): Record<string, unknown>[] =>
  readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);

const db = openKnowledgeDb({ path: ':memory:' });
// ⚠️ L1 багц (2025 оны бүртгэлийн 524 мөр) ХАМТ — ажилтны сангийн бодит хэлбэр; куратор кейсүүд тэр
//    нэгтгэсэн бүртгэл дээр ч хэвээр байхыг энэ файл барина (`topicRouter.test.ts` нь L1-ийг өөрөө шалгана).
const counts = ingestRegistry(db, {
  norms: join(DS, 'registry', 'norms.jsonl'),
  references: join(DS, 'registry', 'references.jsonl'),
  taxonomy: join(DS, 'taxonomy', 'team_topic_map.json'),
  l1: {
    registry: join(DS, 'registry', 'cdc-2025', 'registry_with_verified_delta.jsonl'),
    catalog: join(DS, 'router', 'topic_catalog.json'),
    aliases: join(DS, 'router', 'topic_aliases.jsonl'),
    assignments: join(DS, 'router', 'document_topic_assignments.jsonl'),
    overlays: join(DS, 'router', 'building_overlays.json'),
    packageMeta: join(DS, 'router', 'PACKAGE.json'),
  },
});

test('registry · шингээлт: бүх мөр орж, төлөв бүр тоологдоно', () => {
  assert.ok(counts.norms >= 40, `norms ${counts.norms}`);
  assert.equal(counts.byStatus.DRAFT, 1);
  assert.ok((counts.byStatus.ACTIVE ?? 0) >= 25);
  const c = registryCount(db);
  assert.ok(c && c.norms === counts.norms && c.drafts === 1);
});

test('registry · ACTIVE нь ЗӨВХӨН MCIS-ийн нотолгоотой мөр (status_evidence хоосон байхгүй)', () => {
  for (const r of readJsonl(join(DS, 'registry', 'norms.jsonl'))) {
    const ev = r.status_evidence as string[];
    assert.ok(Array.isArray(ev) && ev.length > 0, `${r.canonical_code}: status_evidence хоосон`);
    if (r.status === 'ACTIVE') assert.ok(ev.some((e) => /MCIS/i.test(e)), `${r.canonical_code}: ACTIVE атлаа MCIS нотолгоогүй`);
    if (r.status === 'DRAFT') assert.equal(r.retrieval_default, false);
  }
});

test('aliasMatches · морфологи: язгуураар таарна, богино үг бүтнээрээ', () => {
  const toks = foldText('Өндөр барилгын цахилгаан, гэрэлтүүлгийн норм өг').split(' ');
  assert.ok(aliasMatches(foldText('гэрэлтүүлэг'), toks));
  assert.ok(aliasMatches(foldText('өндөр барилга'), toks));
  assert.ok(!aliasMatches(foldText('гал'), toks), '«гал» нь «гэрэлтүүлгийн» дотор таарах ёсгүй');
  assert.ok(!aliasMatches(foldText('халаалт'), toks));
});

test('registry · documents/BNbD_31-17-10/tests/registry.jsonl кейсүүд', () => {
  const cases = readJsonl(join(DS, 'documents', 'BNbD_31-17-10', 'tests', 'registry.jsonl'));
  const failures: string[] = [];
  for (const c of cases) {
    const q = String(c.query);
    if (c.kind === 'draft_visible_only_with_flag') {
      const def = searchRegistry(db, q);
      const withDrafts = searchRegistry(db, q, { includeNonCurrent: true });
      if (def.matches.some((m) => m.code === c.must_include_code_when_include_drafts)) failures.push(`${c.test_id}: DRAFT өгөгдмөлөөр гарав`);
      if (!withDrafts.matches.some((m) => m.code === c.must_include_code_when_include_drafts && m.status === 'DRAFT')) failures.push(`${c.test_id}: include_non_current-д DRAFT олдсонгүй`);
      continue;
    }
    const r = searchRegistry(db, q, { limit: 8 });
    const codes = r.matches.map((m) => m.code);
    if (c.must_include_code && !codes.includes(String(c.must_include_code))) failures.push(`${c.test_id}: ${c.must_include_code} алга (${codes.join(', ')})`);
    if (Array.isArray(c.must_include_any) && !c.must_include_any.some((x) => codes.includes(String(x)))) failures.push(`${c.test_id}: ${(c.must_include_any as string[]).join('|')} аль нь ч алга`);
    if (c.expected_team && !r.interpretation.teams.includes(String(c.expected_team))) failures.push(`${c.test_id}: баг ${c.expected_team} танигдсангүй (${r.interpretation.teams.join(',')})`);
    if (Array.isArray(c.expected_topics)) for (const t of c.expected_topics) if (!r.interpretation.topics.includes(String(t))) failures.push(`${c.test_id}: сэдэв ${t} танигдсангүй`);
    if (c.kind === 'lookup_topic' && r.matches.length < 2) failures.push(`${c.test_id}: ганц норм гарав — олон норм хүлээгдсэн`);
  }
  assert.deepEqual(failures, []);
});

test('registry · evals/router_cases.jsonl — NORM_LOOKUP_ONLY кейсүүд бүртгэлээс зөв кодыг өгнө', () => {
  const cases = readJsonl(join(DS, 'evals', 'router_cases.jsonl')).filter((c) => c.expected_intent === 'NORM_LOOKUP_ONLY');
  assert.ok(cases.length >= 3);
  for (const c of cases) {
    const r = searchRegistry(db, String(c.query), { limit: 8 });
    if (c.must_include_code) assert.ok(r.matches.some((m) => m.code === c.must_include_code), `${c.id}: ${c.must_include_code}`);
    if (c.expected_team) assert.ok(r.interpretation.teams.includes(String(c.expected_team)), `${c.id}: team ${c.expected_team}`);
    assert.equal(r.answer_mode, 'LINKS_ONLY');
  }
});

test('registry · нэрлэсэн код: бүртгэлд байгаа ч гүн шингээгээгүй норм танигдана; DRAFT нь DRAFT гэж', () => {
  // 2026-09-21: БНбД 20-04-17 гүн шингээгдсэн (L2, documents/BNbD_20-04-17) тул L0 жишээ нь 23-01-09.
  const a = lookupRegistryCode(db, 'БНбД 23-01-09');
  assert.equal(a?.status, 'ACTIVE');
  assert.equal(a?.capability_level, 'L0');
  assert.match(a?.source_url ?? '', /^https:\/\/mcis\.gov\.mn\//);
  const loads = lookupRegistryCode(db, 'БНбД 20-04-17');
  assert.equal(loads?.status, 'ACTIVE');
  assert.equal(loads?.capability_level, 'L2');
  const d = lookupRegistryCode(db, 'БНбД 31-17-23');
  assert.equal(d?.status, 'DRAFT');
  assert.equal(d?.draft_of, 'БНбД 31-17-10');
  assert.equal(lookupRegistryCode(db, 'БНбД 99-99-99'), null);
});

test('registry · БНбД 22-01-21: canonical + хувилбарын alias НЭГ мөр; 22-01-01*/2006 нь SUPERSEDED → залгамжлагч', () => {
  // 2026-09-23: нормын нүүр ба батлах тушаал 117/2021 «БНбД 22-01-21»; MCIS «БНбД 22-01-21*»; 2022 оны шинэчилсэн
  // хавсралт «БНбД 22-01-21*/22».  НЭГ норм, нэг нэмэлт өөрчлөлтийн бичлэг — хоёр идэвхтэй норм ХЭЗЭЭ Ч биш.
  const canon = lookupRegistryCode(db, 'БНбД 22-01-21');
  assert.equal(canon?.code, 'БНбД 22-01-21');
  assert.equal(canon?.status, 'ACTIVE');
  assert.equal(canon?.capability_level, 'L2');
  assert.match(canon?.source_url ?? '', /^https:\/\/mcis\.gov\.mn\//);
  for (const alias of ['БНбД 22-01-21*', 'БНбД 22-01-21*/22', 'BNbD 22-01-21']) {
    assert.equal(lookupRegistryCode(db, alias)?.code, 'БНбД 22-01-21', `${alias} → canonical`);
  }
  const active = (db.prepare("SELECT COUNT(*) AS n FROM ai_norm_registry WHERE code_key LIKE 'bnbd22-01-21%' AND status = 'ACTIVE'").get() as { n: number }).n;
  assert.equal(active, 1, '22-01-21-ийн идэвхтэй мөр ЯГ нэг');
  for (const old of ['БНбД 22-01-01*/2006', 'БНбД 22.01.01*', 'БНбД 22-01-01*']) {
    const o = lookupRegistryCode(db, old);
    assert.equal(o?.code, 'БНбД 22-01-01*', old);
    assert.equal(o?.status, 'SUPERSEDED', `${old}: түүхэн`);
    assert.equal(o?.superseded_by, 'БНбД 22-01-21', `${old}: залгамжлагч`);
  }
  // 31-17-10-ийн эх ишлэл («БНбД 22-01-01*/2006») ДАРЖ бичигдээгүй — эх код хэвээр, шийдэл нь залгамжаар
  const refs = referencesFrom(db, 'bnbd31-17-10');
  assert.ok(refs.some((r) => r.to_key === 'bnbd22-01-01*'), '31-17-10 → 22-01-01* ирмэг хэвээр');
  assert.ok(!refs.some((r) => r.to_key === 'bnbd22-01-21'), '31-17-10-ийн ишлэлийг 22-01-21 болгож чимээгүй өөрчлөөгүй');
});

test('registry · хариу нь LINKS_ONLY: техникийн тоо/заалтын текст агуулахгүй', () => {
  const r = searchRegistry(db, 'Өндөр барилгын цахилгаан шатны хурд хэд вэ?');
  for (const m of r.matches) {
    const keys = Object.keys(m);
    assert.ok(!keys.some((k) => /text|clause|value|requirement/i.test(k)), keys.join(','));
  }
});

test('registry · хамаарлын граф: БНбД 31-17-10-ийн ишлэлүүд бүртгэлийн мөр рүү шийдэгдэнэ', () => {
  const refs = referencesFrom(db, 'bnbd31-17-10');
  assert.ok(refs.length >= 20, `refs ${refs.length}`);
  const top = refs.filter((r) => r.relationship === 'normative_reference').slice(0, 5);
  assert.ok(top.every((r) => r.count >= 3));
  assert.ok(refs.some((r) => r.to_key === 'bnbd20-04-17' || r.to_key === 'bnbd2-01-07-90'));
  const draft = refs.find((r) => r.relationship === 'draft_revision_of');
  assert.equal(draft, undefined, 'draft_revision_of нь 31-17-23-ЭЭС гарна, 31-17-10-оос биш');
});

test('interpretQuery · латин галиг ч сэдвийг таньдаг', () => {
  const i = interpretQuery(db, 'undur barilgiin gereltuulgiin norm');
  assert.ok(i.topics.includes('high-rise'));
  assert.ok(i.topics.includes('lighting'));
});
