import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {VERSIONS,PROMPT_HASH} from './qualified-model.mjs';
test('saved paid response is recovered without browser or paid API; original budget ledger retained',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dwd-replay-')),oldFetch=globalThis.fetch,oldEnv={...process.env};
 try{
 for(const f of ['qualified-cli.mjs','qualified-model.mjs','client.mjs','model.mjs'])copyFileSync(new URL(f,import.meta.url),join(dir,f));
 writeFileSync(join(dir,'capture.mjs'),"export async function capture(){throw Error('UNEXPECTED_NEW_CAPTURE')}");
 const key='example.nl',id=createHash('sha256').update(key).digest('hex');
 const review={status:'ELIGIBLE',reason_code:'OUTDATED_WEBSITE',reason:'Traditionele brochure met gedateerde vormgeving.',company_name:'Voorbeeld B.V.',company_match:true,services_present:true,nl_confirmed:true,closure_indication:false,email_belongs:true,email:'info@example.nl',name_quote:{text:'Voorbeeld bv',page_index:0},services_quote:{text:'Schilderwerk',page_index:0},location_quote:{text:'Nederland',page_index:0},evidence:[{finding:'Gedateerde typografie en onrustige compositie.',screenshot_index:0}]};
 const evidence=[{source_url:'https://example.nl',observed_at:new Date().toISOString(),path:'saved.jpg'}];
 const put=(suffix,x)=>writeFileSync(join(dir,id+suffix),JSON.stringify(x));
 put('.started.json',{key});put('.answer.json',{id:'already-paid',choices:[{finish_reason:'stop',message:{content:JSON.stringify(review)}}]});put('.settlement.json',{key,amount:1000,provider_request_id:'already-paid'});put('.capture.json',{pages:[{url:'https://example.nl',observed_at:new Date().toISOString(),text:'Voorbeeld b.v'}],contacts:[{kind:'EMAIL',value:'info@example.nl',source_url:'https://example.nl'}],images:[{}]});
 const state={approved:0,rejected:0,results:[{domain:key,result:{status:'SKIPPED',reason:'NAME_NOT_SOURCED',evidence}}],costs:[{key,settlement:{amount:1000},reserved_micro_eur:9999}],calibration:{prompt_hash:PROMPT_HASH,versions:VERSIONS}};
 let finished=0,settled=0;
 globalThis.fetch=async(url,opts)=>{
 const b=JSON.parse(opts.body);let result;
 if(String(url).endsWith('/le_command'))result={bibles:[{},{},{},{}],versions:VERSIONS,start_receipt_id:'test'};
 else if(b.p_action==='status')result=state;
 else if(b.p_action==='candidates')result=[{domain:key,website:'https://example.nl'}];
 else if(b.p_action==='settle'){settled++;result={saved:true};}
 else if(b.p_action==='finish'){finished++;state.approved=1;state.results=[{domain:key,result:{status:'APPROVED',metrics:b.p_payload.metrics}}];result={status:'APPROVED'};}
 else throw Error('UNEXPECTED_REQUEST:'+url+':'+b.p_action);
 return {ok:true,json:async()=>structuredClone(result)};
 };
 Object.assign(process.env,{SUPABASE_URL:'https://skdjbifmtleiogbkqwid.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-not-secret',OPENAI_API_KEY:'test-not-secret',DWD_STATE_DIR:dir});
 await import(pathToFileURL(join(dir,'qualified-cli.mjs')).href);
 assert.equal(finished,1);assert.equal(settled,1);
 const report=JSON.parse(readFileSync(join(dir,'report.json')));assert.equal(report.approved,1);assert.equal(report.committed_upper_micro_eur,101000);
 }finally{globalThis.fetch=oldFetch;process.env=oldEnv;rmSync(dir,{recursive:true,force:true});}
});
