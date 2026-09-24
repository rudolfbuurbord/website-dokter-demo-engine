#!/bin/bash
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Voer uit op Hetzner als root.'; exit 1; }
test -s /etc/dwd-serper.env
test -s /etc/dwd-research.env
if systemctl is-active --quiet dwd-research-docker.timer; then
  echo 'Oude onderzoekstimer is actief; installatie gestopt.'; exit 1
fi
if systemctl is-active --quiet dwd-serper-source.service; then
  echo 'Serper-aanvoer draait al.'; exit 0
fi
SOURCE_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"
install -d -m 700 /var/lib/dwd-budget-test/serper /opt/dwd-budget-source
install -m 600 "$SOURCE_DIR/serper-source.py" /opt/dwd-budget-source/serper-source.py
cat > /etc/systemd/system/dwd-serper-source.service <<'UNIT'
[Unit]
Description=DWD Serper bounded candidate sourcing (no AI or qualification)
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/flock -n /var/lib/dwd-budget-test/serper/source.lock /usr/bin/python3 /opt/dwd-budget-source/serper-source.py
TimeoutStartSec=30min
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/dwd-budget-test/serper
StandardOutput=journal
StandardError=journal
UNIT
systemctl daemon-reload
systemctl start --no-block dwd-serper-source.service
echo 'Serper-aanvoer gestart op de server. Maximaal 40 zoekaanvragen totaal; geen AI-beoordelingen.'
echo 'Voortgang: journalctl -u dwd-serper-source.service -n 8 --no-pager'
