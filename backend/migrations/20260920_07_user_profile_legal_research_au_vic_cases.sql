-- Migration date: 2026-09-20

-- Per-user toggles for Victorian legislation and Australian case-law
-- research tools in chat.
--
-- legal_research_au_vic: Victorian Acts and statutory rules from
-- legislation.vic.gov.au (authorised PDFs via content.legislation.vic.gov.au).
--
-- legal_research_au_cases: High Court, Federal Court, and NSW Caselaw
-- judgments. Victorian Supreme Court / Court of Appeal judgments are not
-- fetched (official publication is through AustLII).
--
-- When true, the matching tools and system prompt are exposed to the chat
-- assistant. When false, both are excluded. A NULL value means the user has
-- not chosen: the application then defaults to on when their saved
-- jurisdiction is Australia, otherwise off.
--
-- Independent of legal_research_au (Commonwealth FRL) and
-- legal_research_au_energy (ESC / AEMC / AER / AEMO).
--
-- Safe to run before application code changes: this only adds nullable
-- columns. Existing rows stay NULL and keep the jurisdiction-derived default.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS legal_research_au_vic boolean;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS legal_research_au_cases boolean;
