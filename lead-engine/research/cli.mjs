import {client} from './client.mjs';
const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
if(required.some(k=>!process.env[k])){console.error('Missing configuration: '+required.filter(k=>!process.env[k]).join(', '));process.exit(2);}
const db=client({url:process.env.SUPABASE_URL.replace(/\/$/,''),key:process.env.SUPABASE_SERVICE_ROLE_KEY});
try{
 const action=process.argv[2]||'status';
 if(action==='status')console.log(JSON.stringify(await db.research('status')));
 else if(action==='once'){
  if(!process.env.RESEARCH_RUN_ID)throw new Error('RESEARCH_RUN_ID_REQUIRED');
  if(process.env.ALLOW_PAID==='true'&&!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY_REQUIRED');
  const {runOne}=await import('./worker.mjs');const {capture}=await import('./capture.mjs');
  const r=await runOne({db,capture,runId:process.env.RESEARCH_RUN_ID,paid:process.env.ALLOW_PAID==='true',apiKey:process.env.OPENAI_API_KEY});
  console.log(JSON.stringify({id:r.id,status:r.status,error_code:r.error_code}));
 }else throw new Error('UNKNOWN_COMMAND');
}catch(e){console.error(JSON.stringify({error:String(e.message).slice(0,180)}));process.exit(1);}
