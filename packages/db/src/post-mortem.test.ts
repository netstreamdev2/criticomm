import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_MORTEM_SECTIONS, durationHours, postMortemPayload, postMortemProblems, saInstant, saStamp, validatePostMortem,
} from './post-mortem.ts';

const good = {
  start_time: '2026-10-09 06:00', end_time: '2026-10-09 18:30', injuries: '3', fatalities: '0', displaced_people: '40',
  root_cause: 'Blocked storm drains after heavy rain', lessons_learned: 'Clear drains before the rainy season',
  reporting_officer: 'Azrah Disaster',
};

test('the sections follow the old After-Action Report', () => {
  assert.deepEqual(POST_MORTEM_SECTIONS.map((s) => s.title), ['Incident Overview', 'Impact Metrics', 'Operational Analysis']);
});

test('a complete report has no problems; the required answers are named', () => {
  assert.deepEqual(validatePostMortem(good), []);
  assert.deepEqual(postMortemProblems({}).flatMap((p) => p.keys).sort(), [
    'end_time', 'lessons_learned', 'reporting_officer', 'root_cause', 'start_time',
  ]);
});

test('times are checked: format, order and not in the future', () => {
  assert.match(validatePostMortem({ ...good, end_time: '9 Oct 18:30' }).join(), /date and time/);
  assert.match(validatePostMortem({ ...good, end_time: '2026-10-09 05:00' }).join(), /before Start Time/);
  assert.match(validatePostMortem({ ...good, end_time: '2099-01-01 00:00' }).join(), /future/);
  assert.match(validatePostMortem({ ...good, injuries: '-2' }).join(), /whole numbers/);
});

test('South African times read and write both ways, and the duration is in hours', () => {
  assert.equal(saInstant('2026-10-09 06:00')?.toISOString(), '2026-10-09T04:00:00.000Z');
  assert.equal(saStamp('2026-10-09T04:00:00Z'), '2026-10-09 06:00');
  assert.equal(durationHours(good.start_time, good.end_time), 12.5);
  assert.equal(durationHours(good.end_time, good.start_time), null);
});

test('the payload defaults counts to zero', () => {
  const p = postMortemPayload({ ...good, injuries: '', fatalities: '' });
  assert.equal(p.injuries, '0');
  assert.equal(p.fatalities, '0');
  assert.equal(p.displaced_people, '40');
});
