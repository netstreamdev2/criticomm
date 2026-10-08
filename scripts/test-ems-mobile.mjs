/** Browser smoke of the EMS start of shift with intercepted Supabase requests (no real duty writes).
 * Start Expo web on 8081. Supply EMS_PLAYWRIGHT_MODULE if Playwright is installed outside this repo.
 * Phone (390 px) and tablet (820 px portrait, 1180 px landscape) widths are both exercised.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.EMS_PLAYWRIGHT_MODULE || 'playwright');
const screenshots = process.env.EMS_SCREENSHOT_DIR || join(tmpdir(), 'criticomm-ems-previews');
mkdirSync(screenshots, { recursive: true });
const env = readFileSync(new URL('../apps/mobile/.env.local', import.meta.url), 'utf8');
const host = new URL(env.match(/^EXPO_PUBLIC_SUPABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g, ''));
const storageKey = `sb-${host.hostname.split('.')[0]}-auth-token`;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const vehicleKeys = ['lights_functional', 'tires_condition_ok', 'equipment_stocked', 'comms_working', 'brakes_responsive'];
const stockKeys = ['oxygen_full', 'aed_battery_ok', 'suction_functional', 'bvm_masks_ok', 'jump_bag_stocked', 'iv_fluids_stocked', 'drug_box_sealed', 'gloves_ppe_stocked'];
const STOCK = ['Oxygen Cylinders (Full)', 'Defibrillator / AED (Battery OK)', 'Suction Unit (Functional)', 'BVM & Masks (Adult/Ped)',
  'Jump Bag (Fully Stocked)', 'IV Fluids & Giving Sets', 'Drug Box (Seals Intact)', 'Gloves & PPE'];
const baseURL = process.env.EMS_APP_URL || 'http://127.0.0.1:8081';
let passed = 0;
let activePage;

async function openApp({ silo = 'Medical', clearance = false, readiness = clearance, missingMigration = false, width = 390, height = 844, light = false } = {}) {
  const user = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'ems-test@example.invalid',
    app_metadata: { silo, role: silo === 'Medical' ? 'Paramedic' : 'Firefighter', tenant_id: '20000000-0000-4000-8000-000000000001' },
    user_metadata: { full_name: 'Pillay' }, created_at: new Date().toISOString() };
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: user.app_metadata })}.test-only`;
  const session = { access_token: token, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const unit = { id: '30000000-0000-4000-8000-000000000001', silo, unit_number: silo === 'Medical' ? 'M-401' : 'FIRE-LAD-01', name: silo === 'Medical' ? 'Ambulance 401' : 'Aerial Ladder 1', type: 'Ambulance', status: clearance ? 'In Use' : 'Available', license_plate: 'ND 401-001', station_number: 'Addington', mileage: 12000 };
  const person = { id: '40000000-0000-4000-8000-000000000001', tenant_id: user.app_metadata.tenant_id, user_id: user.id, silo, rank: 'Paramedic', first_name: 'Thandi', last_name: 'Pillay', station: 'Addington EMS Base', is_on_duty: clearance, assigned_apparatus_id: clearance ? unit.id : null, apparatus: clearance ? unit : null };
  let mental = readiness ? { id: 'readiness-1', timestamp: new Date().toISOString(), passed: true } : null;
  const allTrue = Object.fromEntries([...vehicleKeys, ...stockKeys].map((k) => [k, true]));
  let check = clearance ? { id: 'check-1', form_version: silo === 'Medical' ? 'ems-v1' : 'fire-v1', inspection_ref: 'EMS-TEST-0001', apparatus_id: unit.id, checked_at: new Date().toISOString(), fuel_level: 'Full', inspector_name: 'Paramedic Thandi Pillay', requires_cleaning: false, ...allTrue } : null;
  let cleared = clearance;
  const writes = [];
  const errors = [];
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
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
      if (table === 'shift_requires_firearm' || table === 'shift_requires_bodycam') return json(false);
      if (table === 'assign_vehicle') { person.assigned_apparatus_id = unit.id; person.apparatus = unit; unit.status = 'In Use'; writes.push(table); return json(unit); }
      if (table === 'toggle_duty') { assert.ok(cleared, 'cannot go on duty before clearance'); person.is_on_duty = true; writes.push(table); return json(person); }
      if (table.includes('count')) return json(0);
      return json([]);
    }
    if (table === 'personnel') {
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'content-range': `0-0/${person.is_on_duty ? 1 : 0}` } });
      return json(url.searchParams.get('user_id') ? person : []);
    }
    if (table === 'apparatus') return json(url.searchParams.has('id') ? unit : unit.status === 'Available' ? [unit] : []);
    if (table === 'mental_checks') {
      if (method === 'POST') {
        mental = { ...payload, id: 'readiness-1', timestamp: new Date().toISOString(), passed: ['memory_recall', 'judgment', 'situational_awareness', 'not_under_influence', 'anger_check', 'reflexes'].every((k) => payload[k] === true) };
        writes.push({ table, payload }); return json(mental);
      }
      return json(mental);
    }
    if (table === 'vehicle_checklists') {
      if (missingMigration) return json({ code: '42703', message: 'column oxygen_full does not exist' }, 400);
      if (method === 'POST') {
        check = { ...payload, inspection_ref: `EMS-TEST-${String(writes.length).padStart(4, '0')}`, checked_at: new Date().toISOString(), inspector_name: 'Paramedic Thandi Pillay' };
        const vehicleOk = vehicleKeys.every((k) => payload[k] === true);
        const stockOk = stockKeys.every((k) => payload[k] === true);
        cleared = vehicleOk && stockOk && payload.requires_cleaning === false;
        if (!vehicleOk || payload.requires_cleaning) { unit.status = 'Out of Service'; person.assigned_apparatus_id = null; person.apparatus = null; }
        writes.push({ table, payload }); return json(check);
      }
      return json(check);
    }
    if (table === 'profiles') return json({ id: user.id, silo, full_name: 'Thandi Pillay', role: user.app_metadata.role });
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
const filed = (app) => app.writes.filter((w) => w?.table === 'vehicle_checklists');
async function visible(page, text) { await page.getByText(text, { exact: true }).first().waitFor({ timeout: 60000 }); }
async function yesToAll(page) {
  const radios = page.getByRole('radio', { name: /: Yes$/ });
  assert.ok(await radios.count() > 0, 'Yes choices are accessible');
  for (let i = 0; i < await radios.count(); i++) await radios.nth(i).click();
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'screen must fit the viewport');
}
async function toAmbulance(page) {
  await visible(page, 'Ready to respond.');
  await page.getByRole('button', { name: 'Begin shift checks' }).click();
  await yesToAll(page);
  await page.getByRole('button', { name: 'Confirm readiness' }).click();
  await visible(page, 'Select ambulance');
}
async function toStock(page) {
  await page.getByRole('radio', { name: 'M-401 — Ambulance 401' }).click();
  await page.getByRole('button', { name: 'Confirm ambulance', exact: true }).click();
  await visible(page, 'Vehicle checks');
  await page.getByRole('radio', { name: 'Fuel Full' }).click();
  await yesToAll(page);
  await page.getByRole('button', { name: 'Next: stock check' }).click();
  await visible(page, 'Inventory check');
}
async function settled(page) {
  await page.getByText('Does the ambulance require cleaning?', { exact: true }).waitFor({ state: 'detached', timeout: 10000 });
}
async function tick(page, labels) { for (const label of labels) await page.getByRole('checkbox', { name: label, exact: true }).click(); }
const declaration = (page) => page.getByRole('checkbox', { name: /I checked this ambulance and its stock myself/ });

try {
  // ── Phone: the whole flow, with every validation on the way ──
  const flow = await openApp();
  await visible(flow.page, 'Ready to respond.'); await visible(flow.page, 'EMERGENCY MEDICAL SERVICES');
  await flow.screenshot('01-ems-welcome-phone'); await noOverflow(flow.page);
  await flow.page.getByRole('button', { name: 'Begin shift checks' }).click();
  await flow.page.getByRole('button', { name: 'Confirm readiness' }).click();
  await visible(flow.page, 'Answer all six readiness questions.');
  assert.equal(flow.writes.length, 0);
  await yesToAll(flow.page);
  await flow.page.getByRole('button', { name: 'Confirm readiness' }).click();
  await visible(flow.page, 'Select ambulance'); await flow.screenshot('02-ems-ambulance-phone');
  await flow.page.getByRole('radio', { name: 'M-401 — Ambulance 401' }).click();
  await flow.page.getByRole('button', { name: 'Confirm ambulance', exact: true }).click();
  await visible(flow.page, 'Vehicle checks');
  await flow.page.getByRole('button', { name: 'Next: stock check' }).click();
  await visible(flow.page, 'Choose the ambulance fuel level.');
  await flow.page.getByRole('radio', { name: 'Fuel Full' }).click();
  await flow.page.getByRole('button', { name: 'Next: stock check' }).click();
  await visible(flow.page, 'Answer Yes or No for all 5 vehicle checks.');
  await yesToAll(flow.page);
  await flow.page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('ems-shift:v1:') && Object.values(JSON.parse(localStorage[k]).answers).filter(Boolean).length === 5));
  await flow.page.reload({ waitUntil: 'domcontentloaded' });
  await visible(flow.page, 'Your saved draft has been restored. Verify every answer before filing.');
  assert.equal(await flow.page.getByRole('radio', { name: /: Yes$/, checked: true }).count(), 5);
  await flow.screenshot('03-ems-vehicle-phone');
  await flow.page.getByRole('button', { name: 'Next: stock check' }).click();
  await visible(flow.page, 'Inventory check');
  await flow.page.getByRole('button', { name: 'Confirm stock & finish' }).click();
  await visible(flow.page, 'Say what failed or what stock is missing before filing.');
  await tick(flow.page, STOCK);
  await flow.page.getByRole('button', { name: 'Confirm stock & finish' }).click();
  await visible(flow.page, 'Confirm that you checked the ambulance and its stock yourself.');
  await declaration(flow.page).click();
  await flow.screenshot('04-ems-stock-phone'); await noOverflow(flow.page);
  assert.equal(filed(flow).length, 0, 'nothing filed before the sanitisation question');
  await flow.page.getByRole('button', { name: 'Confirm stock & finish' }).click();
  await visible(flow.page, 'Does the ambulance require cleaning?');
  await flow.page.waitForTimeout(600); // let the fade-in finish
  await flow.page.screenshot({ path: join(screenshots, '05-ems-sanitisation-phone.png') });
  await flow.page.getByRole('button', { name: 'No — ready for duty' }).click();
  await visible(flow.page, 'Your checks are complete.'); await flow.screenshot('06-ems-complete-phone');
  const sent = filed(flow)[0].payload;
  assert.equal(sent.requires_cleaning, false); assert.equal(sent.form_version, 'ems-v1'); assert.match(sent.id, /^[0-9a-f-]{36}$/);
  assert.ok(stockKeys.every((k) => sent[k] === true) && vehicleKeys.every((k) => sent[k] === true));
  assert.equal(flow.writes.filter((w) => w === 'toggle_duty').length, 0);
  await flow.page.getByRole('button', { name: 'Go on duty & open dashboard' }).click();
  await flow.page.getByText('Your checks are complete.', { exact: true }).waitFor({ state: 'detached' });
  await visible(flow.page, 'On duty'); await visible(flow.page, 'M-401'); await visible(flow.page, 'EMERGENCY MEDICAL SERVICES');
  await visible(flow.page, 'YOUR AMBULANCE');
  await flow.screenshot('07-ems-dashboard-phone'); await noOverflow(flow.page);
  assert.equal(flow.writes.filter((w) => w === 'toggle_duty').length, 1);
  assert.deepEqual(flow.errors, []);
  passed++; console.log('PASS phone: welcome → readiness → ambulance → vehicle (draft restored) → stock → sanitisation → duty → EMS dashboard');
  await flow.context.close();

  // ── Stock short: filed, stays with the ambulance, restock and file again ──
  const short = await openApp({ readiness: true });
  await visible(short.page, 'Select ambulance');
  await toStock(short.page);
  await tick(short.page, STOCK.filter((l) => l !== 'Drug Box (Seals Intact)'));
  await visible(short.page, 'You will not be cleared until this is restocked');
  await short.page.getByLabel('Notes', { exact: true }).fill('Drug box seal broken; replacing from base pharmacy.');
  await declaration(short.page).click();
  await short.page.getByRole('button', { name: 'Confirm stock & finish' }).click();
  await short.page.getByRole('button', { name: 'No — ready for duty' }).click();
  await visible(short.page, 'Restock before duty'); await settled(short.page); await short.screenshot('08-ems-stock-short');
  assert.equal(filed(short)[0].payload.drug_box_sealed, false);
  await short.page.reload({ waitUntil: 'domcontentloaded' });
  await short.page.getByText(/found stock short: Drug Box \(Seals Intact\)/).first().waitFor({ timeout: 60000 });
  await tick(short.page, ['Drug Box (Seals Intact)']);
  await declaration(short.page).click();
  await short.page.getByRole('button', { name: 'Confirm stock & finish' }).click();
  await short.page.getByRole('button', { name: 'No — ready for duty' }).click();
  await visible(short.page, 'Your checks are complete.');
  assert.equal(filed(short).length, 2);
  assert.notEqual(filed(short)[0].payload.id, filed(short)[1].payload.id, 'a re-check is a new record');
  assert.deepEqual(short.errors, []);
  await short.context.close(); passed++; console.log('PASS stock short is filed, survives a reload with the gaps listed, and a restocked re-check clears');

  // ── Requires cleaning: off the road, choose another ──
  const dirty = await openApp({ readiness: true });
  await visible(dirty.page, 'Select ambulance');
  await toStock(dirty.page);
  await tick(dirty.page, STOCK);
  await declaration(dirty.page).click();
  await dirty.page.getByRole('button', { name: 'Confirm stock & finish' }).click();
  await dirty.page.getByRole('button', { name: 'Yes, mark off road for cleaning' }).click();
  await visible(dirty.page, 'Ambulance off the road'); await settled(dirty.page); await dirty.screenshot('09-ems-off-road-cleaning');
  assert.equal(filed(dirty)[0].payload.requires_cleaning, true);
  await dirty.page.getByRole('button', { name: 'Choose another ambulance' }).click();
  await visible(dirty.page, 'No ambulances are available. Ask your shift supervisor to release or register one.');
  assert.equal(dirty.writes.filter((w) => w === 'toggle_duty').length, 0);
  assert.deepEqual(dirty.errors, []);
  await dirty.context.close(); passed++; console.log('PASS "requires cleaning" takes the ambulance off the road and keeps the paramedic off duty');

  // ── Tablets: portrait and landscape, dark and light ──
  for (const [label, width, height, light] of [['portrait', 820, 1180, false], ['landscape', 1180, 820, true]]) {
    const tab = await openApp({ readiness: true, width, height, light });
    await visible(tab.page, 'Select ambulance'); await noOverflow(tab.page); await tab.screenshot(`10-ems-ambulance-tablet-${label}`);
    await toStock(tab.page);
    await tick(tab.page, STOCK.slice(0, 5));
    await noOverflow(tab.page); await tab.screenshot(`11-ems-stock-tablet-${label}`);
    // The two stock columns sit side by side on a tablet.
    const eq = await tab.page.getByRole('checkbox', { name: STOCK[0], exact: true }).boundingBox();
    const co = await tab.page.getByRole('checkbox', { name: STOCK[4], exact: true }).boundingBox();
    assert.ok(Math.abs(eq.y - co.y) < 4 && co.x > eq.x + eq.width, `Equipment and Consumables side by side (${label})`);
    assert.deepEqual(tab.errors, []);
    await tab.context.close(); passed++; console.log(`PASS tablet ${label}: no overflow, stock in two columns`);
  }
  const readinessTab = await openApp({ width: 820, height: 1180 });
  await visible(readinessTab.page, 'Ready to respond.');
  await readinessTab.page.getByRole('button', { name: 'Begin shift checks' }).click();
  await visible(readinessTab.page, 'Readiness assessment'); await noOverflow(readinessTab.page);
  await readinessTab.screenshot('12-ems-readiness-tablet');
  await readinessTab.context.close();
  const homeTab = await openApp({ clearance: true, width: 1180, height: 820 });
  await visible(homeTab.page, 'EMERGENCY MEDICAL SERVICES'); await visible(homeTab.page, 'M-401');
  await noOverflow(homeTab.page); await homeTab.screenshot('13-ems-dashboard-tablet');
  assert.deepEqual(homeTab.errors, []);
  await homeTab.context.close(); passed++; console.log('PASS tablet readiness and EMS dashboard fit and render');

  // ── Phone: the home in light mode ──
  const homePhone = await openApp({ clearance: true, light: true });
  await visible(homePhone.page, 'YOUR AMBULANCE'); await noOverflow(homePhone.page); await homePhone.screenshot('14-ems-dashboard-phone-light');
  await homePhone.context.close(); passed++; console.log('PASS light-mode EMS dashboard on a phone');

  const noMigration = await openApp({ missingMigration: true });
  await noMigration.page.getByText(/EMS shift checks are not available yet/).waitFor();
  assert.equal(await noMigration.page.getByRole('button', { name: 'Begin shift checks' }).count(), 0);
  await noMigration.context.close(); passed++; console.log('PASS missing migration explains setup and keeps the gate closed');

  const fire = await openApp({ silo: 'MetroFire', clearance: true });
  await visible(fire.page, 'FIRE & RESCUE'); await visible(fire.page, 'YOUR APPLIANCE');
  assert.equal(await fire.page.getByText('EMERGENCY MEDICAL SERVICES', { exact: true }).count(), 0);
  await fire.screenshot('15-fire-dashboard-unchanged');
  assert.deepEqual(fire.errors, []);
  await fire.context.close(); passed++; console.log('PASS Fire dashboard unchanged after the shared home');
  console.log(`${passed} browser scenarios passed. Previews: ${screenshots}`);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    console.error((await activePage.locator('body').innerText()).slice(0, 6000));
    await activePage.screenshot({ path: join(screenshots, 'test-failure.png') });
  }
  throw error;
} finally { await browser.close(); }
