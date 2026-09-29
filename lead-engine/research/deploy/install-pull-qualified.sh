#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run on Hetzner as root.'; exit 1; }
for cmd in python3 git docker systemctl flock tar; do command -v "$cmd" >/dev/null; done
for file in /etc/dwd-research.env /opt/dwd-seccomp.json; do
  [[ -s "$file" ]] || { echo "Missing $file"; exit 1; }
done
git -C /opt/dwd rev-parse --git-dir >/dev/null
systemctl is-active --quiet docker
if systemctl is-active --quiet dwd-research-docker.timer; then
  echo 'Old research timer is still active. Installation stopped.'; exit 1
fi
install -d -m 700 /var/lib/dwd-deploy
install -m 700 "$(dirname "$0")/pull-qualified.py" /usr/local/sbin/dwd-pull-qualified
cat > /etc/systemd/system/dwd-pull-qualified.service <<'UNIT'
[Unit]
Description=Install explicitly released DWD qualification worker
After=network-online.target docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /usr/local/sbin/dwd-pull-qualified
Environment=GIT_TERMINAL_PROMPT=0
UMask=0077
TimeoutStartSec=30min
UNIT
cat > /etc/systemd/system/dwd-pull-qualified.timer <<'UNIT'
[Unit]
Description=Check DWD release pointer every two minutes
[Timer]
OnBootSec=1min
OnUnitInactiveSec=2min
Unit=dwd-pull-qualified.service
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now dwd-pull-qualified.timer
systemctl start --no-block dwd-pull-qualified.service
echo 'AUTODEPLOY INSTALLED. First deployment submitted; worker success not yet verified.'
echo 'Deployment status: cat /var/lib/dwd-deploy/status.json'
echo 'Worker report: cat /var/lib/dwd-qualified-test/report.json'
