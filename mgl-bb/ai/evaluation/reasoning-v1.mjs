#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmark, validateDependencyDirection } from './reasoning-v1/lib/loadCases.mjs';
import { buildIdentity } from './reasoning-v1/lib/identity.mjs';
import { scanBenchmarkTrainLeak } from './reasoning-v1/lib/safetyGates.mjs';
import { scoreCase } from './reasoning-v1/lib/score.mjs';
import { executeCases, resetExecutorState } from './reasoning-v1/lib/executors.mjs';
import { buildReport, buildStructuralReport, humanReviewExport, referenceReviewExport, printReport, validateResultReport, writeReport } from './reasoning-v1/lib/report.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const REPO=path.resolve(HERE,'..','..');
const ROOT=path.join(HERE,'reasoning-v1');
const SCORER=path.join(ROOT,'lib','score.mjs');
const argv=process.argv.slice(2);
const flag=(name,def=null)=>{const i=argv.indexOf('--'+name);return i<0?def:(argv[i+1]??def);};
const requested=flag('mode','all');
const onlyRaw=flag('only', null);
const onlyIds=onlyRaw === null ? null : new Set(onlyRaw.split(',').map((x)=>x.trim()).filter(Boolean));
const valid=new Set(['all','structural','model','full','adversarial']);
if(!valid.has(requested)){console.error('Unknown --mode '+requested);process.exit(2);}

const benchmark=loadBenchmark(ROOT);
if (onlyIds) {
  const validIds = new Set(benchmark.all.map((c)=>c.id));
  const unknown = [...onlyIds].filter((id)=>!validIds.has(id));
  if (!onlyIds.size || unknown.length) {
    console.error('Invalid --only: ' + (unknown.join(', ') || 'no case IDs'));
    process.exit(2);
  }
}
const identity=await buildIdentity({repoRoot:REPO,requireLive:false,runtimeUrl:flag('rt',undefined)});
const leakage=scanBenchmarkTrainLeak(benchmark.core,REPO);
const offenders=validateDependencyDirection(REPO);
const structural=buildStructuralReport({benchmark,identity,dependencyOffenders:offenders,leakage,scorerPath:SCORER});
const structuralSchema=validateResultReport(structural);
if(!structuralSchema.ok){console.error(structuralSchema.errors.join('\n'));process.exit(2);}
const structuralFile=writeReport(ROOT,structural);
printReport(structural);
console.log('Report ............ '+structuralFile);
if(structural.structural.status!=='PASS'){
  console.error('\nStructural errors:');
  for(const e of structural.structural.validation.errors)console.error(' - '+e);
  for(const e of offenders)console.error(' - production imports benchmark: '+e);
  process.exit(2);
}
const referenceFile=referenceReviewExport(ROOT,benchmark.core,benchmark.validation.case_set_sha256);
console.log('Reference review .. '+referenceFile);
if(requested==='structural')process.exit(0);

const names=requested==='all'
  ? [['MODEL_ONLY_EVIDENCE','model'],['FULL_RAG','full'],['ADVERSARIAL_SYSTEM','adversarial']]
  : [[requested==='model'?'MODEL_ONLY_EVIDENCE':requested==='full'?'FULL_RAG':'ADVERSARIAL_SYSTEM',requested]];

let anyMeasured=false, anyFailed=false, allExplicitBlocked=true;
for(const [mode] of names){
  resetExecutorState();
  const applicable=benchmark.all.filter((c)=>c.modes.includes(mode) && (!onlyIds || onlyIds.has(c.id)));
  const executions=await executeCases(mode,applicable,{
    root:ROOT,
    runtimeUrl:flag('rt',undefined),
    apiUrl:flag('api',undefined),
    user:flag('user',undefined),
    pass:flag('pass',undefined),
    maxTokens:Number(flag('max-tokens','700')),
  });
  for(const c of applicable){
    const e=executions.find((x)=>x.case_id===c.id);
    if(!e)continue;
    e._scored_raw=scoreCase(c,e.raw_answer??'',e);
    e._scored_final=scoreCase(c,e.final_answer??e.raw_answer??'',e);
  }
  const scopedBenchmark=onlyIds ? {...benchmark,all:applicable,core:applicable.filter((c)=>!c.is_variant),variants:applicable.filter((c)=>c.is_variant)} : benchmark;
  const report=buildReport({benchmark:scopedBenchmark,mode,identity,executions,leakage,scorerPath:SCORER});
  const resultSchema=validateResultReport(report);
  if(!resultSchema.ok){console.error(resultSchema.errors.join('\n'));process.exit(2);}
  const file=writeReport(ROOT,report);
  const human=humanReviewExport(ROOT,report,applicable);
  printReport(report);
  console.log('Report ............ '+file);
  console.log('Human review ...... '+human);
  const measured=report.coverage.executed>0;
  if(measured){anyMeasured=true;allExplicitBlocked=false;}
  if(report.coverage.errors>0)allExplicitBlocked=false;
  const scoreBlock=report.scores.model??report.scores.final;
  if(measured && ((scoreBlock?.raw_fail??0)>0 || report.hard_gates.release_gate==='FAIL')) anyFailed=true;
}

if(!anyMeasured)console.log('\nCURRENT QWEN REASONING SCORE: UNMEASURED');
if(requested!=='all' && allExplicitBlocked)process.exit(3);
if(anyFailed)process.exit(1);
process.exit(0);
