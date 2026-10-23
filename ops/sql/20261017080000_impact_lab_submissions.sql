-- =============================================================================
-- Orange County Claude Impact Lab (Sat 2026-10-17): team project submissions.
--
-- Written by api/impact-lab-submit.js, read and deleted by
-- api/impact-lab-submissions.js (organizer view). Same permission model as
-- 001_forms.sql: RLS on, NO policies, so only the service role can touch it.
--
-- Safe to run twice. Apply with:
--   ./ops/supabase/apply.sh ops/supabase/20261017080000_impact_lab_submissions.sql
-- =============================================================================
begin;

create extension if not exists pgcrypto;

create table if not exists public.impact_lab_submissions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  event_slug      text not null default 'oc-2026-10-17' check (char_length(event_slug) <= 60),
  team_name       text not null check (char_length(team_name) between 1 and 120),
  challenge       text not null check (challenge in ('1','2','3')),
  one_liner       text not null check (char_length(one_liner) between 1 and 200),
  what_it_does    text not null check (char_length(what_it_does) between 1 and 1200),
  try_it          text not null check (char_length(try_it) between 1 and 800),
  real_vs_mocked  text not null check (char_length(real_vs_mocked) between 1 and 1000),
  repo_url        text not null check (char_length(repo_url) <= 500),
  demo_video_url  text check (demo_video_url is null or char_length(demo_video_url) <= 500),
  live_demo_url   text check (live_demo_url is null or char_length(live_demo_url) <= 500),
  -- ["Ada Lovelace", "Grace Hopper"], 1 to 10 names
  members         jsonb not null check (jsonb_typeof(members) = 'array'
                    and jsonb_array_length(members) between 1 and 10),
  contact_name    text not null check (char_length(contact_name) between 1 and 120),
  contact_email   text not null check (char_length(contact_email) between 3 and 254),
  no_phi_confirmed boolean not null check (no_phi_confirmed),
  ip_hash         text check (ip_hash is null or char_length(ip_hash) <= 64),
  user_agent      text check (user_agent is null or char_length(user_agent) <= 300),
  suspect         text
);

create index if not exists impact_lab_submissions_event_idx
  on public.impact_lab_submissions (event_slug, created_at);

alter table public.impact_lab_submissions enable row level security;
revoke all on public.impact_lab_submissions from public, anon, authenticated;
grant all on public.impact_lab_submissions to service_role;

commit;
