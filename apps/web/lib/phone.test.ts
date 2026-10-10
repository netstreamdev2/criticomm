import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPhone } from './phone.ts';

const e164 = (raw: string, iso?: string) => {
  const r = checkPhone(raw, iso);
  return r.ok ? r.e164 : `ERR ${r.error}`;
};

test('a South African number reads the same however the caller says it', () => {
  for (const raw of ['082 123 4567', '0821234567', '+27 82 123 4567', '0027821234567', '27821234567', '82 123 4567', '(082) 123-4567']) {
    assert.equal(e164(raw), '+27821234567', raw);
  }
  assert.equal(e164('031 311 1111'), '+27313111111', 'a Durban landline');
});

test('a South African number that cannot exist is refused, and the message says why', () => {
  assert.match(e164('082 123 456'), /Too short for South Africa: 9 digits after \+27/);
  assert.match(e164('082 123 45678'), /Too long/);
  assert.match(e164('092 123 4567'), /not a valid South Africa number/);
  assert.match(e164(''), /Enter the caller/);
  assert.match(e164('082 ABC 4567'), /digits only/);
  assert.match(e164('082*123#4567'), /Remove the symbols/);
  assert.match(e164('082+1234567'), /The \+ belongs only at the start/);
});

test('an American caller: chosen as the country, or pasted whole', () => {
  assert.equal(e164('(415) 555-0132', 'US'), '+14155550132');
  assert.equal(e164('1 415 555 0132', 'US'), '+14155550132', 'the trunk 1');
  assert.equal(e164('+1 415 555 0132'), '+14155550132', 'pasted with +1 while South Africa is selected');
  assert.match(e164('(015) 555-0132', 'US'), /not a valid United States/, 'an area code cannot start with 0 or 1');
  assert.match(e164('415 555 013', 'US'), /Too short for United States/);
  const r = checkPhone('+1 415 555 0132');
  assert.ok(r.ok && r.country.iso === 'US', 'the country follows the number');
});

test('other countries, and the international standard for ones not listed', () => {
  assert.equal(e164('+44 7700 900123'), '+447700900123');
  assert.equal(e164('077 123 4567', 'ZW'), '+263771234567');
  assert.equal(e164('+372 5123 4567'), '+37251234567', 'Estonia, not listed: held to 8–15 digits');
  assert.match(e164('+999 1'), /8 to 15 digits/);
});
