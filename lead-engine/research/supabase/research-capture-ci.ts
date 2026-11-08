import {createRemoteJWKSet,jwtVerify} from "npm:jose@6.1.0";
const jwks=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const audience="dwd-call300-free-capture";
const expectedWorkflow="rudolfbuurbord/website-dokter-demo-engine/.github/workflows/call300-free-capture.yml@refs/heads/lead-budget-test-v1";
const headers={"Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async req=>{
 if(req.method!=="POST")return reply(405,{error:"METHOD"});
 const raw=req.headers.get("authorization")||"";
 if(!raw.startsWith("Bearer "))return reply(401,{error:"OIDC_REQUIRED"});
 try{
  const {payload}=await jwtVerify(raw.slice(7),jwks,{issuer:"https://token.actions.githubusercontent.com",audience,algorithms:["RS256"],maxTokenAge:"10m"});
  if(payload.repository_id!=="1354737432"||payload.repository_owner_id!=="323224610"||payload.ref!=="refs/heads/lead-budget-test-v1"||payload.workflow_ref!==expectedWorkflow||!["push","workflow_dispatch"].includes(String(payload.event_name)))return reply(403,{error:"WORKFLOW_SCOPE"});
 }catch{return reply(401,{error:"OIDC_INVALID"});}
 if(Number(req.headers.get("content-length"))>7000000)return reply(413,{error:"SIZE"});
 try{
  const input=await req.json();
  if(!["state","start","claim","finish","upload"].includes(input.action))return reply(400,{error:"ACTION"});
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",base=Deno.env.get("SUPABASE_URL")||"";
  const auth={apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"};
  const rpc=async(action:string,payload:unknown)=>{
   const r=await fetch(base+"/rest/v1/rpc/le_ci_capture",{method:"POST",headers:auth,body:JSON.stringify({p_action:action,p_payload:payload}),signal:AbortSignal.timeout(30000)});
   const data=await r.json();if(!r.ok)throw Error(data.message||"RPC_FAILED");return data;
  };
  if(input.action!=="upload")return reply(200,await rpc(input.action,input.payload||{}));
  const scope=await rpc("upload_check",input.payload||{});
  const im=input.image;if(!im||typeof im.bytes!=="string"||im.bytes.length>6700000||!Number.isInteger(input.index)||input.index<0||input.index>11)return reply(400,{error:"IMAGE"});
  const bytes=Uint8Array.from(atob(im.bytes),c=>c.charCodeAt(0));
  if(bytes.length<100||bytes.length>5000000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return reply(400,{error:"JPEG"});
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
  const path=scope.run_id+"/"+scope.task_id+"/"+scope.lease_token+"/"+input.index+"-"+sha+".jpg";
  const r=await fetch(base+"/storage/v1/object/lead-research-evidence/"+path,{method:"POST",headers:{...auth,"Content-Type":"image/jpeg","x-upsert":"false"},body:bytes,signal:AbortSignal.timeout(30000)});
  if(!r.ok){const e=await r.json();if(String(e.statusCode)!=="409")throw Error("UPLOAD_FAILED");}
  return reply(200,{bucket:"lead-research-evidence",path,sha256:sha,label:String(im.label).slice(0,100),source_url:im.url,observed_at:im.observed_at});
 }catch(e){return reply(400,{error:String(e.message).slice(0,180)});}
});