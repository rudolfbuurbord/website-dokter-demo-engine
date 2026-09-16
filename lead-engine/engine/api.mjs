import {runOne} from './worker.mjs';

export function createRPC(url,key,fetcher=fetch) {
  return async(action,payload={})=>{
    const response=await fetcher(`${url.replace(/\/$/,'')}/rest/v1/rpc/le_command`,{
      method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},
      body:JSON.stringify({p_action:action,p_payload:payload}),signal:AbortSignal.timeout(20000)
    });
    const data=await response.json();
    if(!response.ok) throw Object.assign(new Error(data.message||'DATABASE_ERROR'),{code:data.code||'DATABASE_ERROR'});
    return data;
  };
}

export function createHandler({key,rpc,run=runOne}) {
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  return async req=>{
    if(!key) return json({error:'NOT_CONFIGURED'},503);
    // This is an internal backend API. Ordinary authenticated users have no access.
    const supplied=req.headers.get('authorization')||'';
    const isService=supplied===`Bearer ${key}`;
    const workerToken=supplied.startsWith('Bearer le_worker_') ? supplied.slice(7) : '';
    if(!isService && !/^le_worker_[a-f0-9]{64}$/.test(workerToken)) return json({error:'UNAUTHORIZED'},401);
    if(req.method!=='POST') return json({error:'POST_REQUIRED'},405);
    try {
      const reader=req.body?.getReader();if(!reader)return json({error:'BODY_REQUIRED'},400);
      let size=0;const chunks=[];
      while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>262144){await reader.cancel();return json({error:'PAYLOAD_TOO_LARGE'},413);}chunks.push(x.value);}
      const bytes=new Uint8Array(size);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.length;}
      let p;try{p=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'INVALID_JSON'},400);}
      if(!p || typeof p!=='object' || Array.isArray(p) || typeof p.action!=='string') return json({error:'ACTION_REQUIRED'},400);
      if(!isService){
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(workerToken)))).map(x=>x.toString(16).padStart(2,'0')).join('');
        const auth=await rpc('authenticate_worker',{digest,action:p.action});
        if(auth.allowed!==true)return json({error:'UNAUTHORIZED'},401);
      }
      if(p.action==='run_once')return json(await run(rpc));
      return json(await rpc(p.action,p.payload||{}));
    } catch(e) {
      // No headers, keys, full response bodies or customer payloads in logs/errors.
      console.error(JSON.stringify({component:'lead-engine',code:e.code||'INTERNAL_ERROR'}));
      return json({error:e.code||'INTERNAL_ERROR',message:String(e.message).slice(0,160)},400);
    }
  };
}
