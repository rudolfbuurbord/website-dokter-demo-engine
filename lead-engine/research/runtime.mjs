export async function rpcRequest(url,headers,action,payload,fetcher=fetch){
 // One bounded transport retry. Never retry the model API here.
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetcher(url,{method:'POST',headers,body:JSON.stringify({p_action:action,p_payload:payload}),signal:AbortSignal.timeout(60000)});
   let data;try{data=await response.json();}catch{const e=Error('DATABASE_INVALID_RESPONSE');e.retryable=response.status>=500;throw e;}
   if(!response.ok){const e=Error(data.message||'DATABASE_FAILED');e.retryable=response.status>=500||response.status===429;throw e;}
   return data;
  }catch(e){
   if(attempt===1||!(e.retryable||e instanceof TypeError||['TimeoutError','AbortError'].includes(e.name)))throw e;
  }
 }
}
export function costTotals(costs){
 const paid=costs.reduce((n,x)=>n+Number(x.settlement?.amount??x.reserved_micro_eur),0);
 return {committed_upper_micro_eur:100000+paid,remaining_upper_micro_eur:Math.max(0,900000-paid),provision_micro_eur:100000};
}
