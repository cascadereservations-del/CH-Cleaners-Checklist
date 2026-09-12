-- 2026-09-13 — meter photo vision verification, and the one-time
-- "I forgot the photos" allowance.
--
-- Apply with run-sql-on-host.sh. That runner opens no transaction of its own,
-- so the begin/commit below are deliberate — same as the 2026-09-12 files.
--
-- Nothing here is destructive: ADD COLUMN IF NOT EXISTS twice, three new
-- functions, one index. Every new column is nullable or defaulted, and the
-- app reads "no verdict yet" as "not checked", never as "failed".
--
-- Authorisation reuses public.current_staff_authorized('read_operations', ...),
-- the same guard get_cleanable_bookings uses, so there is one definition of
-- "may this person see operations data" rather than two that can drift.

begin;

-- ── 1. Where a vision verdict lives ─────────────────────────────────────────
-- One meter_readings row already holds both readings for a session, so the
-- verdict belongs beside them rather than in a table of its own.
alter table public.meter_readings
  add column if not exists vision_electric    numeric,
  add column if not exists vision_water       numeric,
  add column if not exists vision_confidence  numeric,
  -- ok | mismatch | unreadable | not_a_meter | error
  add column if not exists vision_verdict     text,
  add column if not exists vision_checked_at  timestamptz,
  add column if not exists vision_raw         jsonb,
  -- Set once the cleaner has re-uploaded, so the sign-in nudge stops asking.
  add column if not exists vision_resolved_at timestamptz;

comment on column public.meter_readings.vision_verdict is
  'How a vision model read the meter photo: ok, mismatch, unreadable, not_a_meter, error. NULL means not checked yet. Advisory — it never blocks a submission.';

-- ── 2. The forgotten-photo allowance ────────────────────────────────────────
alter table public.cleaning_sessions
  add column if not exists meter_photos_skipped   boolean not null default false,
  add column if not exists meter_photo_skip_note  text;

comment on column public.cleaning_sessions.meter_photos_skipped is
  'The cleaner submitted with no meter photos using the one-time allowance. Two in a row are refused by can_skip_meter_photos().';

create index if not exists cleaning_sessions_property_cleaned_at_idx
  on public.cleaning_sessions (property_id, cleaned_at desc);

