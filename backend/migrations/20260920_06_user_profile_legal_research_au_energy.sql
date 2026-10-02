-- Migration date: 2026-09-20

-- Per-user toggle for Australian energy-law research tools in chat (ESC
-- Victorian codes such as the Energy Retail Code of Practice, plus AEMC
-- rule books).
--
-- When true, the AU energy tools and their system prompt are exposed to
-- the chat assistant. When false, both the tools and the prompt are
-- excluded. A NULL value means the user has not chosen: the application
-- then defaults to on when their saved jurisdiction is Australia,
-- otherwise off.
--
-- Independent of legal_research_au (Commonwealth FRL legislation).
--
-- Safe to run before application code changes: this only adds a nullable
-- column. Existing rows stay NULL and keep the jurisdiction-derived default.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS legal_research_au_energy boolean;
