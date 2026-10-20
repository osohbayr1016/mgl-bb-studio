import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeCases } from './executors.mjs';
import { benchmarkRoot, loadCoreCases } from './loadCases.mjs';

test('model-only mode receives fixture evidence and never calls retrieval or repair',async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),body:init.body??null});
    if(String(url).endsWith('/health'))return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    if(String(url).endsWith('/generate'))return new Response('event: token\ndata: {"text":"Хараахан болохгүй."}\n\nevent: done\ndata: {"stop_reason":"stop"}\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
    throw new Error('unexpected network request: '+url);
  };
  try{
    const c=loadCoreCases(benchmarkRoot()).find((x)=>x.id==='AR-001');
    const [result]=await executeCases('MODEL_ONLY_EVIDENCE',[c],{root:benchmarkRoot(),secret:'test-secret',runtimeUrl:'http://127.0.0.1:39217'});
    assert.equal(result.status,'EXECUTED');
    assert.equal(result.raw_answer,result.final_answer);
    assert.equal(result.repair_attempted,false);
    assert.equal(result.trace.retrieval_called,false);
    assert.deepEqual(calls.map((x)=>new URL(x.url).pathname),['/health','/generate']);
    assert.ok(calls[1].body.includes('3-аас доошгүй'));
  }finally{
    globalThis.fetch=originalFetch;
  }
});
