-- =====================================================================
-- Criticom V5 — dev seed data
-- Populates the silos with realistic example data for local + staging only.
-- Mirrors what V4 DemoDataSeeder + AnalyticsSeeder did.
-- =====================================================================

-- Mutual-aid partners (the hardcoded 41 from DisasterController.GetPartnersByResource)
insert into public.mutual_aid_partners (agency_name, resource_type, contact_number, radio_frequency, commander_name) values
  ('Durban Metro Police HQ',          'Law Enforcement', '031 361 0000', 'Metro Ch 1',        'Duty Commander'),
  ('SAPS Durban Central',             'Law Enforcement', '031 325 4011', 'SAPS Secure',       'Station Commander'),
  ('SAPS Flying Squad (10111)',       'Law Enforcement', '10111',        'SAPS Ops',          'Shift Leader'),
  ('SAPS Search & Rescue (KZN)',      'Law Enforcement', '031 325 6711', 'SAR Tac 1',         'Capt. K9 Unit'),
  ('SAPS Public Order Policing',      'Law Enforcement', '031 325 6000', 'Riot Control Link', 'POP Commander'),
  ('Metro Police - Pinetown',         'Law Enforcement', '031 311 2809', 'Metro Ch 2',        'Regional Commander'),
  ('Metro Police - Umlazi',           'Law Enforcement', '031 311 5000', 'Metro Ch 3',        'Regional Commander'),
  ('Durban Central Fire Station',     'Fire Stations',   '031 361 0000', 'Fire Tac 1',        'Chief Fire Officer'),
  ('Pinetown Fire Station',           'Fire Stations',   '031 311 8273', 'Fire Tac 2',        'Station Commander'),
  ('Umhlanga Fire Station',           'Fire Stations',   '031 561 1111', 'Fire Tac 3',        'Station Commander'),
  ('Amanzimtoti Fire Station',        'Fire Stations',   '031 311 5880', 'Fire Tac 4',        'Station Commander'),
  ('Westville Fire Station',          'Fire Stations',   '031 311 5200', 'Fire Tac 5',        'Station Commander'),
  ('Chatsworth Fire Station',         'Fire Stations',   '031 311 5900', 'Fire Tac 6',        'Station Commander'),
  ('Working on Fire (Wildfires)',     'Fire Stations',   '0860 040 404', 'WoF Air-to-Ground', 'KZN Dispatch'),
  ('Addington Hospital (Public)',     'Hospitals',       '031 327 2000', 'Med-Link 1',        'Casualty Manager'),
  ('King Edward VIII (Public)',       'Hospitals',       '031 360 3111', 'Med-Link 2',        'Trauma Head'),
  ('Albert Luthuli Central (Public)', 'Hospitals',       '031 240 1000', 'Med-Link 3',        'Emergency Coordinator'),
  ('Mahatma Gandhi Memorial',         'Hospitals',       '031 502 1719', 'Med-Link 4',        'ER Manager'),
  ('Prince Mshiyeni Memorial',        'Hospitals',       '031 907 8111', 'Med-Link 5',        'ER Manager'),
  ('Netcare St Augustine''s',         'Hospitals',       '031 268 5000', 'Pvt-Link A',        'ER Manager'),
  ('Netcare Umhlanga',                'Hospitals',       '031 560 5500', 'Pvt-Link B',        'ER Manager'),
  ('Busamed Gateway',                 'Hospitals',       '031 492 1130', 'Pvt-Link C',        'ER Manager'),
  ('KZN Provincial EMS (10177)',      'Ambulance & EMS', '10177',        'Gov EMS Ops',       'Provincial Dispatch'),
  ('Netcare 911',                     'Ambulance & EMS', '082 911',      'Netcare Dispatch',  'KZN Operations'),
  ('ER24 Ambulance',                  'Ambulance & EMS', '084 124',      'ER24 Ops',          'Regional Dispatch'),
  ('KZN VIP Medical Rescue',          'Ambulance & EMS', '086 100 0911', 'VIP Med Channel',   'Shift Supervisor'),
  ('IPSS Medical Rescue',             'Ambulance & EMS', '082 316 4636', 'IPSS Control',      'Operations Manager'),
  ('NSRI Station 5 (Durban Port)',    'Rescue & NGO',    '082 990 5948', 'Marine VHF Ch 16',  'Base Commander'),
  ('Gift of the Givers (KZN Ops)',    'Rescue & NGO',    '0800 786 911', 'Sat-Phone 1',       'KZN Rep'),
  ('Red Cross South Africa',          'Rescue & NGO',    '031 563 2914', 'NGO Link',          'Relief Coordinator'),
  ('Salvation Army KZN',              'Rescue & NGO',    '031 202 2181', 'Mobile Cell',       'Disaster Services'),
  ('SPCA (Animal Rescue)',            'Rescue & NGO',    '031 579 6500', 'Mobile Cell',       'Inspectorate'),
  ('eThekwini Electricity (Faults)',  'Utilities',       '080 311 1111', 'Grid Control',      'Duty Engineer'),
  ('eThekwini Water & Sanitation',    'Utilities',       '080 131 3013', 'Water Ops',         'Sanitation Lead'),
  ('Transnet National Ports Auth.',   'Utilities',       '031 361 8821', 'Port Control 1',    'Harbour Master'),
  ('Eskom KZN Control Center',        'Utilities',       '0860 037 566', 'National Grid Ops', 'Regional Engineer'),
  ('SANRAL (Highways/Bridges)',       'Utilities',       '033 392 8100', 'Road Mgt Link',     'Infrastructure Eng.'),
  ('KZN Prov. Disaster Management',   'Government',      '033 897 5600', 'JOC Command Link',  'PDMC Head'),
  ('SANDF (Military Aid)',            'Government',      '012 355 6000', 'Mil-Tac Alpha',     'Joint Ops Command'),
  ('SASSA (Relief Funds/Grants)',     'Government',      '033 846 3300', 'Mobile Cell',       'Crisis Relief Lead'),
  ('Pending Assignment',              'Internal',        'TBA',          'TBA',               'TBA')
