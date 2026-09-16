# De Website Dokter — Lead Engine

Canonical database: `skdjbifmtleiogbkqwid`, private `lead_engine` schema.
The API entry point is the service-only `public.le_command(p_action, p_payload)`.
Source is versioned alongside the Demo Engine, under `lead-engine/`.

This engine never sends email. External dispatch stays disabled until a configured
provider, verified batch and explicit activation are present. A READY list is not
an authorization to send. Supabase records implementation and integration status.

See `docs/OPERATIONS.md` for bootstrap queries, commands, recovery and limitations.
