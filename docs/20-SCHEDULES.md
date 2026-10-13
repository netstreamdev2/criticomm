# Schedules: shifts, leave, swaps and lateness

One roster for every department: Police, Control Room, EMS, Fire and
Disaster Management. Each roster line is one person on one shift, with a
start and an end. The post, vehicle and call sign belong to that line. The
database enforces every rule below (`0072_schedules.sql`), so the console,
the phone and any later screen all follow the same rules.

## Who sets what

| Who | What they can do |
|---|---|
| **SystemAdmin, SystemController** (organisation HR) | Everything below, in every department. Public holidays. Deciding leave for each other. |
| **Department admin** (Admin of Police, EMS, Fire, Disaster) | Their department's shift types, rotations and late and no-show minutes, plus everything a supervisor can do. |
| **Captain, Fire Chief** | Their department's roster and people. |
| **Supervisor** | Their department's roster and people. |
| **Everyone else** | Their own schedule: confirm shifts, start shifts, ask for leave, offer swaps. |

Some decisions are about a particular person: their leave, excusing their
lateness, or changing a shift that has already started. These need someone
senior to that person, in the same department, and nobody can make them
about themselves. Organisation HR can decide for one another.

## Who sees what

| | Sees |
|---|---|
| **The member** | Their own issued shifts, attendance and leave. Their department's issued roster: who is on, who is off. |
| **People who roster the department** | All of the above for the department, plus drafts, attendance, leave requests and punctuality. |
| **Colleagues** | Never the reason someone is off. A colleague on approved leave shows only as "On leave": no leave type, no sick note, no lateness. |

A draft roster stays hidden until it is published.

## Starting rotations

Every department gets these as a starting point. The department admin can
change them in Shift setup.

| Department | Rotation | Shifts |
|---|---|---|
| Police, Control Room | 224: 2 days, 2 nights, 4 off. Teams A to D. | Day 06:00–18:00, Night 18:00–06:00 |
| EMS | 224, teams A to D | Day 07:00–19:00, Night 19:00–07:00 |
| Fire | 24-48: 24 hours on, 48 off. Teams Red, Blue, Green. | 08:00 to 08:00 |
| Disaster Management | Monday to Friday, public holidays off | Office 08:00–16:30, plus Standby 16:30–08:00 |

Late after **10 minutes**, not started after **60 minutes**. Both can be
changed per department. South African public holidays for 2026 and 2027
are loaded (a Sunday holiday moves to the Monday).

## A shift, start to finish

1. **Build.** A supervisor builds the month from a rotation, or adds single
   shifts. The build skips anyone on leave, in court (an endorsement), or
   already on another shift at that time, and says why for each one. It
   also refuses a vehicle booked on two posts at once.
2. **Publish.** Each person gets one alert for everything new. Until then
   the shifts are drafts and only the people who roster can see them.
3. **Confirm.** The person taps Confirm on the phone or the console. If
   the shift is less than 12 hours away and still not confirmed, they get
   a reminder.
4. **Reminders on the phone.** At 19:00 the evening before, 1 hour before,
   and at the start, unless they have already started. The phone schedules
   these itself, so they fire with no signal, on a locked phone, and with
   the app closed.
5. **Start.**
   - Field crews: going on duty in the app checks them in.
   - Desk staff: the console shows a "Start shift" banner from 30 minutes
     before the start.
   - Someone already on duty when the shift begins is checked in
     automatically.
   - The check-in time is always the real time; it cannot be backdated.
6. **Late.** Not started after the grace minutes: "You are late for your
   shift" goes to the person, and "Late: name" goes to whoever oversees
   them. That is their manager (where one is set) and the senior people in
   their department who are on shift. If nobody senior is on shift, it goes
   to department command.
7. **Not started.** Not started after the no-show minutes: the person is
   told, and department command is told as well. Each alert goes once per
   shift.
8. **Outcome.** Someone senior records why: Present, Excused, Sick or
   Absent without leave. A reason is required. The person is told, and it
   is written to the audit log.
9. **Changes.** Every change to a published shift tells the person and is
   logged. Only someone senior can change a shift that has started, and it
   cannot be deleted, only cancelled with a reason.

When an account is deactivated, its future shifts are cancelled.

## Leave

- **Ask.** The person asks from the phone (it works offline) or from the
  console's Leave page.
  - The dates must be within the coming year.
  - The type must come from the list.
  - Leave cannot overlap leave already asked for.
- **Days it costs.** The rostered shifts it covers, plus working days
  (Monday to Friday, not public holidays) after the last rostered day.
- **Decide.** Someone senior to the person, in their department, decides.
  Nobody decides their own leave. A refusal needs a reason. Approving it
  turns their shifts in those dates to "On leave".
- **Cancel.** The person can cancel it until it starts. Someone senior can
  cancel it at any time, with a reason. The shifts come back.

## Swaps

1. A member offers one of their shifts for a colleague's, in the same
   department.
2. The colleague accepts or declines.
3. Someone senior to both approves or refuses (refusing needs a reason).
   The shifts then change hands.

A swap is refused if the shifts overlap, if one starts within the hour, or
if either person would be double-booked. A swap that hasn't been decided
by the time either shift begins expires.

## Alerts

| Alert | To | Locked phone |
|---|---|---|
| New shifts published, a shift changed or cancelled | The person | Pushed |
| Confirm your next shift (under 12 hours to go) | The person | Pushed |
| Evening before, 1 hour before, at the start | The person | Scheduled on the phone |
| You are late / You have not started | The person | Pushed |
| Late: name / Not started: name | Whoever oversees them; command for not started | Pushed |
| Outcome recorded | The person | Pushed |
| Leave decided | The person | Pushed |
| Leave asked for | Whoever can approve it | In the app |
| Swap offered, accepted, decided | The people in it | Pushed |
| Swap waiting for approval | Whoever can approve it | In the app |

