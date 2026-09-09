const enc = new TextEncoder();

const text = value => value === null || value === undefined ? '' : String(value).trim();
const first = (...values) => values.map(text).find(Boolean) || '';
const norm = value => text(value).toLowerCase().replace(/[\s_-]+/g, ' ').trim();

export async function hmacSha256Hex(secret, rawBody) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeHexEqual(a, b) {
  const aa = text(a).toLowerCase();
  const bb = text(b).toLowerCase();
  if (!aa || aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return diff === 0;
}

export async function verifySmartleadSignature(rawBody, signatureHeader, secret) {
  if (!secret) return false;
  const supplied = text(signatureHeader).replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeHexEqual(expected, supplied);
}

export async function sha256Hex(rawBody) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(rawBody));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function findNested(obj, paths) {
  for (const path of paths) {
    let value = obj;
    for (const key of path.split('.')) value = value && typeof value === 'object' ? value[key] : undefined;
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return undefined;
}

export function extractSmartleadEvent(payload, headers = {}) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const lead = data.lead && typeof data.lead === 'object' ? data.lead : {};
  const custom = lead.custom_fields || data.custom_fields || payload?.custom_fields || {};
  const eventType = first(payload?.type, payload?.event_type, payload?.event, data.event_type, data.event);
  const campaignId = first(data.campaign_id, payload?.campaign_id, data.campaign?.id, payload?.campaign?.id);
  const leadId = first(data.lead_id, lead.id, payload?.lead_id, payload?.lead?.id);
  const email = first(data.email, lead.email, payload?.email, payload?.lead?.email);
  const contactName = first(
    data.name,
    lead.name,
    [lead.first_name, lead.last_name].filter(Boolean).join(' '),
    [data.first_name, data.last_name].filter(Boolean).join(' '),
    payload?.name
  );
  const companyName = first(data.company_name, lead.company_name, payload?.company_name, custom.company_name, custom.company);
  const phone = first(data.phone_number, data.phone, lead.phone_number, lead.phone, payload?.phone_number, payload?.phone);
  const category = first(
    data.reply_category,
    data.lead_category,
    data.category,
    lead.reply_category,
    lead.lead_category,
    lead.category,
    payload?.reply_category,
    payload?.lead_category,
    payload?.category
  );
  const replyText = first(data.reply_text, data.reply, data.message, data.email_body, payload?.reply_text, payload?.reply, payload?.message, payload?.email_body);
  const niche = first(data.niche, lead.niche, custom.niche, custom.subniche, payload?.niche);
  const website = first(data.website, lead.website, custom.website, payload?.website);
  const city = first(data.city, lead.city, custom.city, custom.location, payload?.city, payload?.location);
  const explicitInterested = findNested(payload, ['data.is_interested','data.lead.is_interested','is_interested','lead.is_interested']);
  const requestId = first(headers['x-request-id'], headers['X-Request-Id'], payload?.id, payload?.event_id);

  return {
    eventType,
    campaignId,
    leadId,
    email,
    contactName,
    companyName,
    phone,
    category,
    replyText,
    niche,
    website,
    city,
    explicitInterested: explicitInterested === true || norm(explicitInterested) === 'true',
    requestId,
    raw: payload
  };
}

export function isReplyLikeEvent(eventType) {
  const value = norm(eventType);
  return value.includes('reply') || value.includes('category');
}

export function isPositiveReply(event, configuredCategories = '') {
  if (event.explicitInterested === true) return true;
  const defaults = ['interested', 'positive'];
  const configured = text(configuredCategories).split(',').map(norm).filter(Boolean);
  const allowed = new Set([...defaults, ...configured]);
  return allowed.has(norm(event.category));
}

export function buildProspectFromSmartlead(event, mapping) {
  const niche = first(event.niche, mapping?.niche);
  const missing = [];
  if (!event.companyName) missing.push('company_name');
  if (!event.email) missing.push('email');
  if (!niche) missing.push('niche');
  if (missing.length) return { ok:false, missing };

  return {
    ok:true,
    prospect:{
      lead_status:'HOT_LEAD',
      company_name:event.companyName,
      niche,
      source_ref:`smartlead://${event.campaignId || 'unknown'}/${event.leadId || event.email}`,
      facts:{
        contact:{
          email:event.email,
          phone:event.phone || '',
          city:event.city || ''
        },
        company_name:event.companyName,
        website:event.website || '',
        services:[],
        reviews:[],
        projects:[],
        stats:[]
      }
    }
  };
}

export function sourceKeyFor(event) {
  return `${event.campaignId || 'unknown'}:${event.leadId || event.email || 'unknown'}`;
}
