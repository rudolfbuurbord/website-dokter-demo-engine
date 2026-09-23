import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {euroBudget} from '../euro-budget.mjs';

test('Node guard uses durable SQLite ledger with FX and tax provision',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dwd-eur-'));
 try{
  const config={path:join(dir,'ledger.sqlite'),runId:'test',eurPerUsdUpper:1.2,taxMultiplier:1.21,validUntil:new Date(Date.now()+60_000).toISOString()};
  const budget=euroBudget(config);budget.init();
  budget.beforeModel({task:{id:'1'},reservedUsd:0.2});
  const restarted=euroBudget(config);
  assert.equal(restarted.status().committed_micro_eur,Math.ceil(0.2*1.2*1.21*1e6));
  assert.throws(()=>restarted.beforeModel({task:{id:'1'},reservedUsd:0.2}),/ALREADY_RESERVED/);
  restarted.afterModel({task:{id:'1'},actualUsd:0.1,requestId:'receipt1'});
  assert.equal(restarted.status().committed_micro_eur,Math.ceil(0.1*1.2*1.21*1e6));
  assert.throws(()=>restarted.beforeModel({task:{id:'2'},reservedUsd:0.65}),/BUDGET_EXHAUSTED/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('expired price quote fails before reservation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dwd-eur-'));
 try{
  const budget=euroBudget({path:join(dir,'ledger.sqlite'),runId:'test',eurPerUsdUpper:1,taxMultiplier:1,validUntil:'2020-01-01T00:00:00Z'});
  budget.init();assert.throws(()=>budget.beforeModel({task:{id:'1'},reservedUsd:0.001}),/EXPIRED/);
  assert.equal(budget.status().committed_micro_eur,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
