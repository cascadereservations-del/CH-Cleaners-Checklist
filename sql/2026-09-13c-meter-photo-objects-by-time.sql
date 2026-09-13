-- 2026-09-13c — match legacy meter photos by TIME, not by folder name.
--
-- Apply with run-sql-on-host.sh from stay-site.
--
-- Why this replaces 2026-09-13b, an hour old. Matching legacy photos on a
-- <date>/ folder produced a FALSE MISMATCH against the cleaner on the very
-- first real sweep — the one outcome this whole layer must never produce.
-- Two reports were filed on 2026-09-06, one at 00:38 reading 3814 and one at
-- 23:42 reading 3832, and the folder rule handed both of them the 00:38
-- report's photo. The model read 3814 correctly and was recorded as
-- disagreeing with the 23:42 report.
--
-- Worse, the folder name is the APP's Manila date at upload time, not the
-- cleaning date: the 23:42 session's own photos sit in a 2026-09-07/ folder.
-- So the folder rule is wrong about which day as well as which report.
--
-- What is reliable is the upload clock. A meter photo is taken and uploaded
-- during the report it belongs to, minutes before submission. So for the
-- legacy layout, take the newest meter object created at or before the
-- session's cleaned_at, within a window. For the 2026-09-06 pair that picks
-- 00:32 for the 00:38 report and 23:35 for the 23:42 report — both correct.
--
-- The current layout still wins outright when it matches, because a submission
-- id in the path is proof rather than inference.

begin;

drop function if exists public.get_meter_photo_objects(text, date);

create or replace function public.get_meter_photo_objects(
  p_submission_id text,
  p_cleaned_at    timestamptz default null,
  p_window_hours  integer default 12
)
returns table (
  object_name text,
  meter       text,
  created_at  timestamptz,
  match_by    text
)
language sql
stable
security definer
set search_path to ''
as $function$
  with candidates as (
    select o.name,
           case when o.name ilike '%electric_meter%' then 'electric' else 'water' end as meter,
           o.created_at,
           -- proof beats inference
           case when p_submission_id is not null
                 and o.name like '%' || p_submission_id || '%'
                then 'submission_id' else 'upload_time' end as match_by
    from storage.objects o
    where o.bucket_id = 'cleaning-photos'
      and (o.name ilike '%electric_meter%' or o.name ilike '%water_meter%')
      and (
        (p_submission_id is not null and o.name like '%' || p_submission_id || '%')
        or (p_cleaned_at is not null
            and o.created_at <= p_cleaned_at
            and o.created_at >= p_cleaned_at - make_interval(hours => greatest(p_window_hours, 1)))
      )
  ),
  -- If the submission id matched anything at all, use only those.
  scoped as (
    select * from candidates
    where match_by = 'submission_id'
       or not exists (select 1 from candidates c2 where c2.match_by = 'submission_id')
  )
  select distinct on (meter) name, meter, created_at, match_by
  from scoped
  -- newest first within each meter: the closest upload before the submission
  order by meter, created_at desc;
$function$;

revoke all on function public.get_meter_photo_objects(text, timestamptz, integer) from public;
grant execute on function public.get_meter_photo_objects(text, timestamptz, integer) to service_role;

comment on function public.get_meter_photo_objects(text, timestamptz, integer) is
  'One electric and one water photo for a report. Prefers the submission id in the object path; for legacy uploads with no id, takes the newest photo uploaded in the window before cleaned_at. Never matches on the date folder - that is the app upload date, and it collides when two reports share a day.';

commit;
