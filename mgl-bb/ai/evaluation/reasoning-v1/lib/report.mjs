import fs from 'node:fs';
import path from 'node:path';
import { sha256File, writeJson } from './canonical.mjs';
import { redactObject } from './redaction.mjs';
import { aggregateScores, aggregateRawFinal } from './score.mjs';
import { aggregateHardGates } from './safetyGates.mjs';
import { classifyFailure } from './failureStage.mjs';
import { semanticConsistencyRate } from './variants.mjs';
import { validateIdentity } from './identity.mjs';
import { loadFixture } from './loadCases.mjs';

export function validateResultReport(report){
  const errors=[];
  const required=['schema','benchmark_version','mode','identity','case_set_sha256','scorer_sha256','coverage','scores','hard_gates','repairs','failures_by_stage','cases'];
  for(const key of required) if(report?.[key]===undefined||report?.[key]===null) errors.push('missing '+key);
  if(report?.schema!=='mglai-reasoning-v1-result/1') errors.push('invalid result schema');
  if(!['STRUCTURAL','MODEL_ONLY_EVIDENCE','FULL_RAG','ADVERSARIAL_SYSTEM'].includes(report?.mode)) errors.push('unknown mode');
  if(typeof report?.case_set_sha256!=='string'||!report.case_set_sha256) errors.push('missing case-set hash');
  if(typeof report?.scorer_sha256!=='string'||!report.scorer_sha256) errors.push('missing scorer hash');
  for(const field of validateIdentity(report?.identity).missing) errors.push('identity.'+field);
  for(const key of ['core_total','executed','blocked','errors']) if(!Number.isInteger(report?.coverage?.[key])||report.coverage[key]<0) errors.push('invalid coverage.'+key);
  if(report?.coverage && Number.isInteger(report.coverage.core_total) && Number.isInteger(report.coverage.variant_total) &&
    report.coverage.executed+report.coverage.blocked+report.coverage.errors>report.coverage.core_total+report.coverage.variant_total) errors.push('coverage exceeds case count');
  if(!Array.isArray(report?.cases)) errors.push('cases must be an array');
  else for(const c of report.cases){
    if(typeof c.case_id!=='string'||!c.case_id) errors.push('case missing id');
    if(!['PASS','FAIL','BLOCKED','ERROR'].includes(c.status)) errors.push('case '+c.case_id+' has invalid status');
    if(['PASS','FAIL'].includes(c.status) && (!Number.isInteger(c.score)||c.score<0||c.score>4)) errors.push('case '+c.case_id+' has invalid score');
  }
  return {ok:errors.length===0,errors};
}

function stamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function sourceName(e){
  if(!e)return 'ERROR';
  if(e.final_source)return e.final_source;
  return e.status==='ERROR'?'ERROR':'MODEL';
}

