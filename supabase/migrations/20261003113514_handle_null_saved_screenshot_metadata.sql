CREATE OR REPLACE FUNCTION lead_engine.complete_saved_dossier(p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $fn$
declare m lead_engine.list_members; a lead_engine.observations; b jsonb; pages jsonb; imgs jsonb;
urls jsonb; facts jsonb; ts timestamptz; d jsonb; provider text; domain_key text;
begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY';end if;
 select * into m from lead_engine.list_members where id=p_member for update;
 if not found then raise exception 'MEMBER_NOT_FOUND';end if;
 d:=lead_engine.gate_before_handoff(p_member);
 if m.qualification<>'APPROVED' or d->'reasons' ?| array['QUALITY_AUDIT_REVIEW_REQUIRED','QUALITY_AUDIT_BUSINESS_REJECTED'] then
 return jsonb_build_object('completed',false,'reasons',d->'reasons','qualification',m.qualification);end if;
 d:=lead_engine.email_dossier(p_member);
 if (d->>'allowed')::boolean then return jsonb_build_object('completed',true,'replayed',true);end if;
 select * into a from lead_engine.observations where company_id=m.company_id and field='website_outreach_assessment'
 order by observed_at desc,created_at desc,id desc limit 1;
 select entity_id,details->>'provider_request_id' into domain_key,provider from lead_engine.events
 where event_type='BUDGET100_FINISHED' and details->>'member_id'=p_member::text order by id desc limit 1;
 if provider is null then raise exception 'PAID_REVIEW_PROVENANCE_REQUIRED';end if;
 select details->'data' into b from lead_engine.events where event_type='BUDGET100_REPLAY_BACKUP'
 and entity_id=domain_key order by id desc limit 1;
 if coalesce(b->'review'->>'provider_request_id',b->'answer'->>'id') is distinct from provider then raise exception 'BACKUP_PROVIDER_MISMATCH';end if;
 pages:=coalesce(b->'review'->'pages',b->'capture'->'pages');
 imgs:=coalesce(nullif(b->'review'->'evidence','null'::jsonb),nullif(b->'evidence','null'::jsonb),b->'capture'->'images');
 if jsonb_typeof(pages) is distinct from 'array' or jsonb_array_length(pages)=0
 or jsonb_typeof(imgs) is distinct from 'array' or jsonb_array_length(imgs)=0 then raise exception 'SAVED_SCOPE_REQUIRED';end if;
 select jsonb_agg(distinct coalesce(x->>'source_url',x->>'url')) into urls from jsonb_array_elements(imgs) x
 where coalesce(x->>'source_url',x->>'url') ~ '^https?://';
 if urls is null then raise exception 'SAVED_SCREENSHOT_URL_REQUIRED';end if;
 select min((x->>'observed_at')::timestamptz),jsonb_agg(jsonb_build_object(
 'url',x->>'url','observed_at',x->>'observed_at','http_status',x->'status',
 'forms_observed',x->'forms','interpretation','Stored capture facts only; not an independent functional test.'))
 into ts,facts from jsonb_array_elements(pages) x;
 if ts is null or ts not between now()-interval '30 days' and now()+interval '5 minutes' then raise exception 'SAVED_CAPTURE_STALE';end if;
 insert into lead_engine.observations(company_id,field,layer,value,source_url,observed_at,method)
 values(m.company_id,'website_outreach_assessment','DERIVED_FEATURE',
 a.value||jsonb_build_object('holistic_impression',a.value->>'reason','reviewed_urls',urls,
 'strengths','[]'::jsonb,'unknowns',jsonb_build_array(
 'Sterke punten zijn niet afzonderlijk beoordeeld in de opgeslagen modelronde.',
 'Mobiele weergave, formulieren, volledige navigatie, assets en performance zijn niet functioneel getest.'),
 'desktop_reviewed',true,'mobile_review_status','NOT_TESTED','dossier_enrichment',
 jsonb_build_object('method','saved-dossier-v1','source_assessment_id',a.id,'provider_request_id',provider,'completed_at',now(),'new_research',false)),
 a.source_url,a.observed_at,'saved-dossier-v1');
 insert into lead_engine.observations(company_id,field,layer,value,source_url,observed_at,method)
 values(m.company_id,'website_technical_review','RAW_FACT',jsonb_build_object(
 'reviewer','saved-dossier-v1','scope','Administratieve reconstructie van opgeslagen desktopcapture; geen nieuwe of onafhankelijke functionele test.',
 'checks',jsonb_build_object('reachability','NOT_TESTED','navigation','NOT_TESTED','assets','NOT_TESTED',
 'mobile','NOT_TESTED','contact_flow','NOT_TESTED','forms','NOT_TESTED','basics','NOT_TESTED'),
 'findings','[]'::jsonb,'limitations',jsonb_build_array(
 'Alleen opgeslagen capturefeiten; deze bewijzen geen actuele bereikbaarheid of algemene technische gezondheid.',
 'Geen formulier verzonden, geen mobiele test en geen technische defecten vastgesteld.'),
 'capture_observations',facts,'provider_request_id',provider,'recorded_at',now()),
 pages->0->>'url',ts,'saved-dossier-v1');
 d:=lead_engine.email_dossier(p_member);
 if (d->>'allowed')::boolean is distinct from true then raise exception 'DOSSIER_INCOMPLETE: %',d->'reasons';end if;
 insert into lead_engine.events(entity_type,entity_id,event_type,actor,details)
 values('list_member',p_member::text,'SAVED_DOSSIER_COMPLETED','saved-dossier-v1',
 jsonb_build_object('source_assessment_id',a.id,'provider_request_id',provider,'new_paid_calls',0,
 'technical_tests_performed',false,'send_authorized',false));
 return jsonb_build_object('completed',true,'send_authorized',false);
end $fn$;
