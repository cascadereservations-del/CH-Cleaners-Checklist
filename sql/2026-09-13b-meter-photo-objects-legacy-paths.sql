-- 2026-09-13b — get_meter_photo_objects must also find the LEGACY photo layout.
--
-- Apply with run-sql-on-host.sh from stay-site. That runner opens no
-- transaction of its own, so the begin/commit below are deliberate.
--
-- Why. The first real sweep returned "ok" for the 2026-09-06 report while
-- reading nothing at all: this function found no photos for it, and the edge
-- function treated two nulls as nothing to complain about. Both halves were
-- wrong. This is the SQL half.
--
-- Meter photos exist in two layouts:
--   current, since the 2026-09-12 Storage/Drive fix
--     <property_id>/<user_id>/<submission_id>/<uuid>-electric_meter_<date>_<ts>.jpg
--   legacy, everything before it
--     <date>/electric_meter_<date>_<ts>.jpg
--
-- The legacy path contains no submission id, so matching on the id alone finds
-- nothing for any report older than roughly 2026-09-10 — which is most of the
-- history the sweep exists to check. Matching the cleaning date as a folder
-- prefix covers those, and the two rules together cover everything.
--
-- The date is passed in rather than derived here so the function stays a pure
-- lookup and the caller decides which report it is asking about.

begin;

-- The signature changes, so the one-argument version has to go first.
drop function if exists public.get_meter_photo_objects(text);

create or replace function public.get_meter_photo_objects(
  p_submission_id text,
  p_cleaning_date date default null
)
returns table (
  object_name text,
  meter       text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select o.name,
         case when o.name ilike '%electric_meter%' then 'electric' else 'water' end,
         o.created_at
  from storage.objects o
  where o.bucket_id = 'cleaning-photos'
    and (o.name ilike '%electric_meter%' or o.name ilike '%water_meter%')
    and (
      -- current layout: the submission id appears as a folder in the path
      (p_submission_id is not null and o.name like '%' || p_submission_id || '%')
      -- legacy layout: a flat folder named for the cleaning date
      or (p_cleaning_date is not null
          and o.name like to_char(p_cleaning_date, 'YYYY-MM-DD') || '/%')
    )
  order by o.created_at desc;
$function$;

revoke all on function public.get_meter_photo_objects(text, date) from public;
grant execute on function public.get_meter_photo_objects(text, date) to service_role;

comment on function public.get_meter_photo_objects(text, date) is
  'Meter photo object names for one report, covering both the current <property>/<user>/<submission>/ layout and the legacy flat <date>/ one. service_role only.';

commit;
