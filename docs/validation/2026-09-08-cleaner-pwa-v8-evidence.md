# Cleaner PWA v8 — evidence and handoff (2026-09-08)

Plan: `direct-booking-waves-0-1-sol/docs/plans/2026-09-08-cleaner-pwa-v8-plan.md`
Repo: `Cascade\cleaners-auth-sol\`, branch `codex/named-cleaner-auth`
Reviewer: Opus, against plan section 3, after every commit below.
**Nothing in this branch has been pushed or deployed.**

## Commits (branch start `2e268c3` → `ff16feb`)

| Commit | What |
|---|---|
| `8f2cfaf` | WP1 — identity from the staff session, no typed name |
| `f46a731` | WP1 fixup — backfill `display_name` on pre-WP1 sessions |
| `fa18605` | WP1b — local PIN lock screen for cold opens |
| `3902ade` | WP1b fixup — PIN survives sign-out; a rapid-tap race |
| `0a15509` | WP2 — photo pipeline v2 (off-thread resize, IndexedDB, upload queue) |
| `d0f1b22` | WP2 fixup — stale photo-index closures, IndexedDB write failures |
| `4c9ed72` | WP2 fixup round 2 — pre-submit flush / draft-restore missed `_blob` fallback |
| `470ecef` | WP4 — self-hosted Cormorant subset, system body font, global reduced-motion |
| `11afffa` | WP4 fixup — precache fonts cache-first, not network-first |
| `61a8245` | WP5 — Phase 1 sticky jump summary; header stepper demoted |
| `dbd932c` | WP5 fixup — scroll-margin was 65-95px short; stepper/chips lost a11y names |
| `f0a5629` | **Design override** (Lloyd, not a plan WP) — sign-in is name (dropdown) + PIN, no separate password |
| `ff16feb` | Design pass — frosted glass, earthen-gold theme on the sign-in/PIN gates |

WP3 (`upload-photo` v27, raw-body support) landed in the **other** repo,
`direct-booking-waves-0-1-sol` — see that repo's own two commits
(`8d1f0d9`, `73039de`). Not deployed; v26 stays live.

## Test suite

40/40 passing (`npm test` in `cleaners-auth-sol`), up from the pre-existing
5. Every WP and every fixup added its own tests alongside the code —
see `tests/*.test.mjs`. Separately, `direct-booking-waves-0-1-sol`'s
`upload-photo` change carries 10/10 Deno tests and a clean `deno check`.

## Before / after

| | Before (`2e268c3`) | After (`ff16feb`) |
|---|---|---|
| `index.html` | 361,195 bytes | 396,129 bytes (+34,934, +9.7% — one-time cost, service-worker-cached after first load) |
| Fonts | Google-hosted, 2 families / 6 weights, cross-origin | Self-hosted, 1 family / 2 weights (the only two used), same-origin, cache-first — 45,736 bytes total (`fonts/*.woff2`) |
| Sign-in | Typed name + typed password | Name (dropdown) + 4-digit PIN keypad — **pending an admin-side password change to activate** |
| Cold-open unlock | None (password every time) | Local PIN keypad, no network call |
| Photo capture | Main-thread decode, base64 in memory, unbounded parallel uploads | Worker-thread decode/resize/blur, IndexedDB blob storage, concurrency-2 upload queue, per-thumbnail status |
| Phase 1 (Document) | 5-dot numbered stepper; no way to see all section states without scrolling | Thin segmented stepper; sticky 3-chip jump summary |

No Lighthouse run in this environment (not available as a tool here) — the
first-contentful-paint and CLS targets in the plan's WP4 row are not
independently measured; the font/script changes that would improve them
are done and covered by the tests above (no Google Fonts network
dependency, `font-display: swap`, fonts cache-first).

## Screenshots

`docs/validation/screenshots/`, captured at the plan's two required sizes:

- `sign-in-gate-360x640.png` / `sign-in-gate-412x915.png` — the new
  name+PIN gate (frosted glass / earthen-gold design pass).
- `phase1-document-360x640.png` / `phase1-document-412x915.png` — Phase 1
  with the sticky jump summary, all three section counts visible without
  scrolling.

## Manual verification performed this session (no Lighthouse; live browser checks)

- **WP1/WP1b/design override, end to end against the real Supabase Auth
  endpoint** (`qkgfhsdppslwunarczeq.supabase.co`): selecting "Honey" +
  a 4-digit PIN posts `grant_type=password` with
  `email=honey@staff.cascade.invalid` (correct slug) and the PIN as the
  password; a wrong PIN shows "Invalid login credentials" with the name
  retained and dots reset; "Other" reveals a manual name field; a seeded
  existing session + local PIN record shows the bare PIN-lock screen (no
  dropdown) on reload, and the correct PIN unlocks into the app with the
  identity chip reading "Honey". 5 wrong local PINs clear the PIN record
  and fall back to the name+PIN gate without touching the underlying
  session.
- **WP2 photo pipeline**, end to end with a synthetic file input (real
  camera input can't be scripted): capture → worker resize/blur →
  IndexedDB → thumbnail (object URL, not a data URL) → queued upload →
  failure badge (401, expected against a fake token) → retry-all link
  appears only on failure → individual retry → tap-to-remove cleans up
  the IndexedDB entry and object URL. Regression-tested the exact bug
  class Opus review found: captured two photos, removed the first
  (mid-array), confirmed the survivor's content was untouched and its
  retry didn't duplicate or misidentify anything.
- **WP4 fonts**: both `@font-face` entries report `document.fonts` status
  `"loaded"`; computed `font-family` on a heading resolves to Cormorant
  Garamond/Georgia/serif at weight 700; body resolves to the system
  stack; the two woff2 requests are same-origin 200s with zero requests
  to `fonts.googleapis.com`/`fonts.gstatic.com` in the network log.
- **WP5 sticky summary**: chips read "0/5 · 0/2 · —" without scrolling on
  entering Phase 1; the bar stays pinned while the page scrolls past it
  with no overlap with the Quick/Detail toggle; tapping a chip
  smooth-scrolls to its section with the fixed scroll-margin (measured,
  not guessed, after the first attempt was 65-95px short); tapping
  "All Clear" updates the sticky chip to "✓" live.

## Open items for Lloyd

1. **Blocking for the new sign-in to work**: each staff member's actual
   Supabase Auth password needs to be changed to their chosen PIN via the
   admin dashboard's Staff logins tab. Attempted once this session —
   blocked by Supabase's project-wide minimum password length (8 chars;
   a 4-digit PIN doesn't meet it). Lloyd is lowering that policy himself
   (a project-level Auth setting, not something this session touched).
   Until the password is actually changed, existing strong passwords
   still work against this same form — nothing is broken in the
   meantime, cleaners just can't use a PIN yet.
2. **WP3 deploy approval**: `upload-photo` v27 (raw-body support) is
   committed in `direct-booking-waves-0-1-sol` but not deployed; v26
   stays live until Lloyd approves shipping it. The client (WP2) still
   uses the JSON/dataURL transport either way — switching the client to
   send raw bytes once v27 is live is separate follow-up work, not done
   in this pass.
3. **Marifel / Lloyd staff accounts**: the sign-in dropdown hardcodes
   Honey, Marifel, Lloyd, and "Other." Only Honey is confirmed as a
   working `staff-users` login from the prior session's handoff — verify
   Marifel and Lloyd have (or will have) real accounts before relying on
   those two dropdown entries.
4. Out of scope this pass, by design (see WP4 commit message for the
   full reasoning): CSS coverage-based dead-code removal (checked with a
   static cross-reference pass — zero unused classes found, so there was
   nothing low-risk left to remove) and font-metric-override tuning for
   zero layout shift (no single correct value exists across platforms —
   the fallback differs between Georgia-equipped and Georgia-less
   devices).
