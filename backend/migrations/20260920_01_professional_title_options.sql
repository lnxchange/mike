-- Migration date: 2026-09-20
-- Widen the professional title options offered during onboarding and in
-- settings to include Principal, Special Counsel and Paralegal. Existing
-- values remain valid, so no backfill is needed. Safe to re-run.

alter table public.user_profiles
  drop constraint if exists user_profiles_professional_title_check;

alter table public.user_profiles
  add constraint user_profiles_professional_title_check
  check (
    professional_title is null
    or professional_title in (
      'Principal',
      'Partner',
      'Special Counsel',
      'Senior Associate',
      'Associate',
      'Law Clerk',
      'Paralegal',
      'Counsel',
      'General Counsel',
      'Legal Counsel',
      'Other'
    )
  );
