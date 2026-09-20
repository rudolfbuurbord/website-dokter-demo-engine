import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const url=process.env.KK_QA_URL||'http://127.0.0.1:4173/kleur-karakter/';
const dir=process.env.KK_QA_DIR||'qa-results/kleur-karakter';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true});const checks=[];
function check(name,pass,detail=''){checks.push({name,status:pass?'PASS':'FAIL',detail});if(!pass)console.error('FAIL',name,JSON.stringify(detail));}
for(const [width,height] of [[1440,1000],[1280,900],[768,1024],[390,844]]){
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});const label=`${width}x${height}`;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700);
 const hero=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}};return {height:innerHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,hero:rect('.hero'),title:rect('h1'),art:rect('.hero-art'),copy:rect('.hero-bottom>p'),review:rect('.hero-review'),cta:rect('.round-cta')}});
 check(label+' hero information in first viewport',['title','copy','review','cta'].every(k=>hero[k].y>=0&&hero[k].bottom<=height&&hero[k].x>=0&&hero[k].right<=width),hero);
 check(label+' visual does not overlap content',hero.art.y>=hero.title.bottom-1&&hero.art.bottom<=hero.copy.y+1,hero);
 check(label+' no document overflow',hero.scrollWidth<=width+1,hero.scrollWidth);
 await page.screenshot({path:`${dir}/${label}-hero.png`});
 if(width<761){await page.getByRole('button',{name:'Menu'}).click();check(label+' mobile menu opens',await page.locator('#site-menu').isVisible());await page.locator('#site-menu').getByRole('link',{name:'Projecten'}).click();check(label+' mobile menu closes',await page.locator('.menu-toggle').getAttribute('aria-expanded')==='false');}
 await page.locator('#projecten').scrollIntoViewIfNeeded();await page.waitForTimeout(600);
 const gallery=await page.evaluate(()=>{const t=document.querySelector('.project-track'),c=t.querySelector('.active');const tr=t.getBoundingClientRect(),cr=c.getBoundingClientRect();return {delta:Math.abs((tr.left+tr.right)/2-(cr.left+cr.right)/2),x:scrollX,y:scrollY}});
 check(label+' active project centered',gallery.delta<4,gallery);
 await page.getByRole('button',{name:'Volgend project',exact:true}).click();await page.waitForTimeout(800);
 check(label+' project click does not shift document',await page.evaluate(()=>scrollX===0));
 await page.locator('#voor-na').scrollIntoViewIfNeeded();
 await page.getByRole('button',{name:'Details',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.compare-count').textContent==='02 / 03');
 check(label+' comparison text updates',(await page.locator('#before-title').innerText()).includes('verschil'));
 await page.getByRole('slider',{name:'Vergelijk voor en na'}).press('ArrowRight');
 check(label+' comparison keyboard control',await page.locator('.compare').evaluate(e=>e.style.getPropertyValue('--position')==='51%'));
 const pair=await page.locator('.compare').evaluate(e=>{const a=e.querySelector('.compare-after-image').getBoundingClientRect(),b=e.querySelector('.compare-before img').getBoundingClientRect();return {aw:a.width,bw:b.width,ah:a.height,bh:b.height,left:a.left-b.left}});
 check(label+' identical comparison geometry',pair.aw===pair.bw&&pair.ah===pair.bh&&Math.abs(pair.left)<1,pair);
 await page.screenshot({path:`${dir}/${label}-comparison.png`});
 await page.getByRole('button',{name:'Volgende vergelijking',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.compare-count').textContent==='03 / 03');
 check(label+' third comparison updates',(await page.locator('#before-title').innerText()).includes('verweerd'));
 await page.getByRole('button',{name:'Ruimte',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.compare-count').textContent==='01 / 03');
 await page.locator('.owner-portrait').scrollIntoViewIfNeeded();
 check(label+' portrait visible',await page.locator('.owner-portrait').evaluate(e=>getComputedStyle(e).clipPath==='none'&&getComputedStyle(e).opacity==='1'&&e.querySelector('img').naturalWidth>0));
 await page.locator('#reviews').scrollIntoViewIfNeeded();await page.screenshot({path:`${dir}/${label}-reviews.png`});
 await page.getByRole('button',{name:'Vraag een offerte aan',exact:true}).click();check(label+' enquiry dialog opens',await page.locator('#enquiry-dialog').isVisible());
 let transmissions=0;page.on('request',r=>{if(r.method()==='POST')transmissions++});
 await page.getByLabel('Je naam',{exact:true}).fill('Test');await page.getByLabel('E-mailadres',{exact:true}).fill('test@example.invalid');await page.getByLabel('Wat wil je laten doen?',{exact:true}).fill('Demo test — geen aanvraag.');await page.getByRole('button',{name:'Bekijk je aanvraag'}).click();
 check(label+' form truthful and non-transmitting',(await page.locator('.form-feedback').innerText()).includes('niet verstuurd')&&transmissions===0);
 await page.getByRole('button',{name:'Sluiten',exact:true}).click();check(label+' dialog closes',!(await page.locator('#enquiry-dialog').isVisible()));
 check(label+' no JS errors',errors.length===0,errors);
 check(label+' all page images loaded',await page.evaluate(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0)));
 await page.screenshot({path:`${dir}/${label}-full.png`,fullPage:true});
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload({waitUntil:'networkidle'});
 check(label+' reduced motion reveals content',await page.locator('.owner-portrait').evaluate(e=>getComputedStyle(e).clipPath==='none'));
 check(label+' reduced motion disables transitions',await page.locator('.compare').evaluate(e=>getComputedStyle(e).transitionDuration==='0s'));
 await page.close();
}
await browser.close();const failed=checks.filter(c=>c.status==='FAIL').length;await writeFile(`${dir}/report.json`,JSON.stringify({url,status:failed?'FAIL':'PASS',passed:checks.length-failed,failed,checks},null,2));console.log(JSON.stringify({passed:checks.length-failed,failed,total:checks.length}));if(failed)process.exitCode=1;