export function buildReport({benchmark,mode,identity,executions,leakage,scorerPath}){
  const cases=benchmark.all.filter((c)=>c.modes.includes(mode));
  const scoredFinal=[];
  const scoredRaw=[];
  for(const c of cases){
    const e=executions.find((x)=>x.case_id===c.id)??{case_id:c.id,status:'BLOCKED',blocked_by:'NOT_EXECUTED'};
    const final=e._scored_final;
    const raw=e._scored_raw;
    if(final) scoredFinal.push({
      ...final,
      question:c.question??c.turns?.at(-1)?.question??c.turns?.at(-1)?.q??'',
      raw_answer:e.raw_answer??'',
      answer:e.final_answer??e.raw_answer??'',
      raw_status:raw?.status??null,
      raw_score:raw?.score??null,
      final_source:sourceName(e),
      repair_attempted:!!e.repair_attempted,
      repair_reasons:e.repair_reasons??[],
    });
    if(raw) scoredRaw.push({...raw,answer:e.raw_answer??''});
  }
  const summary=mode==='FULL_RAG'||mode==='ADVERSARIAL_SYSTEM'
    ? {raw:aggregateScores(scoredRaw),final:aggregateScores(scoredFinal)}
    : {model:aggregateScores(scoredFinal)};
  const hard=aggregateHardGates(scoredFinal,leakage);
  const failures={};
  for(const c of cases){
    const e=executions.find((x)=>x.case_id===c.id);
    const s=scoredFinal.find((x)=>x.case_id===c.id);
    if(!s||s.status==='PASS')continue;
    const f=classifyFailure(c,e,s)??{stage:'UNKNOWN'};
    failures[f.stage]=(failures[f.stage]??0)+1;
    s.failure_stage=f;
  }
  const measured=executions.filter((e)=>scoredFinal.some((s)=>s.case_id===e.case_id && (s.status==='PASS'||s.status==='FAIL')));
  const repairAttempted=measured.filter((e)=>e.repair_attempted).length;
  const recovered=measured.filter((e)=>{
    const r=scoredRaw.find((x)=>x.case_id===e.case_id), f=scoredFinal.find((x)=>x.case_id===e.case_id);
    return e.repair_attempted && r?.status==='FAIL' && f?.status==='PASS';
  }).length;
  const report={
    schema:'mglai-reasoning-v1-result/1',
    benchmark_version:benchmark.benchmark_version,
    mode,
    identity,
    case_set_sha256:benchmark.validation.case_set_sha256,
    scorer_sha256:sha256File(scorerPath),
    generated_at:new Date().toISOString(),
    coverage:{
      core_total:benchmark.core.filter((c)=>c.modes.includes(mode)).length,
      variant_total:benchmark.variants.filter((c)=>c.modes.includes(mode)).length,
      executed:scoredFinal.filter((x)=>x.status==='PASS'||x.status==='FAIL').length,
      blocked:scoredFinal.filter((x)=>x.status==='BLOCKED').length,
      errors:scoredFinal.filter((x)=>x.status==='ERROR').length,
      coverage_incomplete:scoredFinal.some((x)=>x.status==='BLOCKED'||x.status==='ERROR'),
    },
    scores:summary,
    semantic_consistency:semanticConsistencyRate(scoredFinal),
    hard_gates:hard,
    repairs:{
      attempted:repairAttempted,
      successful_recovery:recovered,
      failed:Math.max(0,repairAttempted-recovered),
      rate:measured.length?Math.round(repairAttempted/measured.length*10000)/100:null,
      reasons:measured.flatMap((e)=>e.repair_reasons??[]).reduce((a,x)=>(a[x]=(a[x]??0)+1,a),{}),
    },
    failures_by_stage:failures,
    cases:scoredFinal,
  };
  return report;
}

export function buildStructuralReport({benchmark,identity,dependencyOffenders,leakage,scorerPath}){
  const pass=benchmark.validation.ok && dependencyOffenders.length===0;
  return {
    schema:'mglai-reasoning-v1-result/1',
    benchmark_version:benchmark.benchmark_version,
    mode:'STRUCTURAL',
    identity,
    case_set_sha256:benchmark.validation.case_set_sha256,
    scorer_sha256:sha256File(scorerPath),
    generated_at:new Date().toISOString(),
    coverage:{core_total:benchmark.core.length,variant_total:benchmark.variants.length,executed:0,blocked:0,errors:pass?0:1},
    scores:{model_score:'UNMEASURED',natural_mongolian_human_score:'UNMEASURED'},
    hard_gates:aggregateHardGates([],leakage),
    repairs:{attempted:0,successful_recovery:0,failed:0,rate:null,reasons:{}},
    failures_by_stage:{},
    structural:{status:pass?'PASS':'FAIL',validation:benchmark.validation,production_imports_benchmark:dependencyOffenders},
    cases:[],
  };
}

export function writeReport(root,report){
  const dir=path.join(root,'reports');
  const file=path.join(dir,`reasoning-v1-${report.mode.toLowerCase().replaceAll('_','-')}-${stamp()}.json`);
  writeJson(file,redactObject(report));
  return file;
}