on conflict do nothing;

-- Apparatus per silo
insert into public.apparatus (silo, unit_number, name, type, make, model, year, license_plate, status, station_number, department_name, fuel_type, fuel_level) values
  ('MetroPolice', 'P-101', 'Patrol Car 101', 'Patrol Car',  'Toyota', 'Hilux',   2023, 'ND 101-001', 'Available', 'Durban Central', 'Metro Police', 'Diesel', 'Full'),
  ('MetroPolice', 'P-102', 'Patrol Car 102', 'Patrol Car',  'Toyota', 'Hilux',   2023, 'ND 102-001', 'Available', 'Pinetown',       'Metro Police', 'Diesel', 'Full'),
  ('MetroPolice', 'P-201', 'K9 Unit 201',    'K9 Unit',     'Ford',   'Ranger',  2022, 'ND 201-001', 'Available', 'Durban Central', 'Metro Police', 'Diesel', '3/4'),
  ('MetroFire',   'F-301', 'Engine 301',     'Fire Engine', 'MAN',    'TGS',     2021, 'ND 301-001', 'Available', 'Durban Central', 'Fire & Rescue', 'Diesel', 'Full'),
  ('MetroFire',   'F-302', 'Ladder 302',     'Ladder',      'Volvo',  'FE',      2020, 'ND 302-001', 'Available', 'Umhlanga',       'Fire & Rescue', 'Diesel', 'Full'),
  ('Medical',     'M-401', 'Ambulance 401',  'Ambulance',   'MB',     'Sprinter',2023, 'ND 401-001', 'Available', 'Addington',      'EMS',           'Diesel', 'Full'),
  ('Medical',     'M-402', 'Ambulance 402',  'Ambulance',   'MB',     'Sprinter',2023, 'ND 402-001', 'Available', 'King Edward',    'EMS',           'Diesel', '3/4'),
  ('EthekwiniDisaster', 'D-501', 'Command Vehicle 501', 'Command Unit', 'Toyota', 'Land Cruiser', 2022, 'ND 501-001', 'Available', 'JOC', 'Disaster Mgmt', 'Diesel', 'Full')
on conflict do nothing;

-- Sample crime stats (a few rows; full CSV import handled by migration script in Phase 4)
insert into public.crime_stats (year, station_name, local_municipality, district_municipality, latitude, longitude, murder, carjacking, burglary_residential, robbery_residential, drug_crime, dui) values
  ('2022/2023', 'Durban Central', 'eThekwini', 'eThekwini', -29.8587, 31.0218, 89, 134, 412, 287, 1542, 312),
  ('2022/2023', 'Pinetown',       'eThekwini', 'eThekwini', -29.8126, 30.8623, 34, 67,  298, 156, 798,  287),
  ('2022/2023', 'Umhlanga',       'eThekwini', 'eThekwini', -29.7264, 31.0833, 12, 23,  187, 89,  234,  198),
  ('2022/2023', 'Chatsworth',     'eThekwini', 'eThekwini', -29.9131, 30.8743, 76, 89,  267, 198, 1123, 245),
  ('2022/2023', 'Phoenix',        'eThekwini', 'eThekwini', -29.7000, 31.0500, 56, 78,  234, 167, 987,  234)
on conflict do nothing;

-- Note: System users + demo personnel + sample incidents are seeded by the
-- `seed-system-users` Edge Function which uses the Supabase Admin API and
-- assigns app_metadata.silo. SQL alone can't insert into auth.users safely.
