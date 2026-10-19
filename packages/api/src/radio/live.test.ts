import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batteryTone, freshness, joinRadios, radioCounts, realPttRadios, saPlatformTime, type RegisterEntry } from './live.ts';

const now = Date.parse('2026-10-16T10:00:00Z');

test('RealPTT’s lists as radios: dispatcher seats, no 0,0 pins, South African times', () => {
  const radios = realPttRadios(
    [
      { user_id: 1486356481, user_account: 'Nets1', user_name: 'Nets1', user_online: 0, battery: 1, client_type: 0, last_online_time: '2026-08-18 11:46:27' },
      { user_id: 1486356485, user_account: 'nets_dispatch', user_name: 'azrah', user_online: 1, battery: 0, client_type: 5, last_online_time: '-' },
      { user_id: 9, user_account: 'Nets4', user_online: '1', battery: '140', client_type: 0 },
    ],
    [
      { userAccount: 'Nets1', lat: '-29.79', lng: '30.84', time: '2026-08-18 20:37:02', speed: '12.5' },
      { userAccount: 'Nets4', lat: '0', lng: '0', time: '2026-10-16 11:59:00' },
    ],
  );
  const [nets1, dispatch, nets4] = radios;
  assert.equal(nets1!.online, false);
  assert.equal(nets1!.providerUserId, '1486356481');
  assert.equal(nets1!.fixAt, '2026-08-18T18:37:02.000Z', 'SAST is UTC+2');
  assert.equal(nets1!.speedKmh, 12.5);
  assert.equal(nets1!.lastOnlineAt, '2026-08-18T09:46:27.000Z');
  assert.equal(dispatch!.dispatcher, true);
  assert.equal(dispatch!.lastOnlineAt, null, '"-" is never');
  assert.equal(nets4!.online, true);
  assert.equal(nets4!.battery, 100, 'kept between 0 and 100');
  assert.equal(nets4!.lat, null, '0,0 is no position');
  assert.equal(nets4!.fixAt, null);
});

test('platform times', () => {
  assert.equal(saPlatformTime('2026-10-16 12:00'), '2026-10-16T10:00:00.000Z');
  assert.equal(saPlatformTime('yesterday'), null);
  assert.equal(saPlatformTime(null), null);
});

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

test('the register joined to the platforms: whose radio it is, and the ones not in the register', () => {
  const register: RegisterEntry[] = [
    { id: 'r1', provider: 'pocstar', kind: 'radio', account: 'FIRE ALPHA', label: null, silo: 'MetroFire', personnel_id: 'p1', apparatus_id: null, active: true, personName: 'Capt. Dube' },
    { id: 'r2', provider: 'realptt', kind: 'radio', account: 'nets1', label: 'Spare', silo: 'MetroPolice', personnel_id: null, apparatus_id: 'a1', active: true, unitNumber: 'MP-12' },
    { id: 'r3', provider: 'realptt', kind: 'radio', account: 'Old', label: null, silo: 'MetroPolice', personnel_id: null, apparatus_id: null, active: false },
  ];
  const live = realPttRadios(
    [{ user_account: 'Nets1', user_online: 1, battery: 15 }, { user_account: 'Nets2', user_online: 0 }, { user_account: 'Old', user_online: 1 }],
    [],
  );
  const views = joinRadios(register, live, now);
  assert.deepEqual(views.map((v) => v.title), ['MP-12', 'Old', 'Capt. Dube', 'Nets2']);
  const nets1 = views.find((v) => v.account === 'nets1')!;
  assert.equal(nets1.live?.battery, 15, 'matched whatever the case');
  assert.equal(views.find((v) => v.title === 'Capt. Dube')!.live, null, 'registered, not reported: still shown');
  assert.equal(views.find((v) => v.account === 'Old')!.register, null, 'a retired radio still reporting shows as not in the register');
  const c = radioCounts(views);
  assert.deepEqual(c, { total: 4, online: 2, lowBattery: 1, unregistered: 2, hardHats: 0 });
});
