import path from 'node:path';
import { registerHooks } from 'node:module';
import { createClient } from '../../lib/e2e.mjs';
import { loadFixture } from './loadCases.mjs';
import { readSecret } from './identity.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(specifier + '.ts', context);
    return nextResolve(specifier, context);
  },
});

const promptFrame = await import('../../../../backend/src/lib/mglai/promptFrame.ts');
const { assembleTurns } = promptFrame;

function questionOf(c) {
  return c.question ?? c.turns?.at(-1)?.question ?? c.turns?.at(-1)?.q ?? '';
}

function responseLanguage(c) {
  return c.languages?.includes('en') ? 'en' : 'mn-Cyrl';
}

function evidenceFromFixture(f) {
  return (f?.evidence ?? []).map((e, i) => ({
    id: e.id ?? `fixture-${i+1}`,
    kind: e.kind ?? 'chunk',
    title: e.title ?? 'Benchmark evidence',
    documentUid: e.documentUid ?? null,
    clauseUid: e.clauseUid ?? null,
    page: e.page ?? null,
    section: e.section ?? null,
    score: 1,
    text: e.text ?? '',
  }));
}

function supportedText(f) {
  return (f?.evidence ?? []).map((e) => e.text ?? '').join('\n');
}

function fixtureExtra(f) {
  if (!f) return {};
  return {
    syntheticTools: f.syntheticTools,
    replaceTools: f.replaceTools,
    normOverride: f.normOverride,
    localMemory: f.localMemory,
  };
}

function sourceClass(rec, contract) {
  if (contract?.answerMode === 'refusal' && (rec?.source === 'template' || rec?.source === 'repaired')) return 'REFUSAL';
  if (rec?.source === 'template') return 'DETERMINISTIC';
  if (rec?.source === 'repaired' || rec?.source === 'regenerated') return 'REPAIRED';
  return 'MODEL';
}

function repairReasons(rec) {
  return [...new Set((rec?.violations ?? []).flat().filter(Boolean))];
}

async function modelOnlyOne(caseDef, opts) {
  const fixture = caseDef.evidence_fixture ? loadFixture(opts.root, caseDef.evidence_fixture) : null;
  const secret = opts.secret ?? readSecret();
  if (!secret) return {case_id:caseDef.id,status:'BLOCKED',blocked_by:'LOCAL_RUNTIME_SECRET_UNAVAILABLE',fixture};
  const rt = opts.runtimeUrl ?? process.env.MGLAI_RUNTIME_URL ?? 'http://127.0.0.1:39217';
  try {
    const health = await fetch(rt.replace(/\/+$/,'')+'/health',{signal:AbortSignal.timeout(1500)});
    if (!health.ok) return {case_id:caseDef.id,status:'BLOCKED',blocked_by:'LOCAL_RUNTIME_UNAVAILABLE',fixture};
  } catch {
    return {case_id:caseDef.id,status:'BLOCKED',blocked_by:'LOCAL_RUNTIME_UNAVAILABLE',fixture};
  }

  const client = createClient({api:'http://127.0.0.1:0/api',rt,gen:true,secret,maxTokens:opts.maxTokens??700});
  const ev = evidenceFromFixture(fixture);
  let history = [];
  let last = null;
  const turns = Array.isArray(caseDef.turns) ? caseDef.turns : [{question:caseDef.question}];

  try {
    for (const t of turns) {
      const q=t.question??t.q;
      const promptTurns=assembleTurns({
        system:{
          mode:'employee',
          responseLanguage:responseLanguage(caseDef),
          intent:caseDef.expected?.intent ?? (caseDef.expected?.required_sources?.length ? 'NORMATIVE' : 'GENERAL_HELP'),
          evidenceMandatory:!!caseDef.expected?.required_sources?.length,
          depth:'normal',
        },
        history,
        question:q,
        evidence:ev,
        regulatory:!!caseDef.expected?.required_sources?.length,
        normDecision:null,
        toolResults:[],
        tasks:[],
      });
      const g=await client.generate(promptTurns,opts.maxTokens??700,responseLanguage(caseDef));
      last=g;
      const answer=g.text.trim();
      history.push({role:'user',content:q},{role:'assistant',content:t.assistant_after??answer});
      history=history.slice(-12);
    }
    const raw=last?.text?.trim()??'';
    return {
      case_id:caseDef.id,status:'EXECUTED',raw_answer:raw,raw_validation:null,
      repair_attempted:false,repair_reasons:[],repaired_answer:null,
      final_answer:raw,final_validation:null,final_source:'MODEL',
      fixture,supported_text:supportedText(fixture),trace:{mode:'MODEL_ONLY_EVIDENCE',retrieval_called:false,repair_called:false},
      timings:{first_token_ms:last?.firstTokenMs??null,total_ms:last?.totalMs??null},stop_reason:last?.stop??null,
    };
  } catch (error) {
    return {case_id:caseDef.id,status:'ERROR',error:{message:String(error?.message??error)},fixture,supported_text:supportedText(fixture)};
  }
}

