import {chromium} from 'playwright';
import {startProxy,webURL} from './network.mjs';
const host=u=>new URL(u).hostname.replace(/^www\./,'');
export async function capture(url){
 webURL(url);const proxy=await startProxy();let browser;
 const pages=[],images=[],limitations=['No form submission, performance benchmark or comprehensive link audit.','Blocked POST requests, media and websocket traffic may affect rendering; never infer defects from capture failures.'];
 try{
  browser=await chromium.launch({headless:true,chromiumSandbox:true,proxy:{server:proxy.url,bypass:'<-loopback>'},env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8'},args:['--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
  const context=await browser.newContext({viewport:{width:1365,height:900},serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*',route=>{
   const req=route.request();let valid=false;try{webURL(req.url());valid=req.method()==='GET'&&!['media'].includes(req.resourceType());}catch{}
   return valid?route.continue():route.abort();
  });
  await context.routeWebSocket(/.*/,socket=>socket.close());
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const visit=async(target,label,visual=true)=>{
   let response;
   try{response=await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000});}
   catch(e){if(e.name!=='TimeoutError'||page.url()==='about:blank')throw e; limitations.push('Navigation timeout; inspecting already loaded DOM once.');}
   // Refuse optional cookies only; never click CAPTCHA or security challenges.
   for(const label of [/^(Alles weigeren|Alle cookies weigeren|Weigeren|Reject all|Decline all)$/i]){
    const button=page.getByRole('button',{name:label}).first();
    if(await button.isVisible().catch(()=>false))await button.click({timeout:1000}).catch(()=>{});
   }
   await page.waitForLoadState('load',{timeout:5000}).catch(()=>limitations.push('Load event not reached for '+label));
   if(host(page.url())!==host(url))throw new Error('CROSS_DOMAIN_REDIRECT_REVIEW');
   const status=response?.status()??null;
   const data=await page.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText.slice(0,12000),links:Array.from(document.querySelectorAll('a[href]'),a=>({url:a.href,text:a.innerText.slice(0,100)})).slice(0,300),forms:document.forms.length}));
   pages.push({...data,status,observed_at:new Date().toISOString(),label});
   if(status>=400||/captcha|verify you are human|checking your browser|access denied/i.test(data.title+' '+data.text.slice(0,500)))throw new Error('CAPTURE_BLOCKED_OR_HTTP_ERROR');
   if(visual){
    for(const [part,y] of [['top',0],['middle',900],['lower',1800]]){
     await page.evaluate(y=>window.scrollTo(0,y),y);
     await page.waitForTimeout(350);
     const bytes=await page.screenshot({type:'jpeg',quality:65,fullPage:false,timeout:10000});
     images.push({label:label+'-'+part,url:page.url(),observed_at:new Date().toISOString(),bytes});
    }
   }
   return data;
  };
  const home=new URL('/',url).href;
  let data=await visit(home,'homepage');
  if(new URL(url).pathname!=='/')await visit(url,'supplied-page');
  const contact=data.links.find(l=>/contact/i.test(l.text+' '+l.url)&&/^https?:/.test(l.url)&&host(l.url)===host(url));
  if(contact&&!pages.some(p=>p.url===contact.url)){
   try{await visit(contact.url,'contact',false);}catch{limitations.push('Contact page could not be inspected.');}
  }
  const contacts=pages.flatMap(p=>p.links.filter(l=>/^mailto:|^tel:/i.test(l.url)).map(l=>({kind:/^mailto:/i.test(l.url)?'EMAIL':'PHONE',value:decodeURIComponent(l.url.split(':').slice(1).join(':').split('?')[0]),source_url:p.url,observed_at:p.observed_at}))).filter(c=>c.kind==='PHONE'?/^[+\d ()-]{6,30}$/.test(c.value):/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(c.value));
  for(const p of pages){for(const value of p.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]){if(!contacts.some(c=>c.value.toLowerCase()===value.toLowerCase()))contacts.push({kind:'EMAIL',value,source_url:p.url,observed_at:p.observed_at});}}
  return {source_url:url,pages,images,contacts,limitations,mobile_review_status:'NOT_TESTED'};
 }finally{try{await browser?.close();}finally{await proxy.close();}}
}
