import test from 'node:test';import assert from 'node:assert/strict';import {runOne} from '../worker.mjs';
test('uncertain finish is not overwritten with a second error commit',async()=>{
 let finishes=0;
 const db={command:async()=>({start_receipt_id:'r',bibles:[{},{},{},{}],references:[]}),research:async(a)=>{if(a==='claim')return {id:'t',lease_token:'l',company:{website:'https://example.org'}};if(a==='finish'){finishes++;throw new Error('DATABASE_TIMEOUT');}},upload:async()=>[]};
 await assert.rejects(()=>runOne({db,runId:'r',capture:async()=>({images:[]})}),/DATABASE_TIMEOUT/);assert.equal(finishes,1);
});
