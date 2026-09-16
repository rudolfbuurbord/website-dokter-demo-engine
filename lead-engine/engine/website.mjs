import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';

// IPv4-only pinned connections avoid DNS rebinding and IPv4-mapped IPv6 ambiguity.
// Unusual/IPv6-only hosts are reported as blocked instead of silently bypassing this rule.
export function isPublicIPv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a,b,c] = ip.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 ||
    (a===100 && b>=64 && b<=127) || (a===169 && b===254) ||
    (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0 || (b===88 && c===99))) ||
    (a===198 && (b===18 || b===19 || (b===51 && c===100))) ||
    (a===203 && b===0 && c===113));
}

export function checkedURL(input) {
  const u = new URL(input);
  if (u.protocol!=='https:' || u.username || u.password || (u.port && u.port!=='443') ||
      isIP(u.hostname) || !u.hostname.includes('.') ||
      /\.(invalid|localhost|local|internal|test|example)$/i.test(u.hostname)) {
    throw Object.assign(new Error('URL_NOT_PUBLIC_HTTPS'), {code:'URL_BLOCKED'});
  }
  return u;
}

export async function safeFetch(input, {resolve=lookup, request=https.request, maxBytes=750000, redirects=3}={}) {
  let u=checkedURL(input);
  for(let hop=0; hop<=redirects; hop++) {
    const addresses=await resolve(u.hostname,{all:true,family:4});
    if(!addresses.length || addresses.some(x=>!isPublicIPv4(x.address)))
      throw Object.assign(new Error('DNS_NOT_PUBLIC'),{code:'URL_BLOCKED'});
    const pinned=addresses[0].address;
    const result=await new Promise((res,rej)=>{
      const pinnedURL=new URL(u);pinnedURL.hostname=pinned;
      const req=request(pinnedURL,{
        method:'GET', agent:false, servername:u.hostname,
        headers:{Host:u.hostname,'User-Agent':'DeWebsiteDokter-Research/1.0','Accept':'text/html','Accept-Encoding':'identity'},
      }, response=>{
        if(response.statusCode>=300 && response.statusCode<400) {
          response.resume();res({status:response.statusCode,location:response.headers.location});return;
        }
        const chunks=[];let size=0;
        response.on('data',chunk=>{
          size+=chunk.length;
          if(size>maxBytes) {req.destroy(Object.assign(new Error('BODY_TOO_LARGE'),{code:'BODY_TOO_LARGE'}));return;}
          chunks.push(chunk);
        });
        response.on('error',rej);
        response.on('end',()=>res({status:response.statusCode,type:response.headers['content-type']||'',body:Buffer.concat(chunks).toString('utf8')}));
      });
      const deadline=setTimeout(()=>req.destroy(Object.assign(new Error('FETCH_TIMEOUT'),{code:'ETIMEDOUT'})),12000);
      req.on('close',()=>clearTimeout(deadline));req.on('error',rej);req.end();
    });
    if(result.location) {u=checkedURL(new URL(result.location,u).href);continue;}
    if(!result.type?.toLowerCase().includes('text/html')) throw Object.assign(new Error('NOT_HTML'),{code:'NOT_HTML'});
    return {...result,url:u.href};
  }
  throw Object.assign(new Error('TOO_MANY_REDIRECTS'),{code:'REDIRECT_LIMIT'});
}

const strip=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export function inspectHTML(html,url,status=200) {
  const clean=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'');
  const links=[...clean.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map(x=>x[1]);
  const emails=[...new Set(links.filter(x=>/^mailto:/i.test(x)).map(x=>{
    try{return decodeURIComponent(x.slice(7).split('?')[0]).toLowerCase().trim();}catch{return '';}
  }).filter(x=>/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(x)))].slice(0,20);
  const phones=[...new Set(links.filter(x=>/^tel:/i.test(x)).map(x=>x.slice(4).trim()).filter(x=>/^[+\d() .-]{6,30}$/.test(x)))].slice(0,20);
  const contactPages=[...new Set(links.filter(x=>/contact|over-ons|about/i.test(x)).map(x=>{
    try{const u=new URL(x,url);return u.origin===new URL(url).origin && u.protocol==='https:' ? u.href : null;}catch{return null;}
  }).filter(Boolean))].slice(0,5);
  return {status:status>=200 && status<300?'OK':'UNREACHABLE',method_version:'static-html-v1',findings:{
    source_url:url,http_status:status,title:strip(clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]).slice(0,300),
    h1:[...clean.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(x=>strip(x[1]).slice(0,300)).slice(0,10),
    html_has_viewport:/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(clean),
    html_has_form:/<form\b/i.test(clean),emails,phones,contact_pages:contactPages,
    limitation:'Static HTML observations only. No visual quality, mobile rendering, performance score, ownership or email verification inferred.'
  }};
}

export async function auditWebsite(url,fetcher=safeFetch) {
  const r=await fetcher(url);const home=inspectHTML(r.body,r.url,r.status);
  const normalHost=u=>new URL(u).hostname.replace(/^www\./,'');
  if(normalHost(url)!==normalHost(r.url)){
    home.findings.emails=[];home.findings.phones=[];
    home.findings.contact_import_blocked='CROSS_DOMAIN_REDIRECT_REQUIRES_REVIEW';
    return home;
  }
  const pages=[home];home.findings.page_errors=[];
  if(home.status==='OK')for(const page of home.findings.contact_pages.slice(0,2)){
    try{const p=await fetcher(page);if(normalHost(p.url)!==normalHost(r.url))throw new Error('CROSS_DOMAIN_CONTACT_REDIRECT');pages.push(inspectHTML(p.body,p.url,p.status));}
    catch(e){home.findings.page_errors.push({url:page,error:e.code||'CONTACT_PAGE_FAILED'});}
  }
  home.findings.contact_observations=pages.filter(p=>p.status==='OK').flatMap(p=>[
    ...p.findings.emails.map(value=>({kind:'EMAIL',value,source_url:p.findings.source_url})),
    ...p.findings.phones.map(value=>({kind:'PHONE',value,source_url:p.findings.source_url}))
  ]).slice(0,30);
  home.findings.pages_checked=pages.map(p=>({url:p.findings.source_url,http_status:p.findings.http_status}));
  return home;
}
