import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {client} from './client.mjs';
import {euroBudget} from './euro-budget.mjs';
import {runBatch} from './batch.mjs';

const env=process.env;
try{
 const paid=env.ALLOW_PAID==='true';
 const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEARCH_RUN_ID','DWD_TEST_MANIFEST','DWD_EUR_PER_USD_UPPER','DWD_TAX_MULTIPLIER','DWD_PRICE_VALID_UNTIL','DWD_INFRA_UPPER_MICRO_EUR'];
 if(paid)required.push('OPENAI_API_KEY');
 if(required.some(k=>!env[k]))throw Error('MISSING_CONFIGURATION:'+required.filter(k=>!env[k]).join(','));
 if(env.SUPABASE_URL.replace(/\/$/,'')!=='https://skdjbifmtleiogbkqwid.supabase.co')throw Error('PROJECT_MISMATCH');
 if(paid&&env.DWD_COSTS_VERIFIED!=='true')throw Error('ALL_INCREMENTAL_COST_QUOTES_REQUIRED');
 const manifest=JSON.parse(readFileSync(env.DWD_TEST_MANIFEST,'utf8'));
 if(manifest.run_id!==env.RESEARCH_RUN_ID||!Array.isArray(manifest.new_company_ids)||!manifest.new_company_ids.length||
  !Number.isFinite(Date.parse(manifest.expires_at))||Date.parse(manifest.expires_at)<=Date.now()||
  manifest.excludes_existing_approved!==true||manifest.source_urls_verified!==true)throw Error('FRESH_DEDUPED_MANIFEST_REQUIRED');
 const directory=env.DWD_STATE_DIR||'/state';mkdirSync(directory,{recursive:true,mode:0o700});
 const budget=euroBudget({path:directory+'/budget.sqlite',runId:env.RESEARCH_RUN_ID,
  eurPerUsdUpper:Number(env.DWD_EUR_PER_USD_UPPER),taxMultiplier:Number(env.DWD_TAX_MULTIPLIER),validUntil:env.DWD_PRICE_VALID_UNTIL});
 budget.init();
 // Infrastructure provision must cover this whole test, including reruns and storage.
 const infra=Number(env.DWD_INFRA_UPPER_MICRO_EUR);
 if(!Number.isSafeInteger(infra)||infra<0||infra>1_000_000)throw Error('INVALID_INFRA_PROVISION');
 try{budget.reserve('infrastructure','INFRASTRUCTURE',infra);}catch(e){if(e.message!=='ALREADY_RESERVED_NO_RESUBMIT')throw e;}
 const db=client({url:env.SUPABASE_URL.replace(/\/$/,''),key:env.SUPABASE_SERVICE_ROLE_KEY});
 const {capture}=await import('./capture.mjs');
 const saveReport=(status)=>{
  const ledger=budget.status(),entries=ledger.checkpoints,results=entries.filter(e=>e.kind==='RESULT');
  const unique=rows=>new Set(rows.map(r=>r.company_id)).size;
  const report={status,run_id:env.RESEARCH_RUN_ID,target_new_approved:100,
   unique_websites_attempted:unique(entries.filter(e=>e.kind==='ATTEMPT')),
   unique_websites_rendered:unique(entries.filter(e=>e.kind==='CAPTURE'&&e.rendered)),
   page_loads:entries.filter(e=>e.kind==='CAPTURE').reduce((n,e)=>n+e.pages,0),
   database_reported_approved:unique(results.filter(e=>e.qualification==='APPROVED')),
   database_reported_rejected:unique(results.filter(e=>e.qualification==='REJECTED')),
   errors:results.filter(e=>e.status==='ERROR').length,model_proposals_are_not_approvals:true,
   costs:ledger.stages,committed_upper_micro_eur:ledger.committed_micro_eur,
   currency_note:'Conservative EUR conversion incl configured tax; reconcile with provider invoices. Fixed subscriptions excluded.',
   updated_at:new Date().toISOString()};
  writeFileSync(directory+'/report.json.tmp',JSON.stringify(report,null,2),{mode:0o600});renameSync(directory+'/report.json.tmp',directory+'/report.json');
  return report;
 };
 let result;
 try{result=await runBatch({db,capture,runId:env.RESEARCH_RUN_ID,budget,apiKey:env.OPENAI_API_KEY,paid,
  allowedCompanyIds:manifest.new_company_ids,onProgress:()=>saveReport('RUNNING')});}
 finally{saveReport('STOPPED');}
 console.log(JSON.stringify(saveReport(result.status)));
}catch(e){console.error(JSON.stringify({status:'STOPPED',error:String(e.message).slice(0,180)}));process.exitCode=1;}
