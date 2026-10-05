#!/usr/bin/env node
/**
 * Development only: a second eThekwini SystemAdmin, so two-person approvals
 * can be tested (0048 needs two). Never run against production: real
 * SystemAdmins arrive by invitation.
 *
 * Usage: node --env-file=apps/web/.env.local scripts/seed-second-sysadmin.mjs
 * Signs in as sysadmin2@criticom.gov.za with the demo password (Test123!).
 * Safe to re-run.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const EMAIL = 'sysadmin2@criticom.gov.za';
const NAME = 'Zanele Admin';

const { data: tenant, error: tErr } = await db.from('tenants').select('id').eq('slug', 'ethekwini').single();
if (tErr) throw tErr;

const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
let user = list.users.find((u) => u.email === EMAIL);
if (!user) {
  const { data, error } = await db.auth.admin.createUser({
    email: EMAIL, password: 'Test123!', email_confirm: true, user_metadata: { full_name: NAME },
  });
  if (error) throw error;
  user = data.user;
}

const { error } = await db.from('profiles').upsert({
  id: user.id, tenant_id: tenant.id, silo: 'Ethekwini', role: 'SystemAdmin',
  full_name: NAME, email: EMAIL, badge_number: 'B1099', status: 'Active',
});
if (error) throw error;
console.log(`${EMAIL} is a SystemAdmin in eThekwini (password Test123!).`);