Tapping a schedule alert on the phone opens Schedule.

## Where it lives

**Console**

| Page | Who | What |
|---|---|---|
| Roster | People who roster | The month planner: build from a rotation, add a shift, publish, record outcomes, approve swaps, court dates. HR picks the department. |
| Roster → Allocation | People who roster | One day by post: who is on which post and vehicle, and whether they have started. |
| Roster → Shift Setup | Department admins, HR | Shift types, rotations, teams, late and no-show minutes. HR also sets public holidays. |
| My Schedule | Everyone | Now and next, the month, who is on today, swaps. |
| Leave | Everyone | Ask for, cancel, and (for seniors) decide leave. |
| HR | Supervisors and up, HR | Leave to decide, and punctuality for the last 30 days. |
| Dashboards (Command, Police, EMS, Fire, Disaster) | People who roster | "Shift attendance now": who has started, who is late, who has not started. |

**Phone**

| Screen | What |
|---|---|
| Schedule tab | Next shift with a countdown and Confirm. The month calendar. Who is on today. My team today (for supervisors). Swaps, leave, court dates. |
| Profile → My shifts | The next shift, and this month's late and not-started count. |

## Setting it up

1. In the Supabase SQL editor run `0071_duty_tracks.sql`, then
   `0072_schedules.sql`. 0072 needs 0068 (desk departments). It is safe to
   run twice.
2. **pg_cron** must be on (Database → Extensions). Late and not-started are
   checked every minute. Without it, 0072 says so and nothing is checked.
3. **pg_net** must be on, so alerts reach a locked phone. 0072 turns it on
   when it can. Without it, alerts still arrive while the app is open.
4. Each department admin opens **Roster → Shift Setup**, checks the shift
   times, rotation and late minutes, and puts each person in a team.
5. HR checks the public holidays.
6. Phones need the 1.2.0 APK (`docs/16-FIELD-TEST-APK.md`).

## Test script

1. As a department admin, open Shift Setup. Put two officers in teams A and
   B.
2. As their supervisor, build next week from the 224 rotation. Check that
   the officers cannot see the drafts. Publish. Each officer gets one alert.
3. On an officer's phone, open Schedule: the month shows the shifts. Tap
   Confirm on the next one.
4. Give one officer a shift that starts in 70 minutes. Open Schedule on
   their phone once with signal, then lock it in aeroplane mode. The "1
   hour before" reminder fires 10 minutes later, and "at the start" at the
   start. Turn signal back on.
5. Do not start that shift. Ten minutes after the start, the officer gets
   "You are late" and the supervisor gets "Late: name". At 60 minutes,
   "Not started" goes to command as well.
6. As the supervisor, record Excused with a reason. The officer is told.
   The HR page's Punctuality table counts it.
7. As an officer, ask for two days' leave covering a shift. Try to approve
   it as that officer: refused. Approve it as their supervisor: the shift
   shows "On leave". Colleagues see "On leave" and nothing else. Cancel the
   leave: the shift comes back.
8. Officer A offers a shift for officer B's. B accepts. The supervisor
   approves. The shifts change hands and both are told.
9. Give a desk dispatcher a shift starting in 20 minutes. Their console
   shows Start shift. Press it: their supervisor's "Shift attendance now"
   shows them started.

## How it is built

| Piece | Where |
|---|---|
| Rules, roles, alerts, the every-minute check | `supabase/migrations/0072_schedules.sql` |
| Who may do what (console and phone menus) | `scheduleRank`, `canManageRoster`, `canAdminSchedule`, `outranksForSchedule` in `packages/db/src/roles.ts` |
| Reading and writing schedules | `packages/api/src/schedule/` (pure date and shift rules in `rules.ts`) |
| Day by post | `packages/api/src/duty/index.ts` (`assign_post`, `clear_post`, `copy_roster_day`) |
| Console pages | `apps/web/app/(app)/roster/` (planner, allocation, setup, mine), `leave/`, `hr/` |
| Console pieces | `apps/web/components/schedule/` (Start shift banner, On shift now, Punctuality, leave buttons) |
| Phone reminders | `apps/mobile/lib/shift-reminders-policy.ts` (which and when), `lib/shift-reminders.tsx` (scheduling) |
| Phone screens | `apps/mobile/app/(tabs)/schedule.tsx`, `components/my-shifts-card.tsx` |
| Offline leave and swaps | `leave_cancel`, `swap_request`, `swap_respond`, `swap_withdraw` in `apps/mobile/lib/outbox-policy.ts`, sent by `lib/sync.tsx` |

## Verified

- `scripts/test-schedules.mjs` runs the real 0072 twice on Postgres
  (PGlite), 18 scenarios:
  - who may set up and who may roster, and who sees drafts
  - the 224 days and times, and a rebuild adding nothing
  - the build skipping leave, court and double-booking
  - a vehicle on two posts
  - one alert per person on publish, and members may only confirm
  - change alerts, and started shifts locked
  - check-in at the real time
  - late and not-started alerted once each
  - someone already working, and outcomes
  - leave checks and days, deciding, approving, cancelling
  - swaps
  - deactivation, and punctuality
  - the control room, and another organisation seeing nothing
  - no push when pg_net is absent
- The other database suites still pass against the new migration.
- Unit tests pass: 123 and 84 in the packages (roles, shift and date
  rules), 87 on the phone (reminders, offline leave and swaps), 80 in the
  console.
- Type checks pass for the phone, the console and the packages.
- Lint shows no new warnings.

Not yet verified:
- On the hosted Supabase database.
- With pg_net sending real pushes.
- On a phone: the locked-phone reminders and the whole test script above.
  This needs the 1.2.0 APK.
