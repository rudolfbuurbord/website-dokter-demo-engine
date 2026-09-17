import {createHash} from 'node:crypto';
export function client({url,key},fetcher=fetch){
 const headers={apikey:key,authorization:`Bearer ${key}`};
 async function rpc(name,action,payload={}){
  const r=await fetcher(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({p_action:action,p_payload:payload}),signal:AbortSignal.timeout(20000)});
  const data=await r.json();if(!r.ok)throw new Error(data.message||'RPC_FAILED');return data;
 }
 return {command:(a,p)=>rpc('le_command',a,p),research:(a,p)=>rpc('le_research',a,p),async upload(task,images){
  const evidence=[];
  for(const [index,im] of images.entries()){
   const sha=createHash('sha256').update(im.bytes).digest('hex');
   const path=`${task.run_id}/${task.id}/${task.lease_token}/${index}-${sha}.jpg`;
   const r=await fetcher(`${url}/storage/v1/object/lead-research-evidence/${path}`,{method:'POST',headers:{...headers,'content-type':'image/jpeg','x-upsert':'false'},body:im.bytes,signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw new Error('EVIDENCE_UPLOAD_FAILED');
   evidence.push({bucket:'lead-research-evidence',path,sha256:sha,label:im.label,source_url:im.url,observed_at:im.observed_at});
  }
  return evidence;
 }};
}
