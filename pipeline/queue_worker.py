#!/usr/bin/env python3
"""Wachtrij-verwerker voor automatische demo's (draait in GitHub Actions).

  python3 queue_worker.py claim            # pakt wachtende funnel-leads, bouwt demo's -> /tmp/demo_results.json
  python3 queue_worker.py claim --site URL # handmatige test zonder lead
  python3 queue_worker.py finish ok|fail   # na deploy: zet leads op ready (met link) of failed

Env: DEMO_JOB_TOKEN (kortlevende code uit het Supabase-startsein), ANTHROPIC_API_KEY.
"""
import datetime as dt, json, os, re, subprocess, sys, urllib.parse, urllib.request

P = os.path.dirname(os.path.abspath(__file__))
SB = os.environ.get('SUPABASE_URL', 'https://skdjbifmtleiogbkqwid.supabase.co').rstrip('/')
KEY = os.environ.get('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_wRV-K66gO8VckzyoJeJwSw_ARrSpiKS')
JOB = os.environ.get('DEMO_JOB_TOKEN', '')
RES = '/tmp/demo_results.json'
MAX = int(os.environ.get('DEMO_MAX_PER_RUN', '4'))


def sb(method, path, body=None, prefer=None):
    h = {'apikey': KEY, 'Content-Type': 'application/json'}
    if not KEY.startswith('sb_'): h['Authorization'] = f'Bearer {KEY}'  # nieuwe sb_secret-sleutels: alleen apikey
    if prefer: h['Prefer'] = prefer
    req = urllib.request.Request(f'{SB}/rest/v1/{path}', method=method, headers=h,
                                 data=None if body is None else json.dumps(body).encode())
    r = urllib.request.urlopen(req, timeout=30).read()
    return json.loads(r) if r else None


def now(): return dt.datetime.now(dt.timezone.utc).isoformat()


def build(site, slug=None):
    cmd = ['python3', f'{P}/auto_demo.py', site] + ([slug] if slug else [])
    r = subprocess.run(cmd, text=True, capture_output=True, timeout=900)
    out = r.stdout + r.stderr
    print(out[-6000:], flush=True)
    m = re.search(r'^RESULT (.+)$', out, re.M)
    if r.returncode == 0 and m: return json.loads(m.group(1)), None
    stop = re.findall(r'STOP: .+', out)
    return None, (stop[-1] if stop else f'exit {r.returncode}')[:300]


def claim(site=None):
    results = []
    if site:
        res, err = build(site)
        results.append({'lead': None, 'site': site, 'result': res, 'error': err})
    else:
        if not JOB: sys.exit('STOP: geen DEMO_JOB_TOKEN (alleen een startsein vanuit Supabase heeft er een)')
        rows = sb('POST', 'rpc/dwd_demo_claim', {'p_token': JOB, 'p_max': MAX}) or []
        for row in rows:
            print(f'== lead {row["id"]}: {row["website"]}', flush=True)
            res, err = build(row['website'])
            results.append({'lead': row['id'], 'site': row['website'], 'result': res, 'error': err})
            if err:
                sb('POST', 'rpc/dwd_demo_finish', {'p_token': JOB, 'p_id': row['id'], 'p_status': 'failed', 'p_error': err})
    json.dump(results, open(RES, 'w'))
    ok = [r for r in results if r['result'] and not r['result'].get('existing')]
    print(f'klaar: {len(ok)} nieuw gebouwd, {sum(1 for r in results if r["error"])} mislukt, {len(results)} totaal')
    with open(os.environ.get('GITHUB_OUTPUT', '/dev/null'), 'a') as gh:
        gh.write(f'built={len(ok)}\nany={len(results)}\n')


def finish(state):
    if not os.path.exists(RES): return
    for r in json.load(open(RES)):
        if not r['lead'] or not r['result']: continue
        if state == 'ok':
            sb('POST', 'rpc/dwd_demo_finish', {'p_token': JOB, 'p_id': r['lead'], 'p_status': 'ready',
                                              'p_slug': r['result']['slug'], 'p_url': r['result']['url']})
        else:
            sb('POST', 'rpc/dwd_demo_finish', {'p_token': JOB, 'p_id': r['lead'], 'p_status': 'failed', 'p_error': 'deploy mislukt'})
    print('leads bijgewerkt:', state)


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['claim']: claim(a[2] if len(a) > 2 and a[1] == '--site' else None)
    elif a[:1] == ['finish']: finish(a[1] if len(a) > 1 else 'ok')
    else: sys.exit(__doc__)
