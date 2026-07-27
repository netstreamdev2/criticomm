#!/usr/bin/env node
/**
 * Load the SAPS crime dataset (sapacr-2008-2023-v1.1.csv) into public.crime_stats.
 * Same dataset V4 served from wwwroot/data; V5 keeps it in Postgres.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/load-crime-stats.mjs
 *
 * Idempotent: truncates crime_stats first (dataset is a static snapshot).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const csvPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'supabase', 'seed', 'data', 'sapacr-2008-2023-v1.1.csv',
);

/** Minimal CSV parser handling quoted fields (the dataset quotes everything). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const text = readFileSync(csvPath, 'utf8');
const [header, ...rows] = parseCsv(text);
const col = (name) => header.indexOf(name);

const idx = {
  year: col('year'), station: col('station'), loc: col('loc_mn'), dc: col('dc_mn'),
  lng: col('longitude'), lat: col('latitude'),
  murder: col('murder'), carjacking: col('carjacking'),
  burglary_res: col('burglary_res'), robbery_res: col('robbery_res'),
  drug_crime: col('drug_crime'), dui: col('dui'),
};
for (const [k, v] of Object.entries(idx)) {
  if (v === -1) { console.error(`CSV missing expected column for ${k}`); process.exit(1); }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const records = rows
  .filter((r) => r[idx.year] && r[idx.station])
  .map((r) => ({
    year: r[idx.year],
    station_name: r[idx.station],
    local_municipality: r[idx.loc] || null,
    district_municipality: r[idx.dc] || null,
    latitude: num(r[idx.lat]),
    longitude: num(r[idx.lng]),
    murder: num(r[idx.murder]) ?? 0,
    carjacking: num(r[idx.carjacking]) ?? 0,
    burglary_residential: num(r[idx.burglary_res]) ?? 0,
    robbery_residential: num(r[idx.robbery_res]) ?? 0,
    drug_crime: num(r[idx.drug_crime]) ?? 0,
    dui: num(r[idx.dui]) ?? 0,
  }));

console.log(`Parsed ${records.length} rows from ${csvPath}`);

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

// Static snapshot → replace wholesale.
const { error: delErr } = await supabase.from('crime_stats').delete().gte('id', 0);
if (delErr) { console.error('Clear failed:', delErr.message); process.exit(1); }

const BATCH = 500;
for (let i = 0; i < records.length; i += BATCH) {
  const chunk = records.slice(i, i + BATCH);
  const { error } = await supabase.from('crime_stats').insert(chunk);
  if (error) { console.error(`Insert failed at row ${i}:`, error.message); process.exit(1); }
  process.stdout.write(`\rInserted ${Math.min(i + BATCH, records.length)}/${records.length}`);
}
console.log('\nDone.');
