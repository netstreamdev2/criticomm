-- =====================================================================
-- CRITICOMM V5 — 0013
--   OpsLink seed      the command bar's external-resources tier
--   CCTV integrations Hikvision (incoming) + SANRAL matrix (current)
-- =====================================================================

-- ── OPS COMMAND BAR LINKS ────────────────────────────────────────────
-- Stored as OpsLink command_records so admins manage them from Admin →
-- Configuration: name = label, code = sort key, detail1 = URL (empty ⇒
-- placeholder until the service endpoint is issued), detail2 = glyph.
-- URLs for Fines/Trace/Forensics/Constellations come straight from V4;
-- E-NATIS/CAS/PERSAL/FIREARM were placeholder buttons in V4 and stay
-- placeholders until the department supplies its internal endpoints.
insert into public.command_records (silo, module, code, name, detail1, detail2, status, created_by)
select v.silo::silo, v.module, v.code, v.name, v.detail1, v.detail2, 'Active', 'migration-0013'
from (values
  ('Ethekwini', 'OpsLink', '10', 'E-NATIS',        null,                                                              null),
  ('Ethekwini', 'OpsLink', '20', 'CAS',            null,                                                              null),
  ('Ethekwini', 'OpsLink', '30', 'PERSAL',         null,                                                              null),
  ('Ethekwini', 'OpsLink', '40', 'FIREARM',        null,                                                              null),
  ('Ethekwini', 'OpsLink', '50', 'FINES',          'https://www.paycity.co.za/IdSearch',                              null),
  ('Ethekwini', 'OpsLink', '60', 'TRACE',          'https://www.inspiritdata.co.za/login',                            null),
  ('Ethekwini', 'OpsLink', '70', 'FORENSICS',      'https://www.fincyber.tech/login/47B97C4A-E9F6-4283-BDB5-D500CA8851C1', null),
  ('Ethekwini', 'OpsLink', '80', 'CONSTELLATIONS', 'https://www.constellationsza.co.za/#/login',                      null),
  ('Ethekwini', 'OpsLink', '90', 'REAL PTT',       '/dispatch/ptt',                                                   '📡'),
  ('Ethekwini', 'OpsLink', '91', 'FLIGHTRADAR',    'https://www.flightradar24.com/-29.86,31.02/10',                   null),
  ('Ethekwini', 'OpsLink', '92', 'MARINETRAFFIC',  'https://www.marinetraffic.com/en/ais/home/centerx:31.05/centery:-29.87/zoom:11', null),
  ('Ethekwini', 'OpsLink', '93', 'REPORTS',        '/reports',                                                        null)
) as v(silo, module, code, name, detail1, detail2)
where not exists (
  select 1 from public.command_records c
  where c.module = 'OpsLink' and c.name = v.name
);

-- ── CCTV INTEGRATIONS ────────────────────────────────────────────────
-- SANRAL matrix is what the room uses today; Hikvision (HikCentral
-- Professional OpenAPI) is what it is moving to. Both live in the catalogue
-- so the cut-over is a toggle, not a deploy.
insert into public.integration_settings (key, label, category, enabled, config) values
  ('sanral',    'SANRAL CCTV Matrix — current freeway camera wall', 'Surveillance', true,
   '{"matrix_url":"https://www.i-traffic.co.za/map","note":"Registry imported via /api/cameras/import"}'),
  ('hikvision', 'Hikvision HikCentral — incoming CCTV platform',    'Surveillance', false,
   '{"base_url":"","page_size":100,"preview_protocol":"hls","verify_tls":true}')
on conflict (key) do nothing;
