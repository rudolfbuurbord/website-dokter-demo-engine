# Private evidence review
Deployed function: research-evidence-review (project skdjbifmtleiogbkqwid).
Storage bucket lead-research-evidence remains private.
The function uses custom authentication (verify_jwt=false), SHA-256 hashes of random 32-byte hex tokens, task-scoped paths and a maximum 15-minute grant.
It uses the server's built-in service credential; never expose that credential.

## Provisioning SQL (already applied)
```sql
create table public.research_evidence_access (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 task_id uuid not null references lead_engine.research_tasks(id),
 paths jsonb not null check (jsonb_typeof(paths)='array'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
alter table public.research_evidence_access enable row level security;
revoke all on public.research_evidence_access from public,anon,authenticated;
grant select on public.research_evidence_access to service_role;
```

## Owner management workflow
1. Generate a cryptographically random 32-byte token and its SHA-256 hex digest locally. Never put the raw token in logs, GitHub, chat or query strings.
2. Through the authenticated management SQL connector only, insert the hash, selected task ID, that task's output->'images', and now()+interval '10 minutes'. Never accept caller-supplied paths from an unauthenticated client.
3. GET https://skdjbifmtleiogbkqwid.supabase.co/functions/v1/research-evidence-review?index=0 with x-evidence-token header. Index selects one image in the grant. Verify downloaded SHA-256 against original metadata.
4. Delete the grant by token_hash after review. Delete expired grants during housekeeping. Expired entries cannot authorize downloads even before deletion.
No public token-issuance API exists. Management access is required to issue each new grant.
Auth failures return 401; absent/out-of-scope images 404. No CORS wildcard and no-store responses.
This permits future reviews without changing bucket visibility or asking the owner to download images.

## Verification 2026-09-20
Unauthenticated request: 401.
Authorized request: 200, 134648 bytes, SHA-256 matched original homepage screenshot.
All three original Arthico screenshots downloaded and hashes matched.
Anonymous and authenticated roles have no SELECT permission; service_role has SELECT.
The review shows De Kleurkwast branding at the stored arthico.com URL. Resolve business identity before qualification. Original model proposal remains unmodified.
