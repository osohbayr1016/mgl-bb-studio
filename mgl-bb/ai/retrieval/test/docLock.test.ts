/**
 * ЯВЦУУ БАРИМТЫН КОД = ХАТУУ ШҮҮЛТ (P0, 2026-09-11) + БД 21-101-12 профайл +
 * багцын таних тэмдэг + тест-only UBB-11-202-00 фикстур.
 *
 * ⚠️ Фикстур `test/fixtures/ubb-11-202-00/` нь СИНТЕТИК — зөвхөн «утга ба эшлэл
 *    нэг баримтад холбогдоно» гэсэн АРХИТЕКТУРЫН шинжийг шалгахад.  Продын
 *    %LOCALAPPDATA% сан руу ХЭЗЭЭ Ч шингээхгүй (`ai:ingest:norm` нь
 *    data-train-files-ыг л хардаг).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectProfile, cleanPythonRepr } from '../src/datasetProfiles.ts';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset, FIRE_HAZARD_IDENTITY_FILES } from '../src/ingest.ts';
import { askNorm } from '../src/pipeline.ts';
import { requestedDocument, excludedSearchTokens } from '../src/search.ts';
import { extractDocRef, normalizeQuery } from '../src/normalize.ts';
import { datasetIdentity } from '../src/datasetIdentity.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', 'data-train-files');
const BD = join(ROOT, 'MGL_AI_BD_21_101_12_dataset');
const GEO = join(ROOT, 'MCIS_MGL_AI_BNbD_11-03-21_GOLD_v3_SOURCED_COMPLETE');
const FIRE = join(ROOT, 'MGL_AI_BNbD_21_04_05_dataset');
const UBB_FIXTURE = join(HERE, 'fixtures', 'ubb-11-202-00');
const HAVE_BD = existsSync(join(BD, 'v_subcategory_rules.jsonl'));
const HAVE_GEO = existsSync(join(GEO, 'legal_status_graph.json'));
const HAVE_FIRE = existsSync(join(FIRE, 'rules.jsonl'));
const skipBd = HAVE_BD ? false : 'БД 21-101-12 багц олдсонгүй';
const skipBdFire = HAVE_BD && HAVE_FIRE ? false : 'БД 21-101-12 / БНбД 21-04-05 багц олдсонгүй';
const skipGeo = HAVE_GEO ? false : 'БНбД 11-03-21 багц олдсонгүй';

function fresh(folders: string[]) {
  const db = openKnowledgeDb({ path: ':memory:' });
  const counts = folders.map((f) => ingestDataset(db, f));
  return { db, counts };
}

/* ── Код таних (каталогоос хамааралгүй) ───────────────────────────── */

test('extractDocRef · БД/BD/УББ/UBB/СНиП угтварыг таньж, залгаварын зураасыг тайрна', () => {
  assert.equal(extractDocRef('БД 21-101-12-ын дагуу Va хэд вэ?').code, 'БД 21-101-12');
  assert.equal(extractDocRef('BD 21-101-12: Q=1800').code, 'БД 21-101-12');
  assert.equal(extractDocRef('УББ 12-01-01-ийн 1.1 заалт').code, 'УББ 12-01-01');
  assert.equal(extractDocRef('UBB-11-202-00 3.5 заалт').code, 'УББ 11-202-00');
  assert.equal(extractDocRef('БНбД 21-04-05-ын 99.99 заалт').codeDigits, '21-04-05');
  assert.equal(extractDocRef('Хувийн галын ачаалал 2500 МДж/м²').code, undefined);
});

test('excludedSearchTokens · тооцоолуурын оролт (кПа, МДж, °C, м³, X=N) хасагдана, талбай/урт/хувь ХАСАГДАХГҮЙ', () => {
  const q = normalizeQuery('Аппаратын даралт 200 кПа, эзлэхүүн 10 м³, Q=5000 МДж, талбай 300 м², гүн 3 м, 40 хувь, 28°C');
  const ex = excludedSearchTokens(q);
  for (const v of ['200', '10', '5000', '28']) assert.ok(ex.has(v), `${v} хасагдах ёстой`);
  for (const v of ['300', '3', '40']) assert.ok(!ex.has(v), `${v} ХАСАГДАХГҮЙ (лавлах түлхүүр)`);
});

