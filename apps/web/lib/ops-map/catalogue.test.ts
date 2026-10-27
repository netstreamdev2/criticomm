import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, CATALOGUE_GROUPS, catalogueOverlay, matchesSearch, riskSeason } from './catalogue.ts';
import {
  aqiBand, gdacsItems, hasFeatureSource, hasTileSource, overlayTileUrl, quakeColour, riskClass, shareColour, spiClass, tileBbox,
} from '../maps/sources.ts';
import { LAYERS, availableLayers, restoreLayers } from './layers.ts';

/**
 * Every overlay the panel offers can be drawn: it has a source on the
 * server, a legend, words for its (i) and a link to where it comes from.
 * Search finds what people type; the colours follow their scales.
 */

test('every overlay is well formed and has a source on the server', () => {
  const ids = CATALOGUE.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'no id twice');
  for (const o of CATALOGUE) {
    assert.ok((CATALOGUE_GROUPS as readonly string[]).includes(o.group), `${o.id} has a known group`);
    assert.ok(o.legend.length > 0, `${o.id} has a legend`);
    assert.ok(o.about.length > 40 && o.hint.length > 10, `${o.id} explains itself`);
    assert.match(o.sourceUrl, /^https:\/\//, `${o.id} links to its source`);
    assert.ok(!LAYERS.some((l) => (l.id as string) === o.id), `${o.id} does not clash with the map's own layers`);
    if (o.id === 'saws-areas') continue; // from our own records, in the API route
    if (o.kind === 'tiles') assert.ok(hasTileSource(o.id), `${o.id} has its pictures`);
    else assert.ok(hasFeatureSource(o.id), `${o.id} has its features`);
  }
});

test('the Disaster maps offer the overlays; the others do not', () => {
  const disaster = availableLayers({ cameras: false, shelters: true, catalogue: true });
  assert.ok(disaster.includes('saws-areas') && disaster.includes('wards') && disaster.includes('incidents'));
  assert.ok(!availableLayers({ cameras: true }).includes('wards'));
  // A saved choice keeps the overlays only where they are offered.
  assert.deepEqual(restoreLayers(['incidents', 'wards'], availableLayers({ cameras: true }), []), ['incidents']);
  assert.deepEqual(restoreLayers(['incidents', 'wards'], disaster, []), ['incidents', 'wards']);
});

test('search finds a layer by what people call it', () => {
  const find = (q: string) => CATALOGUE.filter((o) => matchesSearch(o, q)).map((o) => o.id);
  assert.ok(find('flood').includes('flood-modis-2d'));
  assert.ok(find('flood').includes('flood-risk'));
  assert.ok(find('councillor').includes('wards'));
  assert.ok(find('shack').includes('ward-informal'));
  assert.ok(find('school').includes('schools'));
  assert.deepEqual(find('ward councillor'), ['wards']);
  assert.equal(find('').length, CATALOGUE.length);
  assert.equal(catalogueOverlay('nope'), null);
});

test('the risk season follows the calendar in Durban', () => {
  assert.equal(riskSeason(new Date('2026-10-27T10:00:00+02:00')), 'Spring');
  assert.equal(riskSeason(new Date('2026-12-15T10:00:00+02:00')), 'Summer');
  assert.equal(riskSeason(new Date('2026-06-01T01:00:00+02:00')), 'Winter');
  assert.equal(riskSeason(new Date('2026-04-10T10:00:00+02:00')), 'Autumn');
});

test('the colours follow their scales', () => {
  assert.equal(riskClass(1).name, 'Very low');
  assert.equal(riskClass(3.32).name, 'Medium');
  assert.equal(riskClass(4.6).name, 'Very high');
  assert.equal(riskClass(Number.NaN).name, 'Very low');
  assert.equal(spiClass(-2.3).name, 'Extremely dry');
  assert.equal(spiClass(0.97).name, 'Near normal');
  assert.equal(spiClass(1.6).name, 'Very wet');
  assert.equal(shareColour(0.5, [5, 15, 30, 50]), '#fff5eb');
  assert.equal(shareColour(37, [25, 30, 35, 40]), '#d94801');
  assert.equal(shareColour(80, [5, 15, 30, 50]), '#7f2704');
  assert.equal(quakeColour(2.3), '#fde68a');
  assert.equal(quakeColour(5.5), '#b91c1c');
  assert.equal(aqiBand(27).name, 'Fair');
});

test('a tile asks its source for exactly its own square', () => {
  const [w, s, e, n] = tileBbox(0, 0, 0);
  assert.ok(Math.abs(w + 20037508.34) < 1 && Math.abs(e - 20037508.34) < 1 && Math.abs(s + 20037508.34) < 1 && Math.abs(n - 20037508.34) < 1);
  const url = overlayTileUrl('clouds-satellite', 5, 18, 18)!.url;
  assert.match(url, /LAYERS=msg_fes:ir108/);
  assert.match(url, /BBOX=/);
  assert.equal(overlayTileUrl('clouds-satellite', 12, 0, 0), null, 'beyond what the source draws');
  assert.match(overlayTileUrl('flood-modis-2d', 9, 300, 300)!.url, /MODIS_Combined_Flood_2-Day\/default\/default\/GoogleMapsCompatible_Level9\/9\/300\/300\.png$/);
});

test('GDACS: current events near us only', () => {
  const item = (lat: number, lng: number, current = 'true', level = 'Orange') => `<item><title>Orange flood in Mozambique</title>
    <link>http://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=1</link><gdacs:iscurrent>${current}</gdacs:iscurrent>
    <gdacs:alertlevel>${level}</gdacs:alertlevel><gdacs:eventtype>FL</gdacs:eventtype><gdacs:eventname></gdacs:eventname>
    <gdacs:country>Mozambique</gdacs:country><geo:Point><geo:lat>${lat}</geo:lat><geo:long>${lng}</geo:long></geo:Point></item>`;
  const got = gdacsItems(`<rss><channel>${item(-25, 33)}${item(-18, -178)}${item(-26, 32, 'false')}</channel></rss>`);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.properties.title, 'Flood: Mozambique');
  assert.equal(got[0]!.properties.colour, '#f97316');
  assert.equal(got[0]!.properties.url, 'https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1');
});
