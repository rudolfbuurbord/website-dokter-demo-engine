#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -u)" = 0 ]] || { echo "Run as root."; exit 1; }
test -s /etc/dwd-research.env
test -s /opt/dwd-seccomp.json
docker info >/dev/null
docker image inspect dwd-research:pilot >/dev/null
# Check required variables without printing any values.
docker run --rm --env-file /etc/dwd-research.env dwd-research:pilot node -e 'for (const k of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","RESEARCH_RUN_ID","OPENAI_API_KEY"]) if (!process.env[k]) { console.error("Missing: "+k); process.exit(1); }'
# Confirm database connectivity before enabling unattended work.
docker run --rm --env-file /etc/dwd-research.env dwd-research:pilot node cli.mjs status
chmod 600 /etc/dwd-research.env
# Do not run the earlier native Playwright service alongside Docker.
systemctl disable --now dwd-research.timer 2>/dev/null || true
systemctl stop dwd-research.service 2>/dev/null || true
install -m 644 /opt/dwd/lead-engine/research/deploy/dwd-research-docker.service /etc/systemd/system/
install -m 644 /opt/dwd/lead-engine/research/deploy/dwd-research-docker.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/dwd-research-docker.service /etc/systemd/system/dwd-research-docker.timer
systemctl daemon-reload
systemctl enable --now dwd-research-docker.timer
systemctl start dwd-research-docker.service
systemctl is-active dwd-research-docker.timer
journalctl -u dwd-research-docker.service -n 6 --no-pager
echo "DWD worker connected. Queue polling every 30 seconds; database run status controls new tasks."
