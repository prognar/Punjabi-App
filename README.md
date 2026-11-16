# punjabi-app (working name)

Punjabi (Gurmukhi) learning app for iOS / Android, rebuilt from the web prototype
[`prognar/Punjabi-Flash-Cards`](https://github.com/prognar/Punjabi-Flash-Cards). Plan: `ROADMAP.md` in that repo.

```
apps/mobile        Expo app (not started)
apps/studio        Content Studio web app (not started)
packages/core      engine, model builder, placement, speech matcher, tracing scorer — pure TS, unit-tested
packages/content   seed data converted from the prototype (JSON) + conversion script
supabase/          migrations, RLS policies, edge functions (not started)
```

## Commands

```
npm install
npm test          # all workspaces
npm run typecheck
PROTOTYPE_DIR=../Punjabi-Flash-Cards npm test                               # also runs corpus-wide parity vs the prototype code
npm run seed:convert -- ../Punjabi-Flash-Cards                              # regenerate packages/content/seed from the prototype
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
