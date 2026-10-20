import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReports } from './compareLib.mjs';

function report(score=75){
  return {
    schema:'mglai-reasoning-v1-result/1', benchmark_version:'reasoning-v1.0.0', mode:'MODEL_ONLY_EVIDENCE',
    case_set_sha256:'cases', scorer_sha256:'scorer',
    identity:{git_sha:'commit',system_prompt_version:'sys-7',tool_schema_version:'tools-1',retrieval_version:'rag-1',model:'Qwen3-8B',model_revision:'rev',model_sha256:'model-sha',quantization:'Q4',adapter:null,adapter_sha256:null,context_tokens:8192,knowledge_db_hash:null,identity_incomplete:false,observed_runtime_model:{model:'Qwen3-8B'}},
    coverage:{executed:48,blocked:0,errors:0,coverage_incomplete:false},
    scores:{model:{weighted_score:score}},hard_gates:{release_gate:'PASS'},
  };
}

test('compatible complete measured reports compare scores',()=>{
  const result=compareReports(report(75),report(80));
  assert.equal(result.status,'COMPARABLE');
  assert.equal(result.score.delta,5);
});

test('missing model identity cannot compare even when both sides omit it',()=>{
  const a=report(), b=report();
  a.identity.model_sha256=null; b.identity.model_sha256=null;
  assert.equal(compareReports(a,b).status,'INCOMPATIBLE');
});

test('blocked coverage cannot be presented as a comparable quality score',()=>{
  const a=report(), b=report();
  b.coverage={executed:28,blocked:20,errors:0,coverage_incomplete:true};
  assert.equal(compareReports(a,b).status,'INCOMPATIBLE');
});

test('documented model metadata without observed runtime is insufficient',()=>{
  const a=report(), b=report();
  b.identity.observed_runtime_model=null;
  assert.equal(compareReports(a,b).status,'INCOMPATIBLE');
});
