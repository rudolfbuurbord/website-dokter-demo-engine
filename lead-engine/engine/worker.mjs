import {auditWebsite} from './website.mjs';

export async function runOne(rpc,{worker='website-worker-v1',audit=auditWebsite}={}) {
  await rpc('recover_jobs',{});
  const job=await rpc('claim_job',{worker,kinds:['WEBSITE_AUDIT']});
  if(!job.id) return {status:job.paused?'PAUSED':'IDLE'};
  let result;
  try {
    const output=await audit(job.input.url);
    // Discovering a public address never marks it valid or identifies its reader.
    if(output.status==='OK') {
      const routes=output.findings.contact_observations||[
        ...(output.findings.emails||[]).map(value=>({kind:'EMAIL',value,source_url:output.findings.source_url})),
        ...(output.findings.phones||[]).map(value=>({kind:'PHONE',value,source_url:output.findings.source_url}))
      ];
      for(const route of routes)await rpc('contact',{
        company_id:job.company_id,...route,is_inferred:false,
        is_role_mailbox:route.kind==='EMAIL' ? /^(info|contact|office|admin|sales|hello|support)@/i.test(route.value) : null
      });
    }
    result={job_id:job.id,lease_token:job.lease_token,outcome:'SUCCEEDED',output};
  } catch(e) {
    const blocked=['URL_BLOCKED','NOT_HTML','BODY_TOO_LARGE','REDIRECT_LIMIT'].includes(e.code);
    result={job_id:job.id,lease_token:job.lease_token,outcome:blocked?'BLOCKED':'RETRY',error_code:e.code||'WEBSITE_FETCH_FAILED',error_detail:String(e.message).slice(0,500)};
  }
  // If commit fails, let the lease expire. Never pretend an uncommitted result succeeded.
  return rpc('finish_job',result);
}
