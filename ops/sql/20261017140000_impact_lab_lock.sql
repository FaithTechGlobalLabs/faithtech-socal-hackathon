-- =============================================================================
-- OC Claude Impact Lab (Sat 2026-10-17): organizer-locked finalists.
--
-- No clock cutoffs (the day may run late). Mike taps "Close voting and lock
-- finalists" on Demo order (admin key): the endpoint stores when, and the
-- finalist team keys in running order, on the event's settings row. Votes are
-- then refused and every view uses the stored list. "Reopen voting" sets both
-- back to null.
--
-- Additive and safe to run twice. Apply BEFORE deploying the code that uses it:
--   ./ops/supabase/apply.sh ops/supabase/20261017140000_impact_lab_lock.sql
-- =============================================================================
begin;

alter table public.impact_lab_settings add column if not exists locked_at timestamptz;
alter table public.impact_lab_settings add column if not exists finalist_keys jsonb;

do $$ begin
  alter table public.impact_lab_settings add constraint impact_lab_settings_keys_array
    check (finalist_keys is null or jsonb_typeof(finalist_keys) = 'array');
exception when duplicate_object then null;
end $$;

commit;
