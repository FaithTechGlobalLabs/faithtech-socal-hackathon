-- =============================================================================
-- OC Impact Lab (2026-10-17): the submission form no longer asks
-- "What is real and what is mocked" or "How a judge can try it", so both
-- columns may be empty.
-- The length checks stay and pass for NULL. Safe to run twice.
-- Apply BEFORE deploying the form change:
--   ./ops/supabase/apply.sh ops/supabase/20261017090000_impact_lab_relax.sql
-- =============================================================================
alter table public.impact_lab_submissions alter column real_vs_mocked drop not null;
alter table public.impact_lab_submissions alter column try_it drop not null;
