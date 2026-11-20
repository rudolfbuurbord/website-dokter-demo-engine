#!/usr/bin/env python3
"""Leest producten uit de webshop van een kachelbedrijf -> <werkmap>/producten.json + foto's in <werkmap>/raw_prod/
Gebruik: shop_scrape.py <website> <werkmap> [max_producten]

Probeert achter elkaar:
  1. Shopify      /products.json
  2. WooCommerce  /wp-json/wc/store/v1/products
  3. Schema.org   JSON-LD "Product" op productpagina's
  4. Algemeen     productkaarten (naam + prijs + foto + link) op categoriepagina's
Daarna per product: vermogen (kW), te verwarmen m², rendement en merk uit de productpagina.
Type (hout/fornuis/pellet/gas/sfeer/buiten-…) wordt geraden uit naam en categorie; controleer dat altijd.
"""
import sys, os, re, json, html, urllib.request, urllib.parse, concurrent.futures as cf
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36'}
base = sys.argv[1].rstrip('/'); W = sys.argv[2]; MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 80
os.makedirs(f'{W}/raw_prod', exist_ok=True)


def get(u, t=20):
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t)
        return r.read().decode('utf8', 'ignore'), r.geturl()
    except Exception:
        return '', u


def txt(h):
    h = re.sub(r'<(script|style|noscript)[^>]*>.*?</\1>', ' ', h, flags=re.S | re.I)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h))).strip()


def money(s):
    m = re.search(r'(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[,.](\d{2}|-))?', str(s).replace('\xa0', ' '))
    if not m: return ''
    n = int(re.sub(r'\D', '', m.group(1)))
    return f'{n:,}'.replace(',', '.')


TYPES = [('buiten-koken', r'plancha|buitenkachel.*(set|vulture|krakatau|vulkaan)|bbq|barbecue|grill|pizzaoven'),
         ('buiten-sfeer', r'vuurschaal|vuurkorf|driepoot|fire ?pit'),
         ('buiten-warm', r'buitenkachel|buitenhaard|terras|tuinkachel|outdoor'),
         ('pellet', r'pellet'),
         ('fornuis', r'fornuis|kookkachel|cooker'),
         ('gas', r'\bgas'),
         ('sfeer', r'bio-?ethanol|elektrisch|electric|sfeerhaard'),
         ('hout', r'houtkachel|kachel|stove|haard|inbouw')]
SKIP = r'pijp|rookkanaal|onderdeel|ruit|koord|pakking|verf|poets|handgreep|rooster|briket|pellets?\s*(zak|pallet|kg)|hout\s*(krat|pallet)|haardset|bestek|mand|ketel|thermometer|ventilator|beschermhoes|hoes|deksel|opzetstuk|afstandhouder|bodemplaat|skillet|pan\b|dutch|cadeau|bon|ethanol\s*\d|\d+\s*l\b|liter|navul'


def guess(name, cat=''):
    s = f'{name} {cat}'.lower()
    if re.search(SKIP, s): return 'accessoire'
    for t, rx in TYPES:
        if re.search(rx, s): return t
    return 'accessoire'


def specs(h):
    t = txt(h); out = {}
    m = re.search(r'(?:vermogen|nominaal)[^0-9]{0,25}(\d+(?:[,.]\d+)?)\s*(?:[-–]|tot)\s*(\d+(?:[,.]\d+)?)\s*kw', t, re.I) or re.search(r'(\d+(?:[,.]\d+)?)\s*(?:[-–]|tot)\s*(\d+(?:[,.]\d+)?)\s*kw', t, re.I)
    if m: out['kw'] = f'{m.group(1)}–{m.group(2)} kW'
    else:
        m = re.search(r'(?:vermogen|nominaal)[^0-9]{0,25}(\d+(?:[,.]\d+)?)\s*kw', t, re.I)
        if m: out['kw'] = f'{m.group(1)} kW'
    m = re.search(r'(?:verwarmt|ruimte|tot)[^0-9]{0,25}(\d{2,3})\s*(?:[-–]|tot)\s*(\d{2,3})\s*m(?:²|2|3|³)', t, re.I)
    if m: out['m2'] = [int(m.group(1)), int(m.group(2))]
    m = re.search(r'rendement[^0-9]{0,15}(\d{2}(?:[,.]\d)?)\s*%', t, re.I)
    if m: out['rendement'] = m.group(1) + '%'
    m = re.search(r'(?:merk|fabrikant|brand)\s*:?\s*([A-Z][\w&\- ]{1,24}?)(?:\s{2,}|\s[A-Z][a-z]+\s*:|$)', t)
    if m: out['merk'] = m.group(1).strip()
    return out


products = []
home, final = get(base); root = urllib.parse.urlsplit(final).netloc

# 1. Shopify
j, _ = get(final.rstrip('/') + '/products.json?limit=250')
if j.startswith('{') and '"products"' in j:
    for p in json.loads(j).get('products', [])[:MAX]:
        v = (p.get('variants') or [{}])[0]; im = (p.get('images') or [{}])[0].get('src', '')
        products.append({'naam': p['title'], 'prijs': money(v.get('price', '')), 'url': final.rstrip('/') + '/products/' + p['handle'], 'foto_url': im, 'cat': p.get('product_type', '')})
    print('bron: Shopify', len(products))
