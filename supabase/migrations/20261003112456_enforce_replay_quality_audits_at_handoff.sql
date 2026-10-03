-- Enforce latest saved-evidence audit outcomes at dossier and send gates.
CREATE OR REPLACE FUNCTION lead_engine.gate_before_handoff(member uuid, own_reservation uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m record; v record; reasons text[]:='{}'; age_days int; begin
 select lm.*,c.niche as company_niche,c.country,c.active_status,c.identity_status,c.domain,l.niche as list_niche,l.status as list_status,
 r.value as email,r.kind,r.enabled,r.source_url as route_source
 into m from lead_engine.list_members lm join lead_engine.companies c on c.id=lm.company_id join lead_engine.lists l on l.id=lm.list_id
 left join lead_engine.contact_routes r on r.id=lm.route_id and r.company_id=lm.company_id where lm.id=member;
 if not found then return jsonb_build_object('allowed',false,'reasons',jsonb_build_array('MEMBER_NOT_FOUND')); end if;
 if m.active_status<>'ACTIVE' then reasons:=array_append(reasons,'COMPANY_NOT_CONFIRMED_ACTIVE'); end if;
 if m.identity_status<>'CLEAR' then reasons:=array_append(reasons,'IDENTITY_REVIEW'); end if;
 if m.country is distinct from 'NL' or m.company_niche is distinct from m.list_niche then reasons:=array_append(reasons,'SCOPE_MISMATCH'); end if;
 if m.list_status in ('ARCHIVED','EXHAUSTED') then reasons:=array_append(reasons,'LIST_NOT_ELIGIBLE'); end if;

 declare a record; reason_ok boolean:=false;
 begin
 select * into a from lead_engine.observations
 where company_id=m.company_id and field='website_outreach_assessment'
 order by observed_at desc,created_at desc,id desc limit 1;
 if found then
 reason_ok:=coalesce(
 a.layer='DERIVED_FEATURE'
 and a.observed_at between now()-interval '30 days' and now()+interval '5 minutes'
 and a.source_url ~ '^https?://'
 and a.value->>'status'='ELIGIBLE'
 and a.value->>'reason_code' in ('BROKEN_WEBSITE','OUTDATED_WEBSITE','POOR_VISUAL_QUALITY')
 and length(trim(a.value->>'reviewer'))>0
 and length(trim(a.value->>'reason'))>0
 and jsonb_typeof(a.value->'evidence')='array'
 and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(a.value->'evidence')='array' then a.value->'evidence' else '[]'::jsonb end) e where length(trim(e->>'finding'))>0 and e->>'source_url' ~ '^https?://' and (a.value->>'reason_code'='BROKEN_WEBSITE' or length(trim(e->>'screenshot_url'))>0))
 and (case when a.value->>'reason_code'='BROKEN_WEBSITE' then a.value->'rechecked_in_browser'='true'::jsonb
 else a.value->'calibration_approved'='true'::jsonb and length(trim(a.value->>'rubric_version'))>0 end),false);
 reason_ok:=reason_ok or coalesce(
 a.layer='DERIVED_FEATURE'
 and a.observed_at between now()-interval '30 days' and now()+interval '5 minutes'
 and a.source_url ~ '^https?://'
 and lead_engine.nonvisual_route_ok(a.value,m.company_id,m.route_id),false);
 end if;
 if not reason_ok then reasons:=array_append(reasons,'WEBSITE_OUTREACH_REASON_REQUIRED'); end if;
 end;

 if not exists(
 select 1 from (select value from lead_engine.observations where company_id=m.company_id and field='website_outreach_assessment' order by observed_at desc,created_at desc,id desc limit 1) a
 join public.bibles b on b.slug='lead-intelligence-bible'
 join public.bible_versions policy_v on policy_v.bible_id=b.id and policy_v.version=b.current_version
 where a.value->>'policy_version_id'=policy_v.id::text
 ) then reasons:=array_append(reasons,'CURRENT_WEBSITE_POLICY_REVIEW_REQUIRED');end if;

 -- A historical approval never overrides the latest replay quality audit.
 -- Unknown/malformed audit outcomes fail closed; a later VALIDATED audit can clear it.
 declare qa jsonb;
 begin
 select latest.details into qa from (
 select distinct on (e.details->>'key') e.details,e.created_at,e.id
 from lead_engine.events e
 where e.event_type='BUDGET100_REPAIR_AUDIT'
 and (e.details->>'key'=m.domain or exists (
 select 1 from lead_engine.events f
 where f.event_type='BUDGET100_FINISHED'
 and f.entity_id=e.details->>'key'
 and f.details->>'company_id'=m.company_id::text))
 order by e.details->>'key',e.created_at desc,e.id desc
 ) latest
 where latest.details->>'status' is distinct from 'VALIDATED'
 order by (latest.details->>'status'='BUSINESS_REJECTED') desc nulls last,latest.created_at desc,latest.id desc
 limit 1;
 if found then
 reasons:=array_append(reasons,case when qa->>'status'='BUSINESS_REJECTED'
 then 'QUALITY_AUDIT_BUSINESS_REJECTED' else 'QUALITY_AUDIT_REVIEW_REQUIRED' end);
 end if;
 end;
 if m.qualification<>'APPROVED' then reasons:=array_append(reasons,'QUALIFICATION_REQUIRED'); end if;
 select (value::text)::int into age_days from lead_engine.settings where key='qualification_max_age_days';
 if m.qualified_at is null or m.qualified_at<now()-make_interval(days=>age_days) then reasons:=array_append(reasons,'QUALIFICATION_STALE'); end if;
 if m.kind is distinct from 'EMAIL' or m.enabled is distinct from true or nullif(m.route_source,'') is null then reasons:=array_append(reasons,'CONTACT_ROUTE_REQUIRED'); end if;
 select * into v from public.email_verifications where normalized_email=m.email order by checked_at desc,id desc limit 1;
 select (value::text)::int into age_days from lead_engine.settings where key='verification_max_age_days';
 if v.verification_status is distinct from 'valid' or v.is_catch_all is true or nullif(v.verifier,'') is null then reasons:=array_append(reasons,'EMAIL_NOT_VERIFIED_VALID');
 elsif v.checked_at>now()+interval '5 minutes' or v.checked_at<now()-make_interval(days=>age_days) then reasons:=array_append(reasons,'VERIFICATION_STALE'); end if;
 if exists(select 1 from public.email_suppressions where status='active' and (lower(trim(email))=m.email or (domain is not null and lower(trim(domain)) in (m.domain,split_part(m.email,'@',2))))) then reasons:=array_append(reasons,'EMAIL_SUPPRESSED'); end if;
 if exists(select 1 from lead_engine.company_blocks where company_id=m.company_id and active) then reasons:=array_append(reasons,'COMPANY_BLOCKED'); end if;
 if exists(select 1 from lead_engine.reservations where (company_id=m.company_id or email=m.email) and status in ('RESERVED','DISPATCHING','ACTIVE','RECONCILE') and (own_reservation is null or id<>own_reservation)) then reasons:=array_append(reasons,'ACTIVE_OUTREACH_CONFLICT'); end if;
 if exists(select 1 from lead_engine.reservations where company_id=m.company_id and route_id=m.route_id and status='COMPLETED') then reasons:=array_append(reasons,'CONTACT_ALREADY_COMPLETED'); end if;
 return jsonb_build_object('allowed',cardinality(reasons)=0,'reasons',to_jsonb(reasons),'member_id',member,'company_id',m.company_id,'route_id',m.route_id,'email',m.email,'verification_id',v.id,'checked_at',now());
end $function$
;
