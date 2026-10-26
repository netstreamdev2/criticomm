import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PIN_MAX_TRIES, PIN_STATE_MESSAGES, pinProblem } from './sign-in-pin.ts';

test('a PIN is six digits', () => {
  assert.equal(pinProblem('48213'), 'Your PIN is 6 digits.');
  assert.equal(pinProblem('4821390'), 'Your PIN is 6 digits.');
  assert.equal(pinProblem('48a139'), 'Your PIN is 6 digits.');
  assert.equal(pinProblem(' 482139'), 'Your PIN is 6 digits.');
  assert.equal(pinProblem('482139'), null);
});

test('only the obvious PINs are refused (0110): one digit six times, 123456 and 654321', () => {
  for (const pin of ['000000', '111111', '999999']) assert.match(pinProblem(pin) ?? '', /one digit/);
  for (const pin of ['123456', '012345', '456789', '654321', '987654', '543210']) assert.match(pinProblem(pin) ?? '', /123456 or 654321/);
});

test('PINs officers pick to remember are allowed', () => {
  for (const pin of ['121212', '112233', '159753', '104200', '200519', '852852']) assert.equal(pinProblem(pin), null, pin);
});

test('the lock counts the same tries as the database (0108)', () => {
  assert.equal(PIN_MAX_TRIES, 5);
  assert.match(PIN_STATE_MESSAGES.locked, /5 wrong tries/);
});
