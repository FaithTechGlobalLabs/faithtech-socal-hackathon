-- =============================================================================
-- OC Claude Impact Lab (Sat 2026-10-17): digital judge scores.
--
-- One row per (event, judge name, team). Judges have no login: the judges page
-- asks for a name once and upserts on (event_slug, judge_name_lower, team_key).
-- Written and read only by api/impact-lab-submissions.js with the service role.
-- Same permission model as the submissions table: RLS on, NO policies.
--
-- Safe to run twice. Apply BEFORE deploying the scoring code:
--   ./ops/supabase/apply.sh ops/supabase/20261017100000_impact_lab_scores.sql
-- =============================================================================
begin;

create extension if not exists pgcrypto;

create table if not exists public.impact_lab_scores (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  event_slug       text not null default 'oc-2026-10-17' check (char_length(event_slug) <= 60),
  judge_name       text not null check (char_length(judge_name) between 1 and 60),
  judge_name_lower text generated always as (lower(judge_name)) stored,
  -- lower-cased, trimmed team name: the same key the judges page uses to pick
  -- the latest submission per team
  team_key         text not null check (char_length(team_key) between 1 and 120),
  team_name        text not null check (char_length(team_name) between 1 and 120),
  challenge        text not null check (challenge in ('1','2','3')),
  impact           smallint not null check (impact between 1 and 5),
  product          smallint not null check (product between 1 and 5),
  demo             smallint not null check (demo between 1 and 5),
  note             text check (note is null or char_length(note) <= 280),
  ip_hash          text check (ip_hash is null or char_length(ip_hash) <= 64),
  constraint impact_lab_scores_judge_team_key unique (event_slug, judge_name_lower, team_key)
);

alter table public.impact_lab_scores enable row level security;
revoke all on public.impact_lab_scores from public, anon, authenticated;
grant all on public.impact_lab_scores to service_role;

commit;
