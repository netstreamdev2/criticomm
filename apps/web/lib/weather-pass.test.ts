import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueWeatherPass, WEATHER_PASS_TTL_S, weatherPassValid } from './weather-pass.ts';

const KEY = 'test-key';
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

test('a fresh pass opens tiles until it expires', () => {
  const { pass, expiresAt } = issueWeatherPass(KEY, NOW);
  assert.ok(weatherPassValid(pass, KEY, NOW));
  assert.ok(weatherPassValid(pass, KEY, NOW + (WEATHER_PASS_TTL_S - 1) * 1000));
  assert.equal(weatherPassValid(pass, KEY, NOW + (WEATHER_PASS_TTL_S + 1) * 1000), false);
  assert.equal(new Date(expiresAt).getTime(), NOW + WEATHER_PASS_TTL_S * 1000);
});

test('a pass from another key, an edited expiry or junk is refused', () => {
  const { pass } = issueWeatherPass(KEY, NOW);
  assert.equal(weatherPassValid(pass, 'other-key', NOW), false);
  const [expiry, mac] = pass.split('.');
  assert.equal(weatherPassValid(`${Number(expiry) + 3600}.${mac}`, KEY, NOW), false);
  for (const junk of ['', 'abc', `${expiry}.`, `${expiry}.${mac}x`, null, undefined]) {
    assert.equal(weatherPassValid(junk, KEY, NOW), false);
  }
});

test('a pass dated far ahead is refused even if signed', () => {
  const future = issueWeatherPass(KEY, NOW + 10 * 3600 * 1000).pass;
  assert.equal(weatherPassValid(future, KEY, NOW), false);
});

test('no key, no pass', () => {
  assert.throws(() => issueWeatherPass('', NOW));
  assert.equal(weatherPassValid(issueWeatherPass(KEY, NOW).pass, '', NOW), false);
});
