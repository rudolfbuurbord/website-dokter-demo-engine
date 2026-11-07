Deno.serve(async req=>{
 const headers={"Cache-Control":"no-store"};
 const deny=(status=401)=>new Response("Access denied",{status,headers});
 if(req.method!=="GET")return deny(405);
 const token=req.headers.get("x-evidence-token")||"";
 if(!/^[a-f0-9]{64}$/.test(token))return deny();
 const index=new URL(req.url).searchParams.get("index")||"";
 if(!/^[0-9]{1,2}$/.test(index))return deny(404);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,"0")).join("");
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}"))[0];
 const base=Deno.env.get("SUPABASE_URL");
 if(!key||!base)return deny(503);
 const auth={apikey:String(key),Authorization:"Bearer "+key};
 try {
  const check=await fetch(base+"/rest/v1/research_evidence_access?select=paths,task_id,expires_at&token_hash=eq."+hash,{headers:auth});
  if(!check.ok)return deny(503);
  const rows=await check.json();
  const grant=rows[0];
  if(!grant||Date.parse(grant.expires_at)<=Date.now())return deny();
  const item=grant.paths[Number(index)];
  if(!item||item.bucket!=="lead-research-evidence"||!item.path.includes("/"+grant.task_id+"/")||item.path.includes(".."))return deny(404);
  const r=await fetch(base+"/storage/v1/object/authenticated/lead-research-evidence/"+item.path.split("/").map(encodeURIComponent).join("/"),{headers:auth});
  if(!r.ok)return deny(502);
  return new Response(r.body,{headers:{...headers,"Content-Type":"image/jpeg","X-Content-Type-Options":"nosniff"}});
 }catch{return deny(503);}
});