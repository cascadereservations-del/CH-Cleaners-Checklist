-- get_missed_cleanings v2 — chase a missing cleaning report until it arrives.
--
-- Three faults in v1, each proven against live data on 2026-09-12:
--
--   1. It only ever looked at yesterday. A report missed on Monday was
--      never mentioned again from Tuesday on. 2026-09-07 (Aya Falgui) and
--      2026-09-09 both have no report and no longer appear anywhere.
--   2. It read airbnb_reservations, so a DIRECT booking's checkout could
--      never raise a reminder — the one booking type Cascade controls.
--      calendar_events is what the checklist itself validates against.
--   3. Its NOT EXISTS was uncorrelated: "cs.checkout_date = ar.checkout_date
--      OR cs.cleaned_at::date = yesterday" meant ANY cleaning filed
--      yesterday — a mid-stay refresh for a different stay, say —
--      suppressed the alert for a genuinely uncleaned checkout.
--
-- v2 looks back over a window, reads the calendar, correlates on the stay,
-- ignores mid-stay refreshes when deciding whether a turnover was filed,
-- and returns days_overdue so the reminder can escalate its wording rather
-- than repeat one line forever.
--
-- CALLER CHANGE: the return shape is different from v1
-- (confirmation_code is gone, source and days_overdue are new). Update the
-- missed-cleaning reminder and turnover-verifier together with this.

begin;

create or replace function public.get_missed_cleanings(
  p_property_id uuid default null,
  p_lookback    integer default 14
)
returns table (
  guest_name    text,
  checkin_date  date,
  checkout_date date,
  source        text,
  days_overdue  integer
)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_prop_id uuid;
  v_today   date;
begin
  -- 00:00 UTC cron = 08:00 Manila, so "today" in Manila is CURRENT_DATE here.
  v_today   := current_date;
  v_prop_id := coalesce(p_property_id, (select id from public.properties limit 1));

  return query
  select
    nullif(trim(coalesce(ce.guest_name, '')), '') as guest_name,
    ce.checkin_date,
    ce.checkout_date,
    ce.source,
    (v_today - ce.checkout_date)::integer as days_overdue
  from public.calendar_events ce
  where ce.property_id = v_prop_id
    and ce.status <> 'cancelled'
    and ce.checkout_date <  v_today
    and ce.checkout_date >= v_today - p_lookback
    and not exists (
      select 1
      from public.cleaning_sessions cs
      where cs.property_id = v_prop_id
        and coalesce(cs.cleaning_type, 'checkout') <> 'mid_stay'
        and (
          cs.checkout_date = ce.checkout_date
          -- filed a day late but clearly for this stay
          or cs.cleaned_at::date between ce.checkout_date and ce.checkout_date + 1
        )
    )
  order by ce.checkout_date desc;
end;
$function$;

comment on function public.get_missed_cleanings(uuid, integer) is
  'Checkouts in the last p_lookback days with no turnover report. Reads calendar_events so direct bookings are covered, ignores mid-stay refreshes, and returns days_overdue for escalating reminders.';

-- v1 took a single uuid argument. Drop it so callers cannot silently keep
-- resolving to the old yesterday-only behaviour.
drop function if exists public.get_missed_cleanings(uuid);

commit;
