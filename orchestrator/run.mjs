import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { renderPainterV1Certified } from '../src/templates/painter-v1-certified.js';
import { buildDemoRecord, normalizeHotLead } from './config-builder.mjs';
import { SupabaseService } from './supabase-client.mjs';

const BASE = process.env.DEMO_BASE_URL || 'https://demo-engine.rudolfalhelou.workers.dev';
const CATEGORY_MAP = { TECHNICAL_QA:'PERFORMANCE_QA', ASSET_QA:'DESIGN_QA' };
const now = () => new Date().toISOString();
const argValue = prefix => process.argv.find(v => v.startsWith(prefix))?.slice(prefix.length) || null;

async function readLead(db) {
  const queuedJobId = argValue('--job-id=');
  if (queuedJobId) {
    const job = await db.getJob(queuedJobId);
    if (!job) throw new Error(`Queued job not found: ${queuedJobId}`);
    if (job.job_type !== 'FULL_DEMO') throw new Error(`Job ${queuedJobId} is not FULL_DEMO`);
    if (job.status !== 'QUEUED') throw new Error(`Job ${queuedJobId} is not QUEUED (status=${job.status})`);
    if (job.tool !== 'hot-lead-queue-v1') throw new Error(`Job ${queuedJobId} is not owned by hot-lead-queue-v1`);
    const payload = job.input_json?.prospect || job.input_json;
    return { lead: normalizeHotLead(payload), job };
  }

  const input = argValue('--input=');
  if (input) return { lead:normalizeHotLead(JSON.parse(await fs.readFile(input, 'utf8'))), job:null };
  if (process.env.ORCHESTRATOR_PROSPECT_JSON) return { lead:normalizeHotLead(JSON.parse(process.env.ORCHESTRATOR_PROSPECT_JSON)), job:null };
  throw new Error('Provide --input=<json file>, --job-id=<uuid>, or ORCHESTRATOR_PROSPECT_JSON');
}

async function runQa(url, templateKey, outDir) {
  await fs.mkdir(outDir, { recursive:true });
  const args = ['qa/runner-certified.mjs', `--url=${url}`, '--scope=prospect', `--template=${templateKey}`, `--output=${outDir}`];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio:'inherit', env:process.env });
    child.on('error', reject);
    child.on('close', resolve);
  });
  const report = JSON.parse(await fs.readFile(path.join(outDir, 'qa-report.json'), 'utf8'));
  return { code, ...report };
}

