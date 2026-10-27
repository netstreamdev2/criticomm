import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warningHazard } from '@criticom/db/disaster-warnings';
import { forEthekwini, isEthekwini, parseCap, parseFeed, stampTime } from './saws-cap.ts';

/**
 * A warning that names eThekwini must reach the desk at the level SAWS gave
 * eThekwini, not the level of some other town in the same file; one that
 * does not name eThekwini must not raise the alarm here.
 */

const FEED = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>
<item><guid isPermaLink="true">http://www.weathersa.co.za/Documents/Warnings/KZN_CAP_SevereThunderstorms_20261026_081911.xml</guid>
<link>http://www.weathersa.co.za/Documents/Warnings/KZN_CAP_SevereThunderstorms_20261026_081911.xml</link><title> Severe Thunderstorms</title></item>
<item><link>http://www.weathersa.co.za/Documents/Warnings/FS_CAP_SevereThunderstorms_20261026_153751.xml</link><title> Severe Thunderstorms</title></item>
<item><link>http://www.weathersa.co.za/Documents/Warnings/KZN_CAP_DamagingWaves_20261025_090002.xml</link><title> Damaging Waves</title></item>
</channel></rss>`;

const area = (desc: string) => `<area><areaDesc>${desc}</areaDesc><polygon>-29.70,30.90 -29.80,31.10 -29.90,30.95 -29.70,30.90</polygon></area>`;
const info = (level: number, areas: string[]) => `<info><event>Severe Thunderstorms</event><severity>Moderate</severity>
<onset>2026-10-27T12:00:00+02:00</onset><expires>2026-10-27T22:59:59+02:00</expires>
<description>- Flooding of settlements, roads and bridges.
- Danger to life (fast flowing streams / deep water).</description>
<instruction>If possible stay indoors &amp; off the roads.</instruction>
<parameter><valueName>alertType</valueName><value>Warning Level ${level}</value></parameter>${areas.map(area).join('')}</info>`;
const cap = (msgType: string, infos: string) => `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
<identifier>d316dffaa3d30a9907d9ec1746fc677e2026.10.26.08.18.50</identifier><sent>2026-10-26T08:18:50+02:00</sent>
<status>Actual</status><msgType>${msgType}</msgType>${infos}</alert>`;

const file = parseFeed(FEED).find((f) => f.province === 'KZN' && f.hazard === 'SevereThunderstorms')!;

test('the feed lists each file once, oldest first, read over https', () => {
  const files = parseFeed(FEED);
  assert.deepEqual(files.map((f) => f.file), [
    'KZN_CAP_DamagingWaves_20261025_090002.xml', 'KZN_CAP_SevereThunderstorms_20261026_081911.xml', 'FS_CAP_SevereThunderstorms_20261026_153751.xml',
  ]);
  assert.ok(files.every((f) => f.url.startsWith('https://www.weathersa.co.za/Documents/Warnings/')));
  assert.equal(stampTime('20261026_081911').toISOString(), '2026-10-26T06:19:11.000Z');
});

test('eThekwini gets the highest level among the parts that name it', () => {
  const alert = parseCap(cap('Update', info(4, ['Ethekwini / King Shaka Airport', 'Ndwedwe']) + info(2, ['M_Ethekwini / M3 Durban']) + info(6, ['Ulundi'])))!;
  const w = forEthekwini(alert, file, warningHazard);
  assert.equal(w.touches, true);
  assert.equal(w.level, 4, 'Ulundi\'s Level 6 is not eThekwini\'s');
  assert.equal(w.hazard, 'Severe thunderstorms');
  assert.equal(w.valid_from, '2026-10-27T12:00:00+02:00');
  assert.equal(w.valid_until, '2026-10-27T22:59:59+02:00');
  assert.equal(w.areas, 'Ethekwini / King Shaka Airport; At sea: Ethekwini / M3 Durban (and 2 other KZN areas)');
  assert.equal(w.area_shapes?.length, 2);
  assert.deepEqual(w.area_shapes?.[0]?.[0], [-29.7, 30.9]);
  assert.equal(w.instructions, 'If possible stay indoors & off the roads.');
  assert.match(w.impacts ?? '', /Flooding of settlements/);
});

test('a file without eThekwini, and a cancellation, raise nothing new', () => {
  const elsewhere = forEthekwini(parseCap(cap('Alert', info(4, ['Ulundi'])))!, file, warningHazard);
  assert.equal(elsewhere.touches, false);
  assert.equal(elsewhere.level, undefined);
  const cancel = forEthekwini(parseCap(cap('Cancel', info(4, ['Ethekwini / King Shaka Airport'])))!, file, warningHazard);
  assert.equal(cancel.msg_type, 'Cancel');
  assert.equal(cancel.level, undefined);
});

test('a re-issue of the same warning has the same key, whatever the level', () => {
  const a = forEthekwini(parseCap(cap('Alert', info(2, ['Ethekwini / King Shaka Airport'])))!, file, warningHazard);
  const b = forEthekwini(parseCap(cap('Update', info(5, ['Ethekwini / King Shaka Airport'])))!, file, warningHazard);
  const gone = forEthekwini(parseCap(cap('Update', info(5, ['Ulundi'])))!, file, warningHazard);
  assert.equal(a.key, b.key);
  assert.equal(a.key, gone.key, 'a re-issue that leaves eThekwini out finds the same warning to end it');
});

test('eThekwini is found by its own name only', () => {
  assert.ok(isEthekwini('Ethekwini / King Shaka Airport'));
  assert.ok(isEthekwini('M_Ethekwini / M3 Durban'));
  assert.ok(!isEthekwini('KwaDukuza / KwaDukusa/Stanger'));
  assert.ok(!isEthekwini('M_KwaDukuza / M4 Tugela Mouth'));
  assert.equal(parseCap('<html>not a warning</html>'), null);
});
