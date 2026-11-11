#!/usr/bin/env python3
"""Eén commando voor een demo van De Website Dokters.

  python3 maak_demo.py start   <website> <naam>   # uitlezen + paletvoorstel (± 1,5 min)
  ... content.json schrijven (prompt.md), palet laten goedkeuren ...
  python3 maak_demo.py publish <naam>             # bouwen, testen, live op demo.dewebsitedokters.nl/<naam>

Werkmap per demo: $DEMO_WORK/<naam> (standaard /home/claude/demos/<naam>).
Repo: $DEMO_REPO (standaard /home/claude/website-dokter-demo-engine).
"""
import json, os, re, subprocess, sys, time, shutil, urllib.request

P = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('DEMO_WORK', '/home/claude/demos')
REPO = os.environ.get('DEMO_REPO', '/home/claude/website-dokter-demo-engine')
DOMAIN = 'https://demo.dewebsitedokters.nl'


def run(cmd, **kw):
    print('$', ' '.join(cmd) if isinstance(cmd, list) else cmd, flush=True)
    r = subprocess.run(cmd, text=True, capture_output=True, **kw)
    out = '\n'.join(l for l in (r.stdout + r.stderr).splitlines() if 'Deprecat' not in l and 'getdata' not in l)
    if out.strip(): print(out.strip())
    if r.returncode: sys.exit(f'STOP: stap faalde ({r.returncode})')
    return r.stdout


def lum(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def contrast(a, b):
    x, y = sorted([lum(a), lum(b)]); return round((y + .05) / (x + .05), 2)


def start(url, naam):
    w = f'{WORK}/{naam}'; os.makedirs(w, exist_ok=True)
    t = time.time()
    run(['python3', f'{P}/scrape.py', url, w])
    f = json.load(open(f'{w}/facts.json'))
    print(f'\n=== {naam}: uitgelezen in {time.time() - t:.0f}s ===')
    print('Logo-kleuren (zichtbare pixels):', f.get('logo_colors'))
    print('CSS-kleuren (let op: sjabloonkleuren zoals one.com-blauw horen niet bij het merk):', f.get('colors', [])[:6])
    print('Telefoon:', f.get('phones'), '| e-mail:', f.get('emails'), '| foto\'s:', len(f.get('photos', [])))
    sat = [c for c, _ in f.get('logo_colors', []) if c.lower() not in ('#ffffff', '#fcfcfc') and abs(lum(c) - .5) < .45]
    if sat:
        acc = sat[0]
        print(f'\nContrast eerste logokleur {acc}: op wit {contrast(acc, "#FFFFFF")}, op papier {contrast(acc, "#F6F4F1")}, '
              f'op warm zwart {contrast(acc, "#1C1615")}  (≥4,5 kleine tekst, ≥3 grote koppen/knoppen)')
    print(f'\nBekijk: {w}/logos.jpg en {w}/sheet.jpg  →  stel palet voor  →  schrijf {w}/content.json (zie {P}/prompt.md)')


def publish(naam):
    w = f'{WORK}/{naam}'; site = f'{w}/site'
    if not os.path.exists(f'{w}/content.json'): sys.exit(f'STOP: {w}/content.json ontbreekt')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', naam): sys.exit('STOP: naam alleen kleine letters, cijfers en -')
    t = time.time()
    run(['python3', f'{P}/build.py', w])
    run(['python3', f'{P}/qa.py', site, f'{w}/qa'])

    # naar de repo
    run(['git', '-C', REPO, 'pull', '-q', '--rebase', 'origin', 'main'])
    dst = f'{REPO}/public/{naam}'; shutil.rmtree(dst, ignore_errors=True); shutil.copytree(site, dst)
    sd = f'{REPO}/src/static-demos.js'; s = open(sd).read()
    names = set(re.findall(r"'([a-z0-9-]+)'", s.split('new Set(')[1])) | {naam}
    s = re.sub(r"new Set\(\[.*?\]\)", 'new Set([' + ', '.join(f"'{n}'" for n in sorted(names)) + '])', s, flags=re.S)
    open(sd, 'w').write(s)
    run(['git', '-C', REPO, 'add', f'public/{naam}', 'src/static-demos.js'])
    st = subprocess.run(['git', '-C', REPO, 'diff', '--cached', '--quiet'])
    if st.returncode:
        run(['git', '-C', REPO, '-c', 'user.name=De Website Dokters', '-c', 'user.email=noreply@anthropic.com', 'commit', '-q', '-m',
             f'Demo {naam} bijwerken\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'])
        sha = run(['git', '-C', REPO, 'rev-parse', 'HEAD']).strip()
        run(['git', '-C', REPO, 'push', '-q', 'origin', 'HEAD:main'])
        # wachten op de deploy-workflow
        for _ in range(40):
            time.sleep(10)
            r = subprocess.run(['gh', 'run', 'list', '-R', 'rudolfbuurbord/website-dokter-demo-engine', '--workflow', 'deploy.yml', '-L', '5',
                                '--json', 'status,conclusion,headSha'], text=True, capture_output=True)
            try: runs = [x for x in json.loads(r.stdout) if x['headSha'] == sha]
            except Exception: runs = []
            if runs and runs[0]['status'] == 'completed':
                if runs[0]['conclusion'] != 'success': sys.exit('STOP: deploy mislukt, zie GitHub Actions')
                break
    else:
        print('Geen wijzigingen t.o.v. live versie.')

    # live controleren
    link = f'{DOMAIN}/{naam}/'
    for _ in range(12):
        try:
            body = urllib.request.urlopen(urllib.request.Request(link, headers={'User-Agent': 'Mozilla/5.0 (DWD demo-check)'}), timeout=15).read().decode('utf8', 'ignore')
            if 'De Website Dokters' in body: break
        except Exception: pass
        time.sleep(5)
    else:
        sys.exit(f'STOP: {link} geeft niet de demo terug')
    print(f'\n=== LIVE in {time.time() - t:.0f}s: {DOMAIN}/{naam} ===')


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) == 3 and a[0] == 'start': start(a[1], a[2])
    elif len(a) == 2 and a[0] == 'publish': publish(a[1])
    else: sys.exit(__doc__)
