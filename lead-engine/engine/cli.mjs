import {readFile} from 'node:fs/promises';
import {createRPC} from './api.mjs';
import {runOne} from './worker.mjs';
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error('Server-side SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
const rpc=createRPC(url,key);
const [action='status',file]=process.argv.slice(2);
if(action==='run_once')console.log(JSON.stringify(await runOne(rpc)));
else if(action==='import'){
  const rows=JSON.parse(await readFile(file,'utf8'));
  if(!Array.isArray(rows)||rows.length>1000)throw new Error('Import must be an array of at most 1000 source records');
  const results=[];
  for(const [index,row] of rows.entries()){
    try{results.push({index,...await rpc('ingest',row)});}
    catch(e){results.push({index,status:'FAILED',error:e.code||'IMPORT_ERROR'});}
  }
  console.log(JSON.stringify(results,null,2));
  if(results.some(x=>x.status==='FAILED'))process.exitCode=1;
}else console.log(JSON.stringify(await rpc(action,file?JSON.parse(await readFile(file,'utf8')):{}),null,2));
