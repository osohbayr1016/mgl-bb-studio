import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkRoot, caseSetSha256, loadCoreCases, validateCase, validateCoreSet, validateDependencyDirection } from './loadCases.mjs';
import { aggregateScores, scoreCase } from './score.mjs';
import { validateIdentity } from './identity.mjs';

const root=benchmarkRoot();
const core=loadCoreCases(root);

test('case hash is stable under object key order and changes with semantics',()=>{
  const first=core[0];
  const reordered=Object.fromEntries(Object.entries(first).reverse());
  assert.equal(caseSetSha256([first]),caseSetSha256([reordered]));
  assert.notEqual(caseSetSha256([first]),caseSetSha256([{...first,expected:{...first.expected,decision:{...first.expected.decision,value:'CHANGED'}}}]));
});

test('case validator rejects absent expectations, unknown modes, invalid safety and missing fixtures',()=>{
  const c=core[0];
  assert.ok(validateCase({...c,expected:{}},root).some((e)=>e.includes('expected semantics')));
  assert.ok(validateCase({...c,expected:{allowed_numbers:[1]}},root).some((e)=>e.includes('no scored assertion')));
  assert.ok(validateCase({...c,modes:['UNKNOWN']},root).some((e)=>e.includes('bad modes')));
  assert.ok(validateCase({...c,safety:{fabricated_number:'MAYBE'}},root).some((e)=>e.includes('invalid safety')));
  assert.ok(validateCase({...c,evidence_fixture:'evidence/does-not-exist.json'},root).some((e)=>e.includes('fixture not found')));
  const sourced=core.find((item)=>item.expected?.required_sources?.length);
  assert.ok(validateCase({...sourced,expected:{...sourced.expected,required_sources:[{document:'Invented standard'}]}},root)
    .some((e)=>e.includes('required source absent')));
});

test('core validator rejects duplicate IDs and category count drift',()=>{
  const duplicate=core.map((c)=>structuredClone(c));
  duplicate[1].id=duplicate[0].id;
  const result=validateCoreSet(duplicate,root);
  assert.equal(result.ok,false);
  assert.ok(result.errors.some((e)=>e.includes('duplicate core id')));
  const drift=core.map((c)=>structuredClone(c));
  drift[1].category='clarification';
  assert.ok(validateCoreSet(drift,root).errors.some((e)=>e.includes('category')));
});

test('blocked cases are excluded from the score denominator and mark coverage incomplete',()=>{
  const c=core[0];
  const blocked=scoreCase(c,'',{status:'BLOCKED',blocked_by:'RUNTIME_UNAVAILABLE'});
  const pass={case_id:'SYNTHETIC',category:c.category,status:'PASS',passed:true,score:4};
  const summary=aggregateScores([blocked,pass]);
  assert.equal(summary.scored,1);
  assert.equal(summary.blocked,1);
  assert.equal(summary.coverage_incomplete,true);
  assert.equal(summary.weighted_score,100);
});

test('identity shape requires every declared field even when a value is unavailable',()=>{
  const identity={schema:'mglai-reasoning-benchmark-identity/1'};
  const result=validateIdentity(identity);
  assert.equal(result.ok,false);
  assert.ok(result.missing.includes('git_sha'));
  assert.ok(result.missing.includes('model_sha256'));
});

test('production source does not import the benchmark',()=>{
  const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..','..','..');
  assert.deepEqual(validateDependencyDirection(repo),[]);
});
