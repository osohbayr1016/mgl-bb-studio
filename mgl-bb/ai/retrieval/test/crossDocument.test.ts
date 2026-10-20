/**
 * MGL AI retrieval · БАРИМТ ХООРОНДЫН ӨРСӨЛДӨӨН (2026-09-21, БНбД 20-04-17 корпуст орсны дараа) — ТЕСТ.
 *
 * Run with:  node --test retrieval/test/crossDocument.test.ts
 *
 * Хэмжсэн гурван гажиг, гурвуулаа ЗАСВАРТАЙ:
 *   1. «7.1-р хүснэгт» → `extractDocRef` «1» гэж бүхэл тоон хүснэгт (table:1) уншиж СНиП-ийн 1-р
 *      хүснэгтийг татаж байв; баримт нэрлэсэн үед «7.1» нь заалт гэж уншигдаж хүснэгт FTS-ийн 6-рт үлдэв.
 *   2. Ерөнхий alias («орон сууц» → БНбД 21-04-05-ын 5 мөр, «sprinkler» → 89 мөр) тэдгээр мөрийн БҮХ ах дүү
 *      alias-ыг FTS-д нэмж мөрүүд өөрсдийгөө өргөж эхний 40-ийг дүүргэж, 20-04-17-ийн 8.3-р хүснэгт
 *      (BM25 3-рт) огт орж ирэхгүй, галын дохиоллын мөр «verified» гарч байв.
 *   3. Хавсралтын үсэгтэй хүснэгт («Д.1-р хүснэгт») бүтэцтэй хөлд огт байгаагүй.
 * Бодит багц олдохгүй бол шингээлтийн тестүүд АЛГАСНА (унахгүй).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeQuery } from '../src/normalize.ts';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset } from '../src/ingest.ts';
import { askNorm } from '../src/pipeline.ts';
import { structuredCandidates, expandAliases } from '../src/search.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOADS = join(HERE, '..', '..', 'norm-dataset', 'documents', 'BNbD_20-04-17', 'pack');
const FIRE = join(HERE, '..', '..', 'data-train-files', 'MGL_AI_BNbD_21_04_05_dataset');
const skipLoads = existsSync(join(LOADS, 'norm-dataset.pack.json')) ? false : 'БНбД 20-04-17 багц олдсонгүй';
const skipBoth = existsSync(join(LOADS, 'norm-dataset.pack.json')) && existsSync(join(FIRE, 'rules.jsonl')) ? false : 'хоёр багцын аль нэг олдсонгүй';

/* ── 1. хүснэгтийн дугаар ─────────────────────────────────────────── */

test('extractDocRef: бүхэл тоон хүснэгт л `table`; цэгтэй/үсэгтэй дугаар («7.1-р», «Д.1-р», «Хүснэгт 16.2.1») энд орохгүй', () => {
  assert.deepEqual(normalizeQuery('5-р хүснэгт').docRef, { table: 5 });
  assert.deepEqual(normalizeQuery('Хүснэгт 12').docRef, { table: 12 });
  assert.deepEqual(normalizeQuery('Хүснэгт 3, мөр 4').docRef, { table: 3, row: '4' });
  assert.deepEqual(normalizeQuery('table 1 row 2').docRef, { table: 1, row: '2' });
  assert.deepEqual(normalizeQuery('7.1-р хүснэгт').docRef, {});
  assert.deepEqual(normalizeQuery('Хүснэгт 16.2.1').docRef, {});
  assert.deepEqual(normalizeQuery('Д.1-р хүснэгт хотойлт').docRef, {});
  const named = normalizeQuery('БНбД 21-04-05 1-р хүснэгтийн 12-р мөр').docRef;
  assert.equal(named.table, 1);
  assert.equal(named.row, '12');
});

test('бүтэцтэй хөл: «7.1-р хүснэгт» баримт нэрлэсэн ч заалт биш ХҮСНЭГТ; «Д.1-р хүснэгт» олдоно', { skip: skipLoads }, () => {
  const db = openKnowledgeDb({ path: ':memory:' });
  ingestDataset(db, LOADS);
  const t71 = structuredCandidates(db, normalizeQuery('БНбД 20-04-17-ийн 7.1-р хүснэгт: найдваршлын илтгэлцүүр'));
  assert.deepEqual(t71.map((c) => c.chunkId), ['BNBD-20-04-17-2017:table:7.1']);
  const d1 = structuredCandidates(db, normalizeQuery('Д.1-р хүснэгт бүтээцийн элементийн босоо хотойлтын хязгаар'));
  assert.deepEqual(d1.map((c) => c.chunkId), ['BNBD-20-04-17-2017:table:Д.1']);
  const lat = structuredCandidates(db, normalizeQuery('8.3-r khusnegt oron suutsnii uruunii achaallyn normyn utga'));
  assert.deepEqual(lat.map((c) => c.chunkId), ['BNBD-20-04-17-2017:table:8.3']);
  // заалт нь хэвээр заалт
  const c = structuredCandidates(db, normalizeQuery('БНбД 20-04-17-ийн 10.11 заалт'));
  assert.deepEqual(c.map((x) => x.chunkId), ['BNBD-20-04-17-2017:clause:10.11']);
  db.close();
});

/* ── 2. ерөнхий alias-ын хөөрөгдөл ───────────────────────────────── */

test('expandAliases: ≥5 канонд хуваалцсан alias-аар л таарсан канонын ах дүү FTS-д өргөтгөгдөхгүй (cap 4), хаалга/alias хөл хэвээр', { skip: skipBoth }, () => {
  const db = openKnowledgeDb({ path: ':memory:' });
  ingestDataset(db, FIRE);
  ingestDataset(db, LOADS);
  const q = normalizeQuery('Орон сууцны өрөө, эмнэлэг, зочид буудлын хучилтад жигд тархсан түр ачааллын нормын утга хэд вэ?');
  const all = expandAliases(db, q);
  const capped = expandAliases(db, q, { maxCanonicalsPerAlias: 4 });
  assert.ok(all.some((a) => /sprinkler|automatic fire/i.test(a)), 'capgүй өргөтгөл галын мөрийн alias-ыг агуулна (хуучин зан төлөв)');
  assert.ok(!capped.some((a) => /sprinkler|automatic fire/i.test(a)), 'cap-тай өргөтгөлд галын alias орохгүй');
  db.close();
});

test('«Орон сууцны хучилтад жигд тархсан түр ачааллын нормын утга» → 20-04-17-ийн 8.3-р хүснэгт нотолгоонд, галын мөр «verified» гарахгүй', { skip: skipBoth }, () => {
  const db = openKnowledgeDb({ path: ':memory:' });
  ingestDataset(db, FIRE);
  ingestDataset(db, LOADS);
  const a = askNorm(db, 'Орон сууцны өрөө, эмнэлэг, зочид буудлын хучилтад жигд тархсан түр ачааллын нормын утга хэд вэ?', { evidenceLimit: 5 });
  const ids = a.evidence.map((e) => e.chunk_id);
  assert.ok(ids.includes('BNBD-20-04-17-2017:table:8.3'), ids.join(','));
  assert.notEqual(a.status, 'verified');
  assert.equal(a.citation?.document, 'БНбД 20-04-17');
  // галын дохиоллын асуулт хэвээр галын багцаас
  const fire = askNorm(db, 'Хатаалгын өрөөнд ГУАТ хэрэгтэй юу?', { evidenceLimit: 5 });
  assert.equal(fire.citation?.document, 'БНбД 21-04-05');
  db.close();
});
