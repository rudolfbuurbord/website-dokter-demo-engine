CREATE OR REPLACE FUNCTION public.dwd_preview_bundle()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'leads',(select coalesce(jsonb_agg(to_jsonb(l) order by sort_order),'[]') from public.dwd_preview_leads l),
 'buckets',jsonb_build_array(jsonb_build_object('key','call_ready_nl_20261107','label','NIEUWE BELKLARE LEADS','count',(select count(*) from public.dwd_preview_leads where data->>'bucketKey'='call_ready_nl_20261107'),'list_id',(select min(list_id::text) from public.dwd_preview_leads where data->>'bucketKey'='call_ready_nl_20261107'),'status','READY'),
 jsonb_build_object('key','hot_fb_test','label','TEST · HOT FB LEADS','testOnly',true,'count',(select count(*) from public.dwd_preview_leads where data->>'bucketKey'='hot_fb_test'),'status','QA'),
   jsonb_build_object(
     'key','all',
     'label','ALLE LEADS',
     'count',(select count(*) from public.dwd_preview_leads where coalesce(data->>'testOnly','false')<>'true' and id not like 'candidate:%')
   ),
   jsonb_build_object(
     'key','young_painters_0_6',
     'label','JONGE SCHILDERS 0–6 JAAR',
     'count',(select count(*) from public.dwd_preview_leads where data->>'bucketKey'='young_painters_0_6'),
     'list_id','c7f02b7b-4bdc-447a-9e4e-566015ba7b61',
     'status','READY'
   )
 ),
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by occurred_at desc),'[]') from public.dwd_preview_events e),
 'goal',(select daily_demo_goal from public.dwd_preview_settings where id),
 'snapshot_at',(select snapshot_at from public.dwd_preview_settings where id),
 'server_time',now(),'environment','test',
 'existing_results',jsonb_build_object(
  'read_at',now(),
  'calls',(select coalesce(jsonb_agg(jsonb_build_object('lead_id',d.id,'name',d.data->>'name','city',d.data->>'city','status',d.status,'called_on',d.called_on,'followup_on',d.followup_on,'notes',d.notes) order by d.called_on desc,p.sort_order),'[]') from public.dwd_call_leads d join public.dwd_preview_leads p on p.id=d.id where d.status<>'todo' and d.called_on is not null and d.id not like 'candidate:%' and coalesce(d.data->>'testOnly','false')<>'true'),
  'demos',(select coalesce(jsonb_agg(jsonb_build_object('source_id',e.id,'lead_id',e.lead_id,'name',d.data->>'name','city',d.data->>'city','registered_at',e.occurred_at,'evidence_kind',e.evidence_kind,'source_method',e.source_method,'notes',d.notes,'followup_on',d.followup_on) order by e.occurred_at),'[]') from public.dwd_call_outcome_events e join public.dwd_call_leads d on d.id=e.lead_id join public.dwd_preview_leads p on p.id=d.id where e.status='demo_sent' and e.previous_status is distinct from 'demo_sent' and e.source_method<>'CURRENT_STATE_SNAPSHOT' and d.id not like 'candidate:%' and coalesce(d.data->>'testOnly','false')<>'true')
 ))
$function$
;
