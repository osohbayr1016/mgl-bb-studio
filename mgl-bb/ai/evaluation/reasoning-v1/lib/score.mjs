import { evaluateSafety } from './safetyGates.mjs';

export const DIMENSION_WEIGHTS = {
  'mongolian-understanding': 10,
  'norm-retrieval': 15,
  'applied-rule': 20,
  'engineering-reasoning': 20,
  clarification: 10,
  'hallucination-traps': 15,
  conversation: 5,
  'cross-source': 5,
};

function hit(text, pattern) {
  try { return new RegExp(pattern,'iu').test(String(text ?? '')); }
  catch { return String(text ?? '').toLocaleLowerCase('mn-MN').includes(String(pattern).toLocaleLowerCase('mn-MN')); }
}
function any(text, patterns=[]) { return patterns.some((p)=>hit(text,p)); }
function all(text, patterns=[]) { return patterns.every((p)=>hit(text,p)); }
function esc(s){return String(s).replace(/[.*+?^$()|[\]\\]/g,'\\$&');}

function languageOk(text, langs) {
  if (!Array.isArray(langs) || langs.length===0) return true;
  const cyr=(String(text).match(/[А-Яа-яӨөҮүЁё]/g)??[]).length;
  const lat=(String(text).match(/[A-Za-z]/g)??[]).length;
  if(langs.includes('en')) return lat>cyr;
  if(langs.some((x)=>x==='mn-Cyrl'||x==='mn-Latn'||x==='mixed')) return cyr>0 && cyr>=lat;
  return true;
}

export function semanticChecks(caseDef, answer, execution={}) {
  const exp=caseDef.expected??{};
  const checks=[];
  const add=(kind,id,ok,detail='')=>checks.push({kind,id,ok,detail});
  const text=String(answer??'');

  if (exp.intent) add('intent','intent',execution.trace?.intent===exp.intent,'expected '+exp.intent+', got '+(execution.trace?.intent??'missing'));

  if (exp.decision) {
    const accepts=exp.decision.accept??[];
    const rejects=exp.decision.reject??[];
    const ok=(accepts.length===0||any(text,accepts)) && !any(text,rejects);
    add('decision','decision:'+exp.decision.value,ok,ok?exp.decision.value:'expected '+exp.decision.value);
  }

  for(const c of exp.required_claims??[]) add('claim',c.id,any(text,c.any??[]) && !any(text,c.reject??[]),'required semantic claim');
  for(const m of exp.missing_inputs??[]) add('missing',m.id,any(text,m.any??[]),'required missing input');
  for(const f of exp.forbidden_claims??[]) add('forbidden',f.id,!any(text,f.any??[]),'forbidden claim');

  for(const s of exp.required_sources??[]) {
    const doc=s.document?hit(text,esc(s.document)):true;
    const clause=s.clause?hit(text,esc(s.clause)):true;
    add('source','source:'+(s.document??'')+':'+(s.clause??''),doc&&clause,'required source locator');
  }

  if(exp.calculation){
    const rv=String(exp.calculation.result).replace('.', '[.,]');
    const resultOk=hit(text,'(?<!\\d)'+rv+'(?!\\d)');
    const unitOk=exp.calculation.unit?any(text,exp.calculation.unit_patterns??[esc(exp.calculation.unit)]):true;
    add('calculation','calculation-result',resultOk&&unitOk,'expected '+exp.calculation.result+' '+(exp.calculation.unit??''));
  }

  if(exp.require_all) add('claim','require-all',all(text,exp.require_all),'all required patterns');
  if(exp.require_any) add('claim','require-any',any(text,exp.require_any),'at least one required pattern');
  if(exp.language) add('language','language',languageOk(text,[exp.language]),'expected '+exp.language);
  else if(caseDef.languages?.includes('mn-Cyrl')||caseDef.languages?.includes('mn-Latn')) add('language','language',languageOk(text,caseDef.languages),'expected Mongolian Cyrillic answer');

  for(const fact of exp.trusted_facts??[]){
    const ok=(fact.accept??[String(fact.value)]).some((p)=>hit(text,p)) && !any(text,fact.reject??[]);
    add('trusted-fact',fact.id??String(fact.value),ok,'trusted fact consistency');
  }

  return checks;
}

