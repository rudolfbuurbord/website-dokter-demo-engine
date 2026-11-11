#!/usr/bin/env python3
"""Volledig automatische demo (voor GitHub Actions / funnel): uitlezen -> schrijven -> bouwen -> testen -> klaarzetten in public/.

  ANTHROPIC_API_KEY=... python3 auto_demo.py <website> [naam]

Schrijft public/<naam>/ en src/static-demos.js in de repo. Committen en deployen doet de workflow.
Print aan het eind één regel: RESULT {"slug":..., "url":..., "seconds":...}
"""
import json, os, re, shutil, subprocess, sys, time, urllib.parse

P = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(P)
WORK = os.environ.get('DEMO_WORK', '/tmp/demos')
DOMAIN = 'https://demo.dewebsitedokters.nl'
STOP = ('schildersbedrijf', 'schilderwerken', 'schilders', 'schilder', 'bedrijf', 'www')


def slugify(url):
    host = urllib.parse.urlparse(url if '://' in url else 'https://' + url).hostname or url
    base = host.split('.')[-2] if host.count('.') >= 1 else host
    parts = []
    for x in re.split(r'[^a-z0-9]+', base.lower()):
        changed = True
        while changed and x and x not in STOP:
            changed = False
            for w in STOP:
                if x.startswith(w) and len(x) > len(w) + 2: x, changed = x[len(w):], True
                elif x.endswith(w) and len(x) > len(w) + 2: x, changed = x[:-len(w)], True
        if x and x not in STOP: parts.append(x)
    s = '-'.join(parts) or re.sub(r'[^a-z0-9]+', '-', base.lower()).strip('-')
    return s[:40] or 'demo'


def run(cmd):
    print('$', ' '.join(cmd), flush=True)
    r = subprocess.run(cmd, text=True, capture_output=True)
    out = '\n'.join(l for l in (r.stdout + r.stderr).splitlines() if 'Deprecat' not in l and 'getdata' not in l)
    if out.strip(): print(out.strip(), flush=True)
    return r.returncode, out


def main(url, naam=None):
    t = time.time(); naam = naam or slugify(url)
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', naam): sys.exit('STOP: ongeldige naam')
    dst = f'{REPO}/public/{naam}'
    if os.path.isdir(dst) and not os.path.exists(f'{dst}/auto.txt'):
        # handgemaakte demo bestaat al: die niet overschrijven, gewoon die link geven
        print('RESULT ' + json.dumps({'slug': naam, 'url': f'{DOMAIN}/{naam}', 'existing': True, 'seconds': 0})); return
    w = f'{WORK}/{naam}'; shutil.rmtree(w, ignore_errors=True); os.makedirs(w)
    code, _ = run(['python3', f'{P}/scrape.py', url, w])
    f = json.load(open(f'{w}/facts.json')) if os.path.exists(f'{w}/facts.json') else {}
    if code or len(f.get('photos', [])) < 4 or not f.get('logos'):
        sys.exit(f'STOP: site niet goed uit te lezen (foto\'s: {len(f.get("photos", []))}, logo: {bool(f.get("logos"))})')
    feedback = ''
    for attempt in range(2):
        code, _ = run(['python3', f'{P}/fill.py', w] + ([feedback] if feedback else []))
        if code: sys.exit('STOP: schrijfstap mislukt')
        code, out = run(['python3', f'{P}/build.py', w])
        if code == 0: break
        feedback = 'De bouw weigerde de kleuren: ' + ' '.join(l for l in out.splitlines() if 'KLEUR' in l or 'Merkkleuren' in l)
    else:
        sys.exit('STOP: bouw mislukt na 2 pogingen')
    code, out = run(['python3', f'{P}/qa.py', f'{w}/site', f'{w}/qa'])
    if code or 'fouten [' in out and re.search(r'fouten \[[^\]]', out) or re.search(r'kapot \[[^\]]', out):
        sys.exit('STOP: QA faalde')
    shutil.rmtree(dst, ignore_errors=True); shutil.copytree(f'{w}/site', dst)
    open(f'{dst}/auto.txt', 'w').write(f'automatisch gemaakt {time.strftime("%Y-%m-%d %H:%M")} uit {url}\n')
    sd = f'{REPO}/src/static-demos.js'; s = open(sd).read()
    names = set(re.findall(r"'([a-z0-9-]+)'", s.split('new Set(')[1])) | {naam}
    s = re.sub(r"new Set\(\[.*?\]\)", 'new Set([' + ', '.join(f"'{n}'" for n in sorted(names)) + '])', s, flags=re.S)
    open(sd, 'w').write(s)
    c = json.load(open(f'{w}/content.json'))
    print('RESULT ' + json.dumps({'slug': naam, 'url': f'{DOMAIN}/{naam}', 'name': c['meta'].get('name'),
                                  'theme': c.get('theme'), 'check': c.get('_check', []), 'seconds': round(time.time() - t)}, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None)
