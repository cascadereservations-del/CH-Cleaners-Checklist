-- 2026-09-13d — schedule the meter photo sweep.
--
-- Apply with run-sql-on-host.sh from stay-site.
--
-- Timing. Job 7 (missed-cleaning-alert) runs at 00:00 UTC = 08:00 Manila and
-- now reports meter follow-ups. The sweep therefore runs at 23:30 UTC = 07:30
-- Manila, half an hour AHEAD of it, so the morning message speaks about
-- verdicts written the same morning rather than yesterday's.
--
-- notify is FALSE on purpose. The 08:00 alert is the single voice for this; a
-- sweep that also posted would put the same finding in the OPS group twice.
-- The sweep writes verdicts, the alert reads them.
--
-- limit 5, not 10. Each session is two images through a vision model at
-- roughly 20-40 seconds a pair, and an edge function has a wall clock. Five a
-- day clears a backlog within a week and keeps every run comfortably short.
--
-- Authorization uses the LEGACY ANON key, because verify-meter-photo is
-- deployed with verify_jwt true and the sb_publishable_ key the other jobs
-- use is not a JWT. The anon key is public by design — it is already embedded
-- in the checklist's HTML — so putting it here reveals nothing. The
-- service-role key is deliberately NOT used: it would sit in cron.job in plain
-- text, readable by anyone who can select from that table, in exchange for
-- nothing this job needs.

begin;

-- Idempotent: unschedule first so re-running this file replaces rather than
-- duplicates. cron.unschedule raises when the job is absent, hence the guard.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'verify-meter-photo-daily') then
    perform cron.unschedule('verify-meter-photo-daily');
  end if;
end
$$;

select cron.schedule(
  'verify-meter-photo-daily',
  '30 23 * * *',
  $job$
  select net.http_post(
    url     := 'https://qkgfhsdppslwunarczeq.supabase.co/functions/v1/verify-meter-photo',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2Zoc2RwcHNsd3VuYXJjemVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjI3MDYsImV4cCI6MjA5NTE5ODcwNn0.Rf1XhyuxkkoGd2HG0I02CP0BA4mu8kfQalLtStDaXAI'
    ),
    body    := '{"lookback":14,"limit":5,"notify":false}'::jsonb,
    timeout_milliseconds := 300000
  ) as request_id;
  $job$
);

commit;
