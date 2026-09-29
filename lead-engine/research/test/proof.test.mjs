import test from 'node:test';
import assert from 'node:assert/strict';
import {anchor,businessExclusion,candidateMode} from '../proof.mjs';
import {rpcRequest,costTotals} from '../runtime.mjs';
const page={url:'https://painter.nl',observed_at:'2026-09-29T00:00:00Z',text:'Schilder-Concurrent B. V.\nWij schilderen binnen en buiten in Nederland.'};
test('invented facts are blocked despite valid page index',()=>{
 for(const [kind,text] of [['name_quote','Onbestaand Bedrijf'],['services_quote','Dakreparatie en stucwerk'],['location_quote','Rotterdam']])assert.throws(()=>anchor({page_index:0,text},[page],kind),/FACT_QUOTE_NOT_FOUND/);
});
test('known paraphrase keeps real literal source as persisted finding',()=>{
 const r=anchor({page_index:0,text:'Binnenschilderwerk en buitenschilderwerk'},[page],'services_quote');
 assert.equal(r.text,page.text.split('\n')[1]);assert.equal(r.method,'CONTROLLED_PARAPHRASE');
});
test('a mistaken page index can be repaired from another actually captured page',()=>assert.equal(anchor({page_index:9,text:'Schilder Concurrent BV'},[page],'name_quote').page_index,0));
test('both observed false approvals are rejected without an AI call',()=>{
 for(const text of ['Vind de beste schilder. Diensten voor schilders','Belangenbehartiger voor ondernemers op de bedrijventerreinen in Emmen'])assert.equal(businessExclusion({pages:[{...page,text}]}).reason_code,'NOT_TARGET_BUSINESS');
});
test('incidental membership wording does not reject a real painter',()=>assert.equal(businessExclusion({pages:[{...page,text:'Wij schilderen woningen. Lid van de ondernemersvereniging.'}]}),null));
test('free capture recovery is permitted once; paid or ambiguous work is not repeated',()=>{
 assert.equal(candidateMode({started:{}}),'FREE_CAPTURE_RECOVERY');
 assert.equal(candidateMode({started:{capture_recovery_used:true}}),'FREE_RECOVERY_EXHAUSTED');
 assert.equal(candidateMode({started:{},reserved:true}),'NO_PAID_RETRY');
 assert.equal(candidateMode({answer:{},reserved:true}),'REPLAY');
 assert.equal(candidateMode({replayOnly:true}),'REPLAY_ONLY');
});
test('one temporary DB failure recovers; a lasting failure stops after two requests',async()=>{
 let calls=0;const headers={};const f=async()=>{calls++;if(calls===1)throw TypeError('network');return {ok:true,json:async()=>({saved:true})}};
 assert.deepEqual(await rpcRequest('https://test.invalid',headers,'settle',{},f),{saved:true});assert.equal(calls,2);
 calls=0;await assert.rejects(()=>rpcRequest('https://test.invalid',headers,'settle',{},async()=>{calls++;throw TypeError('network')}));assert.equal(calls,2);
});
test('policy rejection is never retried',async()=>{let n=0;await assert.rejects(()=>rpcRequest('x',{},'finish',{},async()=>{n++;return {ok:false,status:400,json:async()=>({message:'POLICY_CHANGED'})}}));assert.equal(n,1)});
test('crash with unknown invoice keeps its reservation and original provision',()=>assert.deepEqual(costTotals([{reserved_micro_eur:40000},{reserved_micro_eur:50000,settlement:{amount:5000}}]),{committed_upper_micro_eur:145000,remaining_upper_micro_eur:855000,provision_micro_eur:100000}));
