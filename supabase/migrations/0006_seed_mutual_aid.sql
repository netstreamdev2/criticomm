-- =====================================================================
-- Mutual-aid partner directory — the 41-agency list hardcoded in
-- V4 DisasterController.GetPartnersByResource, now a maintainable table.
-- Idempotent via unique agency_name.
-- =====================================================================
create unique index if not exists mutual_aid_partners_agency_name_key
  on public.mutual_aid_partners (agency_name);

insert into public.mutual_aid_partners (agency_name, resource_type, contact_number, radio_frequency, commander_name) values
  -- Law enforcement & SAPS
  ('Durban Metro Police HQ',            'Law Enforcement', '031 361 0000',  'Metro Ch 1',        'Duty Commander'),
  ('SAPS Durban Central',               'Law Enforcement', '031 325 4011',  'SAPS Secure',       'Station Commander'),
  ('SAPS Flying Squad (10111)',         'Law Enforcement', '10111',         'SAPS Ops',          'Shift Leader'),
  ('SAPS Search & Rescue (KZN)',        'Law Enforcement', '031 325 6711',  'SAR Tac 1',         'Capt. K9 Unit'),
  ('SAPS Public Order Policing (POP)',  'Law Enforcement', '031 325 6000',  'Riot Control Link', 'POP Commander'),
  ('Metro Police - Pinetown',           'Law Enforcement', '031 311 2809',  'Metro Ch 2',        'Regional Commander'),
  ('Metro Police - Umlazi',             'Law Enforcement', '031 311 5000',  'Metro Ch 3',        'Regional Commander'),
  -- Fire stations
  ('Durban Central Fire Station',       'Fire Stations',   '031 361 0000',  'Fire Tac 1',        'Chief Fire Officer'),
  ('Pinetown Fire Station',             'Fire Stations',   '031 311 8273',  'Fire Tac 2',        'Station Commander'),
  ('Umhlanga Fire Station',             'Fire Stations',   '031 561 1111',  'Fire Tac 3',        'Station Commander'),
  ('Amanzimtoti Fire Station',          'Fire Stations',   '031 311 5880',  'Fire Tac 4',        'Station Commander'),
  ('Westville Fire Station',            'Fire Stations',   '031 311 5200',  'Fire Tac 5',        'Station Commander'),
  ('Chatsworth Fire Station',           'Fire Stations',   '031 311 5900',  'Fire Tac 6',        'Station Commander'),
  ('Working on Fire (Wildfires)',       'Fire Stations',   '0860 040 404',  'WoF Air-to-Ground', 'KZN Dispatch'),
  -- Hospitals
  ('Addington Hospital (Public)',       'Hospitals',       '031 327 2000',  'Med-Link 1',        'Casualty Manager'),
  ('King Edward VIII (Public)',         'Hospitals',       '031 360 3111',  'Med-Link 2',        'Trauma Head'),
  ('Albert Luthuli Central (Public)',   'Hospitals',       '031 240 1000',  'Med-Link 3',        'Emergency Coordinator'),
  ('Mahatma Gandhi Memorial (Public)',  'Hospitals',       '031 502 1719',  'Med-Link 4',        'ER Manager'),
  ('Prince Mshiyeni Memorial (Public)', 'Hospitals',       '031 907 8111',  'Med-Link 5',        'ER Manager'),
  ('Netcare St Augustine''s (Private)', 'Hospitals',       '031 268 5000',  'Pvt-Link A',        'ER Manager'),
  ('Netcare Umhlanga (Private)',        'Hospitals',       '031 560 5500',  'Pvt-Link B',        'ER Manager'),
  ('Busamed Gateway (Private)',         'Hospitals',       '031 492 1130',  'Pvt-Link C',        'ER Manager'),
  -- Ambulance & EMS
  ('KZN Provincial EMS (10177)',        'Ambulance & EMS', '10177',         'Gov EMS Ops',       'Provincial Dispatch'),
  ('Netcare 911',                       'Ambulance & EMS', '082 911',       'Netcare Dispatch',  'KZN Operations'),
  ('ER24 Ambulance',                    'Ambulance & EMS', '084 124',       'ER24 Ops',          'Regional Dispatch'),
  ('KZN VIP Medical Rescue',            'Ambulance & EMS', '086 100 0911',  'VIP Med Channel',   'Shift Supervisor'),
  ('IPSS Medical Rescue',               'Ambulance & EMS', '082 316 4636',  'IPSS Control',      'Operations Manager'),
  -- Rescue & NGO
  ('NSRI Station 5 (Durban Port)',      'Rescue & NGO',    '082 990 5948',  'Marine VHF Ch 16',  'Base Commander'),
  ('Gift of the Givers (KZN Ops)',      'Rescue & NGO',    '0800 786 911',  'Sat-Phone 1',       'Dr. Sooliman / KZN Rep'),
  ('Red Cross South Africa',            'Rescue & NGO',    '031 563 2914',  'NGO Link',          'Relief Coordinator'),
  ('Salvation Army KZN',                'Rescue & NGO',    '031 202 2181',  'Mobile Cell',       'Disaster Services'),
  ('SPCA (Animal Rescue)',              'Rescue & NGO',    '031 579 6500',  'Mobile Cell',       'Inspectorate'),
  -- Utilities
  ('eThekwini Electricity (Faults)',    'Utilities',       '080 311 1111',  'Grid Control',      'Duty Engineer'),
  ('eThekwini Water & Sanitation',      'Utilities',       '080 131 3013',  'Water Ops',         'Sanitation Lead'),
  ('Transnet National Ports Auth.',     'Utilities',       '031 361 8821',  'Port Control 1',    'Harbour Master'),
  ('Eskom KZN Control Center',          'Utilities',       '0860 037 566',  'National Grid Ops', 'Regional Engineer'),
  ('SANRAL (Highways/Bridges)',         'Utilities',       '033 392 8100',  'Road Mgt Link',     'Infrastructure Eng.'),
  -- Government
  ('KZN Prov. Disaster Management',     'Government',      '033 897 5600',  'JOC Command Link',  'PDMC Head'),
  ('SANDF (Military Aid to Civil Auth)','Government',      '012 355 6000',  'Mil-Tac Alpha',     'Joint Ops Command'),
  ('SASSA (Relief Funds/Grants)',       'Government',      '033 846 3300',  'Mobile Cell',       'Crisis Relief Lead'),
  -- Internal placeholder (present in V4 list)
  ('Pending Assignment',                'Internal',        'TBA',           'TBA',               'TBA')
on conflict (agency_name) do nothing;
