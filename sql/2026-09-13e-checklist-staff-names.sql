-- 2026-09-13e — the sign-in name list comes from the staff records.
--
-- Apply with run-sql-on-host.sh from stay-site.
--
-- The gate had "Honey" hard-coded in the HTML, so adding a cleaner meant
-- editing and redeploying the page. Now the list is whatever the staff records
-- say is active, and a second cleaner appears simply by existing.
--
-- This is read BEFORE anyone signs in, so it has to be callable by `anon`.
-- That is a deliberate, bounded exposure: the display names of active cleaners
-- and nothing else — no ids, no emails, no roles, no counts. The one name it
-- returns today is already hard-coded in the public HTML, so it reveals
-- nothing new. SECURITY DEFINER because auth.users is not readable by anon.
--
-- Only role='cleaner'. The other roles are accounts rather than people who
-- clean — their display names are slugs like 'admin' and 'rocloyd87', which
-- would read as nonsense in a "choose your name" list. Anyone else still has
-- the "Other / not listed…" option, which has always been there.

begin;

create or replace function public.get_checklist_staff_names()
returns table (display_name text)
language sql
stable
security definer
set search_path to ''
as $function$
  select distinct u.raw_user_meta_data->>'display_name'
  from public.staff_access_profiles sap
  join auth.users u on u.id = sap.user_id
  where sap.role = 'cleaner'
    and sap.disabled_at is null
    and nullif(trim(coalesce(u.raw_user_meta_data->>'display_name', '')), '') is not null
  order by 1;
$function$;

revoke all on function public.get_checklist_staff_names() from public;
grant execute on function public.get_checklist_staff_names() to anon, authenticated;

comment on function public.get_checklist_staff_names() is
  'Display names of active cleaners, for the checklist sign-in list. Callable by anon because it is read before sign-in; returns names only, deliberately nothing else.';

commit;
