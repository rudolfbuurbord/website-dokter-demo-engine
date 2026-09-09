import { renderPainterV1Certified } from './templates/painter-v1-certified.js';
import { BackendSupabase } from './backend-supabase.js';
import {
  buildProspectFromSmartlead,
  extractSmartleadEvent,
  isPositiveReply,
  isReplyLikeEvent,
  sha256Hex,
  sourceKeyFor,
  verifySmartleadSignature
} from './smartlead-webhook.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' };
const HTML_HEADERS = {
  'content-type': 'text/html; charset=UTF-8',
  'cache-control': 'public, max-age=60, s-maxage=300',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const html = (body, status = 200) => new Response(body, { status, headers: HTML_HEADERS });
const keyFor = env => env.SUPABASE_PUBLISHABLE_KEY || env.PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
const now = () => new Date().toISOString();

function cleanSlug(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 1) return null;
  const slug = parts[0].toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) ? slug : null;
}

async function getPublishedDemo(env, slug) {
  const key = keyFor(env);
  if (!env.SUPABASE_URL || !key) throw new Error('Supabase bindings missing');
  const endpoint = new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/demos`);
  endpoint.searchParams.set('select', 'id,slug,company_name,status,template_key,theme,config,seo,version,published_at,updated_at');
  endpoint.searchParams.set('slug', `eq.${slug}`);
  endpoint.searchParams.set('status', 'eq.published');
  endpoint.searchParams.set('limit', '1');
  const response = await fetch(endpoint, { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } });
  if (!response.ok) throw new Error(`Supabase lookup failed: ${response.status}`);
  const rows = await response.json();
  return rows[0] || null;
}

function renderDemo(demo) {
  if (demo.template_key === 'painter_v1') return renderPainterV1Certified(demo);
  return null;
}

function home() {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>De Website Dokter — Demo Engine</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#11120f;color:#f4f1e9;font:15px system-ui}.card{width:min(600px,calc(100% - 40px));padding:32px;border:1px solid #303229;border-radius:24px;background:#191b17}h1{font:500 44px/1 Georgia,serif;margin:10px 0}p{line-height:1.7;color:#b7baaf}code{color:#e1d6bd}</style></head><body><main class="card"><small>DE WEBSITE DOKTER</small><h1>Demo Engine</h1><p>Published prospect-demo's worden dynamisch uit Supabase geladen en gerenderd via gecertificeerde mastertemplates.</p><p><code>/_health</code> · <code>/api/demo/&lt;slug&gt;</code> · <code>/&lt;slug&gt;</code></p></main></body></html>`;
}

