# Lead Engine V1 — operations and handover

## Start here in every new chat

Project: `skdjbifmtleiogbkqwid` (De Website Dokter).
Database schema: `lead_engine` (private). Business source of truth remains Supabase.
Read these before making changes:

```sql
select public.le_command('status');
select * from lead_engine.components;
select * from lead_engine.releases order by deployed_at desc;
select key,title,content_md from lead_engine.runbooks;
select jobid,jobname,schedule,active from cron.job where jobname='lead-engine-tick';
select * from lead_engine.incidents where status <> 'RESOLVED' order by created_at;
```

Also read the current `lead-intelligence-bible`, `cold-email-bible`,
`operations-crm-finance-bible`, and `lead-engine-chat-context` in `public.bibles`
joined to their current `public.bible_versions`.

Supabase registers are authoritative for runtime status. A plan being locked is
not evidence of a working integration. The release row records source commit and
validation; source code is under `lead-engine/` in the existing Demo Engine repo.

## What is running

- Canonical UUID company identities, conservative source/KvK/domain matching,
  repeatable imports, conflict quarantine and immutable source observations.
- Contacts and contact routes with company ownership constraints and evidence.
- Website job queue, bounded retries, leases and stale-result rejection.
- Supabase Edge Function `lead-engine`, custom backend authentication.
- Every minute `cron:lead-engine-tick` recovers stalled jobs, collects worker HTTP
  results, detects stale queues and launches one due website audit when necessary.
- Website audits read a homepage and at most two same-origin contact/about links.
  They extract actual mailto/tel links with exact source URLs. This is static HTML
  research, not browser/visual/mobile/SEO-performance certification.
- Lists, supported filters, traceable builds, manual evidence-based qualification,
  batch approval, reservations, selection snapshots and a dispatch outbox.
- Fresh verification/suppression checks, one active company and one active email,
  a second gate check at dispatch, and no automatic resend after uncertain delivery.
- Outcome import, company holds on replies/negative/stop, idempotent positive-to-CRM
  handoff and a facts/provenance payload for the Demo Engine.
- Cost evidence ledger, audit history, implementation and integration registers.

## Explicit boundaries

- No sourcing supplier selected/connected. Use supplied records (JSON/CLI or RPC).
- No live email verification supplier. Import real supplier results with evidence;
  never mark a found mailbox valid simply because it exists on a website.
- Smartlead outbound adapter and signed event routing from that account are not
  connected. `outreach_enabled=false`; no campaign/email is sent by this engine.
- Owner/LinkedIn research is currently supplied evidence, not an autonomous crawler.
- No predictive scoring. List Health exposes component diagnostics; numerical
  weights are deliberately unset until decided.
- No frontend dashboard was built. Status and drill-down are available via RPC/SQL.
- The internal watchdog cannot detect the database itself being completely down.
  An independent external watchdog remains NOT_CONFIGURED.
- Full backup restore and provider failure drills remain pre-scale requirements.
- Finance payment integration is not built here: WON/REVENUE events are blocked
  until they can be tied to confirmed canonical payments.
- Demo payload is research input, not a publish authorization. It requires positive
  interest and still needs the Demo Engine's asset/provenance/QA checks.
- V1 automatic identity merging is conservative; ambiguous identities require a
  reviewed resolution, not fuzzy name matching or arbitrary manual ID reassignment.

## API / security

`public.le_command(p_action text, p_payload jsonb)` is SECURITY INVOKER and callable
only by `postgres` and server-side `service_role`. Internal tables have RLS and no
anon/authenticated grants. No frontend should receive the service key.

Edge endpoint: `https://skdjbifmtleiogbkqwid.supabase.co/functions/v1/lead-engine`.
POST JSON `{"action":"status","payload":{}}` with a server credential.
Gateway JWT verification is disabled because the function performs custom auth:
exact service key OR a revocable SHA-256-scoped worker credential. Ordinary user
JWTs and missing/incorrect credentials get 401. The worker token can only run
`status` and `run_once`. It cannot import records, qualify leads or dispatch.

The scheduler token is in Vault under `lead_engine_worker_v1`; the private table
`worker_tokens` contains only its digest. Never print, export, log or commit the
decrypted token. To revoke it, disable its row; rotate via a new Vault secret/digest.

The website fetcher refuses non-HTTPS, IP literals, local/reserved IPv4 ranges,
credentials in URLs and custom ports. It pins TCP to the checked IPv4 and validates
TLS/SNI against the original hostname. Redirects are validated again. IPv6-only
and unsupported content are blocked, not bypassed. Edge uses native TCP/startTls
because its Node compatibility layer does not implement lookup/SNI consistently.

