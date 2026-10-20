import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RADIO_ID_PATTERN, batteryTone, chooseSource, freshness, joinRadios, newRadioId, presenceRadios, radioCounts,
  type LiveRadio, type PresenceRow, type RegisterEntry,
} from './live.ts';

const now = Date.parse('2026-10-16T10:00:00Z');

test('how current a position is, and the battery colour', () => {
  assert.equal(freshness(new Date(now - 60_000).toISOString(), now), 'live');
  assert.equal(freshness(new Date(now - 10 * 60_000).toISOString(), now), 'recent');
  assert.equal(freshness(new Date(now - 3 * 3_600_000).toISOString(), now), 'old');
  assert.equal(freshness(null, now), 'none');
  assert.equal(batteryTone(10), '#ef4444');
  assert.equal(batteryTone(35), '#f59e0b');
  assert.equal(batteryTone(80), '#22c55e');
  assert.equal(batteryTone(null), '#64748b');
});

const platform = (account: string, online: boolean, battery: number | null = null): LiveRadio => ({
  provider: 'pocstar', account, providerUserId: null, name: null, online, battery, lat: null, lng: null,
  fixAt: null, speedKmh: null, lastOnlineAt: null, dispatcher: false,
});

test('the register joined to the platform: whose radio it is, and the ones not in the register', () => {
  const register: RegisterEntry[] = [
    { id: 'r1', provider: 'pocstar', kind: 'radio', account: 'FIRE ALPHA', label: null, silo: 'MetroFire', personnel_id: 'p1', apparatus_id: null, active: true, personName: 'Capt. Dube' },
    { id: 'r2', provider: 'pocstar', kind: 'radio', account: 'fire bravo', label: 'Spare', silo: 'MetroPolice', personnel_id: null, apparatus_id: 'a1', active: true, unitNumber: 'MP-12' },
    { id: 'r3', provider: 'pocstar', kind: 'radio', account: 'Old', label: null, silo: 'MetroPolice', personnel_id: null, apparatus_id: null, active: false },
  ];
  const live = [platform('FIRE BRAVO', true, 15), platform('FIRE CHARLIE', false), platform('Old', true)];
  const views = joinRadios(register, live, now);
  assert.deepEqual(views.map((v) => v.title), ['MP-12', 'Old', 'Capt. Dube', 'FIRE CHARLIE']);
  const bravo = views.find((v) => v.account === 'fire bravo')!;
  assert.equal(bravo.live?.battery, 15, 'matched whatever the case');
  assert.equal(views.find((v) => v.title === 'Capt. Dube')!.live, null, 'registered, not reported: still shown');
  assert.equal(views.find((v) => v.account === 'Old')!.register, null, 'a retired radio still reporting shows as not in the register');
  const c = radioCounts(views);
  assert.deepEqual(c, { total: 4, online: 2, lowBattery: 1, unregistered: 2, hardHats: 0, onBackup: 0, talking: 0 });
});

const ago = (ms: number) => new Date(now - ms).toISOString();
const presence = (p: Partial<PresenceRow> & { device_id: string }): PresenceRow => ({
  user_id: 'u1', personnel_id: 'p1', silo: 'MetroPolice', model: 'E977_MB', app_version: '1.3.0', battery: 64, charging: false,
  network: 'cellular', talk_channel: null, talking: false, signed_in: true, lat: null, lng: null, accuracy: null, fix_at: null,
  last_seen_at: ago(20_000), personName: 'Const. Khumalo', ...p,
});

test('the app’s reports as radios: online for two minutes after the last report, signed in', () => {
  const [live, quiet, out] = presenceRadios([
    presence({ device_id: 'HT-AAAA-0001', talking: true, talk_channel: 'dept:MetroPolice', lat: -29.85, lng: 31.02, fix_at: ago(5_000), accuracy: 6, battery: 140.2, network: 'satellite' }),
    presence({ device_id: 'HT-AAAA-0002', talking: true, talk_channel: 'all', last_seen_at: ago(3 * 60_000) }),
    presence({ device_id: 'HT-AAAA-0003', signed_in: false }),
  ], now);
  assert.equal(live!.provider, 'hiktech');
  assert.equal(live!.online, true);
  assert.equal(live!.talking, true);
  assert.equal(live!.talkChannel, 'dept:MetroPolice');
  assert.equal(live!.accuracyM, 6);
  assert.equal(live!.battery, 100, 'kept between 0 and 100');
  assert.equal(live!.network, null, 'an unknown network is no network');
  assert.equal(live!.name, 'Const. Khumalo');
  assert.equal(quiet!.online, false, 'silent for three minutes');
  assert.equal(quiet!.talking, false, 'an offline radio is not on the air');
  assert.equal(quiet!.talkChannel, null);
  assert.equal(out!.online, false, 'signed out');
});

