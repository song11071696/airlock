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

## Real-device test 2026-11-09 14:35 (user's MacBook Air M5, Chrome)
- Gemini Nano downloaded and "ready" on device. Redaction ran: 14 withheld (rules + Nano), leak check passed, 898 bytes outbound.
- Nano added: POSTCODE "Oakridge, CA 94110", ACCOUNT "Tenant Account No: 88-1234-77", DOB "November 6".
- ISSUE: "November 6" tagged DOB by Nano is likely a notice/deadline date, not a birth date. Redacting dates can break deadline extraction. Fix: don't let Nano withhold plain dates unless context says birth/DOB; label-bleed (whole "Tenant Account No:" line) should trim to the value.
- 14:36 Explain on user's Mac: CLOUD WORKED (gemini-3.5-flash-lite, after App Check set to monitor-only). Full hybrid flow verified on real device: Nano + rules redaction → cloud on 898 bytes → local fill-back.
- ISSUE: draft reply says "Please contact me at (415) 555-0198 or via email at d.okafor@..." — those are the LANDLORD's details; tenant reply uses sender's contact as own. Need role-aware tokens (SENDER_* vs RECIPIENT_*) or prompt rule.
- ISSUE: "the account Tenant Account No: 88-1234-77" label bleed in draft (from Nano span).

### Fixes for the 2026-11-09 real-device issues
- Nano date false positive: `postFilterModelEntities()` drops date-only spans (any type) and DOB spans unless birth/DOB wording sits on the same line just before them. Service/deadline dates now reach the analyst. Redactor prompt also told not to tag ordinary dates.
- Label bleed: Nano spans are trimmed to the value (`trimLabel()`), and spans already covered by a rules entity are dropped, so "Tenant Account No: 88-1234-77" becomes one `[[RECIPIENT_ACCOUNT_1]]` token with the label left visible.
- Role confusion: tokens are role-aware (`assignRoles()`, local, from letter layout: To/Dear/labelled names and the recipient address block → RECIPIENT_*, signature block and "call/reach us/deliver to/write to" contact wording → SENDER_*; identifiers default to recipient). Analyst/helper prompts explain the roles and forbid presenting SENDER_* contact as the user's own; `guardReplyDraft()` deterministically replaces sender/unknown phone/email/address in "contact me / my phone" sentences with [your phone]/[your email]/[your address] and a sender name under the sign-off with [your name].
- Local scan after a cloud refusal no longer says "connect to the internet".
- 14:45 re-test on user's Mac after 7f4a1d8: PASS. 12 withheld, role tokens (RECIPIENT_*), "Tenant Account No:" label kept plain, Nov 6 date no longer withheld, leak check pass, 1012 bytes out. Draft: "contact me at [your phone] or [your email]", signed by tenant. Minor: "What to do next" no longer cites landlord's phone/office (SENDER tokens could be referenced and filled back locally) — improvement candidate.

### Polish after the 14:45 re-test (2026-11-09 ~15:10 CST)
- SENDER_* tokens may now be cited in "What to do next" / "Questions to ask" (analyst prompt + `nextSteps` schema description); they are filled back locally, so the landlord's phone/office appear in real values. `guardAnalysis()` runs the reply guard on every string of the result (not only the draft), so a sender contact is still never presented as the user's own. The local rules-only scan also adds "To contact the sender: call … · email … · write to …" from SENDER tokens.
- Sample-letter audit (all three run through discover → build → runAnalysis with simulated Nano spans) found and fixed:
  - insurance: "Mr. Whitaker" got a separate `[[RECIPIENT_PERSON_2]]`, so the model could read him as a second person → surnames now get `[[RECIPIENT_SURNAME_n]]` with the full name's number (prompt explains it).
  - insurance: appeals "PO Box 4410" was sent in clear while its ZIP was tokenised → new PO Box address rule; it becomes `[[SENDER_ADDRESS_1]]` (via "write to").
  - debt: a reply draft re-filled the full card number "4111 1111 1111 1111" into a letter the user would send → card numbers are re-filled masked (`•••• 1111`) in everything the model wrote, incl. follow-ups; the review screen still shows the original locally.
  - verified: service date "September 18" stays visible; DOB/member ID/claim no. are RECIPIENT; Member Services phone and collector phone/email/address are SENDER; debtor tear-off block is RECIPIENT; no SENDER_PERSON in unsigned letters; amounts, organisations and "180 days"/"thirty days" survive; exact round-trip and zero leaks for all three.
- Tests: 48/48 pass (was 24). Build passes.
- `DEMO_SCRIPT.md`: ≤3:00 click-by-click recording script (Chinese steps, English captions, QuickTime steps). Offline shot included: verified in code that `navigator.onLine=false` → `cloudReachable()` false → `analyse()`/`ask()` run `ONLY_ON_DEVICE` on Gemini Nano; status pills switch to offline. Not yet tested on the real Mac; script says rehearse first and never reload while offline (no service worker).
