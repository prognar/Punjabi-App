# punjabi-app (working name)

Punjabi (Gurmukhi) learning app for iOS / Android, rebuilt from the web prototype
[`prognar/Punjabi-Flash-Cards`](https://github.com/prognar/Punjabi-Flash-Cards). Plan: `ROADMAP.md` in that repo.

```
apps/mobile        Expo app (not started)
apps/studio        Content Studio web app (Vite + React): login, dashboard, cards, batch text review → https://prognar.github.io/Punjabi-App/
packages/core      engine, model builder, placement, speech matcher, tracing scorer — pure TS, unit-tested
packages/content   seed data converted from the prototype (JSON) + conversion script
supabase/          migrations (schema, workflow rules, RLS), seed.sql (generated), SQL tests
```

## Commands

```
npm install
npm test          # all workspaces
npm run typecheck
PROTOTYPE_DIR=../Punjabi-Flash-Cards npm test                               # also runs corpus-wide parity vs the prototype code
npm run seed:convert -- ../Punjabi-Flash-Cards                              # regenerate packages/content/seed from the prototype
npm run seed:sql                                                            # regenerate supabase/seed.sql from packages/content/seed
PGHOST=localhost PGUSER=postgres npm run db:test                            # migrations + seed + SQL tests on a throwaway local database
```

## packages/core

| Module | From | Notes |
|---|---|---|
| `model.ts` | `js/model.js` | `buildModel(content, sentences, custom)` — pure function. `slug()` produces the prototype ids (→ `legacy_id`). |
| `engine.ts` | `js/engine.js` | Spaced repetition, mastery, gate, weekly unlock, placement, session builder, XP. Storage removed (the app persists `Progress` itself). `setClock` / `setRandom` for tests. |
| `matcher.ts` | `js/speech.js` | Phonetic key + `scoreHeard`, Gurmukhi→Latin/Devanagari, sounds-like romanization. Recognition and TTS are platform code. |
| `trace.ts` | `js/trace.js` | Trace / freehand scorer with no canvas: ink is rasterized in code; the platform supplies the 128×128 letter mask (`maskFromRGBA`). |

Behaviour is identical to the prototype: the seeded 30-day learner simulations reproduce the same unlock days, and the
parity test compares the model and matcher against the original code for every card.

## supabase

| File | What |
|---|---|
| `migrations/…01_content.sql` | Studio tables: `items` (uuid id + `legacy_id`), reviews, comments, recordings, units / lessons, releases, audit log |
| `migrations/…02_learners.sql` | `accounts`, `learners` (max 6 per account), `item_progress`, `learner_days`, `events` |
| `migrations/…03_workflow.sql` | Lifecycle rules as triggers: per-field sign-off, religious sign-off for `gurbani` / `gurdwara` tags, edit-after-approval → back to review, takes approved by a second person, no deletes, `publish_release()` |
| `migrations/…04_rls.sql` | Row-level security by studio role; learner data visible only to its own account |
| `seed.sql` | Generated. The prototype's 2,358 items and 38 lessons, all `draft`. Ids are UUIDv5 of the legacy id, so re-running is safe. |
| `tests/` | `run-local.sh` applies everything to plain Postgres (with a small Supabase shim) and runs `workflow.test.sql` |

Live project: `txgsbggvkwyrecpwaxns` (https://txgsbggvkwyrecpwaxns.supabase.co) — migrations 1–6 and the seed are applied.
New migrations: add a file here, then `supabase link --project-ref txgsbggvkwyrecpwaxns && supabase db push`.
First owner (once, in the SQL editor): `insert into studio_users (id, roles, display_name) values ('<auth user id>', '{owner}', 'Drew');`
