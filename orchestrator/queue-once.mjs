import { spawn } from 'node:child_process';
import { SupabaseService } from './supabase-client.mjs';

const db = new SupabaseService(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const job = await db.getNextQueuedHotLeadJob();

if (!job) {
  console.log(JSON.stringify({ ok:true, processed:false, reason:'NO_QUEUED_HOT_LEAD_JOBS' }));
  process.exit(0);
}

console.log(JSON.stringify({ ok:true, processed:true, job_id:job.id, company_name:job.input_json?.prospect?.company_name || job.input_json?.company_name || null }));

const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['orchestrator/run.mjs', `--job-id=${job.id}`], {
    stdio:'inherit',
    env:process.env
  });
  child.on('error', reject);
  child.on('close', resolve);
});

if (code !== 0) process.exitCode = code;
