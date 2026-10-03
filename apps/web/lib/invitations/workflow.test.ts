import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  invitationCallback, pendingMetadata, readInvitation, sendSystemAdminInvitation,
  type Invitation, type InvitationOperations, type InvitedAccount,
} from './workflow.ts';
import { createInvitationReceipt, readInvitationReceipt, RECEIPT_SECONDS } from './receipt.ts';

const tenantId = '10000000-0000-4000-8000-000000000001';
const actor = { id: '20000000-0000-4000-8000-000000000002', role: 'SuperAdmin' };
const input = { tenantId, name: 'Test Admin', email: 'recipient@example.com' };
const origin = 'http://127.0.0.1:3000';

function harness() {
  const calls: string[] = [];
  let account: InvitedAccount | null = null;
  let active = true;
  const operations: InvitationOperations = {
    async getTenant() { calls.push('tenant'); return { id: tenantId, name: 'Test tenant', active }; },
    async findAccount() { calls.push('find'); return account; },
    async createAccount(invitation: Invitation) {
      calls.push('create');
      account = { id: 'user-id', email: invitation.email, app_metadata: pendingMetadata(invitation) };
      return account;
    },
    async audit(_id, _invitation, event) { calls.push(`audit:${event}`); },
    async sendEmail(email, callback) {
      calls.push('send');
      assert.equal(email, input.email);
      assert.equal(callback, `${origin}/auth/invite`);
      assert.ok(account);
      assert.equal(account.app_metadata.role, 'Viewer');
      assert.equal(account.app_metadata.invitation_pending, true);
      assert.equal(readInvitation(account)?.tenantId, tenantId);
      return account.id;
    },
  };
  return {
    calls, operations,
    get account() { return account; },
    set account(value) { account = value; },
    set active(value: boolean) { active = value; },
  };
}

test('only SuperAdmin may invoke the invitation workflow', async () => {
  const h = harness();
  for (const role of ['SystemAdmin', 'Admin', 'Viewer', '']) {
    await assert.rejects(sendSystemAdminInvitation({ ...actor, role }, input, origin, h.operations), /Only a SuperAdmin/);
  }
  assert.deepEqual(h.calls, []);
});

test('pending assignment and audit precede mail; input cannot choose SuperAdmin as invited role', async () => {
  const h = harness();
  const result = await sendSystemAdminInvitation(actor, { ...input, email: ' Recipient@Example.com ', role: 'SuperAdmin' }, origin, h.operations);
  assert.equal(result.email, input.email);
  assert.equal(readInvitation(h.account!)?.role, 'SystemAdmin');
  assert.equal(readInvitation(h.account!)?.invitedBy, actor.id);
  assert.deepEqual(h.calls, ['tenant', 'find', 'create', 'audit:requested', 'send', 'audit:sent']);
});

test('invalid input and suspended tenants do not create accounts or send mail', async () => {
  const h = harness();
  await assert.rejects(sendSystemAdminInvitation(actor, { ...input, email: 'not-an-email' }, origin, h.operations));
  assert.deepEqual(h.calls, []);
  h.active = false;
  await assert.rejects(sendSystemAdminInvitation(actor, input, origin, h.operations), /active tenant/);
  assert.deepEqual(h.calls, ['tenant']);
});

test('existing accounts cannot be moved, promoted, or invited again after verification', async () => {
  const h = harness();
  h.account = { id: 'existing', email: input.email, app_metadata: { role: 'SuperAdmin' } };
  await assert.rejects(sendSystemAdminInvitation(actor, input, origin, h.operations), /already belongs/);
  assert.ok(!h.calls.includes('send'));
  h.account = null;
  await sendSystemAdminInvitation(actor, input, origin, h.operations);
  const prepared = h.account!;
  h.account = { ...prepared, email_confirmed_at: new Date().toISOString() };
  h.calls.length = 0;
  await assert.rejects(sendSystemAdminInvitation(actor, input, origin, h.operations), /already belongs/);
  assert.ok(!h.calls.includes('send'));
});

