# Qualification in one research round

Contract: `one-pass-qualification-v1` (owner decision, 2026-09-21).

A request to check domains includes website suitability, active business evidence,
identity matching and a sourced company email. Codex completes the bounded source
research during that same task, without another approval turn. A visual-only table
is an intermediate result, not completed qualification.

Reuse existing captures and source records. At most one focused external research
round and one independent network recheck per problem website. No paid retries.
The Hetzner capture worker does not yet contain an external search executor.

## Atomic completion

Call `public.le_command('start_work', {actor, task})`, read the current Bibles,
then `public.le_command('complete_qualification', payload)` for each dossier.
The legacy `qualify` action goes through the same validation. Do not set
list membership APPROVED directly.

Payload:

- `member_id`, `reviewer`, `start_receipt_id`.
- `route_id`: already stored, enabled, non-inferred EMAIL belonging to this company.
  Register newly found contact evidence using the existing contact command first.
- `activity`: `status: ACTIVE`, `basis`, `event_date`, `evidence`.
  Allowed bases: RECENT_REVIEW, RECENT_PROJECT, RECENT_POST, RECENT_VACANCY,
  REGISTRY_ACTIVE, OWNER_CONFIRMED. Event within 365 days; a directory listing or
  copyright year alone does not qualify. UNKNOWN is a legitimate result.
- `identity`: `status: CLEAR`, `company_match_confirmed: true`, `evidence`.
  Establish why the company, website and selected contact refer to the same business.
- Each evidence entry has `source_url`, `observed_at` and a concrete `finding`.
  Evidence observations must be within 30 days. Do not refresh dates without checking.
- Optional `assessment`: `{value, source_url, observed_at}` containing the canonical
  website_outreach_assessment, current lead Bible version and matching reviewer.
  Otherwise the latest stored canonical assessment is used. Model proposals alone
  never become accepted assessments. Existing nonvisual route requirements apply.

The function saves facts, updates confirmed company state, selects the contact and
sets membership APPROVED, REJECTED or PENDING atomically. The result reports the
last as NEEDS_EVIDENCE and lists specific missing checks. Existing facts can be
reused if still current. A new uncertainty replaces old certainty for that field.
An ambiguous identity, merged company, guessed email, stale evidence or missing
website assessment cannot become APPROVED. A documented unsuitable website can
be REJECTED without spending another research round on it.

Deliverability verification, suppression and dispatch controls belong to outreach.
This command never sends mail, reserves outreach or authorizes launch.

## Existing worker integration

The database trigger on research_tasks appends `output.qualification_result` when
the existing Hetzner worker finishes with REVIEW or ERROR. Raw capture data/error
is preserved. Missing activity/identity/contact evidence stays explicit. Database
finalization is live without a Docker rebuild; independent web research still
runs in the active Codex session. Run pause/budget are unchanged.

## Deployment and verification

Apply database/one-pass-qualification.sql, database/one-pass-command.sql and
database/one-pass-research.sql via
a Supabase migration. The latter preserves the live command router and adds the
completion action. Test with tests/one-pass-qualification.sql (ROLLBACK fixtures).
The migration was deployed and regression tested on 2026-09-21. The four Bibles
were versioned together. Existing candidates were not bulk approved.
Research finish replay ignores only the server-generated qualification_result,
so a repeated identical capture commit still succeeds without redoing research.