## Normal workflow

1. `ingest`: provide `source`, `external_id`, `source_url`, `company_name` and known
   facts. Optional `website` creates a WEBSITE_AUDIT job. Country/niche/active state
   are never guessed. Repeated identical payload returns the same IDs. Matching
   across sources preserves the canonical company ID. Contradictions are REVIEW.
2. `contact`: company_id, kind EMAIL/PHONE/WEBSITE, value, source_url; optionally
   contact_name and role. A generic verified info@ is usable; reader stays UNKNOWN.
3. `verification`: route_id, status, verifier, evidence_ref, checked_at. Existing
   public.email_verifications and public.email_suppressions are the shared truth.
4. `create_list`: name, purpose, niche, selection_logic. V1 NL only. `build_list`
   supports `city`, `limit` (1..1000) and descriptive `hypothesis`; unknown filters
   fail rather than being silently ignored. The build ends in QA.
5. `qualify`: member_id, APPROVED/REJECTED, reviewer and source_url. If a new/better
   contact is found, `select_route` selects it and resets qualification for review.
6. `ready_list`, `create_batch`, `approve_batch`: list needs at least one eligible
   member and explicit reviewer. Every member is gated again before reservation.
7. `reserve`: member_id, batch_id. Locks the company and creates an immutable
   selection snapshot and PENDING outbox entry atomically. No external send.
8. Only when an actual provider adapter is implemented and approved: enable the
   integration, call `prepare_dispatch`, make exactly one external request, then
   `complete_dispatch` with acknowledgement. Unknown delivery -> RECONCILE, not retry.
9. Feed provider-confirmed results through `outcome` with provider, stable event ID,
   reservation_id, event_type, occurred_at and evidence in data. POSITIVE creates or
   links one CRM opportunity and holds the company from new cold outreach.

Initial implementation defaults: email verification max age 14 days; qualification
max age 30 days; three job attempts; five-minute leases; minute-by-minute scheduler.
These are configurable engineering defaults, not empirically validated business
rules or previous user decisions. Health/cost gates govern later scaling.

## Recovery

- Pause: `select public.le_command('pause_processing');` Resume with resume_processing.
- Run `lead_engine.watchdog()` or wait for the next scheduled tick to recover leases.
- Inspect jobs, job_attempts and incidents. `retry_job` requires job_id + reason and
  creates a new job linked by an event; original attempts are preserved.
- EMAIL_VERIFY/CONTACT_RESEARCH/etc. enqueue as BLOCKED until an executor exists;
  LIST_BUILD is currently the synchronous `build_list` command.
- For uncertain dispatch, inspect the provider before changing status. Keep the
  company reserved until a definite sent/not-sent/stop confirmation exists.
- `block_company` requires company_id, reason and source_ref. Pending records cancel;
  already active external sequences need confirmed external stopping and an incident.
- A raw REPLY is conservatively held for classification. OOO handling needs a real
  classified provider event/adapter; do not automatically rotate a contact on it.
- Never release hard-bounce/unsubscribe suppression to make a gate pass.
- Manual canonical corrections use `correct_company` with evidence, reviewer and
  reason. Later source imports fill gaps but never overwrite those corrections.

## Important tables

| Question | Location |
|---|---|
| Where is the company? | companies, identifiers |
| Who/what can we contact? | contacts, contact_routes |
| Where did a fact originate? | sources, source_records, observations |
| What was researched? | website_audits |
| What is running or failed? | jobs, job_attempts, incidents |
| Why selected? | lists, list_members, build_runs, segments, experiments |
| Already being contacted? | reservations, outbox, company_blocks |
| What happened afterwards? | outcomes, crm_handoffs, public.crm_opportunities |
| What did it cost? | cost_entries (evidence-based, no invented zeros) |
| What code/config is live? | releases, components, integrations, settings |
| Did automation actually execute? | worker_invocations, cron.job_run_details |

## Validation and release

Run `node --test lead-engine/tests/engine.test.mjs` from repository root.
Run database tests in a transaction with ROLLBACK on an isolated/idle test database;
do not run the full test suite against a busy production queue. Fixtures use .invalid
domains and never send email. Initial deployment was tested before applying DDL and
again after deployment. Live website and concurrency fixtures were explicitly cleaned.

Source install order: database/schema.sql, operations.sql, automation.sql,
scheduler.sql, hardening.sql. Supabase migration history records applied versions.
Do not replay these additive installation scripts onto an already installed schema.
New changes need a new migration and a new release entry. Do not drop the schema as
a rollback: pause processing and revert only the failed version/function.

References used for implementation:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/functions/schedule-functions
- https://docs.deno.com/api/deno/~/Deno.startTls
