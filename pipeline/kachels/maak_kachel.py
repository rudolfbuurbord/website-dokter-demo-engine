#!/usr/bin/env python3
"""Kachel-demo van De Website Dokters in twee stappen.

  python3 kachels/maak_kachel.py start   <website> <naam>   # uitlezen: site, logo, kleuren, webshop-producten, uitsnijden
  ... content.json afmaken (zie kachels/README.md), kleuren laten goedkeuren ...
  python3 kachels/maak_kachel.py publish <naam>             # bouwen, testen, live op demo.dewebsitedokters.nl/<naam>
"""
import json, os, re, subprocess, sys, time, shutil, urllib.request
H = os.path.dirname(os.path.abspath(__file__)); P = os.path.dirname(H)
WORK = os.environ.get('DEMO_WORK', '/home/claude/demos'); REPO = os.environ.get('DEMO_REPO', os.path.dirname(P))
DOMAIN = 'https://demo.dewebsitedokters.nl'


def run(cmd, ok=(0,)):
    print('$', ' '.join(cmd), flush=True)
    r = subprocess.run(cmd, text=True, capture_output=True)
    out = '\n'.join(l for l in (r.stdout + r.stderr).splitlines() if 'Deprecat' not in l and 'getdata' not in l)
    if out.strip(): print(out.strip())
    if r.returncode not in ok: sys.exit(f'STOP: stap faalde ({r.returncode})')
    return r


def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:40]


