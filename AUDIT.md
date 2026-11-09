# Airlock — audit (2026-11-09 ~14:35 CST)

Repo: https://github.com/song11071696/airlock (`main` = source, `gh-pages` = built site). Local: `/workspace/work/hackathons/hybridai/` (branch `master` → pushes to `main`).
**Live:** https://song11071696.github.io/airlock/

## Verified working

- `npm run build` — TypeScript strict + Vite 8 production build pass (≈104 kB JS, 34 kB gzip), base `/airlock/`, Firebase web config of `airlock-hybridai` baked in from `app/.env.production`.
- `npm test` — **24/24 pass** (vitest 5):
  - `pii.test.ts` (11): rules engine on the 3 fictional letters (names, addresses, account/case/member/claim numbers, DOB, phones, emails, Luhn cards); amounts/deadlines/org names survive; token round-trip; leak check; model-output hygiene; chunking.
  - `pipeline.test.ts` (7): Nano findings merged; device model never called when not ready; only redacted text reaches `analyse()`; local re-hydration; rules-only fallback; leak blocks sending; follow-up questions redacted; **cloud refusal (App Check) → local scan + plain-language notice, 0 bytes counted as sent**.
  - `cloud.test.ts` (2): `VITE_APPCHECK` parsing (default off); `classifyCloudError` for 401/App Check, 403/referrer, 429/quota, 404/model, network, other.
  - `cloud.sdk.test.ts` (1, **real Firebase SDK**, cloud configured, App Check off, endpoint mocked to return 401 App Check): `analyse()` throws `CloudRefusedError(app_check)`; request body contains only tokens; no `X-Firebase-AppCheck` header; cloud then marked refused (no retries) until "Retry cloud"; follow-up gives the same plain refusal without a second request.
  - `ui.smoke.test.ts` (1, jsdom, real SDK, no config): full flow in LOCAL RULES mode, zero network requests.
  - `sdk.behavior.test.ts` (2): firebase@13.2.0 `ONLY_ON_DEVICE` cloud-routing issue + Airlock's guard.
- **Live site** (2026-11-09): `index.html`, JS and CSS all HTTP 200 from https://song11071696.github.io/airlock/; served HTML identical to local `dist/index.html`.
- **Live browser test** (Hark cloud Chrome, no Nano): status pills render; sample → airlock → leak check passed (9 details found by rules, 11 tokens); "Explain" → `POST firebasevertexai.googleapis.com/v1beta/projects/airlock-hybridai/models/gemini-3.5-flash-lite:generateContent` → **HTTP 401 (App Check enforced)**; UI showed "Cloud: refused (App Check)", Retry button, explanatory notice, and LOCAL RULES basic scan; details re-filled locally. Follow-up then showed a raw "On-device model not available" error → fixed (now shows the App Check explanation; covered by `cloud.sdk.test.ts`) and redeployed.

## Known limits / still blocked

- **Cloud half is refused on the live demo** because App Check is enforced for AI Logic and no free provider can be registered (reCAPTCHA v3 deprecated for new registration; reCAPTCHA Enterprise needs billing). Options: (a) App Check debug token for the recorded demo only (works on one browser, token must stay private, not for the public URL); (b) find out whether enforcement can be turned off for AI Logic in the console (App Check → APIs → Firebase AI Logic → "Unenforce"), if the console allows it on this project; (c) accept cloud-refused public demo + Nano path for judges with Chrome.
- **GitHub Actions is disabled for the owner account** (API: "Actions has been disabled for this user"). Pages therefore serves the `gh-pages` branch, deployed with `scripts/deploy-gh-pages.sh`. Pages source was switched from "GitHub Actions" to "Deploy from a branch → gh-pages / (root)" in the GitHub UI (the REST API returned 403 for that change).
- **Real Gemini Nano** still untested (needs physical desktop Chrome ≥139 with the hardware in PLAN.md §7): download flow, entity JSON via `responseConstraint`, photo transcription, offline analysis, follow-ups.
- Rules-only summary text says "Enable Gemini Nano or connect to the internet" even when the cause is an App Check refusal; the notice above it gives the real reason. Minor copy fix pending.
- Rules engine tuned on 3 fictional US letters only.
- Visual layout only seen through the browser test's text report, not a screenshot review.

## What needs the project owner

1. Decide App Check route (a/b/c above). (b) is a console toggle worth checking first; (a) needs one debug token registered in the console.
2. One real-Chrome run on a physical desktop for Gemini Nano + recording the demo video.
3. Nothing else: no voice, no face, no payment.

## Next steps

1. Re-check Devpost rules/submission requirements.
2. Resolve App Check route, then tune `ANALYST_SYSTEM`/schema on live responses.
3. Real Chrome + Nano test; fix what breaks.
4. PLAN.md milestones: deadline countdown, inline review highlight, mobile layout, more letter types, redaction eval (precision/recall).
5. Demo video (captions only) + Devpost write-up by Nov 27; submit Nov 28 (deadline Nov 30 14:00 PT = Dec 1 06:00 CST).
