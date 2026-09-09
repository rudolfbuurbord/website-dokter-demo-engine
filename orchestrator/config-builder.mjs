const hex = value => /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim() : null;
const arr = value => Array.isArray(value) ? value.filter(Boolean) : [];
const text = value => String(value || '').trim();
const safeProof = value => arr(value).filter(item => item && item.claim_safe === true && (item.source_url || item.source === 'verified'));

export function slugify(value) {
  return text(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'prospect';
}

export function normalizeHotLead(input) {
  if (!input || input.lead_status !== 'HOT_LEAD') throw new Error('Lead must have lead_status=HOT_LEAD');
  const companyName = text(input.company_name);
  if (!companyName) throw new Error('Missing company_name');
  const niche = text(input.niche).toLowerCase();
  if (!['schilder','schilders','schilderbedrijf','schildersbedrijf','painter','painting'].includes(niche)) throw new Error(`Unsupported niche: ${niche || 'UNKNOWN'}`);
  const facts = input.facts && typeof input.facts === 'object' ? input.facts : {};
  return { ...input, company_name: companyName, niche: 'schilders', facts };
}

export function buildDemoRecord(rawLead, template) {
  const lead = normalizeHotLead(rawLead);
  if (!template || template.template_key !== 'painter_v1' || template.status !== 'APPROVED') throw new Error('No approved painter_v1 template available');
  const f = lead.facts;
  const services = arr(f.services).map(text).filter(Boolean).slice(0, 6);
  if (!services.length) throw new Error('At least one verified service is required');
  const reviews = safeProof(f.reviews).map(r => ({ text:text(r.text), author:text(r.author), location:text(r.location) })).filter(r => r.text);
  const projects = safeProof(f.projects).map(p => ({ title:text(p.title), subtitle:text(p.subtitle), image_url:text(p.image_url) })).filter(p => p.title || p.image_url);
  const stats = safeProof(f.stats).map(s => ({ value:text(s.value), label:text(s.label) })).filter(s => s.value && s.label);
  const brand = f.brand && typeof f.brand === 'object' ? f.brand : {};
  const theme = {
    background: hex(brand.background) || template.default_theme?.background || '#f4f1ea',
    ink: hex(brand.ink) || template.default_theme?.ink || '#1b1f1a',
    accent: hex(brand.accent) || template.default_theme?.accent || '#606a58'
  };
  const contact = f.contact && typeof f.contact === 'object' ? f.contact : {};
  const heroTitle = text(f.hero_title) || lead.company_name;
  const heroSubtitle = text(f.hero_subtitle) || `${services.slice(0,3).join(', ')} helder en professioneel gepresenteerd.`;
  const config = {
    provenance: { mode:'FACTS_ONLY', generated_by:'prospect-orchestrator-v1', source_ref:text(lead.source_ref) || null },
    hero: { eyebrow:text(f.hero_eyebrow) || services.slice(0,2).join(' • '), title:heroTitle, subtitle:heroSubtitle },
    services,
    contact: { phone:text(contact.phone), email:text(contact.email), city:text(contact.city) },
    brand: { logo_url:text(brand.logo_url), logo_alt: lead.company_name },
    reviews,
    projects,
    stats,
    about: f.about && f.about.claim_safe === true ? { title:text(f.about.title), text:text(f.about.text) } : {},
    process: arr(f.process).filter(x => x && x.claim_safe === true).map(x => ({ title:text(x.title), text:text(x.text) })).filter(x => x.title || x.text)
  };
  const slug = slugify(text(lead.slug) || lead.company_name);
  return {
    slug,
    company_name: lead.company_name,
    status: 'draft',
    template_key: template.template_key,
    template_version: template.current_version,
    theme,
    config,
    seo: { title:`${lead.company_name} — Demo`, description:'Interactieve homepage demo.' },
    version: 1
  };
}