# 2. WooCommerce Store API
if not products:
    j, _ = get(final.rstrip('/') + '/wp-json/wc/store/v1/products?per_page=100')
    if j.startswith('['):
        for p in json.loads(j)[:MAX]:
            pr = p.get('prices', {}); cents = int(pr.get('minor_unit', 2))
            price = int(pr.get('price', 0) or 0) // (10 ** cents) if pr.get('price') else 0
            products.append({'naam': html.unescape(p['name']), 'prijs': f'{price:,}'.replace(',', '.') if price else '', 'url': p['permalink'], 'foto_url': (p.get('images') or [{}])[0].get('src', ''), 'cat': ' '.join(c['name'] for c in p.get('categories', []))})
        print('bron: WooCommerce', len(products))
# 3+4. categoriepagina's doorlopen
if not products:
    cats = []
    for h in re.findall(r'href=["\']([^"\'#]+)["\']', home):
        u = urllib.parse.urljoin(final, h)
        if urllib.parse.urlsplit(u).netloc.replace('www.', '') != root.replace('www.', ''): continue
        if re.search(r'kachel|haard|fornuis|pellet|buiten|outdoor|categor|collectie|aanbied|product', u, re.I) and not re.search(r'\.(jpg|png|pdf|css|js)', u) and u not in cats: cats.append(u)
    cats = cats[:25]; seen = set()
    with cf.ThreadPoolExecutor(8) as ex:
        pages = list(ex.map(get, cats))
    percat = {}
    for (h, u) in pages:
        cat = txt(re.search(r'<h1[^>]*>(.*?)</h1>', h, re.S).group(1)) if re.search(r'<h1[^>]*>(.*?)</h1>', h, re.S) else u
        # JSON-LD
        for blk in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', h, re.S):
            try: d = json.loads(blk)
            except Exception: continue
            items = d if isinstance(d, list) else d.get('itemListElement', [d]) if isinstance(d, dict) else []
            for it in items:
                it = it.get('item', it) if isinstance(it, dict) else {}
                if isinstance(it, dict) and it.get('@type') == 'Product' and it.get('name') not in seen:
                    off = it.get('offers', {}); off = off[0] if isinstance(off, list) else off
                    img = it.get('image'); img = img[0] if isinstance(img, list) else img
                    seen.add(it['name']); products.append({'naam': it['name'], 'prijs': money(off.get('price', '')), 'url': it.get('url', u), 'foto_url': img or '', 'cat': cat})
        # algemene productkaarten: blok met link + afbeelding + prijs
        for st in re.finditer(r'<(?:li|div|article)[^>]+class=["\'][^"\']*(?:product|item|card)[^"\']*["\']', h):
            blk = h[st.start():st.start() + 3500]
            pm = re.search(r'(?:€|&euro;|EUR)\s*(?:&nbsp;|\s)*(\d{1,3}(?:\.\d{3})*(?:,\d{2}|,-)?)|class=["\'][^"\']*price[^"\']*["\'][^>]*>\s*(?:<[^>]+>\s*)*(?:€|&euro;)?\s*(\d{1,3}(?:\.\d{3})*),', blk)
            lm = re.search(r'<a[^>]+href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', blk, re.S)
            im = re.search(r'<img[^>]+(?:data-src|src)=["\']([^"\']+\.(?:jpe?g|png|webp)[^"\']*)', blk, re.I)
            if not (pm and lm and im): continue
            names = [txt(x) for x in re.findall(r'<(?:h\d|strong|a)[^>]*>(.*?)</(?:h\d|strong|a)>', blk, re.S)]
            name = next((n for n in names if 4 < len(n) < 90 and not re.search(r'winkelwagen|bekijk|meer info|€', n, re.I)), '')
            if not name or name in seen or percat.get(u, 0) >= 10: continue
            seen.add(name); percat[u] = percat.get(u, 0) + 1
            products.append({'naam': name, 'prijs': money(pm.group(1) or pm.group(2)), 'url': urllib.parse.urljoin(u, html.unescape(lm.group(1))), 'foto_url': urllib.parse.urljoin(u, html.unescape(im.group(1))), 'cat': cat})
    print('bron: categoriepagina\'s', len(products), 'uit', len(cats), 'pagina\'s')

products = products[:MAX]
for p in products: p['type'] = guess(p['naam'], p.get('cat', ''))
# grotere foto proberen (veel shops: /400x400/ -> /Large/ of -324x324 weg)
def big(u):
    for a, b in [(r'/\d{2,4}x\d{2,4}/', '/Large/'), (r'-\d{2,4}x\d{2,4}(?=\.\w+$)', ''), (r'[?&](?:w|width)=\d+', '')]:
        n = re.sub(a, b, u)
        if n != u: return n
    return u
# specificaties + foto ophalen voor kachels (niet voor accessoires)
def detail(i):
    p = products[i]
    if p['type'] != 'accessoire' and p.get('url'):
        h, _ = get(p['url']); p.update(specs(h))
    for u in ([big(p['foto_url']), p['foto_url']] if p.get('foto_url') else []):
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20); b = r.read()
            if len(b) > 3000:
                ext = 'png' if b[:4] == b'\x89PNG' else 'jpg'; fn = f'{W}/raw_prod/p{i}.{ext}'; open(fn, 'wb').write(b); p['foto_bestand'] = fn; break
        except Exception: pass
with cf.ThreadPoolExecutor(10) as ex: list(ex.map(detail, range(len(products))))
json.dump(products, open(f'{W}/producten.json', 'w'), indent=1, ensure_ascii=False)
from collections import Counter
print('producten:', len(products), dict(Counter(p['type'] for p in products)),
      '| met kW:', sum(1 for p in products if p.get('kw')), '| met m²:', sum(1 for p in products if p.get('m2')),
      '| met foto:', sum(1 for p in products if p.get('foto_bestand')))
