#!/usr/bin/env python3
"""Fixed-branch pull deployment. No credentials in git, logs or test containers."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from datetime import datetime, timezone

STATE = Path('/var/lib/dwd-deploy')
REPO = Path('/opt/dwd')
UNIT = Path('/etc/systemd/system/dwd-qualified-test.service')
DATA = Path('/var/lib/dwd-qualified-test')
SERVICE = 'dwd-qualified-test.service'
BRANCH = 'lead-budget-test-v1'
MANIFEST = 'lead-engine/research/deploy/qualified-release.json'

def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True, timeout=900)

def atomic(path, text):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(text)
    tmp.replace(path)

def report(status, **fields):
    record = dict(time=datetime.now(timezone.utc).isoformat(), status=status, **fields)
    atomic(STATE / 'status.json', json.dumps(record, indent=2) + '\n')
    with (STATE / 'history.jsonl').open('a') as f:
        f.write(json.dumps(record) + '\n')
    print(json.dumps(record), flush=True)

def busy():
    result = run('systemctl', 'show', '-p', 'ActiveState', '--value', SERVICE).stdout.strip()
    return result not in ('inactive', 'failed', '') or run('docker', 'inspect', 'dwd-qualified-test', check=False).returncode == 0

def unit_text(image):
    return f'''[Unit]
Description=DWD bounded 100-lead test (existing cumulative EUR1 budget)
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/flock -n {DATA}/run.lock /usr/bin/docker run --rm --name dwd-qualified-test --init --shm-size=256m --security-opt seccomp=/opt/dwd-seccomp.json --env-file /etc/dwd-research.env --mount type=bind,src={DATA},dst=/state {image} node qualified-cli.mjs
ExecStop=-/usr/bin/docker stop --time 20 dwd-qualified-test
TimeoutStartSec=6h
TimeoutStopSec=30s
Restart=no
UMask=0077
StandardOutput=journal
StandardError=journal
'''

def deploy():
    stage = 'fetch'
    target = None
    try:
        run('git', '-C', str(REPO), 'fetch', '--quiet', 'origin', BRANCH)
        manifest = json.loads(run('git', '-C', str(REPO), 'show', 'FETCH_HEAD:' + MANIFEST).stdout)
        target = manifest.get('commit', '')
        if not re.fullmatch('[0-9a-f]{40}', target) or manifest.get('mode') not in ('hold', 'run'):
            raise ValueError('Invalid release manifest')
        if manifest['mode'] == 'hold':
            report('HELD', commit=target)
            return
        run('git', '-C', str(REPO), 'merge-base', '--is-ancestor', target, 'FETCH_HEAD')
        # A released version gets ONE launch attempt, even after process/server crash.
        # A failed run requires a new reviewed commit, not a blind repeated paid retry.
        marker = STATE / ('attempted-' + target)
        if marker.exists():
            return
        if busy():
            report('WAITING_FOR_IDLE', commit=target)
            return
        if run('systemctl', 'is-active', '--quiet', 'dwd-research-docker.timer', check=False).returncode == 0:
            raise ValueError('Old research timer is active')
        stage = 'build'
        image = 'dwd-research:release-' + target
        with tempfile.TemporaryDirectory(prefix='release-', dir=STATE) as folder:
            archive = Path(folder) / 'code.tar'
            run('git', '-C', str(REPO), 'archive', '--output=' + str(archive), target, 'lead-engine')
            run('tar', '-xf', str(archive), '-C', folder)
            source = Path(folder) / 'lead-engine'
            run('docker', 'build', '-t', image, '-f', str(source / 'research/Dockerfile'), str(source))
        stage = 'tests'
        # No network, secrets, host state, docker socket or paid API access in tests.
        run('docker', 'run', '--rm', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            image, 'node', '--test', 'four-criteria.test.mjs', 'replay.test.mjs', 'company-name.test.mjs')
        if busy():
            report('WAITING_FOR_IDLE', commit=target)
            return
        stage = 'install'
        uid = int(run('docker', 'run', '--rm', '--network=none', '--entrypoint=id', image, '-u').stdout)
        gid = int(run('docker', 'run', '--rm', '--network=none', '--entrypoint=id', image, '-g').stdout)
        DATA.mkdir(parents=True, exist_ok=True)
        os.chown(DATA, uid, gid)
        os.chmod(DATA, 0o700)
        old = UNIT.read_text() if UNIT.exists() else None
        if old is not None:
            atomic(STATE / 'previous.service', old)
        atomic(UNIT, unit_text(image))
        try:
            run('systemctl', 'daemon-reload')
            run('systemctl', 'reset-failed', SERVICE, check=False)
            atomic(marker, datetime.now(timezone.utc).isoformat())
            stage = 'start'
            run('systemctl', 'start', '--no-block', SERVICE)
        except Exception:
            if old is not None:
                atomic(UNIT, old)
            else:
                UNIT.unlink(missing_ok=True)
            run('systemctl', 'daemon-reload', check=False)
            raise
        atomic(STATE / 'installed.json', json.dumps(dict(commit=target, image=image)))
        report('LAUNCH_SUBMITTED', commit=target, image=image,
               note='Submission is not proof of worker success; inspect worker report/journal.')
    except Exception as error:
        # Do not emit subprocess output: it could contain URLs or secrets.
        report('DEPLOY_ERROR', commit=target, stage=stage, error=type(error).__name__)
        raise SystemExit(1)

if __name__ == '__main__':
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'deploy.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit(0)
        deploy()
