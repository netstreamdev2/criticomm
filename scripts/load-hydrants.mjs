#!/usr/bin/env node
/**
 * Load fire hydrants from eThekwini Water & Sanitation (EWS) GeoJSON into
 * public.hydrants — the fire service's register and the live map's layer.
 *
 * Usage:
 *   node --env-file=apps/web/.env.local scripts/load-hydrants.mjs [file.geojson] [--remove-test-hydrants]
 *
 * With no file it loads supabase/seed/data/ews-hydrants-extract.json, V4's
 * copy. That copy is PARTIAL: the city GIS server stopped at 1,000 points
 * (exceededTransferLimit), so it covers the western and central suburbs
 * only. Load the full register the same way once EWS supplies it.
 *
 * Needs migration 0052. Safe to run again: hydrants are matched on
 * source_ref ("EWS:<EWSID>"), so a re-run moves points and adds new ones.
 * What the fire service records — status after an inspection, and the
 * inspection date — is never overwritten; only a hydrant the register now
 * calls inactive is marked Out of Service.
 *
 * --remove-test-hydrants also deletes the demo hydrants scripts/seed-all.mjs
 * creates ("Hydrant <suburb> #<n>", no source_ref).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. node --env-file=apps/web/.env.local …).');
  process.exit(1);
}

const args = process.argv.slice(2);
const removeTest = args.includes('--remove-test-hydrants');
const file = args.find((a) => !a.startsWith('--'))
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'seed', 'data', 'ews-hydrants-extract.json');

const geo = JSON.parse(readFileSync(file, 'utf8'));
const crs = geo.crs?.properties?.name;
if (crs && !/4326|CRS84/i.test(crs)) {
  console.error(`Coordinates are in ${crs}; export the hydrants as WGS84 (EPSG:4326) GeoJSON.`);
  process.exit(1);
}
if (geo.exceededTransferLimit || geo.properties?.exceededTransferLimit) {
  console.warn('! This file is a partial extract: the GIS server stopped early (exceededTransferLimit).');
}

/** Planned hydrants are not on the ground yet; anything else not ACTIVE is out of service. */
const NOT_BUILT = new Set(['PROPOSED', 'PLANNED', 'DESIGN']);

const skipped = { noId: 0, noPosition: 0, notBuilt: 0, duplicate: 0 };
const byRef = new Map();
for (const f of geo.features ?? []) {
  const p = f.properties ?? {};
  const id = p.EWSID ?? p.OBJECTID ?? f.id;
  if (id === undefined || id === null || id === '') { skipped.noId++; continue; }
  const [lng, lat] = f.geometry?.type === 'Point' ? f.geometry.coordinates : [];
  // Anywhere in South Africa; a swapped or projected coordinate fails this.
  if (!(lat >= -35 && lat <= -22 && lng >= 16 && lng <= 33)) { skipped.noPosition++; continue; }
  const life = String(p.LifeCycleStatus ?? 'ACTIVE').toUpperCase();
  if (NOT_BUILT.has(life)) { skipped.notBuilt++; continue; }
  const ref = `EWS:${id}`;
  if (byRef.has(ref)) { skipped.duplicate++; continue; }
  byRef.set(ref, {
    source_ref: ref,
    silo: 'MetroFire',
    location_name: `EWS hydrant ${id}`,
    latitude: lat,
    longitude: lng,
    active: life === 'ACTIVE',
  });
}
console.log(`Read ${geo.features?.length ?? 0} features from ${file}: ${byRef.size} hydrants to load.`);
if (Object.values(skipped).some(Boolean)) console.log('Skipped:', skipped);

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

/**
 * Once the network is involved, failures set the exit code and return:
 * process.exit() with fetch sockets still open aborts Node on Windows
 * (UV_HANDLE_CLOSING) and turns exit 1 into 127.
 */
function fail(...message) {
  console.error(...message);
  process.exitCode = 1;
  return false;
}

async function inBatches(list, label, write) {
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await write(list.slice(i, i + 500));
    if (error) return fail(`${label} failed at row ${i}:`, error.message);
  }
  if (list.length) console.log(`✓ ${label}: ${list.length}`);
  return true;
}

async function load() {
  // Which are already on the register (paged: PostgREST returns 1,000 at a time).
  const existing = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('hydrants').select('source_ref').not('source_ref', 'is', null).range(from, from + 999);
    if (error) {
      return /source_ref/.test(error.message)
        ? fail('Apply supabase/migrations/0052_hydrant_register_import.sql first '
          + '(Supabase dashboard → SQL Editor, or node scripts/apply-migration.mjs).')
        : fail('Reading the register failed:', error.message);
    }
    for (const r of data) existing.add(r.source_ref);
    if (data.length < 1000) break;
  }

  const rows = [...byRef.values()];
  const fresh = rows.filter((r) => !existing.has(r.source_ref));
  const known = rows.filter((r) => existing.has(r.source_ref));
  const upsert = (batch) => supabase.from('hydrants').upsert(batch, { onConflict: 'tenant_id,source_ref' });

  // New hydrants: no inspection on record yet (NULL, not "today").
  const added = await inBatches(fresh, 'added', (batch) => supabase.from('hydrants').insert(
    batch.map(({ active, ...r }) => ({ ...r, status: active ? 'Operational' : 'Out of Service', last_inspected: null })),
  ));
  if (!added) return false;

  // Known hydrants: move them and refresh the name; keep the fire service's status and date…
  const updated = await inBatches(known.filter((r) => r.active), 'updated',
    (batch) => upsert(batch.map(({ active, ...r }) => r)));
  if (!updated) return false;

  // …unless the water register has since taken them out of use.
  const retired = await inBatches(known.filter((r) => !r.active), 'marked out of service',
    (batch) => upsert(batch.map(({ active, ...r }) => ({ ...r, status: 'Out of Service' }))));
  if (!retired) return false;

  if (removeTest) {
    const { data, error } = await supabase
      .from('hydrants').delete().is('source_ref', null).like('location_name', 'Hydrant % #%').select('id');
    if (error) return fail('Removing test hydrants failed:', error.message);
    console.log(`✓ removed ${data.length} test hydrants`);
  }

  const { count } = await supabase.from('hydrants').select('id', { count: 'exact', head: true });
  console.log(`Done. The register now holds ${count} hydrants.`);
  return true;
}

await load();