/* ── Профайл + шингээлт ───────────────────────────────────────────── */

test('fire_hazard_rules · хоёр файл ХОЁУЛАА ≥1 байт байж л танигдана (УББ 12-01-01-ийн 0-байт урхи)', () => {
  const files = new Set(['document.json', 'knowledge_chunks.jsonl', 'aliases.json', 'room_category_rules.jsonl', 'v_subcategory_rules.jsonl', 'obligation_rules.jsonl']);
  // clause_rules-ийн файл ч бий, галын файл нь ХООСОН → clause_rules
  assert.equal(detectProfile((f) => files.has(f), () => false), 'clause_rules');
  const only = new Set(['document.json', 'knowledge_chunks.jsonl', 'aliases.json', 'room_category_rules.jsonl', 'v_subcategory_rules.jsonl']);
  assert.equal(detectProfile((f) => only.has(f), (f) => only.has(f)), 'fire_hazard_rules');
  assert.equal(detectProfile((f) => only.has(f), () => false), null);
});

test('cleanPythonRepr · В-мужийн python-dict repr → муж', () => {
  assert.equal(cleanPythonRepr("g = {'min': 1401, 'max': 2200} МДж/м²"), 'g = 1401–2200 МДж/м²');
  // GAP-023: «g = > 2200» гэсэн давхар тэмдэг биш — «=» харьцуулагчид шингэнэ.
  assert.equal(cleanPythonRepr("g = {'gt': 2200} МДж/м²"), 'g > 2200 МДж/м²');
});

test('БД 21-101-12 шингээлт · 80 хэсэг, зөвхөн requirement дүрэм (гүйцэтгэх дүрэм ҮГҮЙ), 162 тест, 14 кейс, багцын SHA', { skip: skipBd }, () => {
  const { db, counts } = fresh([BD]);
  const c = counts[0]!;
  assert.equal(c.profile, 'fire_hazard_rules');
  assert.equal(c.chunks, 80);
  assert.equal(c.tests, 162);
  assert.equal(c.cases, 14);
  assert.equal(Object.keys(c.rulesByKind).join(','), 'requirement');
  const doc = db.prepare("SELECT metadata_json FROM ai_documents WHERE doc_id = 'BD-21-101-12-2012'").get() as { metadata_json: string };
  const meta = JSON.parse(doc.metadata_json) as { dataset_identity?: { sha256: string; files: string[] }; dataset_version?: string };
  assert.equal(meta.dataset_version, '0.2.0');
  // Amendment A: локал шингээлт ба хөрвүүлэгч ИЖИЛ файлын жагсаалтаар ижил SHA тооцно.
  const ident = datasetIdentity(BD, FIRE_HAZARD_IDENTITY_FILES);
  assert.equal(meta.dataset_identity?.sha256, ident.sha256);
  assert.match(ident.sha256, /^[0-9a-f]{64}$/);
  const v2 = db.prepare("SELECT text_mn FROM ai_chunks WHERE chunk_id = 'BD-21-101-12-2012:room:V2:g'").get() as { text_mn: string };
  assert.ok(!v2.text_mn.includes("{'min'"), 'python repr цэвэрлэгдсэн');
  db.close();
});

test('Amendment A · багцын SHA нь файлын нэг байтын өөрчлөлтөд ч солигдоно, файлын эрэмбээс хамаарахгүй', { skip: skipBd }, () => {
  const a = datasetIdentity(BD, FIRE_HAZARD_IDENTITY_FILES);
  const b = datasetIdentity(BD, [...FIRE_HAZARD_IDENTITY_FILES].reverse());
  assert.equal(a.sha256, b.sha256);
  assert.deepEqual(a.files, b.files);
  const c = datasetIdentity(BD, FIRE_HAZARD_IDENTITY_FILES.filter((f) => f !== 'formulas.jsonl'));
  assert.notEqual(a.sha256, c.sha256);
});

/* ── Хатуу шүүлт ─────────────────────────────────────────────────── */

