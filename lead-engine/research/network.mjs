import http from 'node:http';
import net from 'node:net';
import {lookup} from 'node:dns/promises';
import {isPublicIPv4} from '../engine/website.mjs';
export async function publicAddress(host,resolve=lookup){
 const records=await resolve(host,{all:true,family:4});
 if(!records.length||records.some(r=>!isPublicIPv4(r.address))) throw new Error('NON_PUBLIC_DESTINATION');
 return records[0].address;
}
export function webURL(value){
 const u=new URL(value);
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))throw new Error('UNSAFE_URL');
 return u;
}
// All Chromium HTTP(S) traffic goes through this loopback proxy. Connections pin DNS.
// IPv6-only destinations are explicitly unsupported, never bypassed.
export async function startProxy(){
 const sockets=new Set();
 const server=http.createServer(async(req,res)=>{
  try{
   const u=webURL(req.url);if(req.method!=='GET'||u.protocol!=='http:')throw new Error('READ_ONLY');
   const address=await publicAddress(u.hostname);
   const upstream=http.request({host:address,port:80,path:u.pathname+u.search,method:'GET',headers:{...req.headers,host:u.host},timeout:15000},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
   upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end();
  }catch{res.writeHead(403);res.end();}
 });
 server.on('connect',async(req,client,head)=>{
  try{
   const u=webURL('https://'+req.url);if(u.port&&u.port!=='443')throw new Error('PORT_BLOCKED');
   const ip=await publicAddress(u.hostname);
   const remote=net.connect({host:ip,port:443});sockets.add(remote);remote.on('close',()=>sockets.delete(remote));
   remote.setTimeout(20000,()=>remote.destroy());remote.on('error',()=>client.destroy());client.on('error',()=>remote.destroy());client.on('close',()=>remote.destroy());
   remote.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);});
  }catch{client.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
 });
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