async function handleSmartleadWebhook(request, env) {
  if (request.method !== 'POST') return json({ error:'method_not_allowed' }, 405);
  if (!env.SMARTLEAD_WEBHOOK_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) {
    return json({ error:'webhook_not_configured' }, 503);
  }

  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return json({ error:'payload_too_large' }, 413);
  const signature = request.headers.get('x-smartlead-signature') || '';
  const valid = await verifySmartleadSignature(rawBody, signature, env.SMARTLEAD_WEBHOOK_SECRET);
  if (!valid) return json({ error:'invalid_signature' }, 401);

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return json({ error:'invalid_json' }, 400); }

  const db = new BackendSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const headers = Object.fromEntries(request.headers.entries());
  const event = extractSmartleadEvent(payload, headers);
  const eventKey = event.requestId || await sha256Hex(rawBody);
  const existingEvent = await db.getWebhookEvent(eventKey);
  if (existingEvent && ['PROCESSED','PROCESSED_NO_ACTION','HUMAN_REVIEW'].includes(existingEvent.status)) {
    return json({ ok:true, duplicate:true, event_id:existingEvent.id, status:existingEvent.status });
  }

  const webhookEvent = existingEvent || await db.insertWebhookEvent({
    provider:'SMARTLEAD',
    event_key:eventKey,
    event_type:event.eventType || null,
    payload,
    status:'RECEIVED'
  });

  try {
    if (!isReplyLikeEvent(event.eventType)) {
      await db.updateWebhookEvent(webhookEvent.id, { status:'PROCESSED_NO_ACTION', processed_at:now() });
      return json({ ok:true, hot_lead:false, reason:'NON_REPLY_EVENT' });
    }

    if (!isPositiveReply(event, env.SMARTLEAD_POSITIVE_CATEGORIES || '')) {
      await db.updateWebhookEvent(webhookEvent.id, { status:'PROCESSED_NO_ACTION', processed_at:now() });
      return json({ ok:true, hot_lead:false, reason:'NOT_EXPLICITLY_POSITIVE', category:event.category || null });
    }

    const mapping = await db.getCampaignMapping(event.campaignId);
    const built = buildProspectFromSmartlead(event, mapping);
    if (!built.ok) {
      await db.updateWebhookEvent(webhookEvent.id, {
        status:'HUMAN_REVIEW',
        processed_at:now(),
        error_message:`Missing required factual fields: ${built.missing.join(', ')}`
      });
      return json({ ok:true, hot_lead:true, queued:false, human_review:true, missing:built.missing });
    }

    const sourceKey = sourceKeyFor(event);
    const nextAction = event.phone ? 'CALL_HOT_LEAD' : 'REVIEW_REPLY_AND_ENRICH_PHONE';
    const opportunity = await db.upsertOpportunity({
      company_name:event.companyName,
      contact_name:event.contactName || null,
      contact_email:event.email || null,
      contact_phone:event.phone || null,
      niche:built.prospect.niche,
      status:'HOT_LEAD',
      owner:'Rudolf',
      source:'SMARTLEAD',
      source_key:sourceKey,
      source_event_id:webhookEvent.id,
      campaign_id:event.campaignId || null,
      lead_id:event.leadId || null,
      reply_category:event.category || null,
      reply_text:event.replyText || null,
      next_action:nextAction,
      next_action_at:now(),
      metadata:{ website:event.website || null, city:event.city || null, webhook_event_type:event.eventType || null },
      updated_at:now()
    });

    await db.addActivity({
      opportunity_id:opportunity.id,
      event_type:'POSITIVE_REPLY_RECEIVED',
      payload:{ provider:'SMARTLEAD', event_id:webhookEvent.id, category:event.category || null, campaign_id:event.campaignId || null }
    });

    if (opportunity.demo_job_id) {
      await db.updateWebhookEvent(webhookEvent.id, { status:'PROCESSED', processed_at:now() });
      return json({ ok:true, hot_lead:true, queued:false, duplicate_opportunity:true, opportunity_id:opportunity.id, demo_job_id:opportunity.demo_job_id });
    }

    const job = await db.createDemoJob({
      job_type:'FULL_DEMO',
      status:'QUEUED',
      tool:'hot-lead-queue-v1',
      prompt_version:'facts-only-v1',
      input_json:{
        prospect:built.prospect,
        opportunity_id:opportunity.id,
        source_event_id:webhookEvent.id,
        source:'SMARTLEAD'
      }
    });

    await db.updateOpportunity(opportunity.id, { demo_job_id:job.id, updated_at:now() });
    await db.addActivity({ opportunity_id:opportunity.id, event_type:'DEMO_JOB_QUEUED', payload:{ demo_job_id:job.id } });
    await db.updateWebhookEvent(webhookEvent.id, { status:'PROCESSED', processed_at:now() });

    return json({ ok:true, hot_lead:true, queued:true, opportunity_id:opportunity.id, demo_job_id:job.id }, 202);
  } catch (error) {
    console.error(error);
    try { await db.updateWebhookEvent(webhookEvent.id, { status:'FAILED', error_message:String(error.message || error).slice(0,1000) }); } catch {}
    return json({ error:'webhook_processing_failed' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/_health') return json({
      ok:true,
      service:'demo-engine',
      version:'dynamic-v1.2',
      architecture:'template-registry',
      supabaseConfigured:Boolean(env.SUPABASE_URL && keyFor(env)),
      smartleadBridgeConfigured:Boolean(env.SMARTLEAD_WEBHOOK_SECRET && env.SUPABASE_SERVICE_ROLE_KEY)
    });
    if (url.pathname === '/api/webhooks/smartlead') return handleSmartleadWebhook(request, env);
    if (url.pathname === '/') return html(home());

    if (url.pathname.startsWith('/api/demo/')) {
      const slug = cleanSlug(url.pathname.replace(/^\/api\/demo\//, '/'));
      if (!slug) return json({ error: 'invalid_slug' }, 400);
      try {
        const demo = await getPublishedDemo(env, slug);
        return demo ? json({ demo }) : json({ error: 'demo_not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'demo_lookup_failed' }, 503);
      }
    }

    if (/\.[a-z0-9]{2,8}$/i.test(url.pathname)) return env.ASSETS.fetch(request);
    const slug = cleanSlug(url.pathname);
    if (!slug) return html('<!doctype html><title>Niet gevonden</title><h1>404</h1>', 404);

    try {
      const demo = await getPublishedDemo(env, slug);
      if (!demo) return html('<!doctype html><title>Demo niet gevonden</title><h1>Demo niet gevonden</h1>', 404);
      const rendered = renderDemo(demo);
      if (!rendered) return html('<!doctype html><title>Template niet beschikbaar</title><h1>Template niet beschikbaar</h1>', 501);
      return html(rendered);
    } catch (error) {
      console.error(error);
      return html('<!doctype html><title>Tijdelijk niet beschikbaar</title><h1>Demo tijdelijk niet beschikbaar</h1>', 503);
    }
  }
};
