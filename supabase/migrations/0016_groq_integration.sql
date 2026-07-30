-- =====================================================================
-- CRITICOMM V5 — 0016
-- Groq joins the integration catalogue as the primary AI provider behind
-- Criti; Gemini stays as the fallback. Secrets remain in env.
-- =====================================================================

insert into public.integration_settings (key, label, category, enabled, config) values
  ('groq', 'Groq — primary AI provider for Criti', 'AI', true,
   '{"model":"llama-3.3-70b-versatile","temperature":0.3}')
on conflict (key) do nothing;

update public.integration_settings
   set label = 'Google Gemini — Criti fallback AI provider'
 where key = 'gemini'
   and label = 'Google Gemini — Criti AI assistant';
