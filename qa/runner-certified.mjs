import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));
const targetUrl = String(args.url || process.env.QA_URL || '');
const scope = String(args.scope || process.env.QA_SCOPE || 'prospect').toUpperCase();
const templateKey = String(args.template || process.env.QA_TEMPLATE || 'unknown');
const outputDir = path.resolve(args.output || process.env.QA_OUTPUT || 'qa-results');
if (!targetUrl) throw new Error('Missing --url=<url>');

const VIEWPORTS = [
  { name: 'desktop_1440', width: 1440, height: 1000 },
  { name: 'laptop_1280', width: 1280, height: 900 },
  { name: 'tablet_768', width: 768, height: 1024 },
  { name: 'mobile_390', width: 390, height: 844 }
];
const checks = [];
const add = (category, key, status, viewport, message, severity = 'ERROR', actual = {}) => checks.push({ category, check_key: key, status, severity, viewport, message, actual });
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const consoleErrors = [], pageErrors = [], failedRequests = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('requestfailed', req => failedRequests.push({ url: req.url(), error: req.failure()?.errorText }));
    const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      const step = Math.max(500, Math.floor(innerHeight * .75));
      const maxY = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      for (let y = 0; y < maxY; y += step) { scrollTo(0, y); await new Promise(r => setTimeout(r, 45)); }
      scrollTo(0, maxY); await new Promise(r => setTimeout(r, 120)); scrollTo(0, 0);
    });
    await page.waitForTimeout(120);
    const screenshot = path.join(outputDir, `${vp.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });

    const r = await page.evaluate(({ width, height }) => {
      const visible = el => { const s=getComputedStyle(el),b=el.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>.01&&b.width>1&&b.height>1; };
      const box = el => { const b=el.getBoundingClientRect(); return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}; };
      const all=[...document.querySelectorAll('body *')].filter(visible);
      const interactive=all.filter(el=>el.matches('a,button,input,select,textarea,[role="button"]'));
      const texts=all.filter(el=>el.childElementCount===0&&(el.textContent||'').trim().length>0);
      const overflowPx=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-width;
      const overflowEls=all.map(el=>({el,b:box(el)})).filter(x=>x.b.right>width+2||x.b.left<-2).slice(0,20).map(x=>({tag:x.el.tagName,cls:x.el.className,text:(x.el.textContent||'').trim().slice(0,80),box:x.b}));
      const clipped=texts.map(el=>{const b=box(el),p=el.parentElement,ps=p?getComputedStyle(p):null,pb=p?box(p):null,s=getComputedStyle(el);const clips=(s.overflow==='hidden'||ps?.overflow==='hidden')&&pb&&(b.right>pb.right+1||b.left<pb.left-1||b.bottom>pb.bottom+1||b.top<pb.top-1);return clips?{tag:el.tagName,cls:el.className,text:(el.textContent||'').trim().slice(0,100),box:b,parent:pb}:null;}).filter(Boolean).slice(0,20);
      const smallText=texts.map(el=>({el,size:parseFloat(getComputedStyle(el).fontSize),text:(el.textContent||'').trim()})).filter(x=>x.size<11&&x.text.length>2).slice(0,20).map(x=>({size:x.size,text:x.text.slice(0,80),tag:x.el.tagName,cls:x.el.className}));
      const tinyTargets=interactive.map(el=>({el,b:box(el)})).filter(x=>x.b.width<40||x.b.height<40).slice(0,20).map(x=>({tag:x.el.tagName,cls:x.el.className,text:(x.el.textContent||'').trim().slice(0,80),box:x.b}));
      const candidates=all.filter(el=>el.matches('h1,h2,h3,p,a,button,.btn,.service-card,.review,.project,.float-card,.color-chip')).slice(0,140); const overlaps=[];
      for(let i=0;i<candidates.length;i++){for(let j=i+1;j<candidates.length;j++){const a=candidates[i],b=candidates[j];if(a.contains(b)||b.contains(a))continue;const A=box(a),B=box(b),ix=Math.max(0,Math.min(A.right,B.right)-Math.max(A.left,B.left)),iy=Math.max(0,Math.min(A.bottom,B.bottom)-Math.max(A.top,B.top));if(ix*iy>12)overlaps.push({a:{tag:a.tagName,cls:a.className,text:(a.textContent||'').trim().slice(0,60),box:A},b:{tag:b.tagName,cls:b.className,text:(b.textContent||'').trim().slice(0,60),box:B},area:ix*iy});if(overlaps.length>=25)break;}}
      const tight=[]; const flow=['.hero-copy','section .section-head','.process-item>div','.review','.cta-card>div','.service-card>div'];
      for(const parent of document.querySelectorAll(flow.join(','))){const kids=[...parent.children].filter(visible).filter(el=>el.matches('h1,h2,h3,p,.hero-actions,.stats,.contact-lines,.kicker,footer'));for(let i=0;i<kids.length-1;i++){const A=box(kids[i]),B=box(kids[i+1]),horizontal=Math.max(0,Math.min(A.right,B.right)-Math.max(A.left,B.left)),gap=B.top-A.bottom;if(horizontal>12&&gap>=0&&gap<6)tight.push({a:kids[i].className||kids[i].tagName,b:kids[i+1].className||kids[i+1].tagName,gap});}}
      const hero=document.querySelector('header.hero,.hero,header'); const h1=document.querySelector('h1');
      const firstFold=interactive.filter(el=>box(el).top<height).map(el=>({text:(el.textContent||'').trim(),box:box(el)}));
      const trust=all.filter(el=>/(review|klant|google|ster|rating|ervaring|project|jaar|vakman|keurmerk)/i.test((el.textContent||'').trim())).filter(el=>box(el).top<height*1.6).slice(0,15).map(el=>({text:(el.textContent||'').trim().slice(0,100),box:box(el)}));
      const images=[...document.images].filter(visible).map(img=>({src:img.currentSrc||img.src,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,alt:img.alt,box:box(img)}));
      return {overflowPx,overflowEls,clipped,smallText,tinyTargets,overlaps,tight,hero:hero&&visible(hero)?box(hero):null,h1:h1&&visible(h1)?{text:(h1.textContent||'').trim(),box:box(h1)}:null,firstFold,trust,brokenImages:images.filter(x=>!x.naturalWidth||!x.naturalHeight),title:document.title};
    }, { width: vp.width, height: vp.height });

    add('TECHNICAL_QA','http_status',response?.ok()?'PASS':'FAIL',vp.name,response?`HTTP ${response.status()}`:'No response','CRITICAL',{status:response?.status()});
    add('TECHNICAL_QA','runtime_errors',consoleErrors.length+pageErrors.length===0?'PASS':'FAIL',vp.name,'Browser runtime errors','ERROR',{consoleErrors,pageErrors});
    add('TECHNICAL_QA','failed_requests',failedRequests.length===0?'PASS':'WARN',vp.name,failedRequests.length?'Failed network requests':'No failed requests','WARNING',{failedRequests});
    add('LAYOUT_QA','horizontal_overflow',r.overflowPx<=2?'PASS':'FAIL',vp.name,r.overflowPx<=2?'No horizontal overflow':`${r.overflowPx}px overflow`,'CRITICAL',{overflowPx:r.overflowPx,elements:r.overflowEls});
    add('LAYOUT_QA','unexpected_overlap',r.overlaps.length===0?'PASS':'FAIL',vp.name,r.overlaps.length?'Content collisions detected':'No content collisions','CRITICAL',{overlaps:r.overlaps});
    add('LAYOUT_QA','minimum_spacing',r.tight.length===0?'PASS':'WARN',vp.name,r.tight.length?'Tight content gaps':'Content spacing healthy','WARNING',{pairs:r.tight});
    add('CONTENT_QA','text_containment',r.clipped.length===0?'PASS':'FAIL',vp.name,r.clipped.length?'Clipped text detected':'Text stays inside containers','CRITICAL',{clipped:r.clipped});
    add('CONTENT_QA','minimum_text_size',r.smallText.length===0?'PASS':'WARN',vp.name,r.smallText.length?'Text below 11px':'Readable text sizing','WARNING',{nodes:r.smallText});
    add('INTERACTION_QA','tap_target_size',vp.width>768||r.tinyTargets.length===0?'PASS':'WARN',vp.name,r.tinyTargets.length?'Small mobile targets':'Tap targets acceptable','WARNING',{targets:r.tinyTargets});
    add('RESPONSIVE_QA','hero_visible',r.hero?'PASS':'FAIL',vp.name,r.hero?'Hero visible':'Hero missing','CRITICAL',{hero:r.hero});
    add('CONVERSION_QA','primary_cta_above_fold',r.firstFold.length?'PASS':'FAIL',vp.name,r.firstFold.length?'CTA visible above fold':'No CTA above fold','CRITICAL',{ctas:r.firstFold.slice(0,8)});
    add('CONVERSION_QA','hero_message_present',r.h1?.text?.length>=8?'PASS':'FAIL',vp.name,r.h1?'Hero message present':'Missing hero message','CRITICAL',{h1:r.h1});
    add('CONVERSION_QA','early_trust_signal',r.trust.length?'PASS':'WARN',vp.name,r.trust.length?'Early trust signal detected':'No early trust signal','WARNING',{signals:r.trust});
    add('ASSET_QA','broken_images',r.brokenImages.length===0?'PASS':'FAIL',vp.name,r.brokenImages.length?'Broken images detected':'All images load','CRITICAL',{broken:r.brokenImages});
    await page.close();
  }
} finally { await browser.close(); }

const critical = checks.filter(c=>c.status==='FAIL'&&c.severity==='CRITICAL').length;
const errors = checks.filter(c=>c.status==='FAIL'&&['CRITICAL','ERROR'].includes(c.severity)).length;
const warnings = checks.filter(c=>c.status==='WARN').length;
const status = critical ? 'FAIL' : errors ? 'REVIEW' : warnings ? 'PASS_WITH_WARNINGS' : 'PASS';
const summary = { target_url:targetUrl, scope, template_key:templateKey, status, total_checks:checks.length, critical_failures:critical, error_failures:errors, warnings, viewports:VIEWPORTS, generated_at:new Date().toISOString() };
await fs.writeFile(path.join(outputDir,'qa-report.json'),JSON.stringify({summary,checks},null,2));
await fs.writeFile(path.join(outputDir,'qa-summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
if (status === 'FAIL' || status === 'REVIEW') process.exitCode = 2;
