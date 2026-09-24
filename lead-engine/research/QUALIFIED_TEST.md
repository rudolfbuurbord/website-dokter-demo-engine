# Bounded qualification test — 24 September 2026

The existing 195 Serper candidate records feed `qualified-cli.mjs`. No additional search calls. Existing companies/domains/emails are excluded again at atomic finalization. The target is 100 **new** approved members of the existing ANGLE_01 list; this is a stopping target, not a guarantee within €1.

## Execution

- Current four Bible versions are fetched, saved and checked against the reviewed compact policy version pins; changes stop work.
- Five owner-judged sites are captured and compared against their expected visual verdicts. Any mismatch or inaccessible reference stops automatic qualification. Passing this small benchmark is not proof of general model accuracy.
- Each candidate receives desktop screenshots, published contact extraction and one structured visual/business assessment. Literal source quotes, sourced email, business identity and current production gates are required. Cookie obstruction/failed capture never becomes a bad-site verdict. Mobile is explicitly untested.
- One private evidence upload per capture. Benchmark results, raw model responses, usage, facts, screenshots and database decisions are retained. The automated reviewer is named `budget-worker-v1`, never disguised as a human.
- The complete ingest/contact/membership/qualification transaction rolls back on an inconsistent production verdict. Existing approvals cannot be changed. New ingest-created generic audit jobs are blocked because this worker already supplies the capture.
- No deliverability check, email, Smartlead or outreach activation.

## Costs

Backend serializes every paid reservation with a PostgreSQL advisory lock. Maximum committed upper bound €1 including €0.10 retained provision for 40 existing Serper credits and incremental storage/egress. Model usage: GPT-4.1-mini-2025-04-14, $0.40/M input, $1.60/M output, ignoring cache discounts conservatively. Monetary guard uses USD × 1.50 EUR upper conversion × 1.21 tax upper; these are protective bounds, not an invoice exchange rate. Quote expires 27 September 2026 UTC. Existing fixed subscriptions are reported separately, not newly purchased.

The report retains actual token counts, USD usage cost, conservative EUR amounts, open reservations and provider request IDs. Serper free-trial credit/invoice status is not independently verified; no new pack is bought. Provider invoices are needed for exact final charged EUR. The remaining €0.10 is a provision, not a measured charge. Stop before a call whose worst-case reservation no longer fits. Timeout/ambiguous result keeps its full reservation and is never paid again.

## Recovery and reports

`dwd-qualified-test.service` runs independently of SSH, with up to three service starts on failure. A paid reservation is globally idempotent and never repeated. Local completed reviews can be finalized after a transient database failure. A started but incomplete capture/model attempt is skipped on recovery rather than paid again. Resuming with lost local state preserves the remote spending guard; do not clear database cost events.

Reports `/var/lib/dwd-qualified-test/report.json` and `stopped.json`; raw evidence cache and receipts in same directory. Database event types BUDGET100_RESERVED / SETTLED / CALIBRATED / FINISHED / SKIPPED. Count candidate attempts, successfully rendered sites, page loads, benchmark attempts, approvals/rejections/skips separately.

Validation: Node tests; SQL transaction rollback integration verifies full canonical approval and replay without persisting synthetic leads. Live model calibration and actual image build remain server runtime checks; do not call the test running until its service/event state confirms it.
