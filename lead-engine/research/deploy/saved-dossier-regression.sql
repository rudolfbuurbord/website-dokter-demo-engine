-- Read-only assertions plus idempotent invocation; no network or paid calls.
BEGIN;
SET LOCAL ROLE service_role;
DO $test$
DECLARE r record; before_count bigint; out jsonb; technical jsonb;
BEGIN
 FOR r IN SELECT (result->>'member_id')::uuid mid FROM lead_engine.budget100_current_results WHERE result->>'status'='APPROVED' LOOP
  SELECT count(*) INTO before_count FROM lead_engine.observations WHERE company_id=(SELECT company_id FROM lead_engine.list_members WHERE id=r.mid);
  out:=lead_engine.complete_saved_dossier(r.mid);
  IF out->>'completed'<>'true' OR out->>'replayed'<>'true' THEN RAISE EXCEPTION 'DOSSIER_NOT_IDEMPOTENT';END IF;
  IF before_count<>(SELECT count(*) FROM lead_engine.observations WHERE company_id=(SELECT company_id FROM lead_engine.list_members WHERE id=r.mid)) THEN RAISE EXCEPTION 'REPLAY_DUPLICATED_OBSERVATIONS';END IF;
  SELECT value INTO technical FROM lead_engine.observations WHERE company_id=(SELECT company_id FROM lead_engine.list_members WHERE id=r.mid)
   AND field='website_technical_review' ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(technical->'checks') x WHERE x.value<>'NOT_TESTED') THEN RAISE EXCEPTION 'UNPERFORMED_TEST_CLAIMED';END IF;
  IF jsonb_array_length(technical->'findings')<>0 THEN RAISE EXCEPTION 'UNSOURCED_DEFECT_CLAIMED';END IF;
 END LOOP;
END $test$;
ROLLBACK;
SELECT 'PASS: dossier replay is idempotent; reconstructed dossiers make no unperformed technical-test claims' result;