-- ── 3. May this report skip the meter photos? ───────────────────────────────
-- Lloyd's rule (2026-09-13): forgetting once is human, twice running is a
-- habit. The answer has to come from the server — a localStorage flag is
-- cleared by reinstalling the app, which would make the limit decorative.
create or replace function public.can_skip_meter_photos(
  p_property_id uuid default '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'::uuid
)
returns table (
  allowed         boolean,
  last_skipped    boolean,
  last_session_at timestamptz,
  reason          text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_last_skipped boolean;
  v_last_at      timestamptz;
begin
  if not public.current_staff_authorized('read_operations', p_property_id) then
    raise exception 'not authorized to read operations for this property'
      using errcode = '42501';
  end if;

  -- Only turnovers and deep cleans are held to this. A mid-stay refresh does
  -- not require meter readings at all, so skipping one proves nothing.
  select cs.meter_photos_skipped, cs.cleaned_at
    into v_last_skipped, v_last_at
  from public.cleaning_sessions cs
  where cs.property_id = p_property_id
    and cs.cleaning_type in ('turnover', 'deep_clean')
  order by cs.cleaned_at desc nulls last
  limit 1;

  return query
  select
    coalesce(v_last_skipped, false) = false,
    coalesce(v_last_skipped, false),
    v_last_at,
    case when coalesce(v_last_skipped, false)
         then 'the previous report also had no meter photos'
         else null end;
end;
$function$;

revoke all on function public.can_skip_meter_photos(uuid) from public;
grant execute on function public.can_skip_meter_photos(uuid) to authenticated;

comment on function public.can_skip_meter_photos(uuid) is
  'True when the previous turnover report DID include meter photos. Enforces never-two-in-a-row server-side, because the client copy of that fact is trivially reset.';

-- ── 4. Does anyone owe a re-upload? ─────────────────────────────────────────
-- Read at sign-in. Returns recent sessions whose meter photos were skipped, or
-- whose vision check disagreed with the typed reading, and which nobody has
-- since put right.
create or replace function public.get_meter_photo_followups(
  p_property_id uuid    default '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'::uuid,
  p_lookback    integer default 14
)
returns table (
  session_id      uuid,
  submission_id   text,
  cleaned_at      timestamptz,
  cleaner_name    text,
  reason          text,
  typed_electric  numeric,
  typed_water     numeric,
  vision_electric numeric,
  vision_water    numeric,
  vision_verdict  text
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
  select
    cs.id,
    cs.submission_id,
    cs.cleaned_at,
    cs.cleaner_name,
    case
      when cs.meter_photos_skipped              then 'no meter photos were attached'
      when mr.vision_verdict = 'mismatch'       then 'the photo does not show the number that was typed'
      when mr.vision_verdict = 'not_a_meter'    then 'the photo does not look like a meter'
      when mr.vision_verdict = 'unreadable'     then 'the photo could not be read'
      else 'needs another look'
    end,
    mr.electric_curr,
    mr.water_curr,
    mr.vision_electric,
    mr.vision_water,
    mr.vision_verdict
  from public.cleaning_sessions cs
  left join public.meter_readings mr on mr.session_id = cs.id
  where cs.property_id = p_property_id
    and cs.cleaned_at >= (now() - make_interval(days => greatest(p_lookback, 1)))
    and mr.vision_resolved_at is null
    and (
      cs.meter_photos_skipped
      or mr.vision_verdict in ('mismatch', 'not_a_meter', 'unreadable')
    )
  order by cs.cleaned_at desc;
end;
$function$;

revoke all on function public.get_meter_photo_followups(uuid, integer) from public;
grant execute on function public.get_meter_photo_followups(uuid, integer) to authenticated;

comment on function public.get_meter_photo_followups(uuid, integer) is
  'Recent sessions whose meter photos were skipped or failed the vision check and have not been put right. Read at sign-in so the app can ask for a re-upload.';

-- ── 5. Which sessions still need a vision check? ────────────────────────────
-- Used by the verify-meter-photo edge function when it sweeps on a schedule
-- rather than being handed one submission. service_role only.
create or replace function public.get_meter_sessions_pending_vision(
  p_property_id uuid    default '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'::uuid,
  p_lookback    integer default 7,
  p_limit       integer default 20
)
returns table (
  session_id    uuid,
  submission_id text,
  cleaned_at    timestamptz,
  cleaner_name  text,
  electric_curr numeric,
  water_curr    numeric
)
language sql
stable
security definer
set search_path to ''
as $function$
  select cs.id, cs.submission_id, cs.cleaned_at, cs.cleaner_name,
         mr.electric_curr, mr.water_curr
  from public.cleaning_sessions cs
  join public.meter_readings mr on mr.session_id = cs.id
  where cs.property_id = p_property_id
    and cs.cleaned_at >= (now() - make_interval(days => greatest(p_lookback, 1)))
    and mr.vision_verdict is null
    and coalesce(cs.meter_photos_skipped, false) = false
    and coalesce(cs.meter_photo_count, 0) > 0
  order by cs.cleaned_at desc
  limit greatest(p_limit, 1);
$function$;

revoke all on function public.get_meter_sessions_pending_vision(uuid, integer, integer) from public;
grant execute on function public.get_meter_sessions_pending_vision(uuid, integer, integer) to service_role;

-- ── 6. Where are this submission's meter photos? ────────────────────────────
-- The storage path is <property_id>/<user_id>/<submission_id>/<uuid>-<label>…
-- and older rows use a flat <date>/<label>… instead, so matching on the file
-- name is the one rule that covers both. The edge function needs exact object
-- names to download; letting it guess a prefix would silently miss the legacy
-- layout. service_role only — storage.objects is not the cleaner's to read.
create or replace function public.get_meter_photo_objects(
  p_submission_id text
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
    and o.name like '%' || p_submission_id || '%'
    and (o.name ilike '%electric_meter%' or o.name ilike '%water_meter%')
  order by o.created_at desc;
$function$;

revoke all on function public.get_meter_photo_objects(text) from public;
grant execute on function public.get_meter_photo_objects(text) to service_role;

commit;
