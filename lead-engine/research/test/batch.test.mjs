import test from 'node:test';
import assert from 'node:assert/strict';
import {runBatch} from '../batch.mjs';
import {runOne} from '../worker.mjs';
const session={start_receipt_id:'1',versions:{},references:[],bibles:[{slug:'lead-intelligence-bible',content_md:'x'},{slug:'schilders-niche-bible',content_md:'x'},{},{}]};
const captured={source_url:'https://example.org',pages:[],images:[{bytes:Buffer.from('x'),url:'https://example.org',label:'top'}]};
function setup(tasks){
 const events=[],checkpoints=[];
 const db={command:async()=>session,upload:async()=>[{path:'test'}],research:async(a,p)=>{
  events.push(a);
  if(a==='claim')return tasks.shift()||{status:'IDLE'};
  return {id:p.task_id,status:p.error_code?'ERROR':'REVIEW',...p};
 }};
 const budget={status:()=>({remaining_micro_eur:1e6,checkpoints}),checkpoint:(k,v)=>checkpoints.push(v),beforeModel:()=>events.push('EUR_RESERVE'),afterModel:()=>events.push('EUR_SETTLE')};
 return {db,budget,events,checkpoints};
}
const task=i=>({id:'task'+i,company_id:'c'+i,company:{website:'https://example.org'},lease_token:'lease',run_id:'run'});
test('batch continues beyond eight, individual capture failure does not stop queue',async()=>{
 const s=setup(Array.from({length:12},(_,i)=>task(i)));
 let n=0;
 const r=await runBatch({...s,runId:'run',allowedCompanyIds:Array.from({length:12},(_,i)=>'c'+i),capture:async()=>{if(n++===2)throw Error('TIMEOUT');return captured;}});
 assert.equal(r.status,'IDLE');assert.equal(s.checkpoints.filter(c=>c.kind==='RESULT').length,12);
 assert.equal(s.checkpoints.filter(c=>c.websites_rendered).length,11);
 assert.equal(s.checkpoints.filter(c=>c.websites_attempted).length,12);
 assert.ok(s.checkpoints.filter(c=>c.kind==='RESULT').every(c=>c.qualification==='NOT_QUALIFIED'));
});
test('budget rejection stops before provider and ends batch',async()=>{
 const s=setup([task(1),task(2)]);s.budget.beforeModel=()=>{throw Error('EUR_BUDGET_EXHAUSTED');};
 const r=await runBatch({...s,runId:'run',allowedCompanyIds:['c1','c2'],paid:true,apiKey:'test',capture:async()=>captured,fetcher:()=>assert.fail('paid call')});
 assert.equal(r.status,'BUDGET_OR_POLICY_STOP');assert.equal(s.checkpoints.filter(c=>c.kind==='RESULT').length,1);
});
test('ambiguous provider timeout retains EUR reservation and never retries',async()=>{
 const s=setup([task(1)]);let n=0;
 const r=await runOne({...s,runId:'run',capture:async()=>captured,paid:true,apiKey:'test',fetcher:async()=>{n++;throw Error('TIMEOUT');}});
 assert.equal(n,1);assert.equal(r.error_code,'TIMEOUT');
 assert.deepEqual(s.events,['claim','EUR_RESERVE','reserve','finish']);
});
test('manifest exclusion prevents capture and paid requests',async()=>{
 const s=setup([task(1)]);
 const r=await runBatch({...s,runId:'run',allowedCompanyIds:['c2'],capture:()=>assert.fail('capture')});
 assert.equal(r.status,'MANIFEST_BLOCKED');assert.deepEqual(s.events,['claim']);
});
test('resume skips previously checkpointed company',async()=>{
 const s=setup([task(1)]);s.checkpoints.push({company_id:'c1'});
 const r=await runBatch({...s,runId:'run',allowedCompanyIds:['c1'],capture:()=>assert.fail('duplicate capture')});
 assert.equal(r.status,'MANIFEST_BLOCKED');assert.deepEqual(s.events,['claim']);
});
