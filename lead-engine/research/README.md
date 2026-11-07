# Scripted Lead Research V1 — PILOT, not yet deployed

Purpose: replace expensive interactive browsing with deterministic website capture
and bounded model calls. No Smartlead, messaging, production qualification or
outreach actions exist in this worker.

## What is built
- Private Supabase research queue, run budget in USD, lease fencing and two maximum
  capture attempts; existing company/member IDs retained.
- Mandatory current four-Bible startup receipt on every task. Version changes
  block result commits. The Lead and Schilders Bibles + approved reference judgments
  are supplied to the visual model; other Bibles govern the application contract.
- Playwright desktop screenshots of homepage top, middle and lower sections, plus
  the supplied page if different; one discovered same-domain contact page.
- Public IPv4 DNS-pinned proxy for all browser HTTP(S) traffic, no form submission,
  POST, downloads, service workers or WebSockets. Browser starts without API keys
  in its environment. Cross-domain redirect requires review.
- Private screenshot objects with SHA256, URL, timestamp; sourced contact links.
- GPT-4.1 mini structured proposal with image-index evidence, prompt-injection
  instruction boundaries, actual token usage and provider request receipt.
- Atomic budget reservation before model call. Unknown provider outcomes retain
  reservations; no automatic paid retry. Actual cost is conservatively accounted
  at uncached standard rates (not invoice reconciliation).
- Capture-only default; model proposals never become production qualification.
- Restart-safe task results, no blind duplicate work, explicit errors, status API.

## Deliberate rollout boundaries
Phase 1 is the existing100 pilot. Current run is PAUSED with $0 spend authorization.
No server or API credentials have been connected. No model calls have been made.
A list is not qualified merely because a proposal exists.

Not included in V1: search sourcing adapter, OpenAI Batch submit/poll, automatic
production promotion, mobile capture, comprehensive technical audit, automatic
email-engine offer, report UI and external watchdog. The existing handoff API remains
unchanged. Model quality, live-browser reliability, throughput and true costs must
be validated on the deployed server before scale-up. 24/7 execution is not live yet.

The pilot uses synchronous standard-rate model requests so failures/costs can be
measured simply. Earlier discounted Batch budgets must NOT be presented as the
measured pilot cost. Batch support follows a successful pilot.

## Local tests (no credentials, no paid network calls)
```
node --test lead-engine/research/test/*.test.mjs
```
`test/database.sql` runs contract assertions against the existing list in a
transaction that rolls back all test records. Run after applying `database/research.sql`
to a fresh environment. In production the migration was already applied via Supabase.

## Server installation — Ubuntu 24.04 x86_64, Node 22+
Use a separate unprivileged `dwd-research` user and directory `/opt/dwd` for this repo.
Do not run the untrusted browser as root or disable Chromium sandboxing.

1. Install Node 22+, clone this branch at `/opt/dwd`.
2. `npm ci --prefix /opt/dwd/lead-engine/research`
3. Install browser and Linux dependencies using the pinned Playwright CLI:
   `PLAYWRIGHT_BROWSERS_PATH=/opt/dwd-browsers node /opt/dwd/lead-engine/research/node_modules/playwright/cli.js install --with-deps chromium`
4. Allow the unprivileged worker to read `/opt/dwd-browsers`; create its writable
   home `/var/lib/dwd-research`. Verify Chromium sandbox works under the host's
   user-namespace/AppArmor configuration. Never remove sandboxing to get past errors.
5. Copy `.env.example` into `/etc/dwd-research.env`, owner root, mode 0600.
   Populate Supabase URL + backend service key, run UUID, and only when needed an
   OpenAI project API key. No keys in Git, screenshots, chat or logs.
6. Start with `ALLOW_PAID=false`. Use the status command first. An active capture-only
   run can have budget zero. Claiming remains blocked until the run is ACTIVE.
7. Run a single task, inspect screenshot upload and source URLs; then run the pilot.
   Use a new run_key for model evaluation after a capture-only pilot: do not reset
   completed task statuses and accidentally repeat charges.
8. For paid pilot choose an explicit maximum run budget, set `ALLOW_PAID=true`,
   and supply an API key. `budget_usd` is a cap on this worker's model requests,
   not on hosting, storage, other API projects or future search provider costs.
9. Install `deploy/dwd-research.service` and `.timer` under `/etc/systemd/system/`.
   Enable timer only after the single-task deployment test. One task at a time;
   systemd prevents overlapping invocations of this service. The process starts
   every task with the current Bible. Empty queues generate no model calls.
10. Stop with `systemctl stop dwd-research.timer` and set run status PAUSED.
    In-flight requests may still complete; no new reservations are accepted.

Activation SQL (backend only; use the actual UUID and chosen budget):
```
update lead_engine.research_runs
set status='ACTIVE', budget_usd=0
where id='<run_uuid>';
```

## Current pilot
`existing100-scripted-pilot-v1`, 20 members selected deterministically from the
existing research list. Missing website candidates become WEBSITE_UNKNOWN, never
"no website" leads. Existing list qualification remains unchanged.

Retrieve progress: `select public.le_research('status','{}');`
Review outputs: join `lead_engine.research_tasks` to `companies` by company_id.
Evidence is private: create short-lived signed URLs through an authorized backend
when reviewing. Store stable bucket/path/hash references, not expiring signed URLs.

## Promotion after calibration
A human-reviewed result must be converted into the existing
`website_outreach_assessment` and `website_technical_review` contracts, with actual
scope/limitations and stable proof references. Contact facts are imported through
`le_command('contact',...)`, then existing qualify + handoff_check/offer gates.
Do not set `calibration_approved=true` solely because a model claims eligibility.
No rule is weakened to reach a volume target.

## Verification 2026-09-17
- 11 research Node tests + 18 existing engine tests passed.
- Supabase rollback-only integration checks passed: paused default, idempotent seed,
  exclusive lease, budget rejection, duplicate reservation rejection, wrong-lease
  rejection, finish replay, one observation, backend-only API and policy gate.
- Live pilot seeded: bdb05ab6-1cd3-47d9-8bec-2269641d4902 (20 QUEUED, PAUSED, $0).
- Chromium installed locally, but sandboxed launch cannot run in this root execution
  environment. No sandbox bypass was used. Real capture + upload + paid model
  integration remains a deployment acceptance test; unit tests use mocked providers.
- Security advisor: informational RLS-without-policy notices for intentionally
  backend-only tables; anonymous/authenticated grants explicitly revoked.
