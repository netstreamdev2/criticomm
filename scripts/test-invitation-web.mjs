/**
 * HTTP smoke test with a local Supabase stand-in. No real emails/accounts.
 * Run after the web build, with no dev server using apps/web/.next:
 *   node scripts/test-invitation-web.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { once } from 'node:events';

const tenantId = '10000000-0000-4000-8000-000000000001';
const recipient = {
  id: '30000000-0000-4000-8000-000000000003', aud: 'authenticated', role: 'authenticated',
  email: 'invited-person@example.com', email_confirmed_at: new Date().toISOString(),
  app_metadata: {
    role: 'Viewer', tenant_id: tenantId, invitation_pending: true,
    system_admin_invitation: {
      id: '40000000-0000-4000-8000-000000000004', tenantId,
      email: 'invited-person@example.com', name: 'Invited Person', role: 'SystemAdmin',
      invitedBy: '20000000-0000-4000-8000-000000000002', createdAt: new Date().toISOString(),
    },
  },
  user_metadata: {}, created_at: new Date().toISOString(),
};
const expectedToken = 'a'.repeat(64);
let tokenUsed = false;
let revoked = false;
let audited = false;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeJwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: recipient.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;
const api = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Content-Type', 'application/json');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : {};
  if (url.pathname === '/auth/v1/verify') {
    if (body.token_hash !== expectedToken || body.type !== 'invite' || tokenUsed) {
      res.statusCode = 403;
      res.end(JSON.stringify({ code: 'otp_expired', msg: 'Invalid token' }));
    } else {
      tokenUsed = true;
      res.end(JSON.stringify({ access_token: fakeJwt, token_type: 'bearer', refresh_token: 'mock-refresh', expires_in: 3600, user: recipient }));
    }
  } else if (url.pathname === '/auth/v1/logout') {
    revoked = url.searchParams.get('scope') === 'local';
    res.statusCode = 204; res.end();
  } else if (url.pathname === `/auth/v1/admin/users/${recipient.id}`) {
    res.end(JSON.stringify({ user: recipient }));
  } else if (url.pathname === '/rest/v1/tenants') {
    res.end(JSON.stringify([{ id: tenantId, name: 'Invitation Test Municipality', active: true }]));
  } else if (url.pathname === '/rest/v1/audit_logs' && req.method === 'POST') {
    audited = body.user_id === recipient.id && body.tenant_id === tenantId;
    res.statusCode = 201; res.end();
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: `Unexpected test endpoint ${url.pathname}` }));
  }
});
api.listen(0, '127.0.0.1');
await once(api, 'listening');
const apiUrl = `http://127.0.0.1:${api.address().port}`;
const webUrl = 'http://127.0.0.1:3101';
let web;
let log = '';
try {
  // Refuse to reuse a running app, especially one configured with real Auth.
  let occupied = false;
  try { await fetch(webUrl, { signal: AbortSignal.timeout(500) }); occupied = true; } catch {}
  assert.equal(occupied, false, 'Port 3101 must be free');
  web = spawn(process.execPath, [resolve('apps/web/node_modules/next/dist/bin/next'), 'dev', '--turbo', '--port', '3101'], {
    cwd: resolve('apps/web'), windowsHide: true,
    env: {
      ...process.env, NEXT_PUBLIC_APP_URL: webUrl, NEXT_PUBLIC_SUPABASE_URL: apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => { log = (log + chunk.toString()).slice(-8000); };
  web.stdout.on('data', append);
  web.stderr.on('data', append);
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${webUrl}/accept-invite`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((done) => setTimeout(done, 1000));
  }
  assert.ok(ready, `Test app did not start: ${log}`);
  console.log('Test app ready; all Auth requests point at the local stand-in.');

  const unauthenticated = await fetch(`${webUrl}/accept-invite?email=forged@example.com`);
  const initial = await unauthenticated.text();
  assert.match(initial, /Open your invitation email/);
  assert.doesNotMatch(initial, /id="invited-email"/);
  assert.match(unauthenticated.headers.get('cache-control'), /no-store/);

  const callback = await fetch(`${webUrl}/auth/invite?type=invite&token_hash=${expectedToken}`, {
    redirect: 'manual', headers: { Cookie: 'existing-superadmin-session=preserve-me' },
  });
  assert.equal(callback.status, 307);
  assert.equal(callback.headers.get('location'), `${webUrl}/accept-invite`);
  const cookies = callback.headers.getSetCookie();
  assert.equal(cookies.length, 1, 'Must not modify the existing Auth cookies');
  assert.match(cookies[0], /^criticom-invitation=/);
  assert.match(cookies[0], /httponly/i);
  assert.match(cookies[0], /path=\/accept-invite/i);
  assert.equal(revoked, true, 'Verification session must be revoked on the server');
  assert.equal(audited, true);
  const cookie = cookies[0].split(';')[0];

  const success = await fetch(`${webUrl}/accept-invite?email=forged@example.com`, { headers: { Cookie: cookie } });
  const screen = await success.text();
  assert.match(screen, /Invitation verified/);
  assert.match(screen, /Invitation Test Municipality/);
  assert.match(screen, /<input[^>]*id="invited-email"[^>]*readonly=""[^>]*value="invited-person@example.com"/i);
  assert.doesNotMatch(screen, /<input[^>]*type="password"/i);
  assert.doesNotMatch(screen, /<button[^>]*type="submit"/i);
  assert.doesNotMatch(screen, /mock-refresh|test-signature|test-service-key/);

  const altered = await fetch(`${webUrl}/accept-invite`, { headers: { Cookie: `${cookie}tampered` } });
  assert.match(await altered.text(), /Open your invitation email/);
  const reused = await fetch(`${webUrl}/auth/invite?type=invite&token_hash=${expectedToken}`, { redirect: 'manual' });
  assert.match(reused.headers.get('location'), /error=expired/);
  const malformed = await fetch(`${webUrl}/auth/invite?type=signup&token_hash=invalid`, { redirect: 'manual' });
  assert.match(malformed.headers.get('location'), /error=invalid/);
  console.log('Passed: verified locked email, tenant, no passwords, signed receipt, no Auth cookie replacement, invalid/replayed links.');
} catch (error) {
  console.error(log);
  throw error;
} finally {
  if (web?.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(web.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else web.kill('SIGTERM');
  }
  api.closeAllConnections();
  api.close();
}
