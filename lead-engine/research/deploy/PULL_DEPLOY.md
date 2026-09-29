# Qualified worker pull deployment

Bootstrap `install-pull-qualified.sh` once as root on the existing server, with
`pull-qualified.py` in the same directory. Reuses `/opt/dwd` origin authentication.
No GitHub Actions runner, inbound SSH key, extra paid service or model calls are
needed for deployment. Existing server/build resource consumption still applies.

The timer checks branch `lead-budget-test-v1` every two minutes. Only the exact
ancestor commit in `qualified-release.json` is eligible; ordinary branch commits
do not launch work. Change this pointer **last**, after reviewing code and tests.
The release must include `four-criteria.test.mjs`, `replay.test.mjs` and
`company-name.test.mjs`. Those tests run in the built Docker image without network,
credentials or host mounts. The puller itself is installed locally and does not
self-update from arbitrary repository scripts.

A running worker defers deployment. Each released SHA gets at most one launch
attempt. State and cumulative database budget are never deleted or reset. The
worker retains its EUR1 cap and technical-error reporting. A version completing,
failing or reaching its cap will not be restarted by the polling timer. New work
requires a new reviewed release. `mode: hold` prevents future launches but does
not terminate an already running worker.

Status: `/var/lib/dwd-deploy/status.json`, history: `history.jsonl` in that directory.
`LAUNCH_SUBMITTED` means only that systemd accepted the request. Check the worker
journal and `/var/lib/dwd-qualified-test/report.json` / `stopped.json` for results.
No automatic outbound notifications or remote log-reading access are installed.
Git/build/test errors are logged by stage; raw subprocess output is suppressed
to avoid accidentally disclosing authentication details. A failed build/test is
retried on a later poll, without launching paid work.

Previous service configuration is saved as `/var/lib/dwd-deploy/previous.service`.
Image tags are immutable per code SHA and retained. Failed service submission
restores the previous unit but does not automatically rerun paid work. Runtime
errors require investigation; there is no claim of automatic runtime rollback.
To revert code remotely, release a new commit containing the known-good files.
Previously attempted SHAs remain blocked deliberately.

Pause polling: `systemctl disable --now dwd-pull-qualified.timer`.
Stop current work separately: `systemctl stop dwd-qualified-test.service`.
No other timers, demo deployments, SQL migrations or outreach are modified.

Run deployment tests: `python3 lead-engine/research/deploy/pull-qualified.test.py`.
