# EUR 1 bounded test — implementation status

Implemented: SQLite atomic EUR reservations (integer micro-EUR), concurrent process
protection in the wallet, immutable run configuration, unknown-outcome retention,
no paid retries, restart checkpoints, queue processing beyond eight candidates,
stage cost report and unique website attempt/render counters. The Docker service
has a process lock. Existing `once` behaviour remains unchanged.

This is not yet the autonomous 100-qualified-lead product. No paid run is activated.
Do not label model proposals as APPROVED or set calibration_approved automatically.
The current production policy requires reviewed visual evidence. The worker keeps
that existing gate. Batch target counts only database-reported APPROVED outcomes,
not models' ELIGIBLE proposals; final totals still require a fresh database query.

## Remaining launch requirements

1. Real new candidate source records; source URLs verified and deduplicated against
   existing companies, domains, routes, and previous paid research. Bing RSS returned
   zero records on the target server. There is no working autonomous sourcing adapter.
2. A dedicated research run containing only those candidates, and a manifest with
   `run_id`, `new_company_ids`, `expires_at`, `excludes_existing_approved: true`, and
   `source_urls_verified: true`. Never set these booleans without checking the DB.
3. Check current provider prices, conservative FX/tax conversion and infrastructure
   allowances. `DWD_INFRA_UPPER_MICRO_EUR` must cover the entire test's incremental
   compute/storage/egress. Zero is only valid if verified included in existing plans.
   A ledger cannot bound an unpriced external invoice. Expired quotes block new calls.
4. Verified visual calibration and a policy-compliant final-qualification executor.
   This implementation does not weaken or fabricate calibration approval.
5. Python 3 with sqlite3 in the Docker image, writable /state owned by its pwuser,
   and a database USD cap in addition to the EUR guard. No new subscriptions.

`batch-cli.mjs` uses the same Supabase variables as cli.mjs and requires
`DWD_TEST_MANIFEST`, `DWD_EUR_PER_USD_UPPER`, `DWD_TAX_MULTIPLIER`,
`DWD_PRICE_VALID_UNTIL`, and `DWD_INFRA_UPPER_MICRO_EUR`. Paid mode additionally
requires `ALLOW_PAID=true`, `DWD_COSTS_VERIFIED=true` and OPENAI_API_KEY.
The absolute wallet cap is EUR 1; initialization cannot increase it on restart.

Run tests without API calls:
```
python3 -m unittest discover -s test -p '*_test.py'
node --test test/*.test.mjs
```

The EUR settlement numbers use the configured conservative FX/tax conversion,
not a claimed exact bank charge. Unknown reservations remain separately visible.
The existing Supabase research_spend ledger retains original token usage, USD cost
and provider receipt. Fixed Hetzner/ChatGPT subscriptions are reported separately.
