#!/usr/bin/env python3
"""Stap 2 automatisch: laat een AI-model content.json schrijven uit facts.json + sheet.jpg + logos.jpg.

  ANTHROPIC_API_KEY=... python3 fill.py <werkmap> [extra-feedback]

Regels: prompt.md. Structuur: example_content.json. Valideert het resultaat en probeert het
maximaal 3 keer opnieuw met de foutmelding erbij.
"""
import base64, json, os, re, sys, time, urllib.request, urllib.error

P = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('DEMO_MODEL', 'claude-sonnet-5-5')
HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')


def img_block(path):
    data = base64.b64encode(open(path, 'rb').read()).decode()
    return {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': data}}


def compact_facts(f):
    pages, budget = {}, 16000
    for url, txt in f.get('pages', {}).items():
        t = re.sub(r'\n{2,}', '\n', txt or '').strip()[:5000]
        if budget <= 0: break
        pages[url] = t[:budget]; budget -= len(pages[url])
    return {
        'url': f.get('url'), 'title': f.get('title'), 'phones': f.get('phones'), 'emails': f.get('emails'),
        'logo_colors': f.get('logo_colors'), 'css_colors': (f.get('colors') or [])[:8],
        'photo_ids': [f"#{p['id']} {p['size'][0]}x{p['size'][1]}" for p in f.get('photos', [])],
        'pages': pages,
    }


def call(messages, system):
    key = os.environ.get('ANTHROPIC_API_KEY')
    if not key: sys.exit('STOP: ANTHROPIC_API_KEY ontbreekt')
    body = json.dumps({'model': MODEL, 'max_tokens': 16000, 'system': system, 'messages': messages}).encode()
    for attempt in range(4):
        req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=body, headers={
            'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=300))
            return ''.join(b.get('text', '') for b in r['content'] if b.get('type') == 'text'), r.get('usage', {})
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if e.code in (429, 500, 502, 503, 529) and attempt < 3:
                time.sleep(8 * (attempt + 1)); continue
            sys.exit(f'STOP: API-fout {e.code}: {msg}')


def validate(c, ids):
    err = []
    need = ['brand', 'meta', 'hero', 'film', 'quote', 'projects', 'grid', 'services_head', 'services', 'who', 'steps',
            'trust', 'area', 'reviews', 'offer', 'faq_hello', 'faq', 'footer', 'theme']
    for k in need:
        if k not in c: err.append(f'veld "{k}" ontbreekt')
    if err: return err
    for k in ('ink', 'accent'):
        if not HEX.match(str(c['brand'].get(k, ''))): err.append(f'brand.{k} is geen #RRGGBB')
    if c['theme'] not in ('donker', 'licht', 'merk'): err.append('theme moet donker/licht/merk zijn')
    refs = re.findall(r'#p\d+', json.dumps(c))
    bad = sorted({r for r in refs if r not in ids})
    if bad: err.append(f'onbekende foto-ids: {bad}; kies alleen uit {sorted(ids)}')
    if len(c['services']) != 6: err.append('services moet precies 6 items hebben')
    for s in c['services']:
        if not (isinstance(s, list) and len(s) == 7): err.append('elk services-item = [kop, titel, zin, uitleg, [3 punten], "#pN", "cN"]'); break
    if len(c['trust'].get('cards', [])) != 4: err.append('trust.cards moet precies 4 items hebben')
    if len(c['steps'].get('steps', [])) != 4: err.append('steps.steps moet precies 4 items hebben')
    if len(c['film']) < 6: err.append('film moet minstens 6 foto\'s hebben')
    if len(str(c['hero'].get('word', ''))) > 12: err.append('hero.word te lang (max 11 tekens)')
    a = c.get('area', {})
    if not (isinstance(a.get('latlon'), list) and len(a['latlon']) == 2): err.append('area.latlon = [lat, lon]')
    if not a.get('pc_ranges'): err.append('area.pc_ranges ontbreekt')
    return err


def main(w, feedback=''):
    t = time.time()
    f = json.load(open(f'{w}/facts.json'))
    ids = {'#' + p['id'] for p in f.get('photos', [])}
    system = open(f'{P}/prompt.md').read() + '\n\n## Voorbeeld van de structuur (andere klant!)\n```json\n' + \
        open(f'{P}/example_content.json').read() + '\n```'
    user = [{'type': 'text', 'text': 'facts:\n' + json.dumps(compact_facts(f), ensure_ascii=False)},
            {'type': 'text', 'text': 'Contactvel met foto-ids:'}, img_block(f'{w}/sheet.jpg'),
            {'type': 'text', 'text': 'Logo-kandidaten (beste eerst):'}, img_block(f'{w}/logos.jpg'),
            {'type': 'text', 'text': 'Schrijf nu de complete content.json. Alleen JSON.' + (f'\n\nLET OP, vorige poging faalde: {feedback}' if feedback else '')}]
    messages = [{'role': 'user', 'content': user}]
    for attempt in range(3):
        text, usage = call(messages, system)
        m = re.search(r'\{.*\}', text, re.S)
        try:
            c = json.loads(m.group(0)) if m else None
            err = validate(c, ids) if isinstance(c, dict) else ['geen geldig JSON-object']
        except json.JSONDecodeError as e:
            c, err = None, [f'ongeldige JSON: {e}']
        print(f'poging {attempt + 1}: {len(err)} fouten · tokens in {usage.get("input_tokens")} uit {usage.get("output_tokens")}', flush=True)
        if not err: break
        messages += [{'role': 'assistant', 'content': text}, {'role': 'user', 'content': 'Fouten: ' + '; '.join(err) + '. Lever de complete gecorrigeerde JSON.'}]
    else:
        sys.exit('STOP: model leverde geen geldige content.json: ' + '; '.join(err))
    # vaste velden die het model niet hoeft te kiezen
    logos = f.get('logos') or []
    c.setdefault('logo', {})
    if logos: c['logo']['file'] = logos[0]['file']
    emails = [e for e in (f.get('emails') or []) if '@' in e]
    if emails and not c['meta'].get('email'): c['meta']['email'] = emails[0].lower()
    c['meta']['email'] = re.sub(r'^20(?=[a-z])', '', str(c['meta'].get('email', '')))  # %20-restje uit mailto-links
    c['meta'].setdefault('street', ''); c['meta'].setdefault('postcode', '')
    if c['theme'] == 'licht': c['hero_glow'] = False
    json.dump(c, open(f'{w}/content.json', 'w'), ensure_ascii=False, indent=1)
    print(f'content.json geschreven in {time.time() - t:.0f}s ({MODEL})')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '')
