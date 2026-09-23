#!/usr/bin/env python3
"""Read-only Hetzner preflight. No generation, queue claim or timer changes."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

PROJECT_HOST = 'skdjbifmtleiogbkqwid.supabase.co'
MODEL = 'gpt-4.1-mini-2025-04-14'
MAX_BYTES = 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_env(path):
    values = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key.startswith('export '):
            key = key[7:]
        values[key.strip()] = value.strip().strip('\"\'')
    return values


def request(url, headers=None, payload=None):
    # Never follow API redirects with credentials; never print response bodies.
    opener = urllib.request.build_opener(NoRedirect)
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with opener.open(req, timeout=15) as response:
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError('RESPONSE_TOO_LARGE')
        return raw


def search_candidates(raw):
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('UNSUPPORTED_XML')
    root = ET.fromstring(raw)
    if root.tag != 'rss':
        raise ValueError('NO_RSS_RESULTS')
    found = []
    seen = set()
    for item in root.findall('./channel/item'):
        url = item.findtext('link', '').strip()
        title = item.findtext('title', '').strip()
        description = item.findtext('description', '').strip()
        p = urllib.parse.urlsplit(url)
        if p.scheme not in ('http', 'https') or not p.hostname or p.username:
            continue
        domain = p.hostname.lower().removeprefix('www.')
        # Discovery only: these are not qualified businesses or verified identities.
        if 'schilder' not in (title + ' ' + description + ' ' + domain).lower():
            continue
        if domain not in seen:
            seen.add(domain)
            found.append({'url': url, 'title': title[:200], 'domain': domain,
                          'search_position': 'UNKNOWN', 'qualification': 'NOT_REVIEWED'})
    return found


def preflight(values, fetch=request, timer_check=None):
    report = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'phase': 'READ_ONLY_PREFLIGHT', 'paid_generation_requests': 0,
              'test_started': False, 'checks': {}, 'candidates': []}
    checks = report['checks']
    for key in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'):
        checks[key] = 'PRESENT' if values.get(key) else 'MISSING'
    if timer_check:
        checks['old_timer'] = timer_check()
    base = values.get('SUPABASE_URL', '').rstrip('/')
    if base == 'https://' + PROJECT_HOST and values.get('SUPABASE_SERVICE_ROLE_KEY'):
        key = values['SUPABASE_SERVICE_ROLE_KEY']
        try:
            raw = fetch(base + '/rest/v1/rpc/le_research',
                        {'apikey': key, 'Authorization': 'Bearer ' + key,
                         'Content-Type': 'application/json'},
                        {'p_action': 'status', 'p_payload': {}})
            data = json.loads(raw)
            if not isinstance(data.get('runs'), list):
                raise ValueError('UNEXPECTED_DATABASE_RESPONSE')
            checks['database'] = 'OK'
        except Exception as exc:
            checks['database'] = safe_error(exc)
    else:
        checks['database'] = 'EXPECTED_PROJECT_CONFIG_REQUIRED'
    if values.get('OPENAI_API_KEY'):
        try:
            data = json.loads(fetch('https://api.openai.com/v1/models/' + MODEL,
                                   {'Authorization': 'Bearer ' + values['OPENAI_API_KEY']}))
            checks['model_access'] = 'OK_METADATA_ONLY' if data.get('id') == MODEL else 'UNEXPECTED_RESPONSE'
        except Exception as exc:
            checks['model_access'] = safe_error(exc)
    else:
        checks['model_access'] = 'KEY_MISSING'
    source = 'https://www.bing.com/search?' + urllib.parse.urlencode(
        {'q': 'schildersbedrijf Enschede contact', 'format': 'rss', 'cc': 'nl'})
    report['discovery_source_url'] = source
    try:
        report['candidates'] = search_candidates(fetch(source))
        checks['public_search_probe'] = 'RESULTS_RECEIVED' if report['candidates'] else 'NO_RELEVANT_RESULTS'
    except Exception as exc:
        checks['public_search_probe'] = safe_error(exc)
    report['limitations'] = [
        'Model metadata access does not prove generation permissions or available credit.',
        'Public search is experimental; no SLA, no CAPTCHA bypass, no paid fallback.',
        'Candidates have not been deduplicated against the database or visually qualified.',
        'No paid worker installed or activated by this script.',
        'The EUR 1 total spending guard and qualification calibration are not yet deployed.'
    ]
    return report


def safe_error(exc):
    if isinstance(exc, urllib.error.HTTPError):
        return 'HTTP_' + str(exc.code)
    # Exception messages may contain URL, headers or provider response contents.
    return 'FAILED_' + type(exc).__name__


def main():
    os.umask(0o077)
    try:
        values = read_env('/etc/dwd-research.env')
    except Exception as exc:
        print('CONFIG: ' + safe_error(exc))
        return 1
    def timer():
        result = subprocess.run(['systemctl', 'is-active', 'dwd-research-docker.timer'],
                                capture_output=True, text=True, timeout=5)
        return 'STOPPED' if result.stdout.strip() == 'inactive' else 'CHECK_REQUIRED'
    report = preflight(values, timer_check=timer)
    destination = Path('/var/lib/dwd-budget-test')
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = destination / 'preflight.json.tmp'
    with temp.open('w') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    temp.replace(destination / 'preflight.json')
    for name, status in report['checks'].items():
        print(name + ': ' + status)
    print('SEARCH_CANDIDATES: ' + str(len(report['candidates'])))
    for item in report['candidates'][:3]:
        print('SOURCE_SAMPLE: ' + item['domain'])
    print('PAID_GENERATION_REQUESTS: 0')
    print('TEST_STARTED: NO')
    print('REPORT: /var/lib/dwd-budget-test/preflight.json')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
