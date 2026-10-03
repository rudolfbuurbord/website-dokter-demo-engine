BEGIN;
SET LOCAL ROLE service_role;
DO $t$
DECLARE mid uuid; a lead_engine.observations; result jsonb;
BEGIN
 SELECT lm.id INTO STRICT mid FROM lead_engine.list_members lm JOIN lead_engine.companies c ON c.id=lm.company_id WHERE c.domain='bijlsmaschildersbedrijf.nl';
 SELECT * INTO a FROM lead_engine.observations WHERE company_id=(SELECT company_id FROM lead_engine.list_members WHERE id=mid)
 AND field='website_outreach_assessment' ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1;
 INSERT INTO lead_engine.observations(company_id,field,layer,value,source_url,observed_at,method)
 VALUES(a.company_id,a.field,a.layer,a.value-ARRAY['holistic_impression','reviewed_urls','strengths','unknowns'],a.source_url,a.observed_at,'rollback-original-with-same-transaction-time');
 result:=lead_engine.complete_saved_dossier(mid);
 IF result->>'completed'<>'true' OR (lead_engine.email_dossier(mid)->>'allowed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'SAME_TRANSACTION_DOSSIER_FAILED';END IF;
END $t$;
ROLLBACK;
SELECT 'PASS: newer enriched observation wins within the same transaction; all fixture changes rolled back' result;