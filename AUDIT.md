# Airlock v0 — audit (2026-11-09 ~13:45 CST)

Repo: `/workspace/work/hackathons/hybridai/` (local git, branch `master`). App in `app/`.

## Verified working (by running it here)

- `npm run build` — TypeScript strict type-check + Vite 8 production build pass (≈100 kB JS, 32 kB gzip).
- `npm test` — **20/20 pass** (vitest 5):
  - `pii.test.ts` (11): rules engine finds all identity details in the 3 fictional letters (names incl. bare surnames, addresses, account/case/member/claim numbers, DOB, phones, emails, Luhn-valid card); amounts, deadlines and organisation names survive; no false card on non-Luhn numbers; token round-trip; stable tokens; leak check; model-output hygiene (spans not in the letter are dropped); chunking.
  - `pipeline.test.ts` (6, Firebase layer mocked): Nano findings merged; device model never called when not ready; **only redacted text reaches `analyse()`**; result re-hydrated locally; rules-only fallback when every model fails; send blocked while a leak remains; personal details typed into follow-up questions are redacted.
  - `ui.smoke.test.ts` (1, jsdom, **real** Firebase SDK, no `.env`): full flow sample → airlock → release/withhold chip → analyse → result in LOCAL RULES mode; status pills show "not supported" / "not configured"; **zero network requests**.
  - `sdk.behavior.test.ts` (2): reproduces the SDK issue below, and proves Airlock's guard blocks it.
- `npm run dev` serves the app (checked with curl: page and modules load).

## Found during the build

- **firebase@13.2.0: `ONLY_ON_DEVICE` silently goes to the cloud when `window.LanguageModel` is absent** (`chromeAdapterFactory` returns undefined → `callCloudOrDevice` calls `inCloudCall()`). The docs say it should throw. Airlock guards every on-device-only call with its own `LanguageModel.availability()` check (`assertOnDevice()` in `src/ai.ts`). Worth reporting to firebase/firebase-js-sdk and mentioning in the Devpost write-up (shows depth on "technological implementation").
- App Check is now mandatory for AI Logic (since 2026-11-02): cloud calls will fail until a debug token (dev) or reCAPTCHA key (deploy) is registered.
- Gemini 2.5 is deprecated; app uses the SDK's hybrid default `gemini-3.5-flash-lite` (override with `VITE_CLOUD_MODEL`).

## Not verified yet (could not be tested in this sandbox)

- **Real Gemini Nano.** The sandbox is linux-arm64 with no Chrome; Playwright's Chrome download is 403 for arm64, and Nano needs desktop Chrome with ≥22 GB disk and a GPU >4 GB VRAM or 16 GB RAM. Untested: `initializeDeviceModel` download flow, Nano entity-JSON quality via `responseConstraint`, photo transcription (multimodal flag), Nano analysis offline, Nano follow-ups, speed.
- **Real cloud call.** No Firebase project yet. Untested: Gemini Developer API response against `analysisSchema`, App Check debug-token flow, `inferenceSource` values from live responses, free-tier rate limits.
- **Visual layout.** CSS not seen rendered (no browser here). Needs one look on desktop and mobile width.
- Rules engine is tuned on 3 fictional US letters only; non-US formats (UK postcodes, EU IDs, Chinese names) not covered yet.

## What needs the project owner

1. **Firebase project (≈5 min, free Spark, no card):** I can try this with browser automation; if Google asks for phone verification/2FA or terms acceptance, that step needs you. Steps are in README → "Firebase".
2. **One real-Chrome run on a physical desktop** (Windows/macOS, Chrome ≥139, the hardware above) for Gemini Nano + recording the demo video. If your computer doesn't meet the specs, tell me; fallback is a cloud-only demo plus offline Nano clips, which scores lower on "technological implementation".
3. Nothing else: no voice, no face, no payment required.

## Next steps (in order)

1. Re-check Devpost rules/submission requirements (published "Nov 9"; still "not yet available" at 13:20 CST) — adjust plan if they require Android, a public repo, or a category.
2. Create Firebase project + web app, App Check debug token, fill `.env.local`, run first live cloud analysis on the 3 samples; tune `ANALYST_SYSTEM` and schema.
3. Real Chrome + Nano test: entity extraction quality, photo transcription, offline mode; fix whatever breaks.
4. Build features from PLAN.md milestones: deadline countdown with date maths, better review UI (inline highlight on original), mobile layout, more letter types + redaction eval script with precision/recall table.
5. Deploy to Firebase Hosting with reCAPTCHA v3 App Check; public GitHub repo (user creates empty repo `airlock`, I push).
6. Demo video (captions only) + Devpost write-up by Nov 27; submit Nov 28 (deadline Nov 30 14:00 PT = Dec 1 06:00 CST).