async function withPreviewServer(html, fn) {
  const server = http.createServer((req,res) => {
    res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { return await fn(`http://127.0.0.1:${address.port}/`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function canonicalChecks(qaRunId, checks) {
  return checks.map(c => ({
    qa_run_id: qaRunId,
    category: CATEGORY_MAP[c.category] || c.category,
    check_key: c.check_key,
    severity: c.severity,
    status: c.status === 'WARN' ? 'HUMAN_REVIEW' : c.status,
    viewport: c.viewport || null,
    expected: {},
    actual: c.actual || {},
    message: c.message || null
  }));
}

function canonicalRunStatus(status) {
  if (status === 'PASS') return 'PASS';
  if (status === 'FAIL') return 'FAIL';
  return 'HUMAN_REVIEW';
}

async function persistQa(db, demo, template, report, phase) {
  const run = await db.createQaRun({
    scope:'PROSPECT',
    template_id:template.id,
    template_version:template.current_version,
    demo_id:demo.id,
    status:canonicalRunStatus(report.summary.status),
    viewport_set:{ viewports:report.summary.viewports },
    summary:{ ...report.summary, phase, source:'prospect-orchestrator-v1' },
    started_at:report.summary.generated_at,
    completed_at:now()
  });
  await db.createQaChecks(canonicalChecks(run.id, report.checks));
  return run;
}

async function updateCrmSuccess(db, job, lead, demo, liveUrl) {
  const opportunityId = job.input_json?.opportunity_id || null;
  if (!opportunityId) return;
  const phone = lead.facts?.contact?.phone || lead.contact?.phone || '';
  const nextAction = phone ? 'CALL_HOT_LEAD_WITH_DEMO_READY' : 'SEND_DEMO_AND_MEETING_CTA';
  await db.updateOpportunity(opportunityId, {
    demo_job_id:job.id,
    demo_id:demo.id,
    demo_url:liveUrl,
    next_action:nextAction,
    next_action_at:now(),
    updated_at:now()
  });
  await db.addActivity(opportunityId, 'DEMO_PUBLISHED', { demo_job_id:job.id, demo_id:demo.id, demo_url:liveUrl, qa_status:'PASS' });
}

async function updateCrmFailure(db, job, error) {
  const opportunityId = job?.input_json?.opportunity_id || null;
  if (!opportunityId) return;
  await db.updateOpportunity(opportunityId, {
    next_action:'HUMAN_REVIEW_DEMO_FAILURE',
    next_action_at:now(),
    updated_at:now()
  });
  await db.addActivity(opportunityId, 'DEMO_GENERATION_FAILED', { demo_job_id:job.id, error:String(error.message || error).slice(0,1000) });
}

async function main() {
  const db = new SupabaseService(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { lead, job:queuedJob } = await readLead(db);
  const template = await db.approvedPainterTemplate();
  if (!template) throw new Error('Approved painter_v1 template not found');

  const job = queuedJob || await db.createJob({
    job_type:'FULL_DEMO',
    status:'QUEUED',
    tool:'prospect-orchestrator-v1',
    prompt_version:'facts-only-v1',
    input_json:{ lead_status:lead.lead_status, company_name:lead.company_name, niche:lead.niche, source_ref:lead.source_ref || null, test_fixture:lead.test_fixture === true }
  });

  let demo = null;
  let codeRed = false;
  try {
    await db.updateJob(job.id, { status:'RESEARCHING', started_at:now(), error_message:null });
    const record = buildDemoRecord(lead, template);
    const existing = await db.getDemoBySlug(record.slug);
    if (existing && existing.company_name !== record.company_name) throw new Error(`Slug collision with another company: ${record.slug}`);

    const assetAudit = {
      logo: Boolean(record.config.brand?.logo_url) ? 'REAL_OR_VERIFIED_INPUT' : 'ABSENT',
      projects: record.config.projects?.length || 0,
      reviews: record.config.reviews?.length || 0,
      stats: record.config.stats?.length || 0,
      truth_mode: 'FACTS_ONLY'
    };
    await db.updateJob(job.id, { status:'GENERATING', output_json:{ stage:'CONFIG_BUILT', slug:record.slug, template_key:record.template_key, asset_audit:assetAudit } });
    demo = await db.upsertDemo(record);
    await db.updateJob(job.id, { demo_id:demo.id, status:'QA' });

    const previewHtml = renderPainterV1Certified(demo);
    const previewDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dwd-preview-qa-'));
    const previewReport = await withPreviewServer(previewHtml, url => runQa(url, template.template_key, previewDir));
    await persistQa(db, demo, template, previewReport, 'PRE_PUBLISH');
    if (previewReport.summary.status !== 'PASS' || previewReport.code !== 0) throw new Error(`Pre-publish QA failed: ${previewReport.summary.status}`);

    demo = await db.updateDemo(demo.id, { status:'published', published_at:now(), updated_at:now() });
    const liveUrl = `${BASE.replace(/\/$/, '')}/${demo.slug}`;
    const liveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dwd-live-qa-'));
    const liveReport = await runQa(liveUrl, template.template_key, liveDir);
    await persistQa(db, demo, template, liveReport, 'POST_PUBLISH_LIVE');
    if (liveReport.summary.status !== 'PASS' || liveReport.code !== 0) {
      codeRed = true;
      await db.updateDemo(demo.id, { status:'draft', published_at:null, updated_at:now() });
      await db.updateJob(job.id, { status:'CODE_RED', completed_at:now(), error_message:`Live QA failed: ${liveReport.summary.status}`, output_json:{ stage:'LIVE_QA_FAILED', live_url:liveUrl } });
      throw new Error(`Live QA failed: ${liveReport.summary.status}`);
    }

    const cleanedUp = lead.test_fixture === true;
    if (cleanedUp) demo = await db.updateDemo(demo.id, { status:'archived', updated_at:now() });
    const done = await db.updateJob(job.id, {
      status:'PUBLISHED',
      completed_at:now(),
      output_json:{ stage: cleanedUp ? 'TEST_PUBLISHED_AND_ARCHIVED' : 'PUBLISHED', demo_id:demo.id, slug:demo.slug, demo_url:liveUrl, qa_status:'PASS', test_fixture:cleanedUp }
    });
    if (!cleanedUp) await updateCrmSuccess(db, job, lead, demo, liveUrl);
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `demo_url=${liveUrl}\njob_id=${done.id}\ndemo_id=${demo.id}\n`);
    console.log(JSON.stringify({ ok:true, job_id:done.id, demo_id:demo.id, demo_url:liveUrl, qa:'PASS', test_fixture_archived:cleanedUp }, null, 2));
  } catch (error) {
    if (!codeRed) {
      try { await db.updateJob(job.id, { status:'FAILED', completed_at:now(), error_message:String(error.message || error).slice(0,1000) }); } catch {}
    }
    try { await updateCrmFailure(db, job, error); } catch {}
    throw error;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
