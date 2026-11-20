#!/usr/bin/env python3
"""Bouwt een kachel-demo uit <werkmap>/content.json + <werkmap>/img/  ->  <werkmap>/site/
Gebruik: build_kachel.py <werkmap>"""
import sys, os, json, shutil
import jinja2
H = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, H)
from icons import ICONS

W = sys.argv[1]; C = json.load(open(f'{W}/content.json'))
site = f'{W}/site'; shutil.rmtree(site, ignore_errors=True); os.makedirs(f'{site}/img')
# 1. vaste beelden (WARMTE-hero, sokkel) + beelden van de klant
for f in os.listdir(f'{H}/assets'): shutil.copy(f'{H}/assets/{f}', f'{site}/img/{f}')
if os.path.isdir(f'{W}/img'):
    for f in os.listdir(f'{W}/img'): shutil.copy(f'{W}/img/{f}', f'{site}/img/{f}')
for f in ('style.css', 'app.js'): shutil.copy(f'{H}/template/{f}', f'{site}/{f}')

# 2. standaardwaarden zodat een kaal invulbestand ook werkt
C.setdefault('secties', ['intro', 'kiezer', 'soorten', 'over', 'faq', 'verhalen', 'bezoek'])
C.setdefault('hero', {}); C['hero'].setdefault('variant', 'warmte'); C['hero'].setdefault('zin', '')
C.setdefault('footer', {}); C.setdefault('bezoek', {})
C['bezoek'].setdefault('titel', 'Kom het vuur <em>zelf zien</em>'); C['bezoek'].setdefault('lead', 'Laat u persoonlijk adviseren in onze showroom.')
C['bezoek'].setdefault('tabs', ['bezoek', 'offerte']); C['bezoek'].setdefault('interesses', ['Een houtkachel', 'Ik weet het nog niet'])
PR = C['profiel']; PR.setdefault('hoofdactie', 'webshop' if PR.get('webshop') else 'offerte'); PR.setdefault('knop_product', 'Bekijk in de webshop' if PR['hoofdactie'] == 'webshop' else 'Vraag advies')
if 'menu' not in C:
    m = [('Kachelkiezer', '#kiezer'), ('Collectie', '#soorten'), ('Diensten', '#diensten'), ('Over ons', '#over'), ('Bezoek', '#bezoek')]
    ids = {'kiezer': 'kiezer', 'soorten': 'soorten', 'diensten': 'diensten', 'over': 'over', 'bezoek': 'bezoek'}
    C['menu'] = [(l, h) for l, h in m if h[1:] in C['secties']][:4] or [('Contact', '#bezoek')]
prod = {p['id']: p for p in C.get('producten', [])}

# 3. controle: ontbrekende beelden of product-id's
miss = []
def chk_img(f):
    if f and not os.path.exists(f'{site}/img/{f}'): miss.append(f)
chk_img(C['bedrijf'].get('logo'))
for p in C.get('producten', []): chk_img(p.get('foto'))
def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ('foto', 'hoofdfoto') and isinstance(v, str): chk_img(v)
            if k == 'product' and isinstance(v, str) and v not in prod: miss.append('product-id ' + v)
            walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk({k: v for k, v in C.items() if k != 'producten'})
for sec in ('koken',):
    for i in (C.get(sec) or {}).get('producten', []):
        if i not in prod: miss.append('product-id ' + i)
for g in (C.get('buiten') or {}).get('groepen', []):
    for i in g['producten']:
        if i not in prod: miss.append('product-id ' + i)
if miss: sys.exit('STOP: ontbreekt in content.json/img: ' + ', '.join(sorted(set(miss))))

data = {'producten': C.get('producten', []), 'faq': C.get('faq', []), 'openingstijden': C.get('openingstijden', {}),
        'webshop': PR['hoofdactie'] == 'webshop', 'knop_product': PR['knop_product'], 'mensen_kort': C['bedrijf'].get('mensen_kort', ''),
        'zekerheden': PR.get('zekerheden', []), 'icons': ICONS}
env = jinja2.Environment(loader=jinja2.FileSystemLoader(f'{H}/template'), autoescape=False, undefined=jinja2.ChainableUndefined)
env.globals['ico'] = lambda n: ICONS.get(n, '')
html = env.get_template('index.j2').render(c=C, prod=prod, data_json=json.dumps(data, ensure_ascii=False).replace('</', '<\\/'))
open(f'{site}/index.html', 'w').write(html)
kb = sum(os.path.getsize(f'{site}/img/{f}') for f in os.listdir(f'{site}/img')) // 1024
print(f'gebouwd: {site}/index.html  ({len(html)//1024} KB html, {kb} KB beelden, secties: {", ".join(C["secties"])})')