export function scoreCase(caseDef, answer, execution={}) {
  if(execution.status==='BLOCKED') return {case_id:caseDef.id,core_id:caseDef.core_id??caseDef.id,is_variant:!!caseDef.is_variant,same_semantics:caseDef.same_semantics,status:'BLOCKED',blocked_by:execution.blocked_by,score:null,passed:null,checks:[],semantic:{decision:null},safety_findings:[]};
  if(execution.status==='ERROR') return {case_id:caseDef.id,core_id:caseDef.core_id??caseDef.id,is_variant:!!caseDef.is_variant,same_semantics:caseDef.same_semantics,status:'ERROR',score:null,passed:null,checks:[],semantic:{decision:null},safety_findings:[],error:execution.error};

  const checks=semanticChecks(caseDef,answer,execution);
  const safety=evaluateSafety(caseDef,answer,execution);
  const decision=checks.find((x)=>x.kind==='decision');
  const hard=safety.length>0;
  let score=4;
  if(hard || (decision && !decision.ok)) score=0;
  else {
    const failed=checks.filter((x)=>!x.ok);
    const substantial=failed.filter((x)=>['source','claim','missing','calculation','trusted-fact','intent','forbidden','language'].includes(x.kind));
    if(substantial.length>=2) score=1;
    else if(substantial.length===1) score=2;
    else if(failed.length>0) score=3;
  }
  const passed=score>=3 && !hard;
  return {
    case_id:caseDef.id, core_id:caseDef.core_id??caseDef.id, is_variant:!!caseDef.is_variant,
    same_semantics:caseDef.same_semantics, category:caseDef.category, status:passed?'PASS':'FAIL',
    score, passed, checks, safety_findings:safety,
    semantic:{decision: decision?.ok ? caseDef.expected?.decision?.value ?? null : null},
  };
}

function pct(n,d){return d?Math.round((n/d)*10000)/100:null;}

export function aggregateScores(caseResults) {
  const scored=caseResults.filter((r)=>r.status==='PASS'||r.status==='FAIL');
  const blocked=caseResults.filter((r)=>r.status==='BLOCKED').length;
  const errors=caseResults.filter((r)=>r.status==='ERROR').length;
  const by={};
  for(const [cat,w] of Object.entries(DIMENSION_WEIGHTS)) by[cat]={weight:w,n:0,pass:0,points:0,score:null};
  for(const r of scored){
    if(!by[r.category]) continue;
    const b=by[r.category]; b.n++; if(r.passed)b.pass++; b.points+=r.score??0;
  }
  let weightedNumerator=0, applicableWeight=0;
  for(const b of Object.values(by)){
    b.score=b.n?Math.round((b.points/(4*b.n))*10000)/100:null;
    b.pass_rate=b.n?pct(b.pass,b.n):null;
    if(b.n){weightedNumerator+=b.score*b.weight;applicableWeight+=b.weight;}
  }
  return {
    weighted_score:applicableWeight?Math.round((weightedNumerator/applicableWeight)*100)/100:null,
    raw_pass:scored.filter((r)=>r.passed).length,
    raw_fail:scored.filter((r)=>!r.passed).length,
    scored:scored.length, blocked, errors,
    coverage_incomplete:blocked>0||errors>0,
    dimensions:by,
  };
}

export function aggregateRawFinal(caseDefs, executions) {
  const raw=[], fin=[];
  for(const c of caseDefs){
    const e=executions.find((x)=>x.case_id===c.id);
    if(!e) continue;
    raw.push(scoreCase(c,e.raw_answer??'',e));
    fin.push(scoreCase(c,e.final_answer??e.raw_answer??'',e));
  }
  return { raw:{cases:raw,...aggregateScores(raw)}, final:{cases:fin,...aggregateScores(fin)} };
}
