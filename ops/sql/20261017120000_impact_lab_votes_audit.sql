-- =============================================================================
-- OC Claude Impact Lab (Sat 2026-10-17): keep a trail on shortlist votes.
--
-- The judges page has no login, so anyone who types a judge's name can toggle
-- that judge's votes. Instead of deleting a vote on "tap to remove", the
-- endpoint now sets wanted = false and stamps updated_at and ip_hash, so the
-- organizer views can show when each judge name last changed something and
-- from how many networks. Only wanted = true rows count.
--
-- Additive and safe to run twice. Apply BEFORE deploying the code that uses it:
--   ./ops/supabase/apply.sh ops/supabase/20261017120000_impact_lab_votes_audit.sql
-- =============================================================================
alter table public.impact_lab_votes add column if not exists wanted boolean not null default true;
alter table public.impact_lab_votes add column if not exists updated_at timestamptz not null default now();
