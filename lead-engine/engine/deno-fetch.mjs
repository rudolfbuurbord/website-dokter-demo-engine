import {checkedURL,isPublicIPv4} from './website.mjs';

// Edge Runtime does not implement Node's lookup override/SNI options consistently.
// Connect to the validated IP, then negotiate TLS against the original hostname.
export function decodeHTTP(bytes,maxBytes=750000) {
  const marker=new Uint8Array([13,10,13,10]);let boundary=-1;
  for(let i=0;i<Math.min(bytes.length-3,32768);i++)if(marker.every((v,j)=>bytes[i+j]===v)){boundary=i;break;}
  if(boundary<0)throw Object.assign(new Error('INVALID_HTTP_HEADERS'),{code:'INVALID_HTTP'});
  const head=new TextDecoder().decode(bytes.subarray(0,boundary));
  const lines=head.split('\r\n');const status=Number(lines.shift()?.match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);
  if(!status)throw Object.assign(new Error('INVALID_HTTP_STATUS'),{code:'INVALID_HTTP'});
  const headers={};for(const line of lines){const pos=line.indexOf(':');if(pos<=0)throw new Error('INVALID_HTTP_HEADER');const k=line.slice(0,pos).toLowerCase();if(headers[k]!==undefined)headers[k]+=', '+line.slice(pos+1).trim();else headers[k]=line.slice(pos+1).trim();}
  if(headers['content-encoding'] && headers['content-encoding']!=='identity')throw Object.assign(new Error('UNSUPPORTED_CONTENT_ENCODING'),{code:'NOT_HTML'});
  let body=bytes.subarray(boundary+4);
  if(headers['transfer-encoding']){
    if(headers['transfer-encoding'].toLowerCase()!=='chunked')throw new Error('UNSUPPORTED_TRANSFER_ENCODING');
    const chunks=[];let off=0,total=0,ended=false;
    while(off<body.length){let end=off;while(end<body.length-1 && !(body[end]===13 && body[end+1]===10))end++;
      const line=new TextDecoder().decode(body.subarray(off,end)).split(';')[0];
      if(!/^[0-9a-f]+$/i.test(line))throw new Error('INVALID_HTTP_CHUNK');
      const size=parseInt(line,16);off=end+2;if(size===0){ended=true;break;}
      if(off+size+2>body.length || body[off+size]!==13 || body[off+size+1]!==10)throw new Error('TRUNCATED_HTTP_CHUNK');
      total+=size;if(total>maxBytes)throw Object.assign(new Error('BODY_TOO_LARGE'),{code:'BODY_TOO_LARGE'});
      chunks.push(body.subarray(off,off+size));off+=size+2;
    }
    if(!ended)throw new Error('TRUNCATED_CHUNKED_BODY');
    body=new Uint8Array(total);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}
  }else if(headers['content-length']!==undefined){
    if(!/^\d+$/.test(headers['content-length']) || Number(headers['content-length'])!==body.length)throw new Error('TRUNCATED_HTTP_BODY');
  }
  if(body.length>maxBytes)throw Object.assign(new Error('BODY_TOO_LARGE'),{code:'BODY_TOO_LARGE'});
  return {status,location:headers.location,type:headers['content-type']||'',body:new TextDecoder().decode(body)};
}

export async function safeFetchDeno(input) {
  let url=checkedURL(input);
  for(let redirect=0;redirect<=3;redirect++){
    const addresses=await Deno.resolveDns(url.hostname,'A');
    if(!addresses.length || addresses.some(a=>!isPublicIPv4(a)))throw Object.assign(new Error('DNS_NOT_PUBLIC'),{code:'URL_BLOCKED'});
    let connection;let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;try{connection?.close();}catch{}},12000);
    let result;
    try{
      connection=await Deno.connect({hostname:addresses[0],port:443});
      if(timedOut)throw Object.assign(new Error('FETCH_TIMEOUT'),{code:'ETIMEDOUT'});
      connection=await Deno.startTls(connection,{hostname:url.hostname,alpnProtocols:['http/1.1']});
      const wire=new TextEncoder().encode(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\nUser-Agent: DeWebsiteDokter-Research/1.0\r\nAccept: text/html\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`);
      let sent=0;while(sent<wire.length)sent+=await connection.write(wire.subarray(sent));
      const chunks=[];let total=0;
      while(true){const buffer=new Uint8Array(16384);const n=await connection.read(buffer);if(n===null)break;total+=n;if(total>850000)throw Object.assign(new Error('BODY_TOO_LARGE'),{code:'BODY_TOO_LARGE'});chunks.push(buffer.slice(0,n));}
      const all=new Uint8Array(total);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
      result=decodeHTTP(all);
    }catch(e){if(timedOut)throw Object.assign(new Error('FETCH_TIMEOUT'),{code:'ETIMEDOUT'});throw e;}
    finally{clearTimeout(timer);try{connection?.close();}catch{}}
    if(result.status>=300 && result.status<400 && result.location){url=checkedURL(new URL(result.location,url).href);continue;}
    if(!result.type.toLowerCase().includes('text/html'))throw Object.assign(new Error('NOT_HTML'),{code:'NOT_HTML'});
    return {...result,url:url.href};
  }
  throw Object.assign(new Error('TOO_MANY_REDIRECTS'),{code:'REDIRECT_LIMIT'});
}
