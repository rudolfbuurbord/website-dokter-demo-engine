
begin;
do $test$
declare m record; v jsonb; ev jsonb; g jsonb; d jsonb; p text;
begin
 select lm.id as mid,lm.company_id,r.id as rid,r.source_url into m
 from lead_engine.list_members lm join lead_engine.contact_routes r on r.company_id=lm.company_id and r.kind='EMAIL' and r.enabled and not r.is_inferred
 where r.source_url ~ '^https?://' and r.value not like '%example.%' limit 1;
 assert m.mid is not null,'test requires existing sourced contact';
 update lead_engine.companies set active_status='ACTIVE',identity_status='CLEAR' where id=m.company_id;
 update lead_engine.list_members set route_id=m.rid where id=m.mid;
 ev:=jsonb_build_array(jsonb_build_object('source_url',m.source_url,'finding','Rollback-only test evidence','observed_at',now()));
 select bv.id::text into p from public.bibles b join public.bible_versions bv on bv.bible_id=b.id and bv.version=b.current_version where b.slug='lead-intelligence-bible';
 v:=jsonb_build_object('status','ELIGIBLE','reason_code','NO_WEBSITE_FOUND','reviewer','rollback-test','reason','test',
 'activity_confirmed',true,'identity_confirmed',true,'activity_evidence',ev,'identity_evidence',ev,
 'contact_route_id',m.rid,'no_website_found',true,'website_search_evidence',ev,'policy_version_id',p);
 assert lead_engine.nonvisual_route_ok(v,m.company_id,m.rid),'sourced no-website route accepted';
 assert not lead_engine.nonvisual_route_ok(v-'activity_evidence',m.company_id,m.rid),'missing activity fails closed';
 assert not lead_engine.nonvisual_route_ok(v-'website_search_evidence',m.company_id,m.rid),'missing search fails closed';
 assert not lead_engine.sourced_route_evidence_ok('[{"source_url":"https://example.org","finding":"old","observed_at":"2000-01-01"}]'),'stale observation fails';
 assert not lead_engine.sourced_route_evidence_ok('[{"source_url":"https://example.org","finding":"bad","observed_at":"not-a-date"}]'),'malformed date fails';
 assert not lead_engine.sourced_route_evidence_ok('{}'),'malformed evidence fails';
 update lead_engine.contact_routes set is_inferred=true where id=m.rid;
 assert not lead_engine.nonvisual_route_ok(v,m.company_id,m.rid),'guessed email fails';
 update lead_engine.contact_routes set is_inferred=false where id=m.rid;
 insert into lead_engine.observations(company_id,field,layer,value,source_url,observed_at,method)
 values(m.company_id,'website_outreach_assessment','DERIVED_FEATURE',v,m.source_url,now()+interval '1 minute','rollback-test');
 g:=lead_engine.gate_before_handoff(m.mid);
 assert not (g->'reasons' ? 'WEBSITE_OUTREACH_REASON_REQUIRED'),'new route recognized by production gate';
 d:=lead_engine.email_dossier(m.mid);
 assert not (d->'reasons' ? 'VISUAL_SCOPE_REQUIRED'),'no fake desktop review required';
 assert d->'snapshot'->>'demo_route'='STANDARD_NICHE_NAME_LOGO','no-site demo mapping';
 assert d->'reasons' ? 'TECHNICAL_REVIEW_REQUIRED','technical scope declaration still required';
 v:=v||jsonb_build_object('reason_code','WEBSITE_UNREACHABLE','independent_check_status','UNREACHABLE','reachability_evidence',ev,'public_defect_claimed',false);
 assert lead_engine.nonvisual_route_ok(v,m.company_id,m.rid),'sourced unreachable route accepted';
 assert not lead_engine.nonvisual_route_ok(v||'{"independent_check_status":"REACHABLE"}',m.company_id,m.rid),'retrievable site cannot use unreachable route';
 assert not lead_engine.nonvisual_route_ok(v||'{"public_defect_claimed":true}',m.company_id,m.rid),'unsupported public defect claim rejected';
 assert not has_function_privilege('anon','lead_engine.nonvisual_route_ok(jsonb,uuid,uuid)','execute'),'public access blocked';
end $test$;
rollback;
select 'bounded route regression tests passed; fixture changes rolled back' as result;
