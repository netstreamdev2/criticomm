# Translations: where we stopped

Paused on 2026-10-19 on purpose: translate at the very end, once the wording
stops changing.

## State (word list: 6,015 sentences)

| Languages | Translated | Behind by |
|---|---|---|
| zu, xh, af, nso, tn | 2,321 | about 3,650 |
| st, ts, ss, ve, nr | 2,033 | about 3,940 |

The second group is one batch behind (the "Firearm … Hyundai" batch is done
for all ten; the next batch, "I am not drawing a firearm … KZN", is done only
for the first group).

## Resume

1. `node --experimental-strip-types scripts/i18n-extract.mjs` (word list up to date).
2. For each group, in its own work dir:
   `node --experimental-strip-types .claude/translations/plan.mjs <dir> . zu`
   (or `st` for the second group).
3. Write `<dir>/out/<lang>/NN.lines`: one line per sentence of `batches/NN.txt`,
   `=` keeps the English. Formal register; keep codes, makes and brand names
   in English (AARTO, KPI, HikTech, Toyota …); keep every `{placeholder}`.
4. `node --experimental-strip-types .claude/translations/build2.mjs <dir> .`
   merges into `packages/db/src/i18n/locales/*.ts` and `supabase/seed/translations-*.sql`
   (drops sentences the app no longer shows; rejects broken placeholders and
   over-long buttons).
5. `cd packages/db && npm test`, then run `supabase/seed/translations-all.sql` in Supabase.
