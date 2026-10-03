DO $fix$
DECLARE src text;
BEGIN
src:=pg_get_functiondef('lead_engine.complete_saved_dossier(uuid)'::regprocedure);
src:=replace(src,'observed_at,method)','observed_at,method,created_at)');
src:=replace(src,'a.source_url,a.observed_at,''saved-dossier-v1'');','a.source_url,a.observed_at,''saved-dossier-v1'',clock_timestamp());');
src:=replace(src,'pages->0->>''url'',ts,''saved-dossier-v1'');','pages->0->>''url'',ts,''saved-dossier-v1'',clock_timestamp());');
EXECUTE src;
END $fix$;