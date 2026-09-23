import {runOne} from './worker.mjs';

// Process the existing queue without resetting it or promoting model proposals.
// Production qualification still belongs to complete_qualification after review.
export async function runBatch({db,capture,runId,budget,apiKey,paid=false,allowedCompanyIds,
 maxDurationMs=3_300_000,target=100,now=Date.now,fetcher=fetch,onProgress=()=>{},signal}){
 if(!budget||!runId||!Array.isArray(allowedCompanyIds)||!allowedCompanyIds.length)throw Error('FRESH_DEDUPED_MANIFEST_REQUIRED');
 if(!Number.isFinite(maxDurationMs)||maxDurationMs<=0||maxDurationMs>3_300_000)throw Error('INVALID_TIME_LIMIT');
 if(!Number.isInteger(target)||target<1||target>100)throw Error('INVALID_TARGET');
 const allowed=new Set(allowedCompanyIds),started=now();
 let done=budget.status().checkpoints;
 const seen=new Set(done.map(d=>d.company_id).filter(Boolean));
 for(;;){
  if(signal?.aborted)return {status:'STOPPED'};
  if(now()-started>=maxDurationMs)return {status:'TIME_LIMIT'};
  const wallet=budget.status();
  if(new Set(wallet.checkpoints.filter(c=>c.qualification==='APPROVED').map(c=>c.company_id)).size>=target)return {status:'TARGET_REACHED_REQUIRES_DB_VERIFICATION'};
  if(wallet.halted||wallet.remaining_micro_eur===0)return {status:'BUDGET_STOP'};
  let companyId,taskId,attempted=false,rendered=false;
  let result;
  try{result=await runOne({db,runId,budget,apiKey,paid,fetcher,
   checkTask(task){companyId=task.company_id;taskId=task.id;if(!allowed.has(companyId)||seen.has(companyId))throw Error('NOT_IN_FRESH_MANIFEST_OR_DUPLICATE');},
   capture:async url=>{
    budget.checkpoint('attempt:'+taskId,{kind:'ATTEMPT',task_id:taskId,company_id:companyId,source_url:url,observed_at:new Date().toISOString()});
    attempted=true;const data=await capture(url);rendered=Boolean(data.images?.length);
    budget.checkpoint('capture:'+taskId,{kind:'CAPTURE',task_id:taskId,company_id:companyId,rendered,pages:data.pages?.length||0,observed_at:new Date().toISOString()});
    return data;
   }});}catch(e){
   if(e.message==='NOT_IN_FRESH_MANIFEST_OR_DUPLICATE')return {status:'MANIFEST_BLOCKED',company_id:companyId,task_id:taskId};
   throw e;
  }
  if(!result.id)return result;
  const value={kind:'RESULT',task_id:result.id,company_id:companyId,status:result.status,error_code:result.error_code||null,
   websites_attempted:attempted?1:0,websites_rendered:rendered?1:0,
   qualification:result.output?.qualification_result?.status||'NOT_QUALIFIED',observed_at:new Date().toISOString()};
  budget.checkpoint('task:'+result.id,value);
  if(companyId)seen.add(companyId);
  await onProgress(value);
  if(/BUDGET|COST_QUOTE|COST_OVERRUN|EUR_LEDGER|RUN_PAUSED|POLICY_CHANGED/.test(result.error_code||''))return {status:'BUDGET_OR_POLICY_STOP',reason:result.error_code};
 }
}
