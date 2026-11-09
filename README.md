# Airlock

**Understand an official letter without giving away who you are.**

Airlock is a web app for people who get high-stakes letters (eviction notices, insurance denials, debt-collection letters) and for the caseworkers who help them. It uses **Firebase AI Logic hybrid inference** as a privacy boundary, not just as a fallback:

1. **On your device** (Gemini Nano in Chrome, `ONLY_ON_DEVICE`): read the photo, find names, addresses, case/account numbers, phone numbers, emails, card numbers, dates of birth. A deterministic rules engine (regex + Luhn) runs too, so the guarantee doesn't depend on the model.
2. **Airlock review**: you see exactly the text that would leave the device, with personal details swapped for tokens like `[[PERSON_1]]`. Click to release or withhold; select text to withhold more. A leak check blocks sending if any withheld value is still in the payload.
3. **In the cloud** (`PREFER_IN_CLOUD`, `gemini-3.5-flash-lite`): only the redacted letter is analysed: plain-language summary, deadlines, amounts, next steps, rights, questions to ask, and a reply draft, as structured JSON.
4. **Back on your device**: tokens are replaced with your real details locally. Follow-up questions run on Gemini Nano first (`PREFER_ON_DEVICE`) and go through the same airlock.

The header always shows the on-device model state, network and cloud status, and every step is logged with its real `inferenceSource` (ON DEVICE / IN CLOUD / LOCAL RULES).

| Situation | What happens |
|---|---|
| Chrome desktop + Gemini Nano + online + Firebase configured | Full hybrid: Nano finds PII and reads photos, cloud explains, Nano answers follow-ups |
| Offline (Nano ready) | Everything runs on device, including the analysis |
| No Nano (other browsers, mobile) + cloud | Rules-only redaction, cloud analysis; photos refused (never uploaded) |
| No Nano, no cloud | Rules-only redaction + rules-only "basic scan" of deadlines and amounts |

Not legal advice. All sample letters are fictional.

## Setup

Requirements: Node 20+ (tested on 22), npm.

```bash
cd app
npm install
cp .env.example .env.local   # optional: leave unfilled to run without cloud
npm run dev                  # http://localhost:5173
npm test                     # 20 tests (rules engine, pipeline routing, UI smoke, SDK behaviour)
npm run build                # type-check + production build into app/dist
```

### Firebase (cloud half) — free Spark plan

1. Firebase console → create project (no Google Analytics needed).
2. **AI Services → AI Logic → Get started** → choose **Gemini Developer API** (no billing).
3. Register a **Web app**; copy its config into `app/.env.local` (`VITE_FIREBASE_*`).
4. App Check is enforced for AI Logic. For local dev, `npm run dev` turns on the App Check debug provider: open the app, copy the `AppCheck debug token` from the browser console, and add it under **App Check → Apps → ⋮ → Manage debug tokens**.
5. For a public deploy: register the web app with **reCAPTCHA v3** in App Check, put the site key in `VITE_RECAPTCHA_SITE_KEY`, then `npm run build && npx firebase-tools deploy --only hosting` (set your project id in `app/.firebaserc`).

### Gemini Nano (on-device half)

Chrome desktop ≥ 139 on Windows 10/11, macOS 13+, Linux or Chromebook Plus; ≥ 22 GB free disk; GPU > 4 GB VRAM or 16 GB RAM + 4 cores. For photo input, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart. In the app, click **Enable Gemini Nano** in the header to start the download (first time takes minutes).

## Code map

- `app/src/pii.ts` — rules engine, tokeniser (`Redacted` branded type), re-hydration, leak check, chunking for Nano's 9,216-token limit.
- `app/src/ai.ts` — Firebase init, App Check, one model per privacy class, `assertOnDevice()` guard.
- `app/src/pipeline.ts` — discover → build → analyse → re-hydrate → follow-up, with step log.
- `app/src/fallback.ts` — rules-only scan when no model is reachable.
- `app/src/main.ts`, `index.html`, `style.css` — UI.

### A note on `ONLY_ON_DEVICE`

In `firebase@13.2.0`, if the browser has no `LanguageModel` global (Firefox, Safari, mobile, older Chrome), the SDK creates no on-device adapter and a model with `mode: ONLY_ON_DEVICE` **sends the request to the cloud** instead of throwing (`src/sdk.behavior.test.ts` reproduces this). Airlock therefore checks `LanguageModel.availability()` itself before every on-device-only call and refuses locally.
