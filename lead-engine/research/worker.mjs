import {MODEL,requestBody,reservation,actualCost,validateReview} from './model.mjs';
export async function runOne({db,capture,runId,apiKey,paid=false,fetcher=fetch,budget,checkTask}){
 const session=await db.command('start_work',{actor:'scripted-lead-research-v1',task:'Research pilot '+runId});
 if(!session.start_receipt_id||session.bibles?.length!==4||!session.references)throw new Error('CURRENT_POLICY_REQUIRED');
 const base={start_receipt_id:session.start_receipt_id};
 const task=await db.research('claim',{...base,run_id:runId});
 if(!task.id)return task;
 // Never finish an out-of-scope task: finish triggers can touch qualification.
 if(checkTask)await checkTask(task);
 const token={...base,task_id:task.id,lease_token:task.lease_token};
 let captured,evidence,completion;
 try{
  if(!task.company.website)throw new Error('WEBSITE_UNKNOWN');
  captured=await capture(task.company.website);
  evidence=await db.upload(task,captured.images);
  const safeCapture={...captured,images:evidence};
  if(!paid){
   completion={...token,output:{...safeCapture,status:'REVIEW_REQUIRED',stage:'CAPTURE_ONLY',reason:'AI not enabled; no visual qualification',policy_versions:session.versions}};
  }
  else {
  if(!apiKey)throw new Error('OPENAI_KEY_REQUIRED');
  const body=requestBody(session,captured),reserved=reservation(body);
  // Reserve EUR before any paid call. An uncertain outcome is never refunded.
  if(budget)await budget.beforeModel({task,reservedUsd:reserved});
  await db.research('reserve',{...token,amount_usd:reserved});
  // Exactly one provider attempt. Timeouts retain reservation; no automatic resubmission.
  const response=await fetcher('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new Error('MODEL_HTTP_'+response.status);
  const answer=await response.json();
  if(!answer.id||!Number.isSafeInteger(answer.usage?.prompt_tokens)||answer.usage.prompt_tokens<0||!Number.isSafeInteger(answer.usage?.completion_tokens)||answer.usage.completion_tokens<0)throw new Error('MODEL_USAGE_UNKNOWN');
  if(budget)await budget.afterModel({task,actualUsd:actualCost(answer.usage),requestId:answer.id});
  await db.research('settle',{...token,actual_usd:actualCost(answer.usage),provider_request_id:answer.id,usage:answer.usage});
  if(answer.choices?.[0]?.finish_reason!=='stop'||answer.choices[0].message.refusal)throw new Error('INCOMPLETE_MODEL_RESULT');
  const review=validateReview(JSON.parse(answer.choices[0].message.content),evidence);
  completion={...token,output:{...safeCapture,proposal:review,stage:'MODEL_PROPOSAL',model:MODEL,usage:answer.usage,provider_request_id:answer.id,policy_versions:session.versions,calibration_approved:false,production_qualification:'PENDING',technical_review:{scope:'Scripted desktop capture and contact-page navigation only',checks:{reachability:'CHECKED_NO_ISSUE_FOUND',navigation:'NOT_TESTED',assets:'UNKNOWN',mobile:'NOT_TESTED',contact_flow:'NOT_TESTED',forms:'NOT_TESTED',basics:'NOT_TESTED'},findings:[],limitations:captured.limitations}}};
  }
 }catch(e){
  // Preserve already captured evidence even if model/budget/upload fails.
  const error=String(e.message).slice(0,180);
  completion={...token,error_code:error,output:{source_url:task.company.website,status:'REVIEW_REQUIRED',error_code:error,evidence:evidence||[],contacts:captured?.contacts||[],metrics:{websites_attempted:typeof captured==='undefined'?null:1,websites_rendered:captured?1:0},reason:'Research failed or incomplete; no website defect inferred.'}};
 }
 // A failed commit is left for recovery; do not overwrite it with a second payload.
 return db.research('finish',completion);
}
