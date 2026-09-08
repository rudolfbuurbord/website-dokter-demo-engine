import { renderPainterV1 } from './painter-v1.js';

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const shortLabel = (value, fallback) => {
  const text = String(value || '').trim();
  return text && text.length <= 32 ? text : fallback;
};

function contrastText(hex) {
  const raw = String(hex || '').replace('#', '');
  const normalized = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return '#ffffff';
  const rgb = [0, 2, 4].map(i => parseInt(normalized.slice(i, i + 2), 16));
  const lum = rgb.map(v => v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const L = .2126 * lum[0] + .7152 * lum[1] + .0722 * lum[2];
  const white = 1.05 / (L + .05);
  const black = (L + .05) / .05;
  return black >= white ? '#111111' : '#ffffff';
}

export function renderPainterV1Certified(demo) {
  const cfg = demo.config || {};
  const services = Array.isArray(cfg.services) ? cfg.services : [];
  const brand = cfg.brand || {};
  const accent = demo.theme?.accent || '#606a58';
  const accentContrast = contrastText(accent);
  const serviceTitle = index => {
    const item = services[index];
    return typeof item === 'string' ? item : item?.title;
  };

  let html = renderPainterV1(demo);

  html = html
    .replace('--accent2:', `--accent-contrast:${accentContrast};--accent2:`)
    .replace('background:var(--accent);color:white;font-size:11px', 'background:var(--accent);color:var(--accent-contrast);font-size:11px')
    .replace('.btn-ghost{background:rgba(255,255,255,.65);color:var(--ink);', '.btn-ghost{background:#fff;color:#171712;')
    .replace('.cta .btn{background:white;color:var(--ink)}', '.cta .btn{background:white;color:#171712}')
    .replace('.brand{font-weight:900;letter-spacing:-.03em;font-size:22px}', '.brand{font-weight:900;letter-spacing:-.03em;font-size:22px;min-height:44px;display:inline-flex;align-items:center;max-width:min(38vw,380px);line-height:1.05}.brand-logo{display:block;max-width:220px;max-height:48px;width:auto;height:auto;object-fit:contain}')
    .replace('.float-card span{font-size:10px', '.float-card span{font-size:11px')
    .replace('.float-a{left:14%;top:16%}.float-b{right:1%;bottom:18%}.color-chip{position:absolute;left:38%;bottom:8%;', '.float-a{left:4%;top:15%}.float-b{right:4%;top:15%}.color-chip{position:absolute;left:50%;bottom:5%;')
    .replace('box-shadow:var(--shadow);transform:rotate(-5deg)}', 'box-shadow:var(--shadow);transform:translateX(-50%) rotate(-5deg)}')
    .replace('.stats span{font-size:10px', '.stats span{font-size:11px')
    .replace('.project-overlay span{font-size:10px}', '.project-overlay span{font-size:11px}')
    .replace('.review footer{font-size:10px', '.review footer{font-size:11px')
    .replace('.review-summary span{font-size:10px', '.review-summary span{font-size:11px')
    .replace('font-size:9px;letter-spacing:.12em', 'font-size:11px;letter-spacing:.10em')
    .replace('.float-a{left:0}.float-b{right:0}.color-chip{left:30%}', '.float-a{left:0;top:10%}.float-b{right:0;top:10%}.color-chip{left:50%;bottom:2%}');

  html = html.replace(
    /<div class="float-card float-a"><strong>.*?<\/strong>/,
    `<div class="float-card float-a"><strong>${esc(shortLabel(serviceTitle(0), 'Vakwerk'))}</strong>`
  );
  html = html.replace(
    /<div class="float-card float-b"><strong>.*?<\/strong>/,
    `<div class="float-card float-b"><strong>${esc(shortLabel(serviceTitle(1), 'Aandacht'))}</strong>`
  );

  if (brand.logo_url) {
    const company = esc(demo.company_name);
    html = html.replace(
      `<a class="brand" href="#">${company}</a>`,
      `<a class="brand" href="#"><img class="brand-logo" src="${esc(brand.logo_url)}" alt="${esc(brand.logo_alt || demo.company_name)}"></a>`
    );
  }

  return html;
}
