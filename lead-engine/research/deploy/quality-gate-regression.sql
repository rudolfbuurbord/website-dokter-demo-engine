-- Integration regression against the existing pilot fixture; every test write rolls back.
begin;
set local role service_role;
do $test$
declare m uuid; em text; r jsonb; k text:='deventerschilder.nl';
begin
 select lm.id,cr.value into strict m,em from lead_engine.list_members lm
 join lead_engine.companies c on c.id=lm.company_id
 join lead_engine.contact_routes cr on cr.id=lm.route_id where c.domain=k;
 r:=lead_engine.gate_before_handoff(m);
 if not (r->'reasons' ? 'QUALITY_AUDIT_REVIEW_REQUIRED') then raise exception 'Missing initial audit hold'; end if;
 insert into public.email_verifications(email,verification_status,verifier,is_catch_all,checked_at)
 values(em,'valid','ROLLBACK_ONLY_TEST',false,now());
 r:=lead_engine.gate_before_handoff(m);
 if r->'reasons' ? 'EMAIL_NOT_VERIFIED_VALID' then raise exception 'Verification fixture not recognized';end if;
 if not (r->'reasons' ? 'QUALITY_AUDIT_REVIEW_REQUIRED') or (r->>'allowed')::boolean then raise exception 'Verification bypassed quality hold';end if;
 if not (lead_engine.email_dossier(m)->'reasons' ? 'QUALITY_AUDIT_REVIEW_REQUIRED')
 or not (lead_engine.gate(m)->'reasons' ? 'QUALITY_AUDIT_REVIEW_REQUIRED') then raise exception 'Downstream gate lost hold';end if;
 insert into lead_engine.events(entity_type,entity_id,event_type,actor,details)
 values('test',k,'BUDGET100_REPAIR_AUDIT','rollback-test',jsonb_build_object('key',k,'status','VALIDATED'));
 r:=lead_engine.gate_before_handoff(m);
 if r->'reasons' ? 'QUALITY_AUDIT_REVIEW_REQUIRED' then raise exception 'Later validation failed to clear hold';end if;
 insert into lead_engine.events(entity_type,entity_id,event_type,actor,details)
 values('test',k,'BUDGET100_REPAIR_AUDIT','rollback-test',jsonb_build_object('key',k,'status','UNKNOWN'));
 r:=lead_engine.gate_before_handoff(m);
 if not (r->'reasons' ? 'QUALITY_AUDIT_REVIEW_REQUIRED') then raise exception 'Unknown audit failed open or timestamp tie ordering failed';end if;
 insert into lead_engine.events(entity_type,entity_id,event_type,actor,details)
 values('test',k,'BUDGET100_REPAIR_AUDIT','rollback-test',jsonb_build_object('key',k,'status','BUSINESS_REJECTED'));
 if not (lead_engine.gate_before_handoff(m)->'reasons' ? 'QUALITY_AUDIT_BUSINESS_REJECTED') then raise exception 'Business rejection not enforced';end if;
end $test$;
rollback;
select 'PASS: valid email cannot bypass quality hold; dossier and send gates enforce it; newer audit wins; unknown audit blocks; all fixtures rolled back' result;
