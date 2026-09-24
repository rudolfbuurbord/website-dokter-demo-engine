#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run on the Hetzner server as root.'; exit 1; }
for f in /etc/dwd-research.env /opt/dwd-seccomp.json; do [[ -s $f ]] || { echo "Missing $f"; exit 1; }; done
if systemctl is-active --quiet dwd-research-docker.timer; then echo 'Old timer is active; stop it first.'; exit 1; fi
if systemctl is-active --quiet dwd-qualified-test.service; then echo 'Test already running.'; exit 0; fi
release=$(cd "$(dirname "$0")/../.." && pwd)
docker build -t dwd-research:qualified-test -f "$release/research/Dockerfile" "$release"
install -d -m 700 -o 1000 -g 1000 /var/lib/dwd-qualified-test
cat > /etc/systemd/system/dwd-qualified-test.service <<'UNIT'
[Unit]
Description=DWD 100 new painter leads, EUR1 incremental cap
After=docker.service network-online.target
Requires=docker.service
StartLimitIntervalSec=1800
StartLimitBurst=3
[Service]
Type=oneshot
ExecStart=/usr/bin/flock -n /var/lib/dwd-qualified-test/run.lock /usr/bin/docker run --rm --name dwd-qualified-test --init --shm-size=256m --security-opt seccomp=/opt/dwd-seccomp.json --env-file /etc/dwd-research.env --mount type=bind,src=/var/lib/dwd-qualified-test,dst=/state dwd-research:qualified-test node qualified-cli.mjs
ExecStop=-/usr/bin/docker stop --time 20 dwd-qualified-test
TimeoutStartSec=6h
TimeoutStopSec=30s
Restart=on-failure
RestartSec=60s
UMask=0077
StandardOutput=journal
StandardError=journal
UNIT
systemctl daemon-reload
systemctl start --no-block dwd-qualified-test.service
echo 'Test service submitted. It continues if SSH disconnects.'
echo 'Status: systemctl status dwd-qualified-test.service --no-pager'
echo 'Report: cat /var/lib/dwd-qualified-test/report.json'
echo 'On stop: cat /var/lib/dwd-qualified-test/stopped.json'
