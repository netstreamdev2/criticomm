import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipKind, takeAisMessage, type AisShip } from './ais-message.ts';

test('a ship is put together from its position and its static data, in either order', () => {
  const ships = new Map<string, AisShip>();
  takeAisMessage({ MessageType: 'PositionReport', MetaData: { MMSI: 601010710, ShipName: 'UHAMBO     ', latitude: -29.87, longitude: 31.012 },
    Message: { PositionReport: { Latitude: -29.8701, Longitude: 31.0121, TrueHeading: 511, Cog: 92.4, Sog: 6.1 } } }, ships, 1000);
  takeAisMessage({ MessageType: 'ShipStaticData', MetaData: { MMSI: 601010710, latitude: -29.87, longitude: 31.012 },
    Message: { ShipStaticData: { Name: 'UHAMBO@@@@', Destination: 'DURBAN', Type: 52 } } }, ships, 5000);
  const s = ships.get('601010710')!;
  assert.equal(s.name, 'UHAMBO');
  assert.equal(s.heading, 92.4, 'no true heading (511): the course');
  assert.equal(s.speed, 6.1);
  assert.equal(s.destination, 'DURBAN');
  assert.equal(s.type, 'Tug');
  assert.equal(s.lat, -29.8701);
  assert.equal(s.seen, 1000, 'static data does not make a ship look freshly seen');
});

test('a message with no ship or no place is skipped', () => {
  const ships = new Map<string, AisShip>();
  takeAisMessage({ MessageType: 'PositionReport', MetaData: {} }, ships);
  takeAisMessage({ MessageType: 'PositionReport', MetaData: { MMSI: 1 }, Message: { PositionReport: { Latitude: 91, Longitude: 0 } } }, ships);
  assert.equal(ships.size, 0);
});

test('ship types in words', () => {
  assert.equal(shipKind(74), 'Cargo');
  assert.equal(shipKind(84), 'Tanker');
  assert.equal(shipKind(30), 'Fishing');
  assert.equal(shipKind(0), null);
});
