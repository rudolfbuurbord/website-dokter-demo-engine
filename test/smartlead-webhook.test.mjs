import assert from 'node:assert/strict';
import {
  buildProspectFromSmartlead,
  extractSmartleadEvent,
  hmacSha256Hex,
  isPositiveReply,
  isReplyLikeEvent,
  sourceKeyFor,
  verifySmartleadSignature
} from '../src/smartlead-webhook.js';

const payload = {
  id:'evt_test_reply_001',
  type:'email.reply.received',
  data:{
    campaign_id:123,
    lead_id:456,
    email:'owner@example.nl',
    first_name:'Test',
    last_name:'Eigenaar',
    company_name:'DWD Webhook QA Fixture',
    phone_number:'0612345678',
    lead_category:'Interested',
    reply_text:'Ja, laat maar zien.',
    custom_fields:{ niche:'schildersbedrijf' }
  }
};

const event = extractSmartleadEvent(payload, { 'x-request-id':'req-001' });
assert.equal(event.companyName, 'DWD Webhook QA Fixture');
assert.equal(event.campaignId, '123');
assert.equal(event.leadId, '456');
assert.equal(event.email, 'owner@example.nl');
assert.equal(event.niche, 'schildersbedrijf');
assert.equal(event.requestId, 'req-001');
assert.equal(isReplyLikeEvent(event.eventType), true);
assert.equal(isPositiveReply(event), true);
assert.equal(sourceKeyFor(event), '123:456');

const built = buildProspectFromSmartlead(event, null);
assert.equal(built.ok, true);
assert.equal(built.prospect.lead_status, 'HOT_LEAD');
assert.deepEqual(built.prospect.facts.reviews, []);
assert.deepEqual(built.prospect.facts.projects, []);

const missing = buildProspectFromSmartlead(extractSmartleadEvent({ type:'email.reply.received', data:{ email:'x@example.nl', lead_category:'Interested' } }), null);
assert.equal(missing.ok, false);
assert.deepEqual(missing.missing.sort(), ['company_name','niche']);

const secret = 'unit-test-secret';
const raw = JSON.stringify(payload);
const sig = await hmacSha256Hex(secret, raw);
assert.equal(await verifySmartleadSignature(raw, `sha256=${sig}`, secret), true);
assert.equal(await verifySmartleadSignature(`${raw}x`, `sha256=${sig}`, secret), false);

console.log('smartlead-webhook.test: PASS');