test('PocStar first; the app stands in only when PocStar is not answering for the radio', () => {
  const poc = (online: boolean, at: string | null): LiveRadio => ({ ...platform('FIRE ALPHA', online, 50), lastOnlineAt: at });
  const [appOn] = presenceRadios([presence({ device_id: 'HT-AAAA-0001' })], now);
  const [appOff] = presenceRadios([presence({ device_id: 'HT-AAAA-0001', last_seen_at: ago(60 * 60_000) })], now);
  assert.deepEqual(chooseSource(poc(true, null), appOn!), { live: poc(true, null), fallback: false }, 'PocStar online: PocStar');
  assert.equal(chooseSource(poc(false, ago(10 * 60_000)), appOn!).fallback, true, 'PocStar offline, app online: the app');
  assert.equal(chooseSource(null, appOff!).fallback, true, 'PocStar silent about it: the app, even offline');
  assert.equal(chooseSource(poc(false, ago(5 * 60_000)), appOff!).fallback, false, 'both offline: whichever was heard from last');
  assert.equal(chooseSource(poc(false, ago(5 * 60_000)), null).fallback, false, 'no app: PocStar as it is');
});

test('joined: a PocStar radio backed by its person’s app, a radio running only the app, phones left out', () => {
  const register: RegisterEntry[] = [
    { id: 'r1', provider: 'pocstar', kind: 'radio', account: 'FIRE ALPHA', label: null, silo: 'MetroPolice', personnel_id: 'p1', apparatus_id: null, active: true, personName: 'Const. Khumalo' },
    { id: 'r2', provider: 'hiktech', kind: 'hard_hat', account: 'HT-HHHH-0001', label: 'Hat 12', silo: 'MetroPolice', personnel_id: 'p2', apparatus_id: null, active: true, personName: 'Sgt. Naidoo' },
  ];
  const app = presenceRadios([
    // Khumalo carries the E977 and a phone: the radio is the better backup.
    presence({ device_id: 'HT-PPPP-0001', model: 'SM-A146P', last_seen_at: ago(10_000) }),
    presence({ device_id: 'HT-RRRR-0001', model: 'E977_MB', battery: 71, talking: true, talk_channel: 'all' }),
    // Naidoo's hat runs the app, and is registered as the radio itself; Naidoo's phone is just a phone.
    presence({ device_id: 'HT-HHHH-0001', personnel_id: 'p2', user_id: 'u2', model: 'H1', personName: 'Sgt. Naidoo' }),
    presence({ device_id: 'HT-PPPP-0002', personnel_id: 'p2', user_id: 'u2', model: 'SM-A146P', personName: 'Sgt. Naidoo' }),
    // An E977 nobody has registered yet shows, to be added; an ordinary phone does not.
    presence({ device_id: 'HT-RRRR-0002', personnel_id: 'p3', user_id: 'u3', personName: 'Const. Zulu' }),
    presence({ device_id: 'HT-PPPP-0003', personnel_id: 'p4', user_id: 'u4', model: 'iPhone', personName: 'Capt. Dube' }),
  ], now);
  const views = joinRadios(register, app, now);
  assert.deepEqual(views.map((v) => v.account), ['FIRE ALPHA', 'HT-RRRR-0002', 'HT-HHHH-0001']);
  const khumalo = views[0]!;
  assert.equal(khumalo.fallback, true, 'PocStar has not reported it: the app stands in');
  assert.equal(khumalo.source, 'hiktech');
  assert.equal(khumalo.live?.account, 'HT-RRRR-0001', 'the radio, not the phone');
  assert.equal(khumalo.live?.battery, 71);
  const hat = views.find((v) => v.account === 'HT-HHHH-0001')!;
  assert.equal(hat.fallback, false, 'an app radio in its own right');
  assert.equal(hat.title, 'Sgt. Naidoo');
  assert.equal(views.find((v) => v.account === 'HT-RRRR-0002')!.register, null);
  const c = radioCounts(views);
  assert.equal(c.onBackup, 1);
  assert.equal(c.talking, 1);
  assert.equal(c.unregistered, 1);
});

test('a Radio ID: HT- and eight characters that cannot be misread', () => {
  const seq = [0, 0.99, 0.5, 0.25, 0.1, 0.3, 0.7, 0.9];
  let i = 0;
  const id = newRadioId(() => seq[i++ % seq.length]!);
  assert.match(id, RADIO_ID_PATTERN);
  for (let n = 0; n < 200; n++) assert.match(newRadioId(), RADIO_ID_PATTERN);
  assert.doesNotMatch('HT-OOOO-IIII', RADIO_ID_PATTERN);
});

test('a hard hat is field kit too, matched exactly by model', async () => {
  const { isHardHatModel, isRadioModel } = await import('./live.ts');
  assert.equal(isHardHatModel('H1'), true);
  assert.equal(isHardHatModel(' h1 '), true);
  assert.equal(isHardHatModel('PH1'), false, 'not part of another model');
  assert.equal(isRadioModel('H1'), true);
  assert.equal(isRadioModel('E977_MB'), true);
  assert.equal(isRadioModel('SM-A146P'), false, 'a phone is not a radio');
  const [hat] = presenceRadios([presence({ device_id: 'HT-HHHH-0009', model: 'H1', personnel_id: 'p9', user_id: 'u9', personName: 'Const. Zulu' })], now);
  const [view] = joinRadios([], [hat!], now);
  assert.equal(view!.kind, 'hard_hat', 'shows as a hard hat');
});
