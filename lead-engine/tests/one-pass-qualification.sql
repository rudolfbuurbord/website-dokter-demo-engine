begin;
do $test$
declare m record; s jsonb; p jsonb; v jsonb; ev jsonb; r jsonb; t uuid;
begin
 s:=public.le_command('start_work','{"actor":"rollback-test","task":"one-pass regression"}');
 select lm.id as mid,lm.company_id,cr.id as rid,cr.source_url into m
 from lead_engine.list_members lm join lead_engine.contact_routes cr on cr.company_id=lm.company_id
 join lead_engine.companies c on c.id=lm.company_id join lead_engine.lists l on l.id=lm.list_id
 where cr.kind='EMAIL' and cr.enabled and not cr.is_inferred and cr.source_url ~ '^https?://'
 and cr.value not like '%example.%' and c.country='NL' and c.niche=l.niche and c.merged_into is null
 and l.status not in ('ARCHIVED','EXHAUSTED') limit 1;
 assert m.mid is not null,'fixture missing';
 update lead_engine.contact_routes set observed_at=now() where id=m.rid;
 ev:=jsonb_build_array(jsonb_build_object('source_url',m.source_url,'observed_at',now(),'finding','Rollback fixture only','screenshot_url','supabase-storage://fixture/image.jpg'));
 v:=jsonb_build_object('status','ELIGIBLE','reason_code','OUTDATED_WEBSITE','reason','Dated design fixture','reviewer','rollback-test',
 'calibration_approved',true,'rubric_version','visual-holistic-v1','evidence',ev,'policy_version_id',s->'versions'->>'lead-intelligence-bible');
 p:=jsonb_build_object('member_id',m.mid,'route_id',m.rid,'reviewer','rollback-test','start_receipt_id',s->>'start_receipt_id',
 'assessment',jsonb_build_object('value',v,'source_url',m.source_url,'observed_at',now()+interval '1 second'),
 'activity',jsonb_build_object('status','ACTIVE','basis','RECENT_PROJECT','event_date',current_date,'evidence',ev),
 'identity',jsonb_build_object('status','CLEAR','company_match_confirmed',true,'evidence',ev));
 r:=public.le_command('complete_qualification',p);
 assert r->>'status'='APPROVED',r::text;
 assert (select qualification='APPROVED' from lead_engine.list_members where id=m.mid),'membership not approved';
 assert r->>'deliverability_stage'='OUTREACH_ENGINE','email verification must remain separate';
 r:=public.le_command('complete_qualification',p-'assessment');
 assert r->>'status'='APPROVED','repeat loses qualification';
 r:=public.le_command('qualify',(p-'assessment')||'{"activity":{"status":"UNKNOWN"}}');
 assert r->>'status'='NEEDS_EVIDENCE' and r->'missing_or_rejection_reasons' ? 'ACTIVITY_EVIDENCE_REQUIRED','legacy qualify bypass';
 r:=public.le_command('complete_qualification',jsonb_set(p,'{activity,basis}','"DIRECTORY_ONLY"'));
 assert r->>'status'='NEEDS_EVIDENCE','directory alone is not activity';
 r:=public.le_command('complete_qualification',jsonb_set(p,'{identity,company_match_confirmed}','false'));
 assert r->>'status'='NEEDS_EVIDENCE','identity ambiguity must block';
 update lead_engine.contact_routes set is_inferred=true where id=m.rid;
 r:=public.le_command('complete_qualification',p);
 assert r->>'status'='NEEDS_EVIDENCE' and r->'missing_or_rejection_reasons' ? 'SOURCED_COMPANY_EMAIL_REQUIRED','guessed email approved';
 update lead_engine.contact_routes set is_inferred=false where id=m.rid;
 v:=v||'{"status":"INELIGIBLE","reason_code":"NONE"}';
 p:=jsonb_set(p,'{assessment,value}',v);
 p:=jsonb_set(p,'{assessment,observed_at}',to_jsonb(now()+interval '2 seconds'));
 r:=public.le_command('complete_qualification',p);
 assert r->>'status'='REJECTED','evidenced modern website not rejected';
 v:=v||'{"status":"REVIEW_REQUIRED"}';
 p:=jsonb_set(p,'{assessment,value}',v);
 p:=jsonb_set(p,'{assessment,observed_at}',to_jsonb(now()+interval '3 seconds'));
 r:=public.le_command('complete_qualification',p);
 assert r->>'status'='NEEDS_EVIDENCE','uncertainty is not rejection';
 select id into t from lead_engine.research_tasks where member_id=m.mid limit 1;
 if t is not null then
  update lead_engine.research_tasks set status='QUEUED',start_receipt_id=s->>'start_receipt_id' where id=t;
  update lead_engine.research_tasks set status='ERROR',error_code='WEBSITE_UNKNOWN',output='{"raw_capture":"preserved"}' where id=t;
  assert (select output->>'raw_capture'='preserved' and output->'qualification_result'->>'status'='NEEDS_EVIDENCE' from lead_engine.research_tasks where id=t),'Hetzner finish integration failed';
 end if;
 assert not has_function_privilege('anon','lead_engine.complete_qualification(jsonb)','execute'),'anonymous access';
end $test$;
rollback;
select 'one-pass qualification regression tests passed; fixture changes rolled back' as result;
