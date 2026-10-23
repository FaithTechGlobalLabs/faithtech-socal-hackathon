-- =============================================================================
-- OC Claude Impact Lab (Sat 2026-10-17): judge shortlist votes.
--
-- Between 4:00 and 4:30 PM each judge taps "Want to see this demo" on the
-- submissions they want on stage. One row per (event, judge name, team) means
-- "this judge wants this demo"; toggling off deletes the row. The most-voted
-- teams become the finalists and their demo order (api/impact-lab-submissions.js).
-- Written and read only by that endpoint with the service role.
-- Same permission model as impact_lab_scores: RLS on, NO policies.
--
-- Safe to run twice. Apply BEFORE deploying the shortlist code:
--   ./ops/supabase/apply.sh ops/supabase/20261017110000_impact_lab_votes.sql
-- =============================================================================
begin;

create extension if not exists pgcrypto;

create table if not exists public.impact_lab_votes (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  event_slug       text not null default 'oc-2026-10-17' check (char_length(event_slug) <= 60),
  judge_name       text not null check (char_length(judge_name) between 1 and 60),
  judge_name_lower text generated always as (lower(judge_name)) stored,
  -- lower-cased, trimmed team name, the same key impact_lab_scores uses
  team_key         text not null check (char_length(team_key) between 1 and 120),
  team_name        text not null check (char_length(team_name) between 1 and 120),
  challenge        text not null check (challenge in ('1','2','3')),
  ip_hash          text check (ip_hash is null or char_length(ip_hash) <= 64),
  constraint impact_lab_votes_judge_team_key unique (event_slug, judge_name_lower, team_key)
);

alter table public.impact_lab_votes enable row level security;
revoke all on public.impact_lab_votes from public, anon, authenticated;
grant all on public.impact_lab_votes to service_role;

commit;
