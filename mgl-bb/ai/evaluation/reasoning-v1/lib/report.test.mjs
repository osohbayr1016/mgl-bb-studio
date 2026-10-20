import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReport, humanReviewExport, referenceReviewExport, validateResultReport } from './report.mjs';
import { benchmarkRoot, loadCoreCases } from './loadCases.mjs';

test('report preserves raw/final distinction and exports the actual answer for blind review', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mglai-reasoning-report-'));
  try {
    const c = { id: 'AR-001', category: 'applied-rule', question: 'Болж болох уу?', modes: ['FULL_RAG'] };
    const raw = { case_id: c.id, category: c.category, status: 'FAIL', score: 0, passed: false, safety_findings: [] };
    const final = { ...raw, status: 'PASS', score: 4, passed: true };
    const benchmark = { all: [c], core: [c], variants: [], benchmark_version: 'reasoning-v1.0.0', validation: { case_set_sha256: 'abc' } };
    const report = buildReport({
      benchmark, mode: 'FULL_RAG', identity: { git_sha: 'abc' },
      executions: [{ case_id: c.id, status: 'OK', raw_answer: 'Болж болно.', final_answer: 'Хараахан болохгүй.', repair_attempted: true, repair_reasons: ['TRUSTED_FACT_CONTRADICTION'], _scored_raw: raw, _scored_final: final }],
      leakage: { status: 'PASS', exact: 0, fuzzy: 0 }, scorerPath: new URL('./score.mjs', import.meta.url).pathname,
    });
    assert.equal(report.scores.raw.raw_fail, 1);
    assert.equal(report.scores.final.raw_pass, 1);
    assert.equal(report.repairs.successful_recovery, 1);
    assert.equal(report.repairs.rate, 100);
    assert.equal(report.cases[0].raw_status, 'FAIL');
    assert.equal(report.cases[0].raw_answer, 'Болж болно.');
    assert.equal(report.cases[0].answer, 'Хараахан болохгүй.');
    const review = JSON.parse(fs.readFileSync(humanReviewExport(root, report, [c]), 'utf8'));
    assert.equal(review.items[0].answer, 'Хараахан болохгүй.');
    assert.equal(review.items[0].human_review.natural_mongolian, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('result validation rejects missing identity, invalid mode and score',()=>{
  const identity={schema:'mglai-reasoning-benchmark-identity/1'};
  for(const key of ['git_sha','product_version','system_prompt_version','tool_schema_version','retrieval_version','model','model_revision','model_sha256','quantization','adapter','adapter_sha256','context_tokens','knowledge_db_hash','dataset_manifest_hash','runtime_version','generated_at','hardware','identity_incomplete']) identity[key]=null;
  const report={schema:'mglai-reasoning-v1-result/1',benchmark_version:'reasoning-v1.0.0',mode:'MODEL_ONLY_EVIDENCE',identity,case_set_sha256:'cases',scorer_sha256:'scorer',coverage:{core_total:1,variant_total:0,executed:1,blocked:0,errors:0},scores:{},hard_gates:{},repairs:{},failures_by_stage:{},cases:[{case_id:'AR-001',status:'PASS',score:4}]};
  assert.equal(validateResultReport(report).ok,true);
  const broken={...report,mode:'UNKNOWN',identity:{schema:identity.schema},cases:[{case_id:'AR-001',status:'PASS',score:9}]};
  const result=validateResultReport(broken);
  assert.equal(result.ok,false);
  assert.ok(result.errors.some((e)=>e.includes('unknown mode')));
  assert.ok(result.errors.some((e)=>e.includes('identity.git_sha')));
  assert.ok(result.errors.some((e)=>e.includes('invalid score')));
});

test('reference review packet includes all core expectations and leaves human verdicts blank',()=>{
  const root=benchmarkRoot();
  const core=loadCoreCases(root);
  const file=referenceReviewExport(root,core,'case-hash');
  try{
    const packet=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(packet.items.length,48);
    assert.equal(packet.case_set_sha256,'case-hash');
    assert.ok(packet.items.some((item)=>item.sources.length>0));
    assert.ok(packet.items.every((item)=>item.reviewer.reference_correct===null && item.reviewer.sources_verified===null));
  }finally{fs.rmSync(file);}
});
