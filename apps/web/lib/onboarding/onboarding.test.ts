import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDeadline, invitationEmail, invitationSms } from './messages.ts';
import {
  hashInvitationSecret, looksLikeActivationCode, looksLikeLinkToken, newActivationCode, newLinkToken,
} from './secrets.ts';

test('link tokens are long, random and URL-safe', () => {
  const a = newLinkToken();
  assert.ok(looksLikeLinkToken(a), a);
  assert.notEqual(a, newLinkToken());
  assert.ok(!looksLikeLinkToken('short'));
  assert.ok(!looksLikeLinkToken(`${a}/../x`));
});

test('activation codes read one way only', () => {
  for (let i = 0; i < 200; i++) {
    const code = newActivationCode();
    assert.match(code, /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/, code);
    assert.ok(looksLikeActivationCode(code.toLowerCase().replace('-', ' ')), 'typed in any case, with a space');
  }
  assert.ok(!looksLikeActivationCode('K7Q4-M9X0'), 'a zero is never in a code');
  assert.ok(!looksLikeActivationCode('K7Q4'));
});

test('only a keyed hash is stored, and links and codes never cross', () => {
  const key = 'test-key';
  const h = hashInvitationSecret('code', 'k7q4-m9xp', key);
  assert.equal(h, hashInvitationSecret('code', 'K7Q4 M9XP', key), 'the code however typed');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, hashInvitationSecret('link', 'K7Q4M9XP', key), 'a code cannot pass as a link');
  assert.notEqual(h, hashInvitationSecret('code', 'K7Q4M9XP', 'another-key'), 'useless without the key');
  assert.throws(() => hashInvitationSecret('link', 'x', ''));
});

const data = {
  fullName: 'Thandeka Dlamini', role: 'Police' as const, silo: 'MetroPolice' as const,
  organisation: 'eThekwini Municipality', invitedBy: 'Sipho Admin', expiresAt: '2026-10-06T12:20:00Z',
};
const link = 'https://hiktech.example/invite/abc';

test('deadlines read in South African time', () => {
  assert.equal(formatDeadline('2026-10-06T12:20:00Z'), 'Tuesday 6 October 2026 at 14:20');
});

test('the email names the inviter, role and deadline, and nothing personal', () => {
  const m = invitationEmail(data, link);
  assert.equal(m.subject, 'You’ve been invited to HikTech');
  for (const part of ['Hello Thandeka', 'Sipho Admin', 'Police, Metro Police', link, 'Tuesday 6 October 2026 at 14:20', 'badge number']) {
    assert.ok(m.text.includes(part), part);
  }
  assert.ok(m.html.includes(`href="${link}"`));
  assert.ok(!/MP-1042|1042/.test(m.text + m.html), 'no badge number');
});

test('names are escaped in the email', () => {
  const m = invitationEmail({ ...data, fullName: '<script>x</script> Y', invitedBy: 'A & B' }, link);
  assert.ok(!m.html.includes('<script>x'));
  assert.ok(m.html.includes('A &amp; B'));
});

test('the SMS is short and carries no personal number', () => {
  const s = invitationSms(data, link, Date.parse('2026-10-03T12:20:00Z'));
  assert.ok(s.startsWith('HikTech: Sipho Admin (eThekwini Municipality) invited you as Police, Metro Police.'));
  assert.ok(s.includes('within 3 days'));
  assert.ok(s.includes(link));
  assert.ok(s.length < 320, `${s.length} characters`);
});
