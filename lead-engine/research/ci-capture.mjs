import {spawn} from 'node:child_process';
import {runOne} from './worker.mjs';
const endpoint='https://skdjbifmtleiogbkqwid.supabase.co/functions/v1/research-capture-ci';
let cachedToken='',tokenAt=0;
async function token(){
 if(cachedToken&&Date.now()-tokenAt<120000)return cachedToken;
 const u=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);u.searchParams.set('audience','dwd-call300-free-capture');
 const r=await fetch(u,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('OIDC_REQUEST_FAILED');
 const data=await r.json();if(!data.value)throw Error('OIDC_TOKEN_MISSING');
 cachedToken=data.value;tokenAt=Date.now();return cachedToken;
}
async function call(action,payload={},extra={}){
 const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},body:JSON.stringify({action,payload,...extra}),signal:AbortSignal.timeout(60000)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'GATEWAY_FAILED');return data;
}
const db={
 command:(action,payload)=>{if(action!=='start_work')throw Error('ACTION');return call('start');},
 research:(action,payload)=>{if(!['claim','finish'].includes(action))throw Error('PAID_ACTION_DISABLED');return call(action,payload);},
 upload:async(task,images)=>{
  const evidence=[];
  for(const [index,image] of images.entries())evidence.push(await call('upload',{task_id:task.id,lease_token:task.lease_token},{index,image:{...image,bytes:image.bytes.toString('base64')}}));
  return evidence;
 }
};
const moduleURL=new URL('./capture.mjs',import.meta.url).href;
const capture=target=>new Promise((resolve,reject)=>{
 const code='import {capture} from '+JSON.stringify(moduleURL)+';const c=await capture(process.env.DWD_CAPTURE_URL);process.stdout.write(JSON.stringify({...c,images:c.images.map(x=>({...x,bytes:x.bytes.toString("base64")}))}));';
 const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8',DWD_CAPTURE_URL:target},detached:true,stdio:['ignore','pipe','pipe']});
 let output='',errors='',done=false;
 const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
 const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
 const timer=setTimeout(()=>{kill();finish(Error('CAPTURE_DEADLINE_90S'));},90000);
 child.stdout.on('data',b=>{output+=b.toString();if(output.length>16000000){kill();finish(Error('CAPTURE_OUTPUT_LIMIT'));}});
 child.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-2000);});
 child.on('error',e=>finish(e));child.on('close',code=>{
  if(done)return;if(code!==0)return finish(Error('CAPTURE_CHILD_FAILED: '+errors.split('\n').filter(x=>/Error:/.test(x)).join(' ').slice(0,120)));
  try{const c=JSON.parse(output);c.images=c.images.map(x=>({...x,bytes:Buffer.from(x.bytes,'base64')}));finish(null,c);}catch{finish(Error('INVALID_CAPTURE'));}
 });
});
let processed=0,failures=0;
for(;;){
 try{
  const state=await call('state',{status:'CI_POLLING',processed});
  if(state.target_list_id!=='ec2f3eb6-7de4-461a-83d4-90572c6717aa')throw Error('TARGET_SCOPE');
  if(state.approved>=300){console.log('TARGET_REACHED');break;}
  let worked=false;
  for(const run of state.runs){
   const result=await runOne({db,capture,runId:run.id,paid:false,checkTask:async task=>{if(task.run_id!==run.id)throw Error('RUN_SCOPE');}});
   if(result.id){worked=true;processed++;await call('state',{status:'CI_CAPTURE_SAVED',processed});console.log(JSON.stringify({processed,status:result.status}));}
  }
  failures=0;if(!worked)await new Promise(r=>setTimeout(r,15000));
 }catch(e){
  failures++;console.error(JSON.stringify({status:'CI_RETRY_WAIT',reason:String(e.message).slice(0,180),failures}));
  if(failures>=5)throw e;await new Promise(r=>setTimeout(r,15000));
 }
}
