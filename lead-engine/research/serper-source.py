"""Bounded, resumable Serper candidate sourcing. No AI calls or qualifications."""
import hashlib
import json
import os
from pathlib import Path
import urllib.request
from urllib.parse import urlsplit
from datetime import datetime, timezone

PROJECT = 'https://skdjbifmtleiogbkqwid.supabase.co'
PLACES = ['Enschede','Hengelo','Almelo','Zwolle','Deventer','Apeldoorn','Arnhem','Nijmegen','Doetinchem','Zutphen','Amersfoort','Ede','Assen','Emmen','Leeuwarden','Sneek','Groningen','Hoogeveen','Den Helder','Alkmaar']
EXCLUDE = {'trustoo.nl','werkspot.nl','zoofy.nl','yelp.nl','facebook.com','instagram.com','linkedin.com','youtube.com','google.com','google.nl','marktplaats.nl','telefoonboek.nl','openingstijden.nl','indeed.com','offerteadviseur.nl','schildersbedrijf-nu.nl'}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('REDIRECT_BLOCKED')

def read_env(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v = line.split('=',1)
            result[k.strip()] = v.strip().strip('\"\'')
    return result

def request(url, headers, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={**headers,'Content-Type':'application/json'}, method='POST')
    with urllib.request.build_opener(NoRedirect).open(req, timeout=25) as response:
        body = response.read(2_000_001)
        if len(body)>2_000_000: raise RuntimeError('RESPONSE_TOO_LARGE')
        return json.loads(body)

def candidates(data, query, page, observed):
    output=[]; seen=set()
    for row in data.get('organic',[])[:10]:
        try:
            link=row['link']; parsed=urlsplit(link)
            host=(parsed.hostname or '').lower().removeprefix('www.')
            if parsed.scheme not in ('http','https') or parsed.username or parsed.password or parsed.port not in (None,80,443): continue
            if '.' not in host or not host.isascii() or any(host==x or host.endswith('.'+x) for x in EXCLUDE): continue
            if host in seen: continue
            if not any(x in (row.get('title','')+' '+row.get('snippet','')).lower() for x in ('schilder','schilderwerk')): continue
            seen.add(host)
            output.append({'domain':host,'website':'https://'+host+'/', 'source_url':link,
                'search_title':row.get('title','')[:250],'snippet':row.get('snippet','')[:1000],
                'query':query,'requested_page':page,'provider_position':row.get('position'),
                'search_position_verification':'PROVIDER_REPORTED_ONLY','observed_at':observed})
        except (KeyError,ValueError,TypeError): continue
    return output

def main():
    env=read_env('/etc/dwd-research.env'); env.update(read_env('/etc/dwd-serper.env'))
    if env.get('SUPABASE_URL','').rstrip('/')!=PROJECT: raise RuntimeError('PROJECT_MISMATCH')
    key=env['SUPABASE_SERVICE_ROLE_KEY']; serper=env['SERPER_API_KEY']
    if not key or not serper: raise RuntimeError('KEY_MISSING')
    headers={'apikey':key,'Authorization':'Bearer '+key}
    def rpc(name,action,payload):
        return request(PROJECT+'/rest/v1/rpc/'+name,headers,{'p_action':action,'p_payload':payload})
    session=rpc('le_command','start_work',{'actor':'serper-source-v1','task':'Bounded source-only budget test; no qualification'})
    receipt=session.get('start_receipt_id')
    if not receipt or len(session.get('bibles',[]))!=4: raise RuntimeError('POLICY_REQUIRED')
    state=Path('/var/lib/dwd-budget-test/serper'); state.mkdir(parents=True,exist_ok=True,mode=0o700)
    def save(path,value):
        tmp=path.with_suffix('.tmp'); tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)); tmp.chmod(0o600); tmp.replace(path)
    save(state/'policy.json',session)
    # Page 2 first, then 3. Forty requests maximum enforced in the database across restarts.
    for page in (2,3):
        for place in PLACES:
            query='schildersbedrijf '+place
            request_key=hashlib.sha256(json.dumps([query,page,'nl','nl',10]).encode()).hexdigest()
            payload={'start_receipt_id':receipt,'request_key':request_key}
            cached=state/(request_key+'.json')
            if cached.exists():
                rpc('le_serper_source','finish',{**json.loads(cached.read_text()),**payload})
                continue
            reservation=rpc('le_serper_source','reserve',{**payload,'query':query,'page':page})
            if not reservation.get('allowed'):
                if reservation.get('reason')=='SEARCH_LIMIT': break
                continue
            observed=datetime.now(timezone.utc).isoformat()
            result={**payload,'observed_at':observed,'candidates':[],'provider_credits':None,'error_code':None}
            try:
                data=request('https://google.serper.dev/search',{'X-API-KEY':serper},{'q':query,'gl':'nl','hl':'nl','page':page,'num':10})
                if not isinstance(data.get('organic'),list): raise RuntimeError('INVALID_PROVIDER_RESULT')
                result.update(candidates=candidates(data,query,page,observed),provider_credits=data.get('credits'))
            except Exception as exc:
                result['error_code']=('HTTP_'+str(exc.code)) if hasattr(exc,'code') else type(exc).__name__
            save(cached,result)
            saved=rpc('le_serper_source','finish',result)
            print(json.dumps({'query':query,'page':page,'new_candidates':saved.get('candidates',0),'error':result['error_code']}),flush=True)
            if result['error_code'] and any(x in result['error_code'] for x in ('401','403','402','429')): break
        else: continue
        break
    report=rpc('le_serper_source','status',{})
    report.update(ai_requests=0,websites_viewed=0,test_100_started=False)
    save(state/'report.json',report); print(json.dumps(report),flush=True)

if __name__=='__main__':
    try: main()
    except Exception as exc:
        print(json.dumps({'status':'STOPPED','error_type':type(exc).__name__,'http_status':getattr(exc,'code',None)}),flush=True)
        raise SystemExit(1)
