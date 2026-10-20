import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistory, fingerprint, normalizedQuestion, selectBatch, updatedHistory, validateHistory } from './lib.mjs';

const categories = ['mongolian-understanding','norm-retrieval','applied-rule','engineering-reasoning','clarification','hallucination-traps','conversation','cross-source'];
const catalog = categories.flatMap((category, i) => Array.from({ length: 6 }, (_, j) => ({
  id: String(i) + '-' + String(j),
  category, question: category + ' шинэ асуулт ' + j,
  expected: { decision: { value: 'CHECK' } },
  provenance: { review_status: 'REFERENCE_VERIFIED' },
})));

test('one balanced 40-case cycle has unique IDs, questions and categories', () => {
  const cases = selectBatch(catalog, emptyHistory(), { size: 40, seed: 'fixed' });
  assert.equal(cases.length, 40);
  assert.equal(new Set(cases.map((c) => c.id)).size, 40);
  assert.equal(new Set(cases.map(fingerprint)).size, 40);
  for (const category of categories) assert.equal(cases.filter((c) => c.category === category).length, 5);
  assert.deepEqual(selectBatch(catalog, emptyHistory(), { size: 40, seed: 'fixed' }).map((c)=>c.id), cases.map((c)=>c.id));
});

test('used core cases are never recycled; exhaustion blocks rather than pretending to generate novel questions', () => {
  const before = emptyHistory();
  const first = selectBatch(catalog, before, { size: 40 });
  const after = updatedHistory(before, first);
  assert.equal(after.completed_batches, 1);
  assert.equal(after.used_core_ids.length, 40);
  assert.throws(() => selectBatch(catalog, after, { size: 30 }), /Only 8 novel core cases remain/);
});

test('formatting duplicates and same-semantics variants cannot inflate novelty', () => {
  assert.equal(normalizedQuestion({question:'  ГАЛЫН ачаалал, 2600?! '}), normalizedQuestion({question:'галын ачаалал 2600'}));
  const a = {id:'X',category:'norm-retrieval',question:'Галын ачаалал 2600',expected:{},provenance:{}};
  const b = {...a,id:'Y',question:'Галын ачаалал, 2600?'};
  const variant = {...a,id:'X-LATN',is_variant:true,core_id:'X',question:'Galyn achaalal 2600'};
  const rows = [...catalog, a, b, variant];
  const picked = selectBatch(rows,emptyHistory(),{size:40});
  assert.ok(picked.filter((c)=>['X','Y','X-LATN'].includes(c.id)).length<=1);
});

test('malformed history and invalid requested sizes fail closed', () => {
  assert.throws(()=>selectBatch(catalog,emptyHistory(),{size:29}),/between 30 and 50/);
  assert.throws(()=>selectBatch(catalog,emptyHistory(),{size:51}),/between 30 and 50/);
  assert.throws(()=>validateHistory({schema:'unexpected'}),/Unknown history schema/);
  assert.throws(()=>selectBatch([...catalog,catalog[0]],emptyHistory(),{size:40}),/Duplicate case id/);
});

test('history does not change original data and rejects reuse',()=>{
  const h = emptyHistory();
  const selection = selectBatch(catalog,h,{size:40});
  updatedHistory(h,selection);
  assert.equal(h.used_core_ids.length,0);
  assert.throws(()=>updatedHistory(updatedHistory(h,selection),selection),/Duplicate during history update/);
});
