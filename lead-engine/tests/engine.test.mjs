import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {isPublicIPv4,checkedURL,inspectHTML,safeFetch,auditWebsite} from '../engine/website.mjs';
import {runOne} from '../engine/worker.mjs';
import {createHandler} from '../engine/api.mjs';
import {decodeHTTP} from '../engine/deno-fetch.mjs';

test('SSRF: rejects private, loopback, link local, reserved and IPv6 addresses',()=>{
 for(const ip of ['127.0.0.1','10.1.1.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.0.1','192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','::1','::ffff:127.0.0.1']) assert.equal(isPublicIPv4(ip),false,ip);
 assert.equal(isPublicIPv4('93.184.216.34'),true);
});
test('SSRF: requires public https hostname and normal port',()=>{
 for(const url of ['http://example.com','https://localhost','https://127.0.0.1','https://foo.invalid','https://foo.internal','https://foo.com:8080','https://user:pass@foo.com','file:///etc/passwd'])assert.throws(()=>checkedURL(url));
 assert.equal(checkedURL('https://www.example.com/contact').hostname,'www.example.com');
});
test('SSRF: DNS with private address never opens a connection',async()=>{
 let called=false;await assert.rejects(safeFetch('https://example.com',{resolve:async()=>[{address:'127.0.0.1'}],request:()=>{called=true;}}),/DNS_NOT_PUBLIC/);assert.equal(called,false);
});
test('SSRF: connection is pinned to the checked IP and TLS retains the original hostname',async()=>{
 let pinned;const request=(url,options,cb)=>{
  pinned=url.hostname;assert.equal(options.servername,'example.com');assert.equal(options.headers.Host,'example.com');
  const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'text/html'};cb(res);res.emit('data',Buffer.from('<title>Safe</title>'));res.emit('end');req.emit('close');};req.destroy=e=>req.emit('error',e);return req;
 };
 const r=await safeFetch('https://example.com',{resolve:async()=>[{address:'93.184.216.34'}],request});assert.equal(pinned,'93.184.216.34');assert.equal(r.status,200);
});
test('SSRF: redirect back into private network is revalidated',async()=>{
 const request=(_u,_o,cb)=>{const req=new EventEmitter();req.end=()=>{cb({statusCode:302,headers:{location:'https://127.0.0.1/'},resume(){}});req.emit('close');};return req;};
 await assert.rejects(safeFetch('https://example.com',{resolve:async()=>[{address:'93.184.216.34'}],request}),/URL_NOT_PUBLIC_HTTPS/);
});
test('HTML observations extract actual contacts but make no verification claims',()=>{
 const r=inspectHTML('<title>Schilder</title><script>"mailto:fake@fake.com"</script><h1>Hallo</h1><a href="mailto:info@bedrijf.nl?subject=hoi">mail</a><a href="tel:+31612345678">bel</a><a href="/contact">Contact</a><meta name="viewport" content="width=device-width"><form></form>','https://bedrijf.nl');
 assert.deepEqual(r.findings.emails,['info@bedrijf.nl']);assert.equal(r.findings.html_has_form,true);assert.equal(r.findings.html_has_viewport,true);assert.deepEqual(r.findings.contact_pages,['https://bedrijf.nl/contact']);assert.equal(r.findings.verification_status,undefined);
});
test('script-only website is not falsely assessed as visually poor',()=>{
 const r=inspectHTML('<html><script>renderApp()</script></html>','https://bedrijf.nl');assert.equal(r.findings.visual_score,undefined);assert.equal(r.findings.mobile_quality,undefined);
});
test('worker commits public contacts and audit under claimed lease',async()=>{
 const calls=[];const rpc=async(a,p)=>{calls.push({a,p});return a==='claim_job'?{id:'j',company_id:'c',lease_token:'t',input:{url:'https://bedrijf.nl'}}:{ok:true};};
 await runOne(rpc,{audit:async()=>({status:'OK',findings:{source_url:'https://bedrijf.nl',emails:['info@bedrijf.nl'],phones:['+31612345678']}})});
 assert.equal(calls.filter(x=>x.a==='contact').length,2);assert.equal(calls.at(-1).p.lease_token,'t');assert.equal(calls.at(-1).p.outcome,'SUCCEEDED');assert.ok(!calls.some(x=>x.a==='verification'));
});
test('worker does not import contacts from a failed HTTP page',async()=>{
 const calls=[];const rpc=async(a,p)=>{calls.push({a,p});return a==='claim_job'?{id:'j',company_id:'c',lease_token:'t',input:{url:'https://bedrijf.nl'}}:{};};
 await runOne(rpc,{audit:async()=>({status:'UNREACHABLE',findings:{emails:['info@errorpage.nl']}})});assert.ok(!calls.some(x=>x.a==='contact'));
});
test('worker routes permanent failures to blocked and temporary errors to retry',async()=>{
 for(const [code,outcome] of [['URL_BLOCKED','BLOCKED'],['ETIMEDOUT','RETRY']]){
 const calls=[];const rpc=async(a,p)=>{calls.push({a,p});return a==='claim_job'?{id:'j',lease_token:'t',input:{url:'https://bedrijf.nl'}}:{};};
 await runOne(rpc,{audit:async()=>{throw Object.assign(new Error(code),{code});}});assert.equal(calls.at(-1).p.outcome,outcome);
 }
});
test('API refuses unauthenticated and ordinary user tokens before database call',async()=>{
 let called=false;const handler=createHandler({key:'test-service-only',rpc:async()=>{called=true;}});
 for(const auth of ['', 'Bearer user-jwt']){const r=await handler(new Request('https://api.example.com',{method:'POST',headers:{authorization:auth},body:'{"action":"status"}'}));assert.equal(r.status,401);}assert.equal(called,false);
});
test('API accepts internal status request',async()=>{
 const handler=createHandler({key:'test-service-only',rpc:async(a)=>({action:a})});
 const r=await handler(new Request('https://api.example.com',{method:'POST',headers:{authorization:'Bearer test-service-only'},body:'{"action":"status"}'}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{action:'status'});
});
test('API caps body size and rejects malformed JSON',async()=>{
 const h=createHandler({key:'test',rpc:async()=>({})});
 for(const [body,status] of [['x'.repeat(262145),413],['no-json',400]])assert.equal((await h(new Request('https://api.example.com',{method:'POST',headers:{authorization:'Bearer test'},body}))).status,status);
});
test('edge HTTP decoder handles content length and chunked bodies',()=>{
 const enc=new TextEncoder();
 assert.equal(decodeHTTP(enc.encode('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 5\r\n\r\nhello')).body,'hello');
 assert.equal(decodeHTTP(enc.encode('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n')).body,'hello');
});
test('edge HTTP decoder refuses truncated or oversized content',()=>{
 const enc=new TextEncoder();
 assert.throws(()=>decodeHTTP(enc.encode('HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nhello')),/TRUNCATED/);
 assert.throws(()=>decodeHTTP(enc.encode('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhi')),/TRUNCATED/);
 assert.throws(()=>decodeHTTP(enc.encode('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello'),4),/BODY_TOO_LARGE/);
});
test('worker credential can only invoke explicitly allowed scopes',async()=>{
 const token='le_worker_'+'a'.repeat(64);const calls=[];
 const rpc=async(action,p)=>{calls.push(action);if(action==='authenticate_worker')return {allowed:p.action==='status'};return {ok:true};};
 const h=createHandler({key:'service-test',rpc});
 for(const [action,expected] of [['status',200],['ingest',401],['prepare_dispatch',401]]){
 const res=await h(new Request('https://api.example.com',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({action})}));assert.equal(res.status,expected);
 }
 assert.ok(!calls.includes('ingest'));assert.ok(!calls.includes('prepare_dispatch'));
});
test('contact page discovery retains the exact source URL',async()=>{
 const fetcher=async url=>({url,status:200,body:url.endsWith('/contact')?'<a href="mailto:eigenaar@bedrijf.nl">Mail</a>':'<a href="/contact">Contact</a>'});
 const output=await auditWebsite('https://bedrijf.nl',fetcher);
 assert.deepEqual(output.findings.contact_observations,[{kind:'EMAIL',value:'eigenaar@bedrijf.nl',source_url:'https://bedrijf.nl/contact'}]);
});
test('cross-domain redirect does not attach third-party email to company',async()=>{
 const output=await auditWebsite('https://bedrijf.nl',async()=>({url:'https://parking.nl',status:200,body:'<a href="mailto:info@parking.nl">Contact</a>'}));
 assert.deepEqual(output.findings.emails,[]);assert.equal(output.findings.contact_import_blocked,'CROSS_DOMAIN_REDIRECT_REQUIRES_REVIEW');
});
