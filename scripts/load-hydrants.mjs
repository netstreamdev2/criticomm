#!/usr/bin/env node
/**
 * Load fire hydrants from eThekwini Water & Sanitation (EWS) GeoJSON into
 * public.hydrants — the fire service's register and the live map's layer.
 *
 * Usage:
 *   node --env-file=apps/web/.env.local scripts/load-hydrants.mjs --from-gis [--dry-run]
 *   node --env-file=apps/web/.env.local scripts/load-hydrants.mjs [file.geojson] [--remove-test-hydrants]
 *
 * --from-gis reads the whole register from the city's own GIS server: EWS's
 * "Water Fire Hydrants" layer (about 35,000 points), 1,000 at a time. The
 * server leaves its Sectigo intermediate certificate out of the handshake,
 * so it is supplied from scripts/certs/ and the connection is still fully
 * verified. Fire sprinklers (FS) are inside buildings, not on the street, and
 * are left out.
 *
 * --dry-run reads and counts, and writes nothing (no keys needed).
 *
 * With no file it loads supabase/seed/data/ews-hydrants-extract.json, V4's
 * copy. That copy is PARTIAL: the city GIS server stopped at 1,000 points
 * (exceededTransferLimit), so it covers the western and central suburbs
 * only. --from-gis replaces it.
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
import https from 'node:https';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const removeTest = args.includes('--remove-test-hydrants');
const fromGis = args.includes('--from-gis');
const dryRun = args.includes('--dry-run');
if (!dryRun && (!URL || !KEY)) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. node --env-file=apps/web/.env.local …).');
  process.exit(1);
}
const file = args.find((a) => !a.startsWith('--'))
  ?? join(here, '..', 'supabase', 'seed', 'data', 'ews-hydrants-extract.json');

/** EWS's "Water Fire Hydrants" layer on the city GIS server. */
const GIS_LAYER = 'https://gis.durban.gov.za/server/rest/services/WebViewers/Infrastructural_Services/MapServer/6';
/** The usual roots plus the intermediate the city server does not send. */
const GIS_CA = [...tls.rootCertificates, readFileSync(join(here, 'certs', 'sectigo-dv-r36.pem'), 'utf8')];

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { ca: GIS_CA, timeout: 60_000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GIS server answered ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('GIS server sent something that is not JSON')); }
      });
    }).on('timeout', function () { this.destroy(new Error('GIS server timed out')); }).on('error', reject);
  });
}

/** The whole layer as one WGS84 GeoJSON collection, a page at a time. */
async function readGis() {
  const page = 1000;
  const { count } = await getJson(`${GIS_LAYER}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const features = [];
  for (let offset = 0; ; offset += page) {
    const q = new URLSearchParams({
      where: '1=1', outFields: 'OBJECTID,FeatureType,LifeCycleStatus,EWSID', returnGeometry: 'true',
      outSR: '4326', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: String(page), f: 'geojson',
    });
    const got = await getJson(`${GIS_LAYER}/query?${q}`);
    if (got.error) throw new Error(`GIS server: ${got.error.message ?? JSON.stringify(got.error)}`);
    features.push(...(got.features ?? []));
    process.stdout.write(`\rRead ${features.length} of ${count} from the city GIS…`);
    if ((got.features ?? []).length < page) break;
  }
  process.stdout.write('\n');
  if (features.length !== count) {
    throw new Error(`The GIS server said ${count} hydrants but sent ${features.length}; nothing was loaded. Try again.`);
  }
  return { type: 'FeatureCollection', features };
}

let geo;
try {
  geo = fromGis ? await readGis() : JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const source = fromGis ? 'the city GIS (EWS Water Fire Hydrants)' : file;
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

/** EWS feature types, as the layer describes them; FS (sprinklers) are inside buildings and are left out. */
const KIND = { SH: 'Standard hydrant', DSH: 'Double hydrant', FP: 'Fire plug' };

const skipped = { noId: 0, noPosition: 0, notBuilt: 0, sprinkler: 0, duplicate: 0 };
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
  const kind = String(p.FeatureType ?? '').toUpperCase();
  if (kind === 'FS') { skipped.sprinkler++; continue; }
  const ref = `EWS:${id}`;
  if (byRef.has(ref)) { skipped.duplicate++; continue; }
  byRef.set(ref, {
    source_ref: ref,
    silo: 'MetroFire',
    location_name: `${KIND[kind] ?? 'Hydrant'} ${id}`,
    latitude: lat,
    longitude: lng,
    active: life === 'ACTIVE',
  });
}
console.log(`Read ${geo.features?.length ?? 0} features from ${source}: ${byRef.size} hydrants to load.`);
if (Object.values(skipped).some(Boolean)) console.log('Skipped:', skipped);
if (dryRun) {
  const rows = [...byRef.values()];
  console.log(`Dry run: ${rows.filter((r) => r.active).length} in service, ${rows.filter((r) => !r.active).length} out of service. Nothing was written.`);
  process.exit(0);
}

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
