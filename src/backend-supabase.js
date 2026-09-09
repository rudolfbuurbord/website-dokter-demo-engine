const clean = value => String(value || '').replace(/\/$/, '');

export class BackendSupabase {
  constructor(url, serviceRoleKey) {
    this.url = clean(url);
    this.key = String(serviceRoleKey || '');
    if (!this.url || !this.key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  async request(path, { method='GET', body, headers={} } = {}) {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      method,
      headers:{
        apikey:this.key,
        authorization:`Bearer ${this.key}`,
        accept:'application/json',
        'content-type':'application/json',
        ...headers
      },
      body:body === undefined ? undefined : JSON.stringify(body)
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!response.ok) throw new Error(`Supabase ${method} ${path} failed ${response.status}: ${raw.slice(0,500)}`);
    return data;
  }

  async getCampaignMapping(campaignId) {
    if (!campaignId) return null;
    const rows = await this.request(`outreach_campaign_mappings?select=*&provider=eq.SMARTLEAD&external_campaign_id=eq.${encodeURIComponent(campaignId)}&active=eq.true&limit=1`);
    return rows?.[0] || null;
  }

  async getWebhookEvent(eventKey) {
    const rows = await this.request(`webhook_events?select=*&provider=eq.SMARTLEAD&event_key=eq.${encodeURIComponent(eventKey)}&limit=1`);
    return rows?.[0] || null;
  }

  async insertWebhookEvent(record) {
    const rows = await this.request('webhook_events?on_conflict=provider,event_key', {
      method:'POST',
      body:[record],
      headers:{ Prefer:'resolution=ignore-duplicates,return=representation' }
    });
    return rows?.[0] || this.getWebhookEvent(record.event_key);
  }

  async updateWebhookEvent(id, patch) {
    const rows = await this.request(`webhook_events?id=eq.${encodeURIComponent(id)}`, {
      method:'PATCH',
      body:patch,
      headers:{ Prefer:'return=representation' }
    });
    return rows?.[0] || null;
  }

  async upsertOpportunity(record) {
    const rows = await this.request('crm_opportunities?on_conflict=source,source_key', {
      method:'POST',
      body:[record],
      headers:{ Prefer:'resolution=merge-duplicates,return=representation' }
    });
    return rows?.[0] || null;
  }

  async addActivity(record) {
    const rows = await this.request('crm_activity_events', {
      method:'POST',
      body:[record],
      headers:{ Prefer:'return=representation' }
    });
    return rows?.[0] || null;
  }

  async createDemoJob(record) {
    const rows = await this.request('demo_generation_jobs', {
      method:'POST',
      body:[record],
      headers:{ Prefer:'return=representation' }
    });
    return rows?.[0] || null;
  }

  async updateOpportunity(id, patch) {
    const rows = await this.request(`crm_opportunities?id=eq.${encodeURIComponent(id)}`, {
      method:'PATCH',
      body:patch,
      headers:{ Prefer:'return=representation' }
    });
    return rows?.[0] || null;
  }
}
