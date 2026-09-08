import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [k, ...rest] = arg.replace(/^--/, '').split('=');
  return [k, rest.join('=') || true];
}));

const targetUrl = String(args.url || process.env.QA_URL || '');
const scope = String(args.scope || process.env.QA_SCOPE || 'prospect').toUpperCase();
const templateKey = String(args.template || process.env.QA_TEMPLATE || 'unknown');
const outputDir = path.resolve(args.output || process.env.QA_OUTPUT || 'qa-results');
if (!targetUrl) throw new Error('Missing --url=<demo url>');

const VIEWPORTS = [
  { name: 'desktop_1440', width: 1440, height: 1000 },
  { name: 'laptop_1280', width: 1280, height: 900 },
  { name: 'tablet_768', width: 768, height: 1024 },
  { name: 'mobile_390', width: 390, height: 844 }
];

const checks = [];
const add = (category, key, status, viewport, message, expected = {}, actual = {}, severity = 'ERROR', selector = null, screenshot = null) => {
  checks.push({ category, check_key: key, status, severity, viewport, element_selector: selector, expected, actual, message, screenshot_url: screenshot });
};

const isPass = status => status === 'PASS';
const criticalFailures = () => checks.filter(c => c.severity === 'CRITICAL' && !isPass(c.status));
const errorFailures = () => checks.filter(c => ['CRITICAL', 'ERROR'].includes(c.severity) && !isPass(c.status));