test('resending is limited to the original tenant and pending recipient', async () => {
  const h = harness();
  await sendSystemAdminInvitation(actor, input, origin, h.operations);
  h.calls.length = 0;
  await sendSystemAdminInvitation(actor, input, origin, h.operations);
  assert.ok(!h.calls.includes('create'));
  assert.ok(h.calls.includes('send'));
  const stored = readInvitation(h.account!)!;
  h.account = { ...h.account!, app_metadata: pendingMetadata({ ...stored, tenantId: '30000000-0000-4000-8000-000000000003' }) };
  h.calls.length = 0;
  await assert.rejects(sendSystemAdminInvitation(actor, input, origin, h.operations), /already belongs/);
  assert.ok(!h.calls.includes('send'));
});

test('SMTP failure leaves a retryable pending account, without creating another one', async () => {
  const h = harness();
  const send = h.operations.sendEmail;
  h.operations.sendEmail = async () => { throw new Error('SMTP unavailable'); };
  await assert.rejects(sendSystemAdminInvitation(actor, input, origin, h.operations), /SMTP/);
  assert.equal(h.account?.app_metadata.invitation_pending, true);
  assert.ok(h.calls.includes('audit:failed'));
  h.operations.sendEmail = send;
  h.calls.length = 0;
  await sendSystemAdminInvitation(actor, input, origin, h.operations);
  assert.ok(!h.calls.includes('create'));
});

test('unrecorded invitations are not sent when the initial audit fails', async () => {
  const h = harness();
  h.operations.audit = async () => { throw new Error('audit unavailable'); };
  await assert.rejects(sendSystemAdminInvitation(actor, input, origin, h.operations), /audit/);
  assert.ok(!h.calls.includes('send'));
});

test('post-send audit errors report delivery separately, avoiding accidental retries', async () => {
  const h = harness();
  h.operations.audit = async (_id, _invitation, event) => { if (event === 'sent') throw new Error('audit unavailable'); };
  const result = await sendSystemAdminInvitation(actor, input, origin, h.operations);
  assert.equal(result.email, input.email);
  assert.match(result.warning!, /Email was sent/);
});

test('landing data cannot come from a mismatched email or active role', async () => {
  const h = harness();
  await sendSystemAdminInvitation(actor, input, origin, h.operations);
  assert.equal(readInvitation({ ...h.account!, email: 'someone-else@example.com' }), null);
  assert.equal(readInvitation({ ...h.account!, app_metadata: { ...h.account!.app_metadata, role: 'SystemAdmin' } }), null);
});

test('callback URL only comes from a valid configured origin', () => {
  assert.equal(invitationCallback(origin), `${origin}/auth/invite`);
  assert.equal(invitationCallback('https://criticomm.example'), 'https://criticomm.example/auth/invite');
  for (const value of [undefined, 'http://external.example', 'javascript:alert(1)', 'https://a.example?next=evil', 'https://user:pass@a.example', 'https://a.example/path']) {
    assert.throws(() => invitationCallback(value));
  }
});

test('receipt requires the correct signature, expires, and binds a specific invitation', () => {
  const secret = 'test-only-secret';
  const receipt = createInvitationReceipt('user-one', 'invitation-one', secret, 1000);
  assert.deepEqual(readInvitationReceipt(receipt, secret, 2000), { userId: 'user-one', invitationId: 'invitation-one' });
  assert.equal(readInvitationReceipt(receipt, 'different-key', 2000), null);
  assert.equal(readInvitationReceipt(receipt, secret, 1000 + RECEIPT_SECONDS * 1000), null);
  const parts = receipt.split('.');
  const fake = Buffer.from(JSON.stringify({ userId: 'user-two', invitationId: 'invitation-one', expires: 99999999 })).toString('base64url');
  assert.equal(readInvitationReceipt(`${fake}.${parts[1]}`, secret, 2000), null);
  assert.equal(readInvitationReceipt(`${receipt}.extra`, secret, 2000), null);
  assert.equal(readInvitationReceipt('invalid', secret, 2000), null);
});
