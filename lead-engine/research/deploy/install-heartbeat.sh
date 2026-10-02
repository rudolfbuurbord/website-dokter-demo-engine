#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root on Hetzner'; exit 1; }
test -s /etc/dwd-research.env
python3 -m py_compile "$(dirname "$0")/worker-heartbeat.py"
install -m 700 "$(dirname "$0")/worker-heartbeat.py" /usr/local/sbin/dwd-worker-heartbeat
cat > /etc/systemd/system/dwd-worker-heartbeat.service <<'UNIT'
[Unit]
Description=DWD private server status heartbeat
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /usr/local/sbin/dwd-worker-heartbeat
UMask=0077
TimeoutStartSec=45
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
UNIT
cat > /etc/systemd/system/dwd-worker-heartbeat.timer <<'UNIT'
[Unit]
Description=Report DWD server status every two minutes
[Timer]
OnBootSec=30s
OnUnitInactiveSec=2min
Unit=dwd-worker-heartbeat.service
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now dwd-worker-heartbeat.timer
systemctl start dwd-worker-heartbeat.service
echo 'HEARTBEAT INSTALLED. Verify receipt in Supabase.'