function contrastRatio(rgb1, rgb2) {
  const lum = rgb => {
    const vals = rgb.map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2];
  };
  const [l1, l2] = [lum(rgb1), lum(rgb2)].sort((a,b) => b-a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function parseRgb(value) {
  const m = String(value).match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('requestfailed', req => failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }));

    const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);

    const screenshotPath = path.join(outputDir, `${vp.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    add('TECHNICAL_QA', 'http_status', response && response.ok() ? 'PASS' : 'FAIL', vp.name,
      response ? `HTTP ${response.status()}` : 'No HTTP response', { status: 200 }, { status: response?.status() }, 'CRITICAL', null, screenshotPath);

    const report = await page.evaluate(({ width, height }) => {
      const visible = el => {
        const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01 && r.width > 1 && r.height > 1;
      };
      const box = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
      const all = [...document.querySelectorAll('body *')].filter(visible);
      const interactive = all.filter(el => el.matches('a,button,input,select,textarea,[role="button"]'));
      const textEls = all.filter(el => el.childElementCount === 0 && (el.textContent || '').trim().length > 0);
      const sections = [...document.querySelectorAll('header,main>section,body>section,section,footer')].filter(visible).map(el => ({ id: el.id || null, tag: el.tagName.toLowerCase(), box: box(el) }));
      const horizontalOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - width;
      const overflowEls = all.map(el => ({ el, b: box(el) })).filter(x => x.b.right > width + 2 || x.b.left < -2).slice(0,30).map(x => ({ tag:x.el.tagName, cls:x.el.className, id:x.el.id, text:(x.el.textContent||'').trim().slice(0,80), box:x.b }));
      const clippedText = textEls.map(el => {
        const b = box(el); const s = getComputedStyle(el);
        const parent = el.parentElement ? box(el.parentElement) : null;
        const clipped = (s.overflow === 'hidden' || getComputedStyle(el.parentElement || el).overflow === 'hidden') && parent && (b.right > parent.right + 1 || b.bottom > parent.bottom + 1 || b.left < parent.left - 1 || b.top < parent.top - 1);
        return clipped ? { tag:el.tagName, cls:el.className, text:(el.textContent||'').trim().slice(0,100), box:b, parent } : null;
      }).filter(Boolean).slice(0,30);
      const tooSmallText = textEls.map(el => ({ el, size: parseFloat(getComputedStyle(el).fontSize), text:(el.textContent||'').trim() })).filter(x => x.size < 11 && x.text.length > 2).slice(0,30).map(x => ({ size:x.size, text:x.text.slice(0,80), tag:x.el.tagName, cls:x.el.className }));
      const tinyTargets = interactive.map(el => ({ el, b:box(el) })).filter(x => x.b.width < 40 || x.b.height < 40).slice(0,30).map(x => ({ tag:x.el.tagName, cls:x.el.className, text:(x.el.textContent||'').trim().slice(0,80), box:x.b }));
      const hiddenInteractive = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')].filter(el => !visible(el)).slice(0,20).map(el => ({ tag:el.tagName, cls:el.className, text:(el.textContent||'').trim().slice(0,80) }));
      const hero = document.querySelector('header.hero,.hero,header');
      const heroBox = hero && visible(hero) ? box(hero) : null;
      const heroCtas = hero ? [...hero.querySelectorAll('a,button,[role="button"]')].filter(visible).map(el => ({ text:(el.textContent||'').trim(), box:box(el) })) : [];
      const h1 = document.querySelector('h1');
      const h1Box = h1 && visible(h1) ? box(h1) : null;
      const h1Text = h1 ? (h1.textContent||'').trim() : '';
      const firstViewportCtas = interactive.filter(el => box(el).top < height).map(el => ({ text:(el.textContent||'').trim(), box:box(el) }));
      const possibleTrust = all.filter(el => /(review|klant|google|ster|rating|ervaring|project|jaar|vakman|keurmerk)/i.test((el.textContent||'').trim())).filter(el => box(el).top < height * 1.6).slice(0,15).map(el => ({ text:(el.textContent||'').trim().slice(0,100), box:box(el) }));
      const pairs = [];
      const candidates = all.filter(el => el.matches('h1,h2,h3,p,a,button,.btn,.card,.service-card,.review,.project,.float-card,.color-chip')).slice(0,120);
      for (let i=0;i<candidates.length;i++) for(let j=i+1;j<candidates.length;j++) {
        const a=candidates[i], b=candidates[j];
        if (a.contains(b)||b.contains(a)) continue;
        const A=box(a), B=box(b);
        const ix=Math.max(0,Math.min(A.right,B.right)-Math.max(A.left,B.left));
        const iy=Math.max(0,Math.min(A.bottom,B.bottom)-Math.max(A.top,B.top));
        if (ix*iy > 12) pairs.push({ a:{tag:a.tagName,cls:a.className,text:(a.textContent||'').trim().slice(0,60),box:A}, b:{tag:b.tagName,cls:b.className,text:(b.textContent||'').trim().slice(0,60),box:B}, overlapArea:ix*iy });
        if (pairs.length>=30) break;
      }
      const nearPairs = [];
      const blocks = [...document.querySelectorAll('section,header,footer,.service-card,.review,.process-item,.cta-card')].filter(visible);
      for (let i=0;i<blocks.length-1;i++) {
        const A=box(blocks[i]), B=box(blocks[i+1]);
        const verticalGap = B.top - A.bottom;
        if (verticalGap >= 0 && verticalGap < 12) nearPairs.push({ a:blocks[i].className||blocks[i].id||blocks[i].tagName, b:blocks[i+1].className||blocks[i+1].id||blocks[i+1].tagName, gap:verticalGap });
      }
      const images = [...document.images].filter(visible).map(img => ({ src:img.currentSrc||img.src, naturalWidth:img.naturalWidth, naturalHeight:img.naturalHeight, box:box(img), alt:img.alt }));
      const brokenImages = images.filter(x => !x.naturalWidth || !x.naturalHeight);
      const inputs = [...document.querySelectorAll('input,textarea,select')].filter(visible).map(el => ({ type:el.type, name:el.name, aria:el.getAttribute('aria-label'), label:el.labels?.[0]?.textContent?.trim() }));
      const nav = document.querySelector('nav');
      return { horizontalOverflow, overflowEls, clippedText, tooSmallText, tinyTargets, hiddenInteractive, heroBox, heroCtas, h1Box, h1Text, firstViewportCtas, possibleTrust, overlaps:pairs, nearPairs, brokenImages, images, inputs, sections, hasNav:!!nav, title:document.title, bodyText:(document.body.innerText||'').slice(0,30000) };
    }, { width: vp.width, height: vp.height });

    add('LAYOUT_QA','horizontal_overflow', report.horizontalOverflow <= 2 ? 'PASS':'FAIL', vp.name,
      report.horizontalOverflow <= 2 ? 'No horizontal overflow' : `${report.horizontalOverflow}px horizontal overflow`, { max_px:2 }, { overflow_px:report.horizontalOverflow, elements:report.overflowEls }, 'CRITICAL', 'html', screenshotPath);
    add('LAYOUT_QA','unexpected_overlap', report.overlaps.length === 0 ? 'PASS':'FAIL', vp.name,
      report.overlaps.length === 0 ? 'No detected content collisions' : `${report.overlaps.length} possible content collisions`, { overlaps:0 }, { overlaps:report.overlaps }, 'CRITICAL', null, screenshotPath);
    add('LAYOUT_QA','minimum_spacing', report.nearPairs.length === 0 ? 'PASS':'WARN', vp.name,
      report.nearPairs.length === 0 ? 'No suspicious sub-12px block gaps' : `${report.nearPairs.length} tight block gaps need review`, { min_gap_px:12 }, { pairs:report.nearPairs }, 'WARNING', null, screenshotPath);
    add('CONTENT_QA','text_containment', report.clippedText.length === 0 ? 'PASS':'FAIL', vp.name,
      report.clippedText.length === 0 ? 'Text stays inside containers' : `${report.clippedText.length} clipped text nodes`, { clipped:0 }, { clipped:report.clippedText }, 'CRITICAL', null, screenshotPath);
    add('CONTENT_QA','minimum_text_size', report.tooSmallText.length === 0 ? 'PASS':'WARN', vp.name,
      report.tooSmallText.length === 0 ? 'Readable text sizing' : `${report.tooSmallText.length} text nodes below 11px`, { min_px:11 }, { nodes:report.tooSmallText }, 'WARNING', null, screenshotPath);
    add('INTERACTION_QA','tap_target_size', vp.width > 768 || report.tinyTargets.length === 0 ? 'PASS':'WARN', vp.name,
      vp.width > 768 ? 'Desktop target sizing not gated' : (report.tinyTargets.length ? `${report.tinyTargets.length} mobile targets below 40px` : 'Mobile targets >=40px'), { mobile_min_px:40 }, { targets:report.tinyTargets }, 'WARNING', null, screenshotPath);
    add('RESPONSIVE_QA','hero_visible', report.heroBox && report.heroBox.width > 0 ? 'PASS':'FAIL', vp.name,
      report.heroBox ? 'Hero is visible' : 'Hero missing/hidden', { visible:true }, { hero:report.heroBox }, 'CRITICAL', '.hero', screenshotPath);
    add('CONVERSION_QA','primary_cta_above_fold', report.firstViewportCtas.length > 0 ? 'PASS':'FAIL', vp.name,
      report.firstViewportCtas.length ? `CTA visible above fold: ${report.firstViewportCtas[0].text}` : 'No visible CTA above fold', { min_visible_cta:1 }, { ctas:report.firstViewportCtas.slice(0,8) }, 'CRITICAL', null, screenshotPath);
    add('CONVERSION_QA','hero_message_present', report.h1Text.length >= 8 && report.h1Box ? 'PASS':'FAIL', vp.name,
      report.h1Text ? `Hero headline present: ${report.h1Text.slice(0,100)}` : 'Missing hero headline', { h1:true }, { text:report.h1Text, box:report.h1Box }, 'CRITICAL', 'h1', screenshotPath);
    add('CONVERSION_QA','early_trust_signal', report.possibleTrust.length > 0 ? 'PASS':'WARN', vp.name,
      report.possibleTrust.length ? 'Trust/proof signal detected early' : 'No early trust/proof signal detected', { preferred:true }, { signals:report.possibleTrust }, 'WARNING', null, screenshotPath);
    add('ASSET_QA','broken_images', report.brokenImages.length === 0 ? 'PASS':'FAIL', vp.name,
      report.brokenImages.length === 0 ? 'All rendered images load' : `${report.brokenImages.length} broken images`, { broken:0 }, { broken:report.brokenImages }, 'CRITICAL', 'img', screenshotPath);
    add('TECHNICAL_QA','runtime_errors', consoleErrors.length + pageErrors.length === 0 ? 'PASS':'FAIL', vp.name,
      consoleErrors.length + pageErrors.length === 0 ? 'No browser runtime errors' : 'Browser errors detected', { errors:0 }, { consoleErrors, pageErrors }, 'ERROR', null, screenshotPath);
    add('TECHNICAL_QA','failed_requests', failedRequests.length === 0 ? 'PASS':'WARN', vp.name,
      failedRequests.length === 0 ? 'No failed network requests' : `${failedRequests.length} failed network requests`, { failed:0 }, { failedRequests:failedRequests.slice(0,20) }, 'WARNING', null, screenshotPath);

    const textContrast = await page.evaluate(() => {
      const parse = value => { const m=String(value).match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i); return m?[+m[1],+m[2],+m[3]]:null; };
      const nodes=[...document.querySelectorAll('h1,h2,h3,p,a,button,small,span')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden'&&(el.textContent||'').trim();});
      return nodes.slice(0,200).map(el=>({text:(el.textContent||'').trim().slice(0,70),fg:parse(getComputedStyle(el).color),bg:parse(getComputedStyle(el).backgroundColor),fontSize:parseFloat(getComputedStyle(el).fontSize),fontWeight:parseInt(getComputedStyle(el).fontWeight)||400}));
    });
    const contrastProblems = textContrast.filter(x => x.fg && x.bg && x.bg.some(v => v !== 0)).map(x => ({...x, ratio:contrastRatio(x.fg,x.bg)})).filter(x => x.ratio < (x.fontSize >= 18 || (x.fontSize >= 14 && x.fontWeight >= 700) ? 3 : 4.5)).slice(0,20);
    add('ACCESSIBILITY_QA','text_contrast', contrastProblems.length === 0 ? 'PASS':'WARN', vp.name,
      contrastProblems.length === 0 ? 'No obvious text contrast failures on opaque backgrounds' : `${contrastProblems.length} possible contrast problems`, {}, { problems:contrastProblems }, 'WARNING', null, screenshotPath);

    await page.close();
  }
} finally {
  await browser.close();
}

const categories = [...new Set(checks.map(c => c.category))];
const byCategory = Object.fromEntries(categories.map(cat => {
  const rows = checks.filter(c => c.category === cat);
  return [cat, { pass:rows.filter(c=>c.status==='PASS').length, warn:rows.filter(c=>c.status==='WARN').length, fail:rows.filter(c=>c.status==='FAIL').length }];
}));
const summary = {
  target_url: targetUrl,
  scope,
  template_key: templateKey,
  status: criticalFailures().length ? 'FAIL' : errorFailures().length ? 'REVIEW' : 'PASS',
  total_checks: checks.length,
  critical_failures: criticalFailures().length,
  error_failures: errorFailures().length,
  warnings: checks.filter(c=>c.status==='WARN').length,
  categories: byCategory,
  viewports: VIEWPORTS,
  generated_at: new Date().toISOString()
};

await fs.writeFile(path.join(outputDir,'qa-report.json'), JSON.stringify({ summary, checks }, null, 2));
await fs.writeFile(path.join(outputDir,'qa-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.status === 'FAIL') process.exitCode = 2;
