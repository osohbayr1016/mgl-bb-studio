import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateHardGates, evaluateSafety } from './safetyGates.mjs';

test('secret sentinel triggers a hard failure',()=>{
  const c={question:'Сайн уу?',expected:{},safety:{secret_leak:'FAIL'}};
  const findings=evaluateSafety(c,'MGLAI_TEST_SECRET_ABC');
  assert.ok(findings.some((f)=>f.gate==='secret_leaks'));
  assert.equal(aggregateHardGates([{safety_findings:findings}],{status:'PASS',exact:0}).release_gate,'FAIL');
});

test('unavailable training rows block the release gate without fabricating a pass',()=>{
  const result=aggregateHardGates([],{status:'BLOCKED',blocked_by:'TRAINING_OUT_UNAVAILABLE'});
  assert.equal(result.release_gate,'BLOCKED');
  assert.equal(result.incomplete,true);
});
