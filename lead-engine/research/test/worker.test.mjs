import test from 'node:test';import assert from 'node:assert/strict';
import {runOne} from '../worker.mjs';import {reservation,requestBody,validateReview,actualCost} from '../model.mjs';import {publicAddress,webURL} from '../network.mjs';
const session={start_receipt_id:'1',versions:{test:'v1'},references:[],bibles:[{slug:'lead-intelligence-bible',content_md:'rules'},{slug:'schilders-niche-bible',content_md:'rules'},{},{}]};
const captured={source_url:'https://example.org',pages:[],images:[{bytes:Buffer.from('image'),url:'https://example.org',label:'top'}],contacts:[],limitations:[],mobile_review_status:'NOT_TESTED'};
function setup(){const calls=[];return {calls,db:{command:async()=>session,research:async(a,p)=>{calls.push({a,p});return a==='claim'?{id:'task',lease_token:'lease',run_id:'run',company:{website:'https://example.org'}}:{status:'REVIEW',...p};},upload:async()=>[{path:'proof.jpg'}]}};}
test('capture-only never calls model, reserves budget or approves',async()=>{const {db,calls}=setup();const r=await runOne({db,runId:'run',capture:async()=>captured,fetcher:()=>assert.fail('paid call')});assert.equal(r.output.stage,'CAPTURE_ONLY');assert.equal(r.output.status,'REVIEW_REQUIRED');assert.ok(!calls.some(x=>x.a==='reserve'));});
test('screenshot failure cannot become broken website qualification',async()=>{const {db}=setup();const r=await runOne({db,runId:'run',capture:async()=>{throw new Error('TIMEOUT');}});assert.equal(r.output.status,'REVIEW_REQUIRED');assert.equal(r.error_code,'TIMEOUT');});
test('budget rejection stops before provider',async()=>{const {db}=setup();const old=db.research;db.research=async(a,p)=>{if(a==='reserve')throw new Error('BUDGET_EXHAUSTED');return old(a,p);};const r=await runOne({db,capture:async()=>captured,runId:'run',paid:true,apiKey:'test',fetcher:()=>assert.fail('paid call')});assert.equal(r.error_code,'BUDGET_EXHAUSTED');});
test('ambiguous paid timeout is not retried or refunded',async()=>{const {db,calls}=setup();let n=0;const r=await runOne({db,capture:async()=>captured,runId:'run',paid:true,apiKey:'test',fetcher:async()=>{n++;throw new Error('TIMEOUT');}});assert.equal(n,1);assert.equal(r.error_code,'TIMEOUT');assert.equal(calls.filter(c=>c.a==='reserve').length,1);assert.ok(!calls.some(c=>c.a==='settle'));});
test('successful paid proposal records usage before finish, never production approval',async()=>{const {db,calls}=setup();const review={status:'ELIGIBLE',reason_code:'OUTDATED_WEBSITE',holistic_impression:'Dated',reason:'Observed design',reference_comparison:'Alferink',evidence:[{finding:'Dated visual hierarchy',screenshot_index:0}],strengths:[],unknowns:[]};const r=await runOne({db,capture:async()=>captured,runId:'run',paid:true,apiKey:'test',fetcher:async()=>({ok:true,json:async()=>({id:'provider-1',usage:{prompt_tokens:5000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(review)}}]})})});assert.equal(r.output.calibration_approved,false);assert.equal(r.output.production_qualification,'PENDING');assert.deepEqual(calls.map(c=>c.a),['claim','reserve','settle','finish']);});
test('missing policy blocks claiming',async()=>{const {db,calls}=setup();db.command=async()=>({bibles:[]});await assert.rejects(()=>runOne({db}),/CURRENT_POLICY/);assert.equal(calls.length,0);});
test('public DNS check blocks mixed/private addresses',async()=>{for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1'])await assert.rejects(()=>publicAddress('host',async()=>[{address:ip}]),/NON_PUBLIC/);await assert.rejects(()=>publicAddress('host',async()=>[{address:'8.8.8.8'},{address:'127.0.0.1'}]));assert.equal(await publicAddress('host',async()=>[{address:'8.8.8.8'}]),'8.8.8.8');});
test('non-web schemes, credentials, unexpected ports blocked',()=>{for(const u of ['file:///etc/passwd','http://user:pass@example.org','https://example.org:8080'])assert.throws(()=>webURL(u));});
test('invalid image reference and broken-site diagnosis rejected',()=>{const r={status:'ELIGIBLE',reason_code:'BROKEN_WEBSITE',holistic_impression:'x',reason:'x',evidence:[],strengths:[],unknowns:[]};assert.throws(()=>validateReview(r,[{}]));r.reason_code='OUTDATED_WEBSITE';r.reference_comparison='ref';r.evidence=[{finding:'x',screenshot_index:9}];assert.throws(()=>validateReview(r,[{}]));});
test('reservation conservatively exceeds example measured spend',()=>{assert.ok(reservation(requestBody(session,captured))>actualCost({prompt_tokens:2500,completion_tokens:500}));});

// Regression: pilot returned INELIGIBLE with OUTDATED_WEBSITE and dated-design evidence.
const contradictoryReview={status:'INELIGIBLE',reason_code:'OUTDATED_WEBSITE',holistic_impression:'Verouderd ontwerp',reason:'Zware schaduw in het logo en zwakke visuele hiërarchie.',reference_comparison:'Vergelijkbaar met de goedgekeurde slechte Alferink-referentie.',evidence:[{finding:'Zware logoschaduw',screenshot_index:0}],strengths:['Contactgegevens zichtbaar'],unknowns:['Mobiele weergave niet getest']};
test('contradictory pilot verdict is rejected without silently approving it',()=>{
 assert.throws(()=>validateReview(contradictoryReview,[{}]),/CONTRADICTORY_REVIEW/);
 assert.equal(contradictoryReview.status,'INELIGIBLE');
 for(const status of ['INELIGIBLE','REVIEW_REQUIRED'])for(const reason_code of ['OUTDATED_WEBSITE','POOR_VISUAL_QUALITY'])assert.throws(()=>validateReview({...contradictoryReview,status,reason_code},[{}]),/CONTRADICTORY_REVIEW/);
});
test('consistent decisions pass; ineligibility without evidence is rejected',()=>{
 for(const status of ['INELIGIBLE','REVIEW_REQUIRED'])assert.equal(validateReview({...contradictoryReview,status,reason_code:'NONE'},[{}]).status,status);
 for(const reason_code of ['OUTDATED_WEBSITE','POOR_VISUAL_QUALITY'])assert.equal(validateReview({...contradictoryReview,status:'ELIGIBLE',reason_code},[{}]).status,'ELIGIBLE');
 assert.throws(()=>validateReview({...contradictoryReview,status:'ELIGIBLE',reason_code:'NONE'},[{}]),/UNSUPPORTED_ELIGIBILITY/);
 assert.throws(()=>validateReview({...contradictoryReview,reason_code:'NONE',evidence:[]},[{}]),/UNSUPPORTED_INELIGIBILITY/);
 assert.throws(()=>validateReview({...contradictoryReview,reason_code:'NONE',reference_comparison:' '},[{}]),/UNSUPPORTED_INELIGIBILITY/);
});
test('contradiction becomes manual review, keeps evidence and settles cost once',async()=>{
 const {db,calls}=setup();let attempts=0;
 const r=await runOne({db,capture:async()=>captured,runId:'run',paid:true,apiKey:'test',fetcher:async()=>{attempts++;return {ok:true,json:async()=>({id:'regression-1',usage:{prompt_tokens:15839,completion_tokens:454},choices:[{finish_reason:'stop',message:{content:JSON.stringify(contradictoryReview)}}]})};}});
 assert.equal(attempts,1);
 assert.equal(r.error_code,'CONTRADICTORY_REVIEW');
 assert.equal(r.output.status,'REVIEW_REQUIRED');
 assert.deepEqual(r.output.evidence,[{path:'proof.jpg'}]);
 assert.equal(r.output.proposal,undefined);
 assert.deepEqual(calls.map(c=>c.a),['claim','reserve','settle','finish']);
 assert.equal(calls.find(c=>c.a==='settle').p.actual_usd,0.007062);
});