export function humanReviewExport(root,report,caseDefs){
  const byId=new Map(caseDefs.map((c)=>[c.id,c]));
  const items=(report.cases??[]).filter((r)=>r.status!=='BLOCKED'&&r.status!=='ERROR').map((r)=>{
    const c=byId.get(r.case_id);
    return {
      case_id:r.case_id,
      question:c?.question??c?.turns?.at(-1)?.question??c?.turns?.at(-1)?.q??'',
      answer:r.answer??'',
      automatic_result:{semantic_correct:r.status==='PASS',hard_gate_failure:(r.safety_findings??[]).length>0},
      human_review:{natural_mongolian:null,professional:null,clear:null,concise:null,notes:null},
    };
  });
  const out={schema:'mglai-reasoning-v1-human-review/1',benchmark_version:report.benchmark_version,mode:report.mode,generated_at:new Date().toISOString(),items};
  const file=path.join(root,'reports',`reasoning-v1-human-review-${report.mode.toLowerCase()}-${stamp()}.json`);
  writeJson(file,redactObject(out));
  return file;
}

export function referenceReviewExport(root,coreCases,caseSetSha256){
  const items=coreCases.map((c)=>{
    const fixture=c.evidence_fixture?loadFixture(root,c.evidence_fixture):null;
    return {
      case_id:c.id,
      category:c.category,
      question:c.question??c.turns?.at(-1)?.question??c.turns?.at(-1)?.q??'',
      turns:c.turns??null,
      expected:c.expected,
      provenance:c.provenance,
      evidence_fixture:c.evidence_fixture??null,
      evidence:fixture?.evidence??[],
      sources:fixture?.sources??[],
      reviewer:{name:null,reviewed_at:null,reference_correct:null,sources_verified:null,notes:null},
    };
  });
  const out={schema:'mglai-reasoning-v1-reference-review/1',case_set_sha256:caseSetSha256,generated_at:new Date().toISOString(),items};
  const file=path.join(root,'reports',`reasoning-v1-reference-review-${stamp()}.json`);
  writeJson(file,redactObject(out));
  return file;
}

export function printReport(report){
  console.log('\nMGL AI — REASONING V1');
  console.log('Benchmark ......... '+report.benchmark_version);
  console.log('Mode .............. '+report.mode);
  console.log('Git ............... '+(report.identity?.git_sha??'unknown'));
  console.log('Model ............. '+(report.identity?.observed_runtime_model?.model??report.identity?.model??'UNMEASURED'));
  console.log('Adapter ........... '+(report.identity?.adapter??'none/unknown'));
  console.log('Prompt ............ '+(report.identity?.system_prompt_version??'unknown'));
  console.log('Case set .......... '+String(report.case_set_sha256??'').slice(0,12));
  console.log('Core .............. '+report.coverage.core_total);
  console.log('Variants .......... '+(report.coverage.variant_total??0));
  console.log('Executed .......... '+report.coverage.executed);
  console.log('Blocked ........... '+report.coverage.blocked);
  if(report.mode==='STRUCTURAL'){
    console.log('STRUCTURAL_VALIDATION = '+report.structural.status);
    console.log('MODEL_SCORE = UNMEASURED');
  }else if(report.scores.raw){
    console.log('RAW_SCORE .......... '+(report.scores.raw.weighted_score??'UNMEASURED'));
    console.log('FINAL_SCORE ........ '+(report.scores.final.weighted_score??'UNMEASURED'));
    console.log('Repair attempted ... '+report.repairs.attempted);
  }else{
    console.log('MODEL_SCORE ......... '+(report.scores.model?.weighted_score??'UNMEASURED'));
  }
  console.log('Release gate ....... '+report.hard_gates.release_gate+(report.hard_gates.incomplete?' (incomplete)':''));
  if(report.coverage.coverage_incomplete) console.log('COVERAGE_INCOMPLETE');
}
