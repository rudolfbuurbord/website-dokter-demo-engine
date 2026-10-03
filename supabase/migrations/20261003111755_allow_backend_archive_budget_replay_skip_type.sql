-- Qualification replay archives superseded skip events by changing only event_type.
-- Preserve event payloads and client access restrictions.
GRANT UPDATE (event_type) ON lead_engine.events TO service_role;
