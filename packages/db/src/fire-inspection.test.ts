import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRE_INSPECTION_GROUPS, FIRE_INSPECTION_ITEMS, NOTICE_DAYS, addDays, addMonths, failingItems, followUp, inspectionPayload,
  inspectionProblems, noticeDays, outcomeOf, premisesState, usualRisk, type InspectionAnswer, type InspectionDraft,
} from './fire-inspection.ts';

/**
 * A site inspection decides whether a business is told to fix something and
 * by when. The notice is served on the owner, so the checks, the sections and
 * the dates have to be right every time.
 */

const allYes = (): Record<string, InspectionAnswer> => Object.fromEntries(FIRE_INSPECTION_ITEMS.map((i) => [i.key, 'yes']));
const site: InspectionDraft = {
  name: 'Skyline Mall', address: '12 Smith Street, Durban', occupancy: 'Shopping centre', risk: 'High', kind: 'Routine',
  checklist: allYes(),
};

test('every check is unique, has a by-law section and a time to fix it', () => {
  const keys = FIRE_INSPECTION_ITEMS.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const i of FIRE_INSPECTION_ITEMS) {
    assert.match(i.section, /^s\.\d+/, i.key);
    assert.ok((NOTICE_DAYS as readonly number[]).includes(i.days), i.key);
    assert.ok(i.remedy.endsWith('.'), i.key);
  }
  assert.deepEqual(FIRE_INSPECTION_GROUPS.map((g) => g.title), ['Escape routes', 'Fire equipment', 'Emergency plan', 'Dangerous goods', 'Site and access']);
});

test('blocked escape routes are put right immediately; they are never N/A', () => {
  const escape = FIRE_INSPECTION_ITEMS.find((i) => i.key === 'escape_routes_clear');
  assert.equal(escape?.days, 0);
  assert.equal(escape?.na, false);
});

test('all good is compliant and next due after the risk months', () => {
  assert.deepEqual(inspectionProblems(site), []);
  assert.equal(outcomeOf(site), 'Compliant');
  assert.deepEqual(followUp(site, '2026-10-23'), { complyBy: null, reinspectOn: null, nextDue: '2027-04-23' });
  assert.equal(followUp({ ...site, risk: 'Low' }, '2026-10-23').nextDue, '2028-10-23');
});

test('a fault makes a compliance notice: the longest time given sets the date, the inspector comes back then', () => {
  const draft = { ...site, checklist: { ...allYes(), extinguishers: 'no', exit_signs: 'no' } as Record<string, InspectionAnswer> };
  assert.equal(outcomeOf(draft), 'Compliance notice');
  assert.deepEqual(failingItems(draft.checklist).map((i) => i.key), ['exit_signs', 'extinguishers']);
  assert.deepEqual(followUp(draft, '2026-10-23'), { complyBy: '2026-11-22', reinspectOn: '2026-11-22', nextDue: '2026-11-22' });
  // The inspector gives less time.
  assert.equal(followUp({ ...draft, days: { extinguishers: 7, exit_signs: 14 } }, '2026-10-23').complyBy, '2026-11-06');
  // A day that is not one of the choices falls back to the item's own.
  assert.deepEqual(noticeDays({ ...draft, days: { extinguishers: 5 } }).map((n) => n.days), [30, 30]);
});

test('immediately means the inspector comes back the next day', () => {
  const draft = { ...site, checklist: { ...allYes(), escape_routes_clear: 'no' } as Record<string, InspectionAnswer> };
  assert.deepEqual(followUp(draft, '2026-10-23'), { complyBy: '2026-10-23', reinspectOn: '2026-10-24', nextDue: '2026-10-24' });
});

test('a notice needs how it was served and, unless fixed to the door, who was in charge', () => {
  const draft: InspectionDraft = { ...site, checklist: { ...allYes(), housekeeping: 'no' } };
  assert.deepEqual(inspectionProblems(draft).flatMap((p) => p.keys).sort(), ['person_in_charge', 'served']);
  assert.deepEqual(inspectionProblems({ ...draft, served: 'Affixed to the premises' }), []);
  assert.deepEqual(inspectionProblems({ ...draft, served: 'Handed over', person_in_charge: 'T. Naidoo' }), []);
});

test('an instruction needs a reason and wins over the notice', () => {
  const draft: InspectionDraft = { ...site, instruction: 'Close the premises', served: 'Handed over', person_in_charge: 'T. Naidoo' };
  assert.equal(outcomeOf(draft), 'Instruction');
  assert.match(inspectionProblems(draft).map((p) => p.message).join(), /why the instruction/);
  assert.deepEqual(inspectionProblems({ ...draft, instruction_reason: 'Gas leak in the kitchen, people inside' }), []);
});

test('every check must be answered; N/A only where it may be', () => {
  const draft: InspectionDraft = { ...site, checklist: { ...allYes(), escape_routes_clear: 'na', sprinklers: undefined } };
  const p = inspectionProblems(draft);
  assert.match(p[0]?.message ?? '', /Answer every check \(2 left\)/);
  assert.deepEqual(p[0]?.keys.sort(), ['escape_routes_clear', 'sprinklers']);
});

test('a new site needs its name, address, use and risk; a site on the register does not', () => {
  assert.deepEqual(inspectionProblems({ kind: 'Routine', checklist: allYes() }).flatMap((p) => p.keys).sort(), ['address', 'name', 'occupancy', 'risk']);
  assert.deepEqual(inspectionProblems({ premises_id: 'p1', kind: 'Routine', checklist: allYes() }), []);
});

test('the payload carries only real answers and the notice the server checks', () => {
  const draft: InspectionDraft = {
    ...site, checklist: { ...allYes(), lpg: 'no', sprinklers: 'na', exit_signs: 'na' }, days: { lpg: 7 },
    served: 'Handed over', person_in_charge: 'T. Naidoo', lat: -29.85, lng: 31.02, accuracy: 7.6,
  };
  const p = inspectionPayload(draft);
  assert.equal((p.checklist as Record<string, string>).exit_signs, undefined, 'exit signs are never N/A');
  assert.equal((p.checklist as Record<string, string>).sprinklers, 'na');
  assert.deepEqual(p.notice, [{ key: 'lpg', days: 7 }]);
  assert.equal(p.accuracy, 8);
  assert.equal(p.name, 'Skyline Mall');
  assert.equal(inspectionPayload({ ...draft, premises_id: 'p1' }).name, undefined);
});

test('dates move by whole days and months, held to the month end', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonths('2027-08-31', 6), '2028-02-29');
});

test('the usual risk follows the kind of premises', () => {
  assert.equal(usualRisk('Hospital or clinic'), 'High');
  assert.equal(usualRisk('Factory or workshop'), 'Moderate');
  assert.equal(usualRisk('Shop or office'), 'Low');
});

test('a premises shows as overdue, due soon, with a notice open, or up to date', () => {
  assert.equal(premisesState({ next_due: null, last_outcome: null }, '2026-10-23'), 'Never inspected');
  assert.equal(premisesState({ next_due: '2026-10-01', last_outcome: 'Compliant' }, '2026-10-23'), 'Overdue');
  assert.equal(premisesState({ next_due: '2026-11-01', last_outcome: 'Compliance notice' }, '2026-10-23'), 'Notice open');
  assert.equal(premisesState({ next_due: '2026-11-01', last_outcome: 'Compliant' }, '2026-10-23'), 'Due soon');
  assert.equal(premisesState({ next_due: '2027-04-23', last_outcome: 'Compliant' }, '2026-10-23'), 'Up to date');
});
