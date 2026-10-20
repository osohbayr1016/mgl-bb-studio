const CRITICAL_RESULT = ['schema','benchmark_version','case_set_sha256','scorer_sha256'];
const CRITICAL_ID = ['system_prompt_version','tool_schema_version','retrieval_version','knowledge_db_hash'];
const MODEL_ID = ['model','model_revision','model_sha256','quantization','adapter','adapter_sha256'];

export function compareCompatibility(a,b,opts={}){
  const differences=[];
  const requiredResult=['schema','benchmark_version','case_set_sha256','scorer_sha256','mode'];
  const requiredIdentity=['git_sha','system_prompt_version','retrieval_version','model','model_sha256','context_tokens'];
  if(a?.mode==='FULL_RAG'||a?.mode==='ADVERSARIAL_SYSTEM') requiredIdentity.push('knowledge_db_hash');
  for(const [label,report] of [['a',a],['b',b]]){
    for(const k of requiredResult) if(report?.[k]==null) differences.push({field:label+'.'+k,a:report?.[k]??null,allowed:false});
    for(const k of requiredIdentity) if(report?.identity?.[k]==null) differences.push({field:label+'.identity.'+k,a:report?.identity?.[k]??null,allowed:false});
    if(report?.mode!=='STRUCTURAL' && !report?.identity?.observed_runtime_model) differences.push({field:label+'.identity.observed_runtime_model',a:null,allowed:false});
    if(report?.identity?.identity_incomplete) differences.push({field:label+'.identity.identity_incomplete',a:true,allowed:false});
    if(report?.mode==='STRUCTURAL') differences.push({field:label+'.mode',a:'STRUCTURAL',allowed:false});
    if(report?.coverage?.coverage_incomplete || !report?.coverage?.executed) differences.push({field:label+'.coverage',a:report?.coverage??null,allowed:false});
  }
  for(const k of CRITICAL_RESULT) if((a?.[k]??null)!==(b?.[k]??null)) differences.push({field:k,a:a?.[k]??null,b:b?.[k]??null,allowed:false});
  for(const k of CRITICAL_ID) if((a?.identity?.[k]??null)!==(b?.identity?.[k]??null)) differences.push({field:'identity.'+k,a:a?.identity?.[k]??null,b:b?.identity?.[k]??null,allowed:false});
  for(const k of MODEL_ID) if((a?.identity?.[k]??null)!==(b?.identity?.[k]??null)) differences.push({field:'identity.'+k,a:a?.identity?.[k]??null,b:b?.identity?.[k]??null,allowed:!!opts.allowModelDiff});
  if((a?.mode??null)!==(b?.mode??null)) differences.push({field:'mode',a:a?.mode,b:b?.mode,allowed:false});
  if(a?.coverage?.executed!==b?.coverage?.executed) differences.push({field:'coverage.executed',a:a?.coverage?.executed,b:b?.coverage?.executed,allowed:false});
  const blocked=differences.filter((d)=>!d.allowed);
  return {compatible:blocked.length===0,differences,blocked};
}

function value(report){
  if(report?.scores?.model)return report.scores.model.weighted_score??null;
  if(report?.scores?.final)return report.scores.final.weighted_score??null;
  return null;
}

export function compareReports(a,b,opts={}){
  const compatibility=compareCompatibility(a,b,opts);
  if(!compatibility.compatible)return {status:'INCOMPATIBLE',compatibility};
  const av=value(a), bv=value(b);
  return {
    status:'COMPARABLE',
    compatibility,
    score:{a:av,b:bv,delta:av==null||bv==null?null:Math.round((bv-av)*100)/100},
    coverage:{a:a.coverage,b:b.coverage},
    hard_gates:{a:a.hard_gates,b:b.hard_gates},
  };
}
