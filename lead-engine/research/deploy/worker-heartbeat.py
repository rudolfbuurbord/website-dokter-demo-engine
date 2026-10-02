#!/usr/bin/env python3
"""Read-only server telemetry. No provider calls or worker starts."""
import json
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen
from datetime import datetime, timezone

ENV = Path('/etc/dwd-research.env')
BASE = 'https://skdjbifmtleiogbkqwid.supabase.co'

def read_json(path):
    try:
        p = Path(path)
        if p.stat().st_size > 1048576:
            return {}
        value = json.loads(p.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}

def select_fields(value, allowed):
    return {k: v for k, v in value.items() if k in allowed
            and (v is None or isinstance(v, (str, int, float, bool)))
            and len(str(v)) <= 256}

def service_state(unit):
    try:
        p = subprocess.run(['systemctl', 'show', unit, '--property=ActiveState,SubState,Result'],
                           capture_output=True, text=True, timeout=5, check=True)
        return dict(line.split('=', 1) for line in p.stdout.splitlines() if '=' in line)
    except (OSError, subprocess.SubprocessError):
        return {'Result': 'STATUS_UNAVAILABLE'}

def collect():
    return {
        'schema_version': 1,
        'observed_at': datetime.now(timezone.utc).isoformat(),
        'deployment': select_fields(read_json('/var/lib/dwd-deploy/status.json'),
            {'time', 'status', 'commit', 'stage', 'error'}),
        'installed': select_fields(read_json('/var/lib/dwd-deploy/installed.json'), {'commit', 'image'}),
        'worker': service_state('dwd-qualified-test.service'),
        'deployment_timer': service_state('dwd-pull-qualified.timer'),
    }

def credentials():
    values = {}
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        values[k.strip()] = v.strip().strip('\"\'')
    if values.get('SUPABASE_URL', '').rstrip('/') != BASE:
        raise ValueError('PROJECT_MISMATCH')
    key = values.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not key:
        raise ValueError('KEY_MISSING')
    return key

def send(payload, key):
    request = Request(BASE + '/rest/v1/rpc/dwd_record_worker_heartbeat',
        data=json.dumps({'p_payload': payload}).encode(), method='POST',
        headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with urlopen(request, timeout=15) as response:
        if response.status not in (200, 204):
            raise RuntimeError('HEARTBEAT_REJECTED')

def main():
    try:
        send(collect(), credentials())
        print('HEARTBEAT_SENT')
        return 0
    except Exception as error:
        # Never print exception text: credentials/response bodies may be sensitive.
        print('HEARTBEAT_FAILED:' + type(error).__name__)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
