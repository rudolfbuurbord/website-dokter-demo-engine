import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {client} from './client.mjs';
import {body,validate,MODEL,PROMPT_HASH,VERSIONS} from './qualified-model.mjs';
import {reservation,actualCost} from './model.mjs';
const env=process.env,dir=env.DWD_STATE_DIR||'/state',now=()=>new Date().toISOString();
const hash=s=>createHash('sha256').update(s).digest('hex');
mkdirSync(dir,{recursive:true,mode:0o700});
function save(name,value){writeFileSync(`${dir}/${name}.tmp`,JSON.stringify(value,null,2),{mode:0o600});renameSync(`${dir}/${name}.tmp`,`${dir}/${name}`);}
function read(name){return existsSync(`${dir}/${name}`)?JSON.parse(readFileSync(`${dir}/${name}`,'utf8')):null;}
const refs=[['https://dusinkschildersbedrijf.nl/','ELIGIBLE'],['https://alferink-schilderwerken.nl/schildersbedrijf-enschede/','ELIGIBLE'],['https://vanheek.nl/uw-schildersbedrijf-in-enschede/','ELIGIBLE'],['https://www.schildersbedrijfwestenberg.nl/','INELIGIBLE'],['https://www.ronaldschilderwerken.nl/','INELIGIBLE']];
let db,rpc,base,report,stopped='ERROR';
try{
 if(env.SUPABASE_URL?.replace(/\/$/,'')!=='https://skdjbifmtleiogbkqwid.supabase.co'||!env.SUPABASE_SERVICE_ROLE_KEY||!env.OPENAI_API_KEY)throw Error('CONFIGURATION_REQUIRED');
 // Fixed quote lifetime: no indefinite reuse of an old price or currency bound.
 if(Date.now()>Date.parse('2026-09-27T00:00:00Z'))throw Error('PRICE_CONFIGURATION_EXPIRED');
 db=client({url:env.SUPABASE_URL.replace(/\/$/,''),key:env.SUPABASE_SERVICE_ROLE_KEY});
 const session=await db.command('start_work',{actor:'budget-worker-v1',task:'100 nieuwe schilders maximaal EUR1'});
 if(session.bibles?.length!==4||Object.entries(VERSIONS).some(([k,v])=>session.versions?.[k]!==v))throw Error('POLICY_CHANGED_REVIEW_REQUIRED');
 save('policy.json',session);base={start_receipt_id:session.start_receipt_id};
 rpc=async(action,p={})=>{
  const res=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/le_budget_qualification`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json'},body:JSON.stringify({p_action:action,p_payload:{...base,...p}}),signal:AbortSignal.timeout(20000)});
  const j=await res.json();if(!res.ok)throw Error(j.message||'DATABASE_FAILED');return j;
 };
 report=async(status)=>{
  const s=await rpc('status');
  const results=s.results||[];
  const costs=s.costs||[];
  save('report.json',{status,target_new_approved:100,approved:s.approved,rejected:s.rejected,
   unique_candidate_websites_attempted:new Set(results.filter(x=>x.result.metrics?.attempted).map(x=>x.domain)).size,
   unique_candidate_websites_rendered:new Set(results.filter(x=>x.result.metrics?.rendered).map(x=>x.domain)).size,
   page_loads:results.reduce((n,x)=>n+(x.result.metrics?.pages||0),0),skipped:results.filter(x=>x.result.status==='SKIPPED').length,
   calibration_websites_attempted:readdirSync(dir).filter(f=>f.endsWith('.started.json')).map(f=>read(f)).filter(x=>x.key.startsWith('calibration:')).length,source_requests:40,source_candidates:195,
   costs,committed_upper_micro_eur:100000+costs.reduce((n,x)=>n+Number(x.settlement?.amount??x.reserved_micro_eur),0),
   provision_micro_eur:100000,conversion:'USD × 1.50 EUR upper × 1.21 tax upper. Upper bound, not invoice total.',
   fixed_subscriptions:'Existing Hetzner/Supabase/ChatGPT subscriptions excluded from incremental spend; no new subscription.',
   source_cost:'40 existing Serper credits; free-trial expected, invoice not verified. No more source calls in this run.',
   model:MODEL,updated_at:now()});return s;
 };
 const {capture}=await import('./capture.mjs');
 async function review(url,key,benchmark=false){
  const id=hash(key),cached=read(id+'.review.json');
  if(cached)return cached;
  if(read(id+'.started.json'))throw Error('PREVIOUS_ATTEMPT_NO_PAID_RETRY');
  save(id+'.started.json',{url,key,at:now()});
  let c,evidence=[];
  try{
   c=await capture(url);save(id+'.capture.json',{...c,images:c.images.map(x=>({label:x.label,url:x.url,observed_at:x.observed_at}))});
   evidence=await db.upload({run_id:'budget100-v1',id,lease_token:'v1'},c.images);
   const request=body(c),upper=Math.ceil(reservation(request)*1.50*1.21*1e6);
   const reserved=await rpc('reserve',{key,amount:upper,stage:benchmark?'CALIBRATION':'QUALIFICATION'});
   if(!reserved.allowed)throw Error(reserved.reason);
   const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(90000)});
   if(!response.ok)throw Error('MODEL_HTTP_'+response.status);
   const answer=await response.json();save(id+'.answer.json',answer);
   if(!answer.id||!Number.isSafeInteger(answer.usage?.prompt_tokens)||!Number.isSafeInteger(answer.usage?.completion_tokens))throw Error('MODEL_USAGE_UNKNOWN');
   const receipt={key,amount:Math.ceil(actualCost(answer.usage)*1.50*1.21*1e6),provider_request_id:answer.id,usage:answer.usage,actual_usd:actualCost(answer.usage)};
   save(id+'.settlement.json',receipt);
   const settlement=await rpc('settle',receipt);if(settlement.overrun)throw Error('COST_RESERVATION_OVERRUN');
   if(answer.choices?.[0]?.finish_reason!=='stop'||answer.choices[0].message.refusal)throw Error('MODEL_INCOMPLETE');
   const r=validate(JSON.parse(answer.choices[0].message.content),c,{benchmark});
   const output={r,evidence,contacts:c.contacts,pages:c.pages,metrics:{attempted:true,rendered:true,pages:c.pages.length},provider_request_id:answer.id};
   save(id+'.review.json',output);return output;
  }catch(e){e.metrics={attempted:true,rendered:!!c,pages:c?.pages.length||0};e.evidence=evidence;throw e;}
 }
 let s=await report('STARTING');
 if(!s.calibration||s.calibration.prompt_hash!==PROMPT_HASH||Object.entries(VERSIONS).some(([k,v])=>s.calibration.versions?.[k]!==v)){
  const checks=[];
  for(const [url,expected] of refs){const out=await review(url,'calibration:'+hash(url),true);checks.push({url,expected,actual:out.r.status,reason:out.r.reason,evidence:out.evidence});if(out.r.status!==expected)throw Error('REFERENCE_CALIBRATION_FAILED:'+url);}
  await rpc('calibrate',{key:PROMPT_HASH,model:MODEL,prompt_hash:PROMPT_HASH,checks});
 }
 const candidates=await rpc('candidates');
 for(const candidate of candidates){
  s=await report('RUNNING');if(s.approved>=100){stopped='TARGET_REACHED';break;}
  const key=candidate.domain;
  let out;
  try{
   out=await review(candidate.website,key);const r=out.r;
   const contact=out.contacts.find(c=>c.kind==='EMAIL'&&c.value.toLowerCase()===r.email.toLowerCase());
   const ev=r.evidence.map(x=>({finding:x.finding,source_url:out.evidence[x.screenshot_index].source_url,observed_at:out.evidence[x.screenshot_index].observed_at,screenshot_url:'storage://lead-research-evidence/'+out.evidence[x.screenshot_index].path}));
   const quote=name=>({finding:r[name].text,source_url:out.pages[r[name].page_index].url,observed_at:out.pages[r[name].page_index].observed_at});
   const payload={key,company_name:r.company_name,country:'NL',contact,model:MODEL,prompt_hash:PROMPT_HASH,provider_request_id:out.provider_request_id,metrics:out.metrics,evidence:out.evidence,
    qualification:{activity:{status:'ACTIVE',basis:'WEBSITE_BUSINESS_PRESENTATION',services_present:true,contact_consistent:true,closure_indication:false,evidence:[quote('services_quote'),quote('location_quote')]},identity:{status:'CLEAR',company_match_confirmed:true,evidence:[quote('name_quote'),quote('location_quote')]},assessment:{source_url:candidate.website,observed_at:out.evidence[0].observed_at,value:{status:r.status,reason:r.reason,reden:r.reason,reason_code:r.reason_code,reviewer:'budget-worker-v1',start_receipt_id:base.start_receipt_id,policy_version_id:VERSIONS['lead-intelligence-bible'],rubric_version:'owner-single-screen-binary-v2',calibration_approved:true,calibration_ref:PROMPT_HASH,desktop_reviewed:true,mobile_review_status:'NOT_TESTED',evidence:ev}}}};
   save(hash(key)+'.finish.json',payload);
   await rpc('finish',payload);
  }catch(e){
   if(/EURO_CAP|TARGET_REACHED|COST_|POLICY_|CURRENT_BIBLE|MODEL_HTTP_(401|403|429)/.test(e.message)){stopped=e.message;await rpc('skip',{key,reason:stopped,metrics:e.metrics||out?.metrics||{attempted:true},evidence:e.evidence||out?.evidence||[]});break;}
   await rpc('skip',{key,reason:String(e.message).slice(0,200),metrics:e.metrics||out?.metrics||{attempted:true},evidence:e.evidence||out?.evidence||[]});
  }
 }
 if(stopped==='ERROR')stopped='SOURCE_EXHAUSTED';
 await report(stopped);console.log(JSON.stringify({status:stopped,report:dir+'/report.json'}));
}catch(e){if(report)await report('STOPPED:'+String(e.message).slice(0,120)).catch(()=>{});save('stopped.json',{status:'STOPPED',reason:String(e.message).slice(0,250),at:now()});console.error(JSON.stringify({status:'STOPPED',reason:String(e.message).slice(0,250)}));process.exitCode=1;}
