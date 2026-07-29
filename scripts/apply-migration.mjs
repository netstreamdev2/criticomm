#!/usr/bin/env node
/**
 * Apply one or more SQL migration files to the database in SUPABASE_DB_URL.
 *
 * The hosted project's direct host is IPv6-only, so SUPABASE_DB_URL points at
 * the Supavisor session pooler. Each file runs inside a transaction: if any
 * statement fails the whole file rolls back and nothing is half-applied.
 *
 * Usage:
 *   node scripts/apply-migration.mjs supabase/migrations/0010_*.sql
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/apply-migration.mjs <file.sql> [...]');
  process.exit(1);
}

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('SUPABASE_DB_URL is not set (source .env first).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

let failed = false;
for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  process.stdout.write(`→ ${file} … `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('ok');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    failed = true;
    console.log('FAILED');
    console.error(`  ${err.message}`);
    if (err.position) {
      const upTo = sql.slice(0, Number(err.position));
      console.error(`  at line ${upTo.split('\n').length}`);
    }
    break;
  }
}

await client.end();
process.exit(failed ? 1 : 0);
