/** Browser smoke of the Expo app with intercepted Supabase requests (no real duty writes).
 * Start Expo web on 8081. Supply FIRE_PLAYWRIGHT_MODULE if Playwright is installed outside this repo.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.FIRE_PLAYWRIGHT_MODULE || 'playwright');
const screenshots = process.env.FIRE_SCREENSHOT_DIR || join(tmpdir(), 'criticomm-fire-previews');
mkdirSync(screenshots, { recursive: true });
const env = readFileSync(new URL('../apps/mobile/.env.local', import.meta.url), 'utf8');
const host = new URL(env.match(/^EXPO_PUBLIC_SUPABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g, ''));
const storageKey = `sb-${host.hostname.split('.')[0]}-auth-token`;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const essential = ['lights_functional','tires_condition_ok','equipment_stocked','comms_working','brakes_responsive'];
const equipment = ['scba_checked','water_tank_full','pump_operational','hoses_and_nozzles_stocked','ladders_secured','turnout_gear_complete'];
const baseURL = process.env.FIRE_APP_URL || 'http://127.0.0.1:8081';
let passed = 0;
let activePage;

async function openApp({ silo = 'MetroFire', clearance = false, readiness = clearance, missingMigration = false, noAppliances = false, light = false, width = 390 } = {}) {
  const user = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'fire-test@example.invalid',
    app_metadata: { silo, role: silo === 'MetroFire' ? 'Firefighter' : 'Police', tenant_id: '20000000-0000-4000-8000-000000000001' },
    user_metadata: { full_name: 'Miller' }, created_at: new Date().toISOString() };
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: user.app_metadata })}.test-only`;
  const session = { access_token: token, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const appliance = { id: '30000000-0000-4000-8000-000000000001', silo, unit_number: 'FIRE-LAD-01', name: 'Aerial Ladder 1', type: 'Ladder Truck', status: 'Available', license_plate: 'ND 123-456', station_number: 'Central', mileage: 12000 };
  const person = { id: '40000000-0000-4000-8000-000000000001', tenant_id: user.app_metadata.tenant_id, user_id: user.id, silo, rank: 'Firefighter', first_name: 'Miller', last_name: 'Daniels', station: 'Central Fire Station', is_on_duty: clearance, assigned_apparatus_id: clearance ? appliance.id : null, apparatus: clearance ? appliance : null };
  let mental = readiness ? { id: 'readiness-1', timestamp: new Date().toISOString(), passed: true } : null;
  let inspection = clearance ? { id: 'inspection-1', form_version: 'fire-v1', inspection_ref: 'FIRE-TEST-0001', apparatus_id: appliance.id, checked_at: new Date().toISOString(), fuel_level: 'Full', inspector_name: 'Firefighter Miller Daniels', ...Object.fromEntries([...essential, ...equipment].map(k => [k, true])) } : null;
  let cleared = clearance;
  const writes = [];
  const errors = [];
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ key, value, light }) => {
    localStorage.setItem(key, value);
    localStorage.setItem('hiktech.theme', light ? 'light' : 'dark');
  }, { key: storageKey, value: JSON.stringify(session), light });
  await context.route(`**://${host.hostname}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const table = path.split('/').at(-1);
    const method = request.method();
    const payload = request.postData() ? JSON.parse(request.postData()) : {};
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '0-0/0' };
    const json = (body, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } });
    if (path.includes('/auth/v1/')) return json(path.endsWith('/user') ? user : session);
    if (path.includes('/rpc/')) {
      if (table === 'has_completed_shift_start_today') return json(cleared);
      if (table === 'shift_readiness_passed_today') return json(!!mental && mental.passed !== false);
      if (table === 'shift_vehicle_passed_today') return json(cleared);
      if (table === 'shift_requires_firearm' || table === 'shift_requires_bodycam') return json(silo !== 'MetroFire');
      if (table === 'shift_firearm_resolved_today' || table === 'shift_bodycam_resolved_today') return json(clearance);
      if (table === 'assign_vehicle') { person.assigned_apparatus_id = appliance.id; person.apparatus = appliance; appliance.status = 'In Use'; writes.push(table); return json(appliance); }
      if (table === 'toggle_duty') { assert.ok(cleared, 'cannot go on duty before clearance'); person.is_on_duty = true; writes.push(table); return json(person); }
      if (table.includes('count')) return json(0);
      return json([]);
    }
    if (table === 'personnel') {
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'content-range': `0-0/${person.is_on_duty ? 1 : 0}` } });
      return json(url.searchParams.get('user_id') ? person : []);
    }
    if (table === 'apparatus') return json(url.searchParams.has('id') ? appliance : noAppliances || appliance.status === 'Out of Service' ? [] : [appliance]);
    if (table === 'mental_checks') {
      if (method === 'POST') {
        mental = { ...payload, id: 'readiness-1', timestamp: new Date().toISOString(), passed: ['memory_recall','judgment','situational_awareness','not_under_influence','anger_check','reflexes'].every(k => payload[k] === true) };
        writes.push({ table, payload }); return json(mental);
      }
      return json(mental);
    }
    if (table === 'vehicle_checklists') {
      if (missingMigration) return json({ code: '42703', message: 'column scba_checked does not exist' }, 400);
      if (method === 'POST') {
        inspection = { ...payload, id: 'inspection-1', inspection_ref: 'FIRE-TEST-0001', checked_at: new Date().toISOString(), inspector_name: 'Firefighter Miller Daniels' };
        cleared = [...essential, ...equipment].every(k => payload[k] === true);
        if (!cleared) { appliance.status = 'Out of Service'; person.assigned_apparatus_id = null; person.apparatus = null; }
        writes.push({ table, payload }); return json(inspection);
      }
      return json(inspection);
    }
    if (table === 'profiles') return json({ id: user.id, silo, full_name: 'Miller Daniels', role: user.app_metadata.role });
    if (request.headers().accept?.includes('vnd.pgrst.object')) return json(null);
    return json([]);
  });
  // Never open a realtime connection to the configured project during UI tests.
  await context.routeWebSocket(/supabase/, (socket) => socket.close());
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror', (e) => { errors.push(e.message); console.error('Browser:', e.message); });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  return { context, page, writes, errors, screenshot: (name) => page.screenshot({ path: join(screenshots, `${name}.png`), fullPage: true }) };
}
async function visible(page, text) { await page.getByText(text, { exact: true }).first().waitFor({ timeout: 60000 }); }
async function yesToAll(page) {
  const radios = page.getByRole('radio', { name: /: Yes$/ });
  assert.ok(await radios.count() > 0, 'readiness/checklist Yes choices are accessible');
  for (let i = 0; i < await radios.count(); i++) await radios.nth(i).click();
}
async function pickAppliance(page) {
  await visible(page, 'Select appliance');
  await page.getByRole('radio', { name: 'FIRE-LAD-01 — Aerial Ladder 1' }).click();
  await page.getByRole('button', { name: 'Confirm appliance', exact: true }).click();
  await visible(page, 'Appliance & equipment');
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'screen must fit the viewport');
}
async function sign(page) {
  await page.getByRole('checkbox').click();
  const pad = page.getByLabel('Signature pad. Sign with your finger.');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 25, box.y + 35); await page.mouse.down();
  await page.mouse.move(box.x + 95, box.y + 75, { steps: 12 });
  await page.mouse.move(box.x + 140, box.y + 25, { steps: 12 }); await page.mouse.up();
}
try {
  const flow = await openApp();
  await visible(flow.page, 'Ready to respond.'); await flow.screenshot('01-fire-welcome'); await noOverflow(flow.page);
  await flow.page.getByRole('button', { name: 'Begin shift checks' }).click();
  await flow.page.getByRole('button', { name: 'Confirm readiness' }).click();
  await visible(flow.page, 'Answer all six readiness questions.');
  assert.equal(flow.writes.length, 0);
  await yesToAll(flow.page);
  await flow.page.getByRole('button', { name: 'Confirm readiness' }).click();
  await visible(flow.page, 'Select appliance'); await flow.screenshot('02-fire-appliance');
  await pickAppliance(flow.page);
  await flow.page.getByRole('button', { name: 'Review & sign' }).click();
  await visible(flow.page, 'Choose the appliance fuel level.');
  await flow.page.getByRole('radio', { name: 'Fuel Full' }).click();
  await flow.page.getByRole('button', { name: 'Review & sign' }).click();
  await visible(flow.page, 'Answer Yes or No for all 11 appliance and equipment checks.');
  await yesToAll(flow.page);
  await flow.page.waitForFunction(() => Object.keys(localStorage).some(k => k.startsWith('fire-shift:v1:') && Object.values(JSON.parse(localStorage[k]).answers).filter(Boolean).length === 11));
  await flow.page.reload({ waitUntil: 'domcontentloaded' });
  await visible(flow.page, 'Your saved draft has been restored. Verify every answer before signing.');
  assert.equal(await flow.page.getByRole('radio', { name: /: Yes$/, checked: true }).count(), 11);
  await flow.screenshot('03-fire-equipment');
  await flow.page.getByRole('button', { name: 'Review & sign' }).click();
  await visible(flow.page, 'Confirm & sign on');
  await flow.page.getByRole('button', { name: 'Sign & file shift checks' }).click();
  await visible(flow.page, 'Confirm your declaration and add your signature.');
  assert.equal(flow.writes.filter(w => w?.table === 'vehicle_checklists').length, 0);
  await sign(flow.page); await flow.screenshot('04-fire-sign');
  await flow.page.getByRole('button', { name: 'Sign & file shift checks' }).click();
  await visible(flow.page, 'Your checks are complete.'); await flow.screenshot('05-fire-complete');
  assert.equal(flow.writes.filter(w => w === 'toggle_duty').length, 0);
  await flow.page.getByRole('button', { name: 'Go on duty & open dashboard' }).click();
  await flow.page.getByText('Your checks are complete.', { exact: true }).waitFor({ state: 'detached' });
  await visible(flow.page, 'On duty'); await visible(flow.page, 'FIRE-LAD-01');
  await visible(flow.page, 'Ready for the call.'); await flow.screenshot('06-fire-dashboard'); await noOverflow(flow.page);
  assert.equal(flow.writes.filter(w => w === 'toggle_duty').length, 1);
  assert.deepEqual(flow.errors, []);
  passed++; console.log('PASS Fire welcome → validation → readiness → appliance → all 11 checks → real signature → duty → dashboard');
  await flow.context.close();

  const unfit = await openApp();
  await visible(unfit.page, 'Ready to respond.');
  await unfit.page.getByRole('button', { name: 'Begin shift checks' }).click();
  await yesToAll(unfit.page);
  await unfit.page.getByRole('radio', { name: /: No$/ }).first().click();
  await unfit.page.getByRole('button', { name: 'Confirm readiness' }).click();
  await visible(unfit.page, 'Add a note about the readiness concern for your station officer.');
  assert.equal(unfit.writes.length, 0);
  await unfit.page.getByLabel('Readiness notes', { exact: true }).fill('Feeling fatigued. Requesting station officer review.');
  await unfit.page.getByRole('button', { name: 'Confirm readiness' }).click();
  await visible(unfit.page, 'Readiness needs attention');
  await unfit.page.reload({ waitUntil: 'domcontentloaded' });
  await visible(unfit.page, 'Readiness needs attention');
  assert.equal(unfit.writes.filter(w => w === 'assign_vehicle' || w === 'toggle_duty').length, 0);
  assert.deepEqual(unfit.errors, []);
  await unfit.screenshot('08-fire-readiness-review');
  await unfit.context.close(); passed++; console.log('PASS failed readiness requires notes and remains stood down after reload');

  const defect = await openApp({ readiness: true });
  await pickAppliance(defect.page);
  await defect.page.getByRole('radio', { name: 'Fuel Full' }).click();
  await yesToAll(defect.page);
  await defect.page.getByRole('radio', { name: 'SCBA serviceable: No' }).click();
  await defect.page.getByRole('button', { name: 'Review & sign' }).click();
  await visible(defect.page, 'Describe the failed checks before filing the inspection.');
  await defect.page.getByLabel('Inspection notes', { exact: true }).fill('SCBA cylinder seal damaged. Remove from service.');
  await defect.page.getByRole('button', { name: 'Review & sign' }).click();
  await visible(defect.page, 'Appliance will not be cleared');
  await sign(defect.page);
  await defect.page.getByRole('button', { name: 'Sign & report defects' }).click();
  await visible(defect.page, 'Appliance not cleared'); await defect.screenshot('09-fire-appliance-failed');
  assert.equal(defect.writes.filter(w => w === 'toggle_duty').length, 0);
  assert.equal(defect.writes.find(w => w?.table === 'vehicle_checklists').payload.scba_checked, false);
  await defect.page.getByRole('button', { name: 'Choose another appliance' }).click();
  await visible(defect.page, 'No appliances are available. Ask your station officer to release or register an appliance.');
  assert.ok(await defect.page.getByRole('button', { name: 'Confirm appliance', exact: true }).isDisabled());
  assert.deepEqual(defect.errors, []);
  await defect.context.close(); passed++; console.log('PASS signed defects block duty and remove the failed appliance from selection');

  const tablet = await openApp({ clearance: true, light: true, width: 1024 });
  await visible(tablet.page, 'Ready for the call.'); await visible(tablet.page, 'FIRE-LAD-01');
  await noOverflow(tablet.page); await tablet.screenshot('10-fire-tablet-light');
  assert.deepEqual(tablet.errors, []);
  await tablet.context.close(); passed++; console.log('PASS light-mode Fire dashboard fits a tablet viewport');

  const missing = await openApp({ missingMigration: true });
  await missing.page.getByText(/Fire shift checks are not available yet/).waitFor();
  assert.equal(await missing.page.getByRole('button', { name: 'Begin shift checks' }).count(), 0);
  await missing.context.close(); passed++; console.log('PASS missing migration explains setup and keeps the gate closed');

  const police = await openApp({ silo: 'MetroPolice', clearance: true });
  await visible(police.page, 'Real-Time\nIncident Map');
  assert.equal(await police.page.getByText('Ready for the call.', { exact: true }).count(), 0);
  await police.screenshot('07-police-unchanged');
  assert.deepEqual(police.errors, []);
  await police.context.close(); passed++; console.log('PASS Police retains its original dashboard');
  console.log(`${passed} browser scenarios passed. Previews: ${screenshots}`);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    console.error((await activePage.locator('body').innerText()).slice(0, 6000));
    await activePage.screenshot({ path: join(screenshots, 'test-failure.png') });
  }
  throw error;
} finally { await browser.close(); }
