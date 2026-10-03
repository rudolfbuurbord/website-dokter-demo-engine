import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {client} from './client.mjs';
import {body,validate,MODEL,PROMPT_HASH,VERSIONS} from './qualified-model.mjs';
import {reservation,actualCost} from './model.mjs';
import {businessExclusion,candidateMode,PROTOCOL} from './proof.mjs';
import {rpcRequest,costTotals} from './runtime.mjs';
const env=process.env,dir=env.DWD_STATE_DIR||'/state',now=()=>new Date().toISOString();
// Paid work requires the exact 50-company cohort in both worker and database.
const COHORT_ID='pilot50-2026-10-03';
let cohortKeys=[];
const RELEASE_REPLAY_ONLY=false;
const hash=s=>createHash('sha256').update(s).digest('hex');
mkdirSync(dir,{recursive:true,mode:0o700});
function save(name,value){writeFileSync(`${dir}/${name}.tmp`,JSON.stringify(value,null,2),{mode:0o600});renameSync(`${dir}/${name}.tmp`,`${dir}/${name}`);}
function read(name){return existsSync(`${dir}/${name}`)?JSON.parse(readFileSync(`${dir}/${name}`,'utf8')):null;}
let db,rpc,base,report,stopped='ERROR',previousResults=[];
try{
 if(env.SUPABASE_URL?.replace(/\/$/,'')!=='https://skdjbifmtleiogbkqwid.supabase.co'||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('CONFIGURATION_REQUIRED');
 db=client({url:env.SUPABASE_URL.replace(/\/$/,''),key:env.SUPABASE_SERVICE_ROLE_KEY});
 const session=await db.command('start_work',{actor:'budget-worker-v1',task:'Process authorized pilot50 cohort; preserve cumulative EUR1 budget; no outreach'});
 if(session.bibles?.length!==4||Object.entries(VERSIONS).some(([k,v])=>session.versions?.[k]!==v))throw Error('POLICY_CHANGED_REVIEW_REQUIRED');
 save('policy.json',session);base={start_receipt_id:session.start_receipt_id,protocol_version:PROTOCOL,cohort_id:COHORT_ID};
 rpc=(action,p={})=>rpcRequest(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/le_budget_qualification`,{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json'},action,{...base,...p});
 report=async(status)=>{
  const s=await rpc('status');
  const results=s.results||[];previousResults=results;
  const costs=s.costs||[];
  save('report.json',{status,target_new_approved:100,approved:s.approved,rejected:s.rejected,
   unique_candidate_websites_attempted:new Set(results.filter(x=>x.result.metrics?.attempted).map(x=>x.domain)).size,
   unique_candidate_websites_rendered:new Set(results.filter(x=>x.result.metrics?.rendered).map(x=>x.domain)).size,
   pages_captured:results.reduce((n,x)=>n+(x.result.metrics?.pages||0),0),skipped:results.filter(x=>x.result.status==='SKIPPED').length,
   calibration_websites_attempted:readdirSync(dir).filter(f=>f.endsWith('.started.json')).map(f=>read(f)).filter(x=>x.key.startsWith('calibration:')).length,source_requests:s.source_requests,source_candidates:s.source_candidates,
   results,criteria_version:PROTOCOL,costs,...costTotals(costs),
   provision_micro_eur:100000,conversion:'USD × 1.50 EUR upper × 1.21 tax upper. Upper bound, not invoice total.',
   fixed_subscriptions:'Existing Hetzner/Supabase/ChatGPT subscriptions excluded from incremental spend; no new subscription.',
   source_cost:'40 existing Serper credits; free-trial expected, invoice not verified. No more source calls in this run.',
   model:MODEL,prompt_hash:PROMPT_HASH,protocol_version:PROTOCOL,updated_at:now()});await rpc('heartbeat',{key:'worker',status,protocol_version:PROTOCOL,release:env.DWD_RELEASE||'unidentified',summary:{approved:s.approved,rejected:s.rejected,cohort_id:cohortKeys.length?COHORT_ID:null,cohort_total:cohortKeys.length,cohort_processed:results.filter(x=>cohortKeys.includes(x.domain)).length,...costTotals(costs)}});return s;
 };
 let replayOnly=true;
 async function review(url,key,benchmark=false){
 const id=hash(key);
 if(!read(id+'.review.json')&&!read(id+'.answer.json')){
  const recovered=await rpc('restore',{key});
  if(recovered?.data){
   for(const [part,value] of Object.entries(recovered.data))if(['review','answer','capture','settlement','evidence'].includes(part)&&value)save(id+'.'+part+'.json',value);
  }
 }
 const cached=read(id+'.review.json');
  if(cached){
   await rpc('backup',{key,data:{review:cached,answer:read(id+'.answer.json'),capture:read(id+'.capture.json'),settlement:read(id+'.settlement.json')},inference_prompt_hash:read(id+'.inference.json')?.prompt_hash||'LEGACY_UNKNOWN'});
   const blocked=businessExclusion(cached);if(blocked){const e=Error('NOT_TARGET_BUSINESS');e.business_rejection=blocked;e.evidence=cached.evidence;e.metrics=cached.metrics;throw e;}
   cached.r=validate(cached.r,{images:cached.evidence,pages:cached.pages,contacts:cached.contacts},{benchmark});return cached;
  }
  const answerSaved=read(id+'.answer.json'),captureSaved=read(id+'.capture.json');
  if(answerSaved&&captureSaved){
   await rpc('backup',{key,data:{answer:answerSaved,capture:captureSaved,settlement:read(id+'.settlement.json'),evidence:read(id+'.evidence.json')},inference_prompt_hash:read(id+'.inference.json')?.prompt_hash||'LEGACY_UNKNOWN'});
   const ev=read(id+'.evidence.json')||previousResults.find(x=>x.domain===key)?.result.evidence||[];
   if(!ev.length)throw Error('SAVED_VISUAL_EVIDENCE_MISSING');
   const receipt=read(id+'.settlement.json');
   if(!receipt)throw Error('COST_SAVED_SETTLEMENT_MISSING');
   await rpc('settle',receipt);
   if(answerSaved.choices?.[0]?.finish_reason!=='stop'||answerSaved.choices[0].message.refusal)throw Error('MODEL_INCOMPLETE');
   try{
    const blocked=businessExclusion(captureSaved);if(blocked){const e=Error('NOT_TARGET_BUSINESS');e.business_rejection=blocked;throw e;}
    const r=validate(JSON.parse(answerSaved.choices[0].message.content),captureSaved,{benchmark});
    const out={r,evidence:ev,contacts:captureSaved.contacts,pages:captureSaved.pages,metrics:{attempted:true,rendered:true,pages:captureSaved.pages.length},provider_request_id:answerSaved.id};
    save(id+'.review.json',out);return out;
   }catch(e){e.metrics={attempted:true,rendered:true,pages:captureSaved.pages.length};e.evidence=ev;throw e;}
  }
  const started=read(id+'.started.json');
  const current=await rpc('status');
  const mode=candidateMode({started,reserved:current.costs.some(x=>x.key===key),replayOnly});
  if(!['NEW','FREE_CAPTURE_RECOVERY'].includes(mode))throw Error(mode);
  // Expiry protects NEW spend, not recovery of already-paid responses.
  if(RELEASE_REPLAY_ONLY||replayOnly)throw Error('REPLAY_ONLY');
  // Pricing verified 2026-10-03: developers.openai.com/api/docs/models/gpt-4.1-mini ($0.40/$1.60 per 1M).
  if(Date.now()>Date.parse('2026-10-04T00:00:00Z'))throw Error('PRICE_CONFIGURATION_EXPIRED');
  if(!env.OPENAI_API_KEY)throw Error('CONFIGURATION_REQUIRED');
  const {capture}=await import('./capture.mjs');
  save(id+'.started.json',{url,key,at:now(),capture_recovery_used:mode==='FREE_CAPTURE_RECOVERY'});
  let c,evidence=[];
  try{
   c=await capture(url);save(id+'.capture.json',{...c,images:c.images.map(x=>({label:x.label,url:x.url,observed_at:x.observed_at}))});
   const duplicate=await rpc('precheck',{key,canonical_domain:c.canonical_domain||new URL(c.pages[0].url).hostname.replace(/^www\./,'')});
   if(duplicate.exists)throw Error('EXISTING_CANONICAL_DOMAIN');
   const excluded=businessExclusion(c);if(excluded){const e=Error('NOT_TARGET_BUSINESS');e.business_rejection=excluded;throw e;}
   evidence=await db.upload({run_id:'budget100-v1',id,lease_token:'v1'},c.images);
   save(id+'.evidence.json',evidence);
   const request=body(c),upper=Math.ceil(reservation(request)*1.50*1.21*1e6);
   save(id+'.inference.json',{prompt_hash:PROMPT_HASH,model:MODEL,protocol_version:PROTOCOL,at:now()});
   const reserved=await rpc('reserve',{key,amount:upper,stage:benchmark?'CALIBRATION':'QUALIFICATION'});
   if(!reserved.allowed)throw Error(reserved.reason);
   const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(90000)});
   if(!response.ok)throw Error('MODEL_HTTP_'+response.status);
   const answer=await response.json();save(id+'.answer.json',answer);
   if(!answer.id||!Number.isSafeInteger(answer.usage?.prompt_tokens)||!Number.isSafeInteger(answer.usage?.completion_tokens))throw Error('MODEL_USAGE_UNKNOWN');
   const receipt={key,amount:Math.ceil(actualCost(answer.usage)*1.50*1.21*1e6),provider_request_id:answer.id,usage:answer.usage,actual_usd:actualCost(answer.usage)};
   save(id+'.settlement.json',receipt);
   const settlement=await rpc('settle',receipt);if(settlement.overrun)throw Error('COST_RESERVATION_OVERRUN');
   await rpc('backup',{key,data:{answer,capture:read(id+'.capture.json'),settlement:receipt,evidence},inference_prompt_hash:PROMPT_HASH});
   if(answer.choices?.[0]?.finish_reason!=='stop'||answer.choices[0].message.refusal)throw Error('MODEL_INCOMPLETE');
   const r=validate(JSON.parse(answer.choices[0].message.content),c,{benchmark});
   const output={r,evidence,contacts:c.contacts,pages:c.pages,metrics:{attempted:true,rendered:true,pages:c.pages.length},provider_request_id:answer.id};
   save(id+'.review.json',output);return output;
  }catch(e){e.metrics=e.metrics||{attempted:true,rendered:!!c,pages:c?.pages.length||0};e.evidence=evidence;save(id+'.error.json',{key,reason:String(e.message),metrics:e.metrics,at:now()});throw e;}
 }
 let s=await report('STARTING');
 // Reuse ONLY the exact calibrated inference prompt. A new prompt requires new,
 // genuinely matching calibration evidence; cached answers never certify a new prompt.
 if(!s.calibration||s.calibration.prompt_hash!==PROMPT_HASH||Object.entries(VERSIONS).some(([k,v])=>s.calibration.versions?.[k]!==v))throw Error('POLICY_CALIBRATION_MISMATCH_NO_PAID_RETRY');
 cohortKeys=s.control?.cohort_id===COHORT_ID&&Array.isArray(s.control.keys)&&new Set(s.control.keys).size===50?s.control.keys:[];
 replayOnly=RELEASE_REPLAY_ONLY||s.control?.mode!=='RUN'||cohortKeys.length!==50;
 // Revalidate every already-finished cached candidate as well; do not overwrite a
 // historical approval automatically when evidence is merely missing.
 for(const previous of s.results.filter(x=>x.result.member_id&&(!cohortKeys.length||cohortKeys.includes(x.domain)))){
  const key=previous.domain;
  try{const out=await review('https://'+key+'/',key);await rpc('audit',{key,status:'VALIDATED',reason:'Saved evidence passed repaired four-criteria validator',provider_request_id:out.provider_request_id});}
  catch(e){await rpc('audit',{key,status:e.business_rejection?'BUSINESS_REJECTED':'REVIEW_REQUIRED',reason:e.message,business_rejection:e.business_rejection||null});}
 }
 const rawCandidates=await rpc('candidates');
 const completed=new Set(s.results.filter(x=>['APPROVED','REJECTED','SKIPPED'].includes(x.result.status)&&!(x.result.status==='SKIPPED'&&String(x.result.reason).startsWith('DOSSIER_INCOMPLETE')&&(read(hash(x.domain)+'.review.json')||s.recoverable_keys?.includes(x.domain)))).map(x=>x.domain));
 const candidates=[...new Map(rawCandidates.map(x=>[x.domain,x])).values()]
 .filter(x=>!cohortKeys.length||(cohortKeys.includes(x.domain)&&!completed.has(x.domain)));
 for(const candidate of candidates){
  const key=candidate.domain;
  if(replayOnly&&!read(hash(key)+'.answer.json')&&!read(hash(key)+'.review.json')&&!s.recoverable_keys?.includes(key))continue;
  s=await report('RUNNING');if(s.approved>=100){stopped='TARGET_REACHED';break;}
  let out;
  try{
   out=await review(candidate.website,key);const r=out.r;
   const contact=out.contacts.find(c=>c.kind==='EMAIL'&&c.value.toLowerCase()===r.email.toLowerCase());
   const ev=r.evidence.map(x=>({finding:x.finding,source_url:out.evidence[x.screenshot_index].source_url,observed_at:out.evidence[x.screenshot_index].observed_at,screenshot_url:'storage://lead-research-evidence/'+out.evidence[x.screenshot_index].path}));
   const quote=name=>({finding:r[name].text,interpretation:r[name].method||'NORMALIZED_SOURCE_MATCH',source_url:out.pages[r[name].page_index].url,observed_at:out.pages[r[name].page_index].observed_at});
   const payload={key,canonical_domain:new URL(out.pages[0].url).hostname.replace(/^www\./,''),company_name:r.company_name,country:'NL',contact,model:MODEL,prompt_hash:PROMPT_HASH,provider_request_id:out.provider_request_id,metrics:out.metrics,evidence:out.evidence,
    qualification:{activity:{status:'ACTIVE',basis:'WEBSITE_BUSINESS_PRESENTATION',services_present:true,contact_consistent:true,closure_indication:false,evidence:[quote('services_quote'),quote('location_quote')]},identity:{status:'CLEAR',company_match_confirmed:true,evidence:[quote('name_quote'),quote('location_quote')]},assessment:{source_url:candidate.website,observed_at:out.evidence[0].observed_at,value:{status:r.status,reason:r.reason,reden:r.reason,reason_code:r.reason_code,reviewer:'budget-worker-v1',start_receipt_id:base.start_receipt_id,policy_version_id:VERSIONS['lead-intelligence-bible'],rubric_version:'owner-single-screen-binary-v2',calibration_approved:true,calibration_ref:PROMPT_HASH,desktop_reviewed:true,mobile_review_status:'NOT_TESTED',evidence:ev}}}};
   save(hash(key)+'.finish.json',payload);
   await rpc('finish',payload);
  }catch(e){
   if(e.business_rejection){await rpc('reject',{key,...e.business_rejection,metrics:e.metrics||out?.metrics||{attempted:true},visual_evidence:e.evidence||[]});continue;}
   if(/EURO_CAP|TARGET_REACHED|COST_|POLICY_|CURRENT_BIBLE|MODEL_HTTP_(401|403|429)/.test(e.message)){stopped=e.message;break;}
   const prior=previousResults.find(x=>x.domain===key)?.result;
   await rpc('skip',{key,reason:String(e.message).slice(0,200),metrics:e.metrics||out?.metrics||prior?.metrics||{attempted:true},evidence:e.evidence||out?.evidence||prior?.evidence||[],criteria_version:PROTOCOL});
  }
 }
 if(stopped==='ERROR')stopped=replayOnly?'REPLAY_COMPLETE':'COHORT_COMPLETE';
 await report(stopped);console.log(JSON.stringify({status:stopped,report:dir+'/report.json'}));
}catch(e){if(report)await report('STOPPED:'+String(e.message).slice(0,120)).catch(()=>{});save('stopped.json',{status:'STOPPED',reason:String(e.message).slice(0,250),at:now()});console.error(JSON.stringify({status:'STOPPED',reason:String(e.message).slice(0,250)}));process.exitCode=1;}

