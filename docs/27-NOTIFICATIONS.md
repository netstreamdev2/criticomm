# 27 — Notifications: who each one is for, who may send one

Migration `0084_notification_audience.sql`. Run it after 0083.

## Whom a notification is for

Every notification (`public.alerts`) now names its audience, and only that
audience can read it. The database enforces this (row-level security), on the
console, on the phone and over realtime alike.

| Audience | Example | Who reads it |
|---|---|---|
| `person` | "Patricia" | that one person |
| `people` | "Patricia and Stephen" | the named few (1 to 50), each with their own read |
| `role` | "Metro Police admins" | holders of those roles in one department |
| `role`, every department | "every captain" | holders of those roles anywhere in the organisation |
| `department` | "Metro Police" | everyone in that department |
| `organisation` | "Everyone" | everyone in the organisation |

Each bubble shows which, as a coloured chip: blue "Just you", purple "Shared"
(people or a role), teal the department, orange "Everyone".

Two things changed for readers:

- The organisation-wide roles (dispatch, the control room, the viewer, the
  call logger, system roles) no longer read every department's broadcasts.
  They read what is sent to them, their role, their department or everyone.
  Dispatch's own work comes through the call queue, which is unchanged.
- A withdrawn notification disappears for everyone.

Notifications never leave their organisation (0030).

## Who may send

Nobody writes the table directly any more. People send through
`send_notification()`, and the database checks it:

| To | Who may send |
|---|---|
| one person in the organisation | anyone signed in |
| a few people, a role, a department: their own | Admin, Supervisor, Captain, FireChief, Dispatcher, ControlRoom, SystemController, SystemAdmin, SuperAdmin |
| another department | SuperAdmin, SystemAdmin, SystemController, and the central control room (ControlRoom or Dispatcher in eThekwini) |
| everyone, or a role in every department | SuperAdmin, SystemAdmin, SystemController |

A person's notification is never an emergency:

- no blocking pop-up and no Critical (Low, Medium or High only);
- links go only to pages inside HikTech;
- title up to 140 characters, message up to 1000.

Every send is audited (`NotificationSent`), and every take-back too
(`NotificationWithdrawn`).

The emergency and operational notifications (dispatch, SOS, assignments, case
review, schedules, account requests, Criti broadcasts) are still raised by the
database's own functions. Their wording, their reach and their pop-ups are
unchanged.

## Functions

| Function | Does |
|---|---|
| `send_notification(audience, title, body, link, severity, user, users, roles, silo, all_departments, kind)` | sends one (kinds: info, broadcast, mail, task) |
| `withdraw_notification(id)` | the sender, or SuperAdmin/SystemAdmin, takes it back |
| `my_sent_notifications()` | the last 50 you sent |
| `notification_reach()` | whom you may send to; the form uses it |
| `notification_activity(since)` | how many were raised, for System Status (administrators; an Admin sees their department only) |

`raise_dispatch_alerts` (the V4-era fan-out, unused since 0073) can no longer
be called.

## The console

- **Notifications page** (`/notifications`):
  - white frosted bubbles grouped by day;
  - tabs: All, Unread, Just me, Shared, My department, Everyone;
  - **Send a notification**, offering only what you may send;
  - **What I sent**, with Take back.
- **Pop-up:** a white frosted bubble drops in from the top, like a phone's
  heads-up. It says whom the notification was for and who sent it. It lifts
  away after a few seconds; you can swipe it up or close it, and hovering
  holds it.
- **Unchanged:** the SOS pop-up, the blocking dispatch alert and the new-call
  cards keep their look and place.
- Mail and duty tasks send through the same function, to the one person, as
  kinds `mail` and `task`.

## The phone

- **Inbox** (the bell): the same bubbles and tabs.
- **Heads-up:** drops in under the status bar. Swipe it up or let it go; tap
  it to open the call, the schedule or the inbox.
- **Unchanged:** the full-screen dispatch and SOS alert.
- It is JavaScript only, so it ships over the air. No new build is needed.

## Tests

`scripts/test-notification-audience.mjs` runs 11 scenarios on PGlite. It runs
Patricia and Stephen (Metro Police admins), an officer, Fire's admin, the
control-room dispatcher, a viewer, a system admin, another organisation and a
deactivated account through:

- each audience;
- who may send what;
- no emergencies and no links out;
- no direct writes;
- read receipts;
- the database's own notifications;
- taking one back;
- System Status.
