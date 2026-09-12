-- get_cleanable_bookings — the stays a cleaner may still file a report for.
--
-- Why this exists: the checklist used to read calendar_events straight over
-- PostgREST, but the only SELECT policy on that table is
-- calendar_events_owner_admin_all. A cleaner's token therefore got an empty
-- array, not an error, so date validation silently degraded to "no calendar
-- data — allow any date" for the exact person it was built to help. This
-- function is SECURITY DEFINER so the cleaner can see the stays, and it
-- re-checks read_operations itself so the RLS intent is preserved.
--
-- What counts as cleanable on p_date:
--   checkout   — the stay ended on or shortly before p_date (the turnover)
--   mid_stay   — the guest is still in the unit and the stay is long enough
--                to include a scheduled refresh
--   checkin    — a guest arrives on p_date (pre-arrival clean)
-- Future stays and stays that have not ended yet are never returned as a
-- turnover. A long stay can legitimately need more than one report, so
-- already_reported is matched per (stay, cleaning_type), not per stay.

begin;

create or replace function public.get_cleanable_bookings(
  p_date        date,
  p_property_id uuid default '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'::uuid,
  p_lookback    integer default 10,
  p_midstay_min integer default 5
)
returns table (
  event_id         uuid,
  checkin_date     date,
  checkout_date    date,
  nights           integer,
  guest_name       text,
  kind             text,
  already_reported boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.current_staff_authorized('read_operations', p_property_id) then
    raise exception 'not authorized to read operations for this property'
      using errcode = '42501';
  end if;

  return query
  with candidate as (
    select
      ce.id,
      ce.checkin_date,
      ce.checkout_date,
      ce.nights,
      nullif(trim(coalesce(ce.guest_name, '')), '') as guest_name,
      case
        when ce.checkout_date <= p_date                               then 'checkout'
        when ce.checkin_date  <  p_date and ce.checkout_date > p_date  then 'mid_stay'
        else 'checkin'
      end as kind
    from public.calendar_events ce
    where ce.property_id = p_property_id
      and ce.status <> 'cancelled'
      and (
        -- ended on or shortly before the cleaning date
        (ce.checkout_date <= p_date and ce.checkout_date >= p_date - p_lookback)
        -- guest still in residence, stay long enough to earn a mid-stay clean
        or (ce.checkin_date < p_date and ce.checkout_date > p_date
            and coalesce(ce.nights, 0) >= p_midstay_min)
        -- arriving today
        or ce.checkin_date = p_date
      )
  )
  select
    c.id,
    c.checkin_date,
    c.checkout_date,
    c.nights,
    c.guest_name,
    c.kind,
    exists (
      select 1
      from public.cleaning_sessions cs
      where cs.property_id = p_property_id
        and case
              when c.kind = 'mid_stay' then
                coalesce(cs.cleaning_type, '') = 'mid_stay'
                and cs.checkout_date = c.checkout_date
                and cs.cleaned_at::date = p_date
              else
                coalesce(cs.cleaning_type, 'checkout') <> 'mid_stay'
                and cs.checkout_date = c.checkout_date
            end
    ) as already_reported
  from candidate c
  order by
    case c.kind when 'checkout' then 0 when 'mid_stay' then 1 else 2 end,
    c.checkout_date desc;
end;
$function$;

revoke all on function public.get_cleanable_bookings(date, uuid, integer, integer) from public;
grant execute on function public.get_cleanable_bookings(date, uuid, integer, integer) to authenticated;

comment on function public.get_cleanable_bookings(date, uuid, integer, integer) is
  'Stays a cleaner may still file a report for on a given date. SECURITY DEFINER because calendar_events is owner/admin only; re-checks read_operations itself.';

commit;
