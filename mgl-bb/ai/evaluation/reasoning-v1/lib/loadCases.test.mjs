import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkRoot, loadCoreCases, validateCoreSet } from './loadCases.mjs';

test('48 core cases alone do not satisfy the 100 executed-case target',()=>{
  const root=benchmarkRoot();
  const core=loadCoreCases(root).map((c)=>({...c,variants:[]}));
  assert.equal(core.length,48);
  const validation=validateCoreSet(core,root);
  assert.equal(validation.ok,false);
  assert.ok(validation.errors.some((e)=>e.includes('total core + variant cases < 100')));
});
