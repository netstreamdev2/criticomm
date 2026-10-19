# 24 — Police reports, the police badge, and the call logger

## Run once

In the Supabase SQL editor, after 0080: `0081_logger_observes.sql`. It is safe
to run again.

## The police reports pages (V4 Reports → Management)

**Police Reports** in the menu opens `/police/report-centre`: a colour-coded tile
for each page and for each form, with live counts.

| Page | What it shows |
|---|---|
| Reports management | Totals (all, reviewed, awaiting review, console reports, this week, arrests), the last 7 days as stacked bars, a donut by form, a card per form with its reviewed share, recent activity, the busiest stations and officers |
| Recent activity | Reports as they are filed, newest first: time, case number, forms, officer and badge, station, place, the call, its dispatcher and severity, and where it stands. Filter by period and form |
| Records | Every report: search, filter by form, status, period and dates, 20 per page, export to CSV, open one |
| Specialised report | Tick the forms and choose dates, station, officer, status and arrest. Shows totals, graphs and the reports, with a PDF and a spreadsheet |

The seven DMPS forms and the case report each keep their colour from the phone:

| Form | Colour |
|---|---|
| 12A Arrest Report | red |
| CR1 Crash Report | orange |
| VI Vehicle Inspection | teal |
| 216E Use of Official Firearm | purple |
| SANRAL Incident Report | yellow |
| 211A Tow In | pink |
| DOG Dog Capture / Tackle | green |
| Case report only | blue |

A report's status comes from its call:

- **Reviewed:** the call was closed after review.
- **Awaiting review:** the call is not closed yet.
- **Console report:** filed from the console, not on a dispatched call.

**Who opens the pages:**

- police dispatch, the police captain and the police administrator (Metro Police only);
- the case manager (Metro Police or eThekwini);
- the system administrators and the system controller.

Fire, EMS and Disaster staff do not.

The pages read with the person's own sign-in, so the database decides which
reports are in them. All data is real. CSV and PDF exports go to the audit
trail as `PoliceReportsExported`. Each report also downloads on its own as a PDF
from its page (`/api/pdf/police-report/<id>`).

## The police badge

The real DMPS badge from V4 (`Metro_logo_front.png`) replaces the redrawn one.

- **Console:** beside HikTech in the menu for Metro Police staff, and at the top of
  the police reports pages.
- **Phone:** beside HikTech in the header and at the start of shift for police, on
  the police report screen beside the municipality's crest, and on the
  vehicle inspection.
- **PDFs:** beside the eThekwini crest on police report PDFs, the specialised
  report, and any case PDF for a call police worked on.

HikTech's mark is never replaced.

## The call logger only watches

The call logger logs calls, finishes the ones they sent early, and watches every
call as it unfolds. Case Management is gone from their menu and their pages. The
database (0081) now enforces this:

- They read no department's reports (police, fire, patient care, post-mortem).
  Before 0081 they could read them all.
- On a call they did not log, they add nothing: no update, no attachment, no
  file. On their own calls they can still attach what the caller sent.

Also in 0081, the case manager reads police reports, as they already read the
fire, patient care and post-mortem ones. Everyone else reads and writes as
before.

## Verification

```
node --experimental-strip-types --test packages/api/src/police/report-stats.test.ts packages/db/src/roles.test.ts
CASE_PGLITE_MODULE=… node scripts/test-logger-observes.mjs
```