def start(url, naam):
    w = f'{WORK}/{naam}'; os.makedirs(f'{w}/img', exist_ok=True); t = time.time()
    run(['python3', f'{P}/scrape.py', url, w])                    # teksten, logo, kleuren, contact (gedeeld met schilders)
    run(['python3', f'{H}/shop_scrape.py', url, w, '80'])          # producten + kW/m²
    f = json.load(open(f'{w}/facts.json')); prods = json.load(open(f'{w}/producten.json'))
    # foto's: uitsnijden waar het kan (witte achtergrond), anders als sfeerfoto
    from PIL import Image
    out = []
    for i, p in enumerate(prods):
        if not p.get('foto_bestand'): continue
        pid = slug(p['naam'].replace('Houtkachel', '').replace('Houtfornuis', '')) or f'p{i}'
        r = subprocess.run(['python3', '-I', f'{H}/uitsnijden.py', p['foto_bestand'], f'{w}/img/{pid}.png', '700'])
        if r.returncode == 0: p['foto'] = f'{pid}.png'; p['uitgesneden'] = True
        else:
            im = Image.open(p['foto_bestand']).convert('RGB'); Wd, Hd = im.size; px = im.load()
            lab = sum(1 for y in range(int(Hd * .15)) for x in range(int(Wd * .72), Wd, 2) if px[x, y][1] > 140 and px[x, y][1] - px[x, y][2] > 60)
            if lab > 80: im = im.crop((0, int(Hd * .16), Wd, Hd))   # energielabel rechtsboven wegknippen
            im.thumbnail((700, 700)); im.save(f'{w}/img/{pid}.jpg', quality=84); p['foto'] = f'{pid}.jpg'
        p['id'] = pid; out.append(p)
    # contactvel met productfoto's
    from PIL import ImageDraw
    S = 180; cols = 8; rows = (len(out) + cols - 1) // cols or 1
    sh = Image.new('RGB', (cols * S, rows * (S + 30)), (30, 24, 20)); d = ImageDraw.Draw(sh)
    for i, p in enumerate(out):
        im = Image.open(f"{w}/img/{p['foto']}").convert('RGBA'); im.thumbnail((S - 8, S - 8)); x, y = (i % cols) * S, (i // cols) * (S + 30)
        sh.paste(im, (x + 4, y + 4), im); d.text((x + 4, y + S), f"{p['id'][:22]}\n{p['type']} {'✂' if p.get('uitgesneden') else ''}", fill=(230, 220, 205))
    sh.save(f'{w}/producten.jpg', quality=80)
    # concept-content.json: alles wat automatisch kan, de rest staat klaar om in te vullen
    types = {p['type'] for p in out}
    secties = ['snelbalk', 'intro', 'kiezer', 'soorten', 'uitgelicht']
    if sum(p['type'] == 'fornuis' for p in out) >= 2: secties.append('koken')
    if types & {'buiten-koken', 'buiten-warm', 'buiten-sfeer'}: secties.append('buiten')
    secties += ['over', 'faq', 'verhalen', 'bezoek']
    keep = ('id', 'naam', 'type', 'prijs', 'url', 'foto', 'uitgesneden', 'kw', 'm2', 'merk')
    concept = {
        '_status': 'CONCEPT: vul aan volgens README.md (teksten, soorten, uitgelicht, faq, verhalen, openingstijden, kleur) en verwijder dit veld',
        'bedrijf': {'naam': f.get('title', '').split('|')[0].split(' - ')[0].strip(), 'slogan': '', 'plaats': '', 'straat': '', 'postcode': '',
                    'telefoon': (f.get('phones') or [''])[0], 'telefoon_link': '', 'email': (f.get('emails') or [''])[0], 'website': f.get('url', url), 'mensen': '', 'mensen_kort': '', 'logo': 'logo.png'},
        'profiel': {'webshop': bool(out), 'hoofdactie': 'webshop' if out else 'offerte', 'zekerheden': []},
        'openingstijden': {'regels': [], 'per_dag': {}},
        'secties': secties, 'hero': {'variant': 'warmte', 'zin': ''},
        'producten': [{k: p[k] for k in keep if p.get(k)} for p in out if p['type'] != 'accessoire'],
        'accessoires': [{k: p[k] for k in keep if p.get(k)} for p in out if p['type'] == 'accessoire'],
    }
    cfile = f'{w}/content.json'
    if not os.path.exists(cfile): json.dump(concept, open(cfile, 'w'), indent=1, ensure_ascii=False)
    else: json.dump(concept, open(f'{w}/content.concept.json', 'w'), indent=1, ensure_ascii=False)
    from collections import Counter
    print(f'\n=== {naam}: klaar in {time.time() - t:.0f}s ===')
    print('Logokleuren (zichtbaar):', f.get('logo_colors'), '| CSS:', f.get('colors', [])[:4])
    print('Producten:', dict(Counter(p['type'] for p in out)), '| uitgesneden:', sum(1 for p in out if p.get('uitgesneden')))
    print('Voorgestelde secties:', secties)
    print(f'Bekijk: {w}/logos.jpg, {w}/sheet.jpg (sfeerfoto\'s), {w}/producten.jpg  →  maak {cfile} af  →  publish')


def publish(naam):
    w = f'{WORK}/{naam}'; site = f'{w}/site'
    C = json.load(open(f'{w}/content.json'))
    if C.get('_status'): sys.exit('STOP: content.json is nog een concept (_status staat er nog in)')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', naam): sys.exit('STOP: naam alleen kleine letters, cijfers en -')
    t = time.time()
    run(['python3', f'{H}/build_kachel.py', w])
    run(['python3', f'{P}/qa.py', site, f'{w}/qa'])
    run(['git', '-C', REPO, 'pull', '-q', '--rebase', 'origin', 'main'])
    dst = f'{REPO}/public/{naam}'; shutil.rmtree(dst, ignore_errors=True); shutil.copytree(site, dst)
    sd = f'{REPO}/src/static-demos.js'; s = open(sd).read()
    names = set(re.findall(r"'([a-z0-9-]+)'", s.split('new Set(')[1])) | {naam}
    s = re.sub(r"new Set\(\[.*?\]\)", 'new Set([' + ', '.join(f"'{n}'" for n in sorted(names)) + '])', s, flags=re.S); open(sd, 'w').write(s)
    run(['git', '-C', REPO, 'add', f'public/{naam}', 'src/static-demos.js'])
    if subprocess.run(['git', '-C', REPO, 'diff', '--cached', '--quiet']).returncode:
        run(['git', '-C', REPO, '-c', 'user.name=De Website Dokters', '-c', 'user.email=noreply@anthropic.com', 'commit', '-q', '-m',
             f'Kachel-demo {naam} bijwerken\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'])
        sha = run(['git', '-C', REPO, 'rev-parse', 'HEAD']).stdout.strip()
        run(['git', '-C', REPO, '-c', 'push.negotiate=true', 'push', '-q', 'origin', 'HEAD:main'])
        for _ in range(40):
            time.sleep(10)
            r = subprocess.run(['gh', 'run', 'list', '-R', 'rudolfbuurbord/website-dokter-demo-engine', '--workflow', 'deploy.yml', '-L', '5', '--json', 'status,conclusion,headSha'], text=True, capture_output=True)
            try: runs = [x for x in json.loads(r.stdout) if x['headSha'] == sha]
            except Exception: runs = []
            if runs and runs[0]['status'] == 'completed':
                if runs[0]['conclusion'] != 'success': sys.exit('STOP: deploy mislukt, zie GitHub Actions')
                break
    link = f'{DOMAIN}/{naam}/'
    for _ in range(12):
        try:
            body = urllib.request.urlopen(urllib.request.Request(link + '?v=' + str(int(time.time())), headers={'User-Agent': 'Mozilla/5.0 (DWD demo-check)'}), timeout=15).read().decode('utf8', 'ignore')
            if 'De Website Dokters' in body and C['bedrijf']['naam'].split()[0] in body: break
        except Exception: pass
        time.sleep(5)
    else: sys.exit(f'STOP: {link} geeft niet de demo terug')
    print(f'\n=== LIVE in {time.time() - t:.0f}s: {DOMAIN}/{naam} ===')


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) == 3 and a[0] == 'start': start(a[1], a[2])
    elif len(a) == 2 and a[0] == 'publish': publish(a[1])
    elif len(a) == 2 and a[0] == 'build': run(['python3', f'{H}/build_kachel.py', f'{WORK}/{a[1]}']); run(['python3', f'{P}/qa.py', f'{WORK}/{a[1]}/site', f'{WORK}/{a[1]}/qa'])
    else: sys.exit(__doc__)