test('санд байхгүй код нэрлэвэл → named_document_absent, өөр баримтаас ХЭЗЭЭ Ч хариулахгүй', { skip: skipGeo }, () => {
  const { db } = fresh([GEO]);
  const a = askNorm(db, 'БД 21-101-12-ын дагуу аппаратын даралт 200 кПа, эзлэхүүн 10 м³ бол Va хэд вэ?');
  assert.equal(a.status, 'insufficient_evidence');
  assert.equal(a.no_match_reason, 'named_document_absent');
  assert.equal(a.citation, null);
  assert.deepEqual(a.evidence, []);
  assert.equal(a.named_document?.code, 'БД 21-101-12');
  assert.equal(a.named_document?.absent, true);
  // Latin хэлбэр ч ижил
  const b = askNorm(db, 'BD 21-101-12: Q=5000 MJ, g=1000, H=2');
  assert.equal(b.no_match_reason, 'named_document_absent');
  db.close();
});

test('санд БАЙГАА код нэрлэвэл бүх хөл тэр баримтад цоожлогдоно — заалт байхгүй бол clause_not_in_named_document', { skip: skipBdFire }, () => {
  const { db } = fresh([BD, FIRE]);
  const a = askNorm(db, 'БД 21-101-12-ын дагуу аппаратын даралт 200 кПа, эзлэхүүн 10 м³ бол Va хэд вэ?');
  assert.ok(a.evidence.length > 0);
  assert.ok(a.evidence.every((e) => e.doc_id === 'BD-21-101-12-2012'), 'бүх нотолгоо нэрлэсэн баримтаас');
  assert.equal(a.citation?.doc_id, 'BD-21-101-12-2012');
  assert.equal(a.citation?.dataset_sha256, datasetIdentity(BD, FIRE_HAZARD_IDENTITY_FILES).sha256);
  assert.equal(a.named_document?.relation, 'exact');
  const missing = askNorm(db, 'БНбД 21-04-05-ын 99.99 заалтад юу гэж заасан бэ?');
  assert.equal(missing.status, 'insufficient_evidence');
  assert.equal(missing.no_match_reason, 'clause_not_in_named_document');
  assert.equal(missing.citation, null);
  db.close();
});

test('нотолгооны хэсэг бүр ӨӨРИЙН баримттай (doc_id, code) — толгой баримт бүх хэсэгт дарагдахгүй', { skip: skipBdFire }, () => {
  const { db } = fresh([BD, FIRE]);
  const a = askNorm(db, 'шатамхай шингэн хадгалах өрөө галын аюулын ангилал');
  assert.ok(a.evidence.length > 0);
  for (const e of a.evidence) {
    assert.ok(typeof e.doc_id === 'string' && e.doc_id.length > 0);
    assert.ok(typeof e.code === 'string' && e.code.length > 0);
    const row = db.prepare('SELECT doc_id FROM ai_chunks WHERE chunk_id = ?').get(e.chunk_id) as { doc_id: string };
    assert.equal(e.doc_id, row.doc_id);
  }
  db.close();
});

test('§9 · солигдсон код (БНбД 11-03-01) нь ИЛ харилцаагаар залгамжлагч руу очно, харилцаа буцаана', { skip: skipGeo }, () => {
  const { db } = fresh([GEO]);
  const r = requestedDocument(db, normalizeQuery('БНбД 11-03-01 одоо хүчинтэй юу?'));
  assert.equal(r.absent, false);
  assert.equal(r.relation, 'superseded_by');
  assert.equal(r.relatedCode, 'БНбД 11-03-21');
  const a = askNorm(db, 'БНбД 11-03-01 одоо хүчинтэй юу?');
  assert.equal(a.citation?.doc_id, 'BNBD-11-03-21-2022');
  assert.match(a.note_mn, /солигдсон/);
  db.close();
});

/* ── Тест-only UBB-11-202-00 фикстур: утга ба эшлэл АТОМ ─────────── */

