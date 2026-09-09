export class SupabaseService {
  constructor(url, serviceRoleKey) {
    this.url = String(url || '').replace(/\/$/, '');
    this.key = String(serviceRoleKey || '');
    if (!this.url || !this.key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  async request(path, { method='GET', body, headers={} } = {}) {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: this.key,
        authorization: `Bearer ${this.key}`,
        accept: 'application/json',
        'content-type': 'application/json',
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!response.ok) throw new Error(`Supabase ${method} ${path} failed ${response.status}: ${raw.slice(0,500)}`);
    return data;
  }

  async approvedPainterTemplate() {
    const rows = await this.request('demo_templates?select=*&template_key=eq.painter_v1&status=eq.APPROVED&limit=1');
    return rows?.[0] || null;
  }

  async getDemoBySlug(slug) {
    const rows = await this.request(`demos?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`);
    return rows?.[0] || null;
  }

  async getJob(id) {
    const rows = await this.request(`demo_generation_jobs?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows?.[0] || null;
  }

  async getNextQueuedHotLeadJob() {
    const rows = await this.request('demo_generation_jobs?select=*&job_type=eq.FULL_DEMO&status=eq.QUEUED&tool=eq.hot-lead-queue-v1&order=created_at.asc&limit=1');
    return rows?.[0] || null;
  }

  async createJob(input) {
    const rows = await this.request('demo_generation_jobs', { method:'POST', body:[input], headers:{ Prefer:'return=representation' } });
    return rows[0];
  }

  async updateJob(id, patch) {
    const rows = await this.request(`demo_generation_jobs?id=eq.${encodeURIComponent(id)}`, { method:'PATCH', body:patch, headers:{ Prefer:'return=representation' } });
    return rows[0];
  }

  async upsertDemo(record) {
    const rows = await this.request('demos?on_conflict=slug', {
      method:'POST',
      body:[record],
      headers:{ Prefer:'resolution=merge-duplicates,return=representation' }
    });
    return rows[0];
  }

  async updateDemo(id, patch) {
    const rows = await this.request(`demos?id=eq.${encodeURIComponent(id)}`, { method:'PATCH', body:patch, headers:{ Prefer:'return=representation' } });
    return rows[0];
  }

  async createQaRun(body) {
    const rows = await this.request('demo_qa_runs', { method:'POST', body:[body], headers:{ Prefer:'return=representation' } });
    return rows[0];
  }

  async createQaChecks(rows) {
    if (!rows.length) return [];
    return this.request('demo_qa_checks', { method:'POST', body:rows, headers:{ Prefer:'return=minimal' } });
  }
}
