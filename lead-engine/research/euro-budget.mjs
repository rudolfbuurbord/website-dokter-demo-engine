import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function euroBudget({path,runId,eurPerUsdUpper,taxMultiplier,validUntil,python='python3'}){
 if(!path||!runId||!Number.isFinite(eurPerUsdUpper)||eurPerUsdUpper<=0||!Number.isFinite(taxMultiplier)||taxMultiplier<1||!Number.isFinite(Date.parse(validUntil)))throw Error('VERIFIED_COST_CONFIGURATION_REQUIRED');
 const run=(action,p={})=>{
  let raw;
  try{raw=execFileSync(python,[fileURLToPath(new URL('./budget_ledger.py',import.meta.url)),path,action],{input:JSON.stringify({...p,run_id:runId}),encoding:'utf8',maxBuffer:5_000_000,stdio:['pipe','pipe','pipe']});}
  catch(e){let code;try{code=JSON.parse(e.stdout).error;}catch{}throw Error(code||'EUR_LEDGER_FAILED');}
  return JSON.parse(raw);
 };
 const convert=usd=>{
  if(!Number.isFinite(usd)||usd<0)throw Error('INVALID_USD_COST');
  return Math.ceil(usd*eurPerUsdUpper*taxMultiplier*1e6);
 };
 return {
  init(capMicroEur=1_000_000){return run('init',{cap_micro_eur:capMicroEur,eur_per_usd_upper:eurPerUsdUpper,tax_multiplier:taxMultiplier,valid_until:validUntil});},
  status:()=>run('status'),
  reserve(key,stage,upperMicroEur){
   if(Date.now()>=Date.parse(validUntil))throw Error('COST_QUOTE_EXPIRED');
   return run('reserve',{key,stage,upper_micro_eur:upperMicroEur});
  },
  beforeModel({task,reservedUsd}){this.reserve('model:'+task.id,'MODEL',convert(reservedUsd));},
  afterModel({task,actualUsd,requestId}){return run('settle',{key:'model:'+task.id,actual_micro_eur:convert(actualUsd),receipt:requestId});},
  checkpoint(key,value){return run('checkpoint',{key,value});}
 };
}
