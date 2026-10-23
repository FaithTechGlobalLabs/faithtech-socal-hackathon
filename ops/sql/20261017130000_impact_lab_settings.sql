-- =============================================================================
-- OC Claude Impact Lab (Sat 2026-10-17): one shared finalist count.
--
-- The organizer sets how many teams demo once, with the admin key, from the
-- Demo order view; Demo order, Score and Results all read it. One row per
-- event. Without a row the endpoint uses IMPACT_LAB_FINALISTS, then 12.
-- Written and read only by api/impact-lab-submissions.js with the service role.
-- Same permission model as impact_lab_scores: RLS on, NO policies.
--
-- Additive and safe to run twice. Apply BEFORE deploying the code that uses it:
--   ./ops/supabase/apply.sh ops/supabase/20261017130000_impact_lab_settings.sql
-- =============================================================================
begin;

create table if not exists public.impact_lab_settings (
  event_slug  text primary key check (char_length(event_slug) between 1 and 60),
  finalists   integer check (finalists between 1 and 40),
  updated_at  timestamptz not null default now(),
  ip_hash     text check (ip_hash is null or char_length(ip_hash) <= 64)
);

alter table public.impact_lab_settings enable row level security;
revoke all on public.impact_lab_settings from public, anon, authenticated;
grant all on public.impact_lab_settings to service_role;

commit;