let fullClientPromise=null;
async function getFullClient(opts){
  if(fullClientPromise)return fullClientPromise;
  fullClientPromise=(async()=>{
    const user=opts.user??process.env.MGLAI_EVAL_USER;
    const pass=opts.pass??process.env.MGLAI_EVAL_PASS;
    if(!user||!pass)return {blocked:'EVAL_CREDENTIALS_UNAVAILABLE'};
    const api=opts.apiUrl??process.env.MGLAI_API_URL??'http://127.0.0.1:3000/api';
    const rt=opts.runtimeUrl??process.env.MGLAI_RUNTIME_URL??'http://127.0.0.1:39217';
    const secret=opts.secret??readSecret();
    if(!secret)return {blocked:'LOCAL_RUNTIME_SECRET_UNAVAILABLE'};
    const client=createClient({api,rt,gen:true,secret,maxTokens:opts.maxTokens??700});
    try{await client.login(user,pass);return {client};}
    catch(error){return {blocked:/fetch failed|ECONNREFUSED/i.test(String(error))?'BACKEND_UNAVAILABLE':'EVAL_LOGIN_FAILED',error:String(error?.message??error)};}
  })();
  return fullClientPromise;
}

async function fullOne(caseDef,opts,adversarial=false){
  const ready=await getFullClient(opts);
  const fixtureRef=adversarial?caseDef.adversarial_fixture:null;
  const fixture=fixtureRef?loadFixture(opts.root,fixtureRef):null;
  if(ready.blocked)return {case_id:caseDef.id,status:'BLOCKED',blocked_by:ready.blocked,error:ready.error,fixture};
  const client=ready.client;
  const conv=`reasoning_v1_${caseDef.id}_${Date.now()}`;
  let history=[],state=null,seq=0,last=null;
  const turns=Array.isArray(caseDef.turns)?caseDef.turns:[{question:caseDef.question}];
  try{
    for(const t of turns){
      const q=t.question??t.q;
      const r=await client.turn(conv,q,history,state,seq,{...fixtureExtra(fixture),persist:false});
      last=r;
      const final=r.rec?.final??r.answer??'';
      history.push({role:'user',content:q},{role:'assistant',content:t.assistant_after??final});
      history=history.slice(-20);
      state=r.ctx?.conv_state_next??state;
      seq+=2;
    }
    const rec=last.rec??{};
    const raw=rec.raw??'';
    const fin=rec.final??last.answer??raw;
    const reasons=repairReasons(rec);
    const toolText=JSON.stringify(last.tools??[]);
    const normText=JSON.stringify(last.ctx?.trusted_norm_result??last.ctx?.local_norm??{});
    return {
      case_id:caseDef.id,status:'EXECUTED',
      raw_answer:raw,raw_validation:rec.rawValid==null?null:{ok:!!rec.rawValid,violations:rec.violations?.[0]??[]},
      repair_attempted:(rec.attempts??0)>1 || ['repaired','regenerated','template'].includes(rec.source),
      repair_reasons:reasons,
      repaired_answer:fin!==raw?fin:null,
      final_answer:fin,final_validation:rec.finalValid==null?null:{ok:!!rec.finalValid},
      final_source:sourceClass(rec,last.contract),
      fixture,supported_text:[supportedText(fixture),toolText,normText].filter(Boolean).join('\n'),
      trace:{
        mode:adversarial?'ADVERSARIAL_SYSTEM':'FULL_RAG',
        intent:last.plan?.intent??null,
        turn:last.plan?.turn?.kind??null,
        retrieval_ok:last.normRetrieval?.attempted?last.normRetrieval.reason==='ok':undefined,
        retrieval_reason:last.normRetrieval?.reason??null,
        tools:(last.tools??[]).map((t)=>({tool:t.tool,ok:t.ok})),
      },
      timings:{first_token_ms:rec.firstTokenMs??null,total_ms:rec.genMs??null},
      stop_reason:rec.stop??null,
    };
  }catch(error){
    return {case_id:caseDef.id,status:'ERROR',error:{message:String(error?.message??error)},fixture,supported_text:supportedText(fixture)};
  }
}

export async function executeCases(mode,cases,opts){
  const out=[];
  for(const c of cases){
    if(!c.modes.includes(mode))continue;
    if(mode==='MODEL_ONLY_EVIDENCE')out.push(await modelOnlyOne(c,opts));
    else if(mode==='FULL_RAG')out.push(await fullOne(c,opts,false));
    else if(mode==='ADVERSARIAL_SYSTEM')out.push(await fullOne(c,opts,true));
    else throw new Error('unknown live mode '+mode);
  }
  return out;
}

export function resetExecutorState(){ fullClientPromise=null; }

export const __test = { evidenceFromFixture, fixtureExtra, sourceClass, repairReasons };
