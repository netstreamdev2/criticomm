# 07 — Engineering standards

What CI enforces, what it deliberately does not, and why. Read this before
changing `biome.json` or adding a check to the pipeline.

---

## The gate

`.github/workflows/ci.yml` runs on every push and pull request:

| Step | Command | Blocks merge |
|---|---|---|
| Lint | `pnpm lint` | yes |
| Typecheck | `pnpm typecheck` | yes |
| Test | `pnpm test` | yes |
| Build | `pnpm build` | yes |
| Migrations apply from empty | `node scripts/apply-migration.mjs` against a throwaway PostGIS | yes |

The migration job matters more than it looks. A migration is the one artefact
with no undo, and the sequence from nothing is exactly what a new environment
and a restore-from-backup both execute. A migration that only works against the
current production database is a migration that has not been tested.

---

## Linting

`pnpm lint` runs **`biome lint`**, not `biome check`.

`biome check` also enforces the formatter and import ordering. This codebase is
hand-formatted in a consistent style Biome does not produce — aligned `case`
arms, deliberate line grouping in long forms, comment blocks positioned against
the code they explain. Running the formatter over it produces a 150-file diff
that changes no behaviour, destroys that structure, and buries every real
finding for a year. `pnpm format` is still there for anyone who wants it on
their own files.

### Rules turned off, and why

Each of these was reviewed against actual violations, not turned off to make a
number go down.

| Rule | Sites | Why off |
|---|---|---|
| `style/noNonNullAssertion` | 95 | Used where a database constraint or an immediately preceding guard already establishes non-null. None is a latent crash; flagging all of them buries the findings that matter. |
| `suspicious/noArrayIndexKey` | 23 | Wrong for the lists here — rows are refetched wholesale rather than reordered, so an index is stable for the render. Where identity genuinely matters (incidents, alerts, queue rows) the code already keys by database id. |
| `correctness/useExhaustiveDependencies` | 15 | Flags the deliberate run-once-on-mount effects and the realtime subscriptions that must **not** re-subscribe per render. Following it mechanically would reintroduce socket churn on the dispatch board. |
| `style/useSingleVarDeclarator`, `style/useTemplate`, `style/noUnusedTemplateLiteral`, `style/useSelfClosingElements`, `complexity/noForEach`, `complexity/useOptionalChain` | ~15 | Pure style, and the house style is consistent. |
| `suspicious/noShadowRestrictedNames` | 2 | Both are lucide icons named `Map` and `Link`. Renaming an icon import to satisfy a linter is worse code. |
| `suspicious/noAssignInExpressions` | 1 | The idiomatic `while ((m = re.exec(s)))` regex loop. |
| `nursery/noImgElement` | 2 | Base64 signature images. There is no URL for `next/image` to optimise. |

### Rules downgraded to warnings

`a11y/noLabelWithoutControl` and `a11y/useSemanticElements` — 19 sites, mostly
labels on the Log-a-Call form that are not programmatically associated with
their inputs. These are **real defects**, not style: a screen reader announces
those fields with no name. They are warnings rather than errors so the gate is
green today, and they are tracked for repair. When they are fixed, promote both
back to `"error"` in `biome.json` so they stay fixed.

Nothing else is suppressed. If a new violation appears, fix it or argue for it
here — do not add a rule to the off list to get a build green.

---

## Testing

`node --test` with `--experimental-strip-types`. No test framework, no
transpile step, no config file. Node 22 runs the TypeScript directly.

Tests import with explicit `.ts` extensions (`./roles.ts`) because the strip-
types loader requires it. Metro and `tsc` both resolve that unchanged.

### What is worth a test here

Not coverage. This is an emergency-dispatch system, and the tests exist for the
places where a silent regression is not a bad user experience but a call that
does not reach a crew:

- **`packages/db/src/roles.test.ts`** — the route matrix is the authorization
  boundary. Middleware, sidebar, command palette and every quick link read from
  it. A regression means a responder opens a dispatch console, or a call-taker
  loses the incident they were told to work.
- **`packages/api/src/reporting/query.test.ts`** — the report builder composes
  SQL filters from user input. The tests pin that a filter naming an unknown
  column is dropped rather than passed through, and that sensitive datasets stay
  closed to ordinary roles.
- **`packages/api/src/automations/automations.test.ts`** — the thresholds behind
  automatic escalation. A `0` in the wrong box means "escalate the instant a
  call is logged", which turns every call into a Critical interrupt and teaches
  operators to ignore the alarm.
- **`apps/mobile/lib/outbox-policy.test.ts`** — the offline queue. Every rule in
  it is reachable only when the network is down, which is the least convenient
  place to discover it is wrong.

The pattern worth copying: when logic is safety-relevant but tangled up with a
runtime that cannot be tested (React Native, a Supabase client), split the pure
decisions into their own module and test that. `outbox-policy.ts` exists purely
because of this; `outbox.ts` re-exports it so no call site had to change.

---

## Database changes

- Migrations are append-only and numbered. Never edit an applied migration —
  write the next one.
- Apply with `node scripts/apply-migration.mjs supabase/migrations/00NN_*.sql`.
  Each file runs in a transaction, so a failure rolls the whole file back.
- Every mutating `SECURITY DEFINER` function starts with `require_role(...)`.
  The one deliberate exception is `raise_panic` — gating an emergency on a role
  matrix is how someone dies over a provisioning mistake, and the reasoning is
  written at the function.
- Prefer `SECURITY INVOKER` and let RLS do the scoping. `search_everything`
  reads across seven tables and every department; the only thing making that
  safe is that RLS runs for the calling user on each branch.
- PostgREST resolves RPCs by argument name. Adding a parameter with a default to
  an existing function creates a *second* overload, and a call matching both
  resolves to neither — drop the old arity in the same migration.

---

## Conventions

- Server-action `<form>`s with uncontrolled fields (`apps/web/components/fields.tsx`).
- `SimpleTable` for lists.
- Query functions live in `packages/api/src/<module>/index.ts`; pages import
  from `@criticom/api` and never build queries inline.
- `logAudit` on every mutation.
- Comments explain **why**, not what. A comment restating the code is noise; a
  comment recording the constraint that produced the code is the most valuable
  thing in the file.
