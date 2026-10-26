import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAge, checkCapacity, checkCount, checkEmail, checkName, checkPhone, checkWard, figureMax, wardNumber } from './disaster-checks.ts';

test('phone numbers: South African in any spacing, or international; nothing made up', () => {
  for (const ok of ['082 123 4567', '0821234567', '+27 82 123 4567', '27821234567', '031-361-0000', '(031) 361 0000', '+44 20 7946 0958', '', null]) {
    assert.equal(checkPhone(ok), null, String(ok));
  }
  for (const bad of ['123', '082 123', '08212345678', '0000000000', '0111111111', '+27 0 82 123 4567', 'abc', '1234567890']) {
    assert.ok(checkPhone(bad), bad);
  }
});

test('wards: a number, eThekwini 1 to 111', () => {
  assert.equal(wardNumber('Ward 76'), '76');
  assert.equal(wardNumber(' 076 '), '76');
  assert.equal(wardNumber('Umlazi'), null);
  assert.equal(checkWard('76'), null);
  assert.equal(checkWard('ward 111', 'eThekwini Metro'), null);
  assert.ok(checkWard('112', 'eThekwini Metro'));
  assert.equal(checkWard('115', 'Ugu'), null);
  assert.ok(checkWard('121', 'Ugu'));
  assert.ok(checkWard('0'));
  assert.ok(checkWard('Umlazi'));
  assert.equal(checkWard(''), null);
});

test('names, ages and email addresses', () => {
  assert.equal(checkName('Thandi Mkhize'), null);
  assert.equal(checkName("N'wa-Baloyi"), null);
  assert.ok(checkName('Thandi 2'));
  assert.ok(checkName('x'));
  assert.equal(checkAge('34'), null);
  assert.equal(checkAge('0'), null);
  assert.ok(checkAge('130'));
  assert.ok(checkAge('about 30'));
  assert.equal(checkEmail('t.mkhize@durban.gov.za'), null);
  assert.ok(checkEmail('t.mkhize@durban'));
});

test('counts: whole numbers within what one incident can have', () => {
  assert.equal(checkCapacity('350'), null);
  assert.equal(checkCapacity('0'), null, 'not known yet');
  assert.ok(checkCapacity('250000'));
  assert.equal(figureMax('water_tankers'), 1000);
  assert.equal(figureMax('people_rescued'), 500000);
  assert.equal(checkCount('12', figureMax('water_tankers')), null);
  assert.ok(checkCount('5000', figureMax('water_tankers')));
  assert.equal(checkCount('5000', figureMax('people_rescued')), null);
  assert.ok(checkCount('1.5', 10));
});
