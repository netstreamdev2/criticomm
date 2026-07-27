#!/usr/bin/env node
/**
 * Create (or promote) the first admin user in the wired Supabase project.
 * Uses the service-role key via the Auth Admin API + a profiles upsert.
 *
 * Usage (PowerShell/bash — never commit real values):
 *   node scripts/create-admin.mjs <email> <password> [role] [silo] [fullName]
 *
 * Examples:
 *   node scripts/create-admin.mjs ops@ethekwini.gov.za "Str0ngP@ss!" SystemAdmin Ethekwini "Control Room"
 *
 * Roles: SystemAdmin | SuperAdmin | Admin | Dispatcher | Supervisor | …
 * Silos: Ethekwini | MetroPolice | MetroFire | Medical | EthekwiniDisaster
 */
import { createClient } from '@supabase/supabase-js';

const [, , email, password, role = 'SystemAdmin', silo = 'Ethekwini', fullName = 'Administrator'] = process.argv;
const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (source .env).'); process.exit(1); }
if (!email || !password) { console.error('Usage: node scripts/create-admin.mjs <email> <password> [role] [silo] [fullName]'); process.exit(1); }

const supabase = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// 1) Create the auth user with silo/role stamped into app_metadata (middleware reads these).
const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { silo, role },
  user_metadata: { full_name: fullName },
});

let userId = created?.user?.id;
if (createErr) {
  if (!/already registered|exists/i.test(createErr.message)) { console.error('createUser failed:', createErr.message); process.exit(1); }
  // Already exists → find them and update metadata.
  const { data: list } = await supabase.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) { console.error('User exists but could not be located.'); process.exit(1); }
  userId = existing.id;
  await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { silo, role }, user_metadata: { full_name: fullName },
  });
  console.log(`Updated existing user ${email}.`);
} else {
  console.log(`Created user ${email}.`);
}

// 2) Upsert the matching profiles row (RLS + app read from here).
const { error: profErr } = await supabase.from('profiles').upsert({
  id: userId, silo, role, full_name: fullName, email, status: 'Active',
});
if (profErr) { console.error('profiles upsert failed:', profErr.message); process.exit(1); }

console.log(`✓ ${email} is now ${role} in ${silo}. You can sign in at /login.`);