test('UBB-11-202-00 синтетик фикстур · 1:5000 нь заалт 3.5, хуудас 7-той хамт л ирнэ; фикстур прод санд байхгүй', { skip: skipGeo }, () => {
  assert.ok(existsSync(join(UBB_FIXTURE, 'document.json')), 'фикстур хавтас');
  assert.ok(statSync(join(UBB_FIXTURE, 'obligation_rules.jsonl')).size > 0);
  const { db } = fresh([GEO, UBB_FIXTURE]);
  const a = askNorm(db, 'Хот суурины хөгжлийн ерөнхий төлөвлөгөөний үндсэн шийдлийг ямар масштабаар боловсруулах ёстой вэ?');
  assert.equal(a.citation?.doc_id, 'UBB-11-202-00-TEST');
  assert.equal(a.citation?.document, 'УББ 11-202-00');
  assert.equal(a.citation?.clause, '3.5');
  assert.equal(a.citation?.page, 7);
  // АТОМ ХОЛБООС: утгыг агуулсан хэсэг ба эшлэл НЭГ баримт; өөр баримтын хэсэгт тэр утга байхгүй.
  const valueChunks = a.evidence.filter((e) => e.text_mn.includes('1:5000'));
  assert.ok(valueChunks.length > 0);
  assert.ok(valueChunks.every((e) => e.doc_id === a.citation?.doc_id), 'утга ба эшлэл нэг баримтаас');
  assert.equal(a.evidence[0]?.doc_id, 'UBB-11-202-00-TEST');
  // Явцуу код нэрлэвэл ч ижил баримт
  const b = askNorm(db, 'УББ 11-202-00-ын 3.5 заалтаар ерөнхий төлөвлөгөөний масштаб хэд вэ?');
  assert.equal(b.citation?.doc_id, 'UBB-11-202-00-TEST');
  assert.equal(b.citation?.clause, '3.5');
  db.close();
  // Прод сан: фикстур ХЭЗЭЭ Ч орохгүй
  const prod = join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'knowledge', 'knowledge.sqlite');
  if (existsSync(prod)) {
    const p = openKnowledgeDb({ path: prod, readOnly: true });
    const n = (p.prepare("SELECT COUNT(*) AS n FROM ai_documents WHERE doc_id LIKE '%11-202-00%'").get() as { n: number }).n;
    assert.equal(n, 0, 'синтетик фикстур прод санд орсон байна!');
    p.close();
  }
});

/* ── P0-14 · хайлт УНАСАН ≠ олдсонгүй (runtime 503) ─────────────────── */

test('ftsCandidates · FTS хүснэгт алга (дахин шингээлт явж байна) → KnowledgeUnavailableError, [] БИШ', async () => {
  const { ftsCandidates } = await import('../src/search.ts');
  const { isKnowledgeInfrastructureError, KnowledgeUnavailableError } = await import('../src/db.ts');
  const db = openKnowledgeDb({ path: ':memory:' });
  db.exec('DROP TABLE IF EXISTS ai_chunks_fts');
  assert.throws(() => ftsCandidates(db, normalizeQuery('галын ачаалал хэд вэ'), 10), (e: unknown) => e instanceof KnowledgeUnavailableError);
  assert.equal(isKnowledgeInfrastructureError(new Error('no such table: ai_chunks_fts')), true);
  assert.equal(isKnowledgeInfrastructureError(new Error('database is locked')), true);
  assert.equal(isKnowledgeInfrastructureError(new Error('fts5: syntax error near "*"')), false, 'синтаксийн алдаа = хоосон үр дүн (олдсонгүй)');
  db.close();
});

test('runtime server.ts · санг ЗӨВХӨН УНШИНА, схем зөрвөл/сан унавал 503 (200 «олдсонгүй» биш)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(HERE, '..', '..', 'runtime', 'src', 'server.ts'), 'utf8');
  assert.match(src, /openKnowledgeDb\(\{ path: (?:cfg\.knowledgeDb|knowledgePath), readOnly: true \}\)/, 'runtime нь бичих горимоор нээж хүснэгт устгах эрсдэлгүй (B-ийн заагчийн knowledgePath ч readOnly)');
  assert.match(src, /knowledge_schema_mismatch/);
  assert.match(src, /knowledge_unavailable/);
  assert.match(src, /catch \(err\) \{[\s\S]{0,600}json\(res, 503/, 'askNorm-ын алдаа 503 болно');
});
