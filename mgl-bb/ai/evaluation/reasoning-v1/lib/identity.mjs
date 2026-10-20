import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { canonicalJson, readJson, sha256File, sha256Text } from './canonical.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(specifier + '.ts', context);
    return nextResolve(specifier, context);
  },
});

function safeExec(cmd,args,cwd){
  try{return execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()||null;}catch{return null;}
}
function repoRootFromHere(){
  const here=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
  return path.resolve(here,'..','..','..','..');
}
function defaultKnowledgePath(){
  if(process.env.MGLAI_KNOWLEDGE_DB) return process.env.MGLAI_KNOWLEDGE_DB;
  if(process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA,'MglAi','knowledge','knowledge.sqlite');
  return path.join(os.homedir(),'.local','share','MglAi','knowledge','knowledge.sqlite');
}
function readSecret(){
  if(process.env.MGLAI_SECRET) return process.env.MGLAI_SECRET;
  const p=process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'MglAi','secret.txt'):path.join(os.homedir(),'.local','share','MglAi','secret.txt');
  try{return fs.readFileSync(p,'utf8').trim();}catch{return '';}
}
async function runtimeInfo(runtimeUrl,secret){
  if(!secret) return null;
  try{
    const r=await fetch(runtimeUrl.replace(/\/+$/,'')+'/info',{headers:{'X-MglAi-Secret':secret},signal:AbortSignal.timeout(2000)});
    return r.ok?await r.json():null;
  }catch{return null;}
}
function datasetManifestHash(repoRoot){
  const manifest=path.join(repoRoot,'ai','training','split-manifest.json');
  if(!fs.existsSync(manifest)) return null;
  const doc=readJson(manifest);
  const refs=[...(doc.train??[]),...(doc.val??[]),...(doc.test??[])];
  const files=[];
  for(const rel of refs){
    if(String(rel).includes('*')) continue;
    const p=path.join(repoRoot,'ai',rel.replace(/^training\//,'training/'));
    if(fs.existsSync(p)) files.push({path:rel,sha256:sha256File(p)});
  }
  if(!files.length) return null;
  return sha256Text(canonicalJson({manifest:doc,files}));
}
function gpuInfo(){
  const p=spawnSync('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader,nounits'],{encoding:'utf8'});
  if(p.status!==0||!p.stdout?.trim()) return {gpu:null,vram_mb:null};
  const [name,mem]=p.stdout.trim().split('\n')[0].split(',').map((x)=>x.trim());
  return {gpu:name||null,vram_mb:Number.isFinite(Number(mem))?Number(mem):null};
}
function findDocumented(registry,variant='employee-8b-q4'){
  const c=(registry?.candidates??[]).find((x)=>x.runtime_variant===variant)??null;
  if(!c)return null;
  return {
    runtime_variant:c.runtime_variant, model:c.base_model??null, revision:c.base_model_revision??null,
    model_sha256:c.artifact_sha256??null, quantization:c.quantization??null, context_tokens:c.context_tokens??null,
    artifact:c.gguf_file??null,
  };
}
function adapterSha(info){
  const a=info?.adapter??info?.engine?.adapter??null;
  if(!a)return null;
  return a.sha256??a.artifact_sha256??a.adapter_sha256??null;
}

export async function buildIdentity(opts={}){
  const repoRoot=opts.repoRoot??repoRootFromHere();
  const runtimeUrl=opts.runtimeUrl??process.env.MGLAI_RUNTIME_URL??'http://127.0.0.1:39217';
  const secret=opts.secret??readSecret();
  let versions={};
  try{
    const v=await import('../../../../backend/src/lib/mglai/version.ts');
    versions={
      product_version:v.MGL_AI_VERSION??null,
      system_prompt_version:v.MGL_AI_PROMPT_VERSION??null,
      tool_schema_version:v.MGL_AI_TOOL_SCHEMA_VERSION??null,
      retrieval_version:v.MGL_AI_RETRIEVAL_VERSION??null,
    };
  }catch{
    versions={product_version:null,system_prompt_version:null,tool_schema_version:null,retrieval_version:null};
  }
  let registry=null;
  try{registry=readJson(path.join(repoRoot,'ai','registry','models.json'));}catch{}
  const documented=findDocumented(registry);
  const info=await runtimeInfo(runtimeUrl,secret);
  const engine=info?.engine??null;
  const active=info?.active_model??null;
  const observed=info?{
    model:active?.base_model??active?.model??engine?.artifact??null,
    model_revision:active?.base_model_revision??active?.revision??null,
    model_sha256:active?.artifact_sha256??active?.sha256??null,
    quantization:engine?.quantization??active?.quantization??null,
    context_tokens:engine?.contextTokens??active?.context_tokens??null,
    runtime_variant:engine?.runtimeVariant??active?.runtime_variant??null,
    adapter:engine?.adapterVersion??info?.adapter?.version??null,
    artifact:engine?.artifact??null,
  }:null;
  const gpu=gpuInfo();
  const identity={
    schema:'mglai-reasoning-benchmark-identity/1',
    git_sha:safeExec('git',['rev-parse','HEAD'],repoRoot),
    ...versions,
    model:observed?.model??null,
    model_revision:observed?.model_revision??null,
    model_sha256:observed?.model_sha256??null,
    quantization:observed?.quantization??null,
    adapter:observed?.adapter??null,
    adapter_sha256:adapterSha(info),
    context_tokens:observed?.context_tokens??null,
    knowledge_db_hash:sha256File(defaultKnowledgePath()),
    dataset_manifest_hash:datasetManifestHash(repoRoot),
    runtime_version:info?.runtime_version??null,
    generated_at:new Date().toISOString(),
    hardware:{gpu:gpu.gpu,vram_mb:gpu.vram_mb,cpu:os.cpus()?.[0]?.model??null,ram_mb:Math.round(os.totalmem()/1024/1024)},
    documented_model:documented,
    observed_runtime_model:observed,
    identity_incomplete:false,
  };
  const critical=['git_sha','product_version','system_prompt_version','tool_schema_version','retrieval_version','model','model_revision','model_sha256','quantization','context_tokens','knowledge_db_hash','dataset_manifest_hash','runtime_version'];
  identity.identity_incomplete=critical.some((k)=>identity[k]==null);
  return identity;
}

export function validateIdentity(i){
  const fields=['schema','git_sha','product_version','system_prompt_version','tool_schema_version','retrieval_version','model','model_revision','model_sha256','quantization','adapter','adapter_sha256','context_tokens','knowledge_db_hash','dataset_manifest_hash','runtime_version','generated_at','hardware','identity_incomplete'];
  const missing=fields.filter((k)=>!(k in (i??{})));
  if(i?.schema!=='mglai-reasoning-benchmark-identity/1') missing.push('schema:value');
  return {ok:missing.length===0,missing};
}

export { readSecret };
