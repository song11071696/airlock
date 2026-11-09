# Airlock — #BuildHybridAI 2026 plan

**One line:** Photograph or paste an official letter (eviction notice, insurance denial, debt-collection letter, benefits decision). Airlock strips out who you are *on your own device* with Gemini Nano, sends only the anonymised letter to Gemini in the cloud for expert-level analysis and a reply draft, then puts your real details back in locally. The cloud never sees your name, address, case numbers, or the photo.

Hackathon: https://firebasehybridaihackathon.devpost.com/ — submissions Nov 9 – Nov 30 2026, 2:00 PM PT (= Dec 1 2026 06:00 Asia/Shanghai). Single $30k grand prize. Official rules/submission requirements not published yet (checked 2026-11-09 13:20 CST); re-check before Nov 12.

---

## 1. Tech facts this plan is built on (from the docs, 2026-11-05 versions)

Source: https://firebase.google.com/docs/ai-logic/hybrid/web/get-started , …/configuration-options , …/generate-structured-output (text copies in `research/`).

- Web SDK: `firebase` 13.2.0 (npm, 2026-11-06). `import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, Schema } from "firebase/ai"`.
- `getGenerativeModel(ai, { mode, onDeviceParams?, inCloudParams? })`. Modes: `PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`.
- `result.response.inferenceSource` → `"on_device"` | `"in_cloud"` (JS SDK ≥12.5).
- Default cloud model `gemini-3.5-flash-lite` (SDK ≥13.0); override via `inCloudParams.model`. Gemini 2.5 is deprecated — do not use.
- On-device = Chrome Prompt API (Gemini Nano), **Chrome desktop ≥ 139 only**, flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` for image input. `model.initializeDeviceModel(progressCb)` must be called on a user gesture; first download takes minutes. While downloading: `PREFER_*` modes silently go to cloud, `ONLY_ON_DEVICE` waits.
- On-device limits: single-turn only (no chat), text + JPEG/PNG input, inline data only, **9,216-token max**, no tools / function calling / countTokens, structured output via `onDeviceParams.promptOptions.responseConstraint` (cloud uses `responseMimeType` + `responseSchema`).
- **App Check enforcement is required for AI Logic since 2026-11-02.** Local dev uses the debug provider (`self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`, register token in console); a deployed demo needs reCAPTCHA (v3 or Enterprise) site key.
- Android hybrid exists (ML Kit Prompt API, beta, specific devices incl. Pixel 9; AI Logic SDK 17.10+/BoM 34.10+, must name a cloud model explicitly). iOS hybrid exists (Apple Foundation Models, Apple Intelligence devices, SDK 12.13+, text only). Both experimental. We ship **web only**; Android is a stretch goal, not in scope.

## 2. Competitor scan

- #BuildHybridAI 2026 gallery: not published yet (1,074 registrants on day 1). Re-check weekly.
- Closest prior art = Chrome Built-in AI Challenge 2024/2025 winners (https://developer.chrome.com/blog/ai-challenge-winners-2025):
  - Best hybrid: **Trail** (offline trail companion), **Mentelo** (on-page tech support extension).
  - Helpful/multimodal: AAC Board AI, Nutshell (hands-free), Phonaify, Pet Shelter App.
  - Honourable: BrowseBack, EduAdapt, Helix AI (sidebar chat), Marionette (agent), Turing Werewolf.
  - 2024: Mochi (reading for ADHD/dyslexia), WP on-device assistant, Opale, Orma, Crooked Tankard.
- Saturated, avoid: summarise/rewrite-the-page extensions, sidebar chatbots, reading-accessibility, translation, "offline companion" apps, browsing memory.
- What nobody in those galleries did: use on-device and cloud as **two halves of one pipeline with a privacy boundary between them**. Every hybrid winner used hybrid as *fallback* ("cloud if Nano missing"). Airlock uses hybrid as *architecture*: some steps are legally/ethically required to stay local (ONLY_ON_DEVICE), some deliberately go to the bigger model (PREFER_IN_CLOUD), and the app proves to the user exactly what crossed the line.

## 3. Why it should win, per criterion

| Criterion | Airlock's case |
|---|---|
| **Technological implementation** | Uses all four modes for a reason: `ONLY_ON_DEVICE` for anything touching raw text/photos (transcribe, find PII) – never falls back to cloud by construction; `PREFER_IN_CLOUD` for analysis of the *redacted* text (falls back to Nano offline); `PREFER_ON_DEVICE` for follow-up Q&A over redacted context; structured output on both sides (JSON schema / responseConstraint); `inferenceSource` drives the per-step badges; download progress via `initializeDeviceModel`; App Check. A TypeScript branded type `Redacted` makes it a compile error to pass unredacted text to a cloud-capable call. Deterministic regex/Luhn layer runs even when Nano is unavailable, so the privacy guarantee never depends on model availability. Chunking for the 9,216-token on-device cap. |
| **Design** | One flow: Letter → Airlock review ("this is exactly what will leave your device", diff-highlighted, click any word to withhold it) → Plain-language result (what it is, deadline countdown, what to do, what to ask, reply draft with your details filled back in) → Ask follow-ups. Persistent status bar: on-device model state, network, cloud. Works offline in reduced mode. Nothing stored server-side; no accounts. |
| **Potential impact** | Real, specific audience: people who receive high-stakes letters they don't understand and can't safely paste into a chatbot — tenants facing eviction notices, patients with insurance denials, people with debt-collection letters, and the legal-aid / community caseworkers who help them and are often barred by policy from putting client PII into cloud AI. Deadlines in these letters are short (e.g. US eviction notices often 3–30 days; debt-validation 30 days) and missing them is costly. Airlock removes the "I can't paste this into AI" blocker. |
| **Quality of idea** | Non-obvious use of hybrid: not "Nano when available", but a split-brain privacy airlock with local re-hydration. Shows genuine understanding of where on-device wins (privacy of identity) and where cloud wins (reasoning quality, long structured output). |

## 4. Architecture

```
 [photo JPEG/PNG]──► ① Transcribe (ONLY_ON_DEVICE, Nano multimodal)──┐
 [pasted text] ─────────────────────────────────────────────────────┤
                                                                     ▼
                     ② Find PII:  a) rules (regex+Luhn, always, local)
                                  b) Nano entity JSON (ONLY_ON_DEVICE, chunked)
                                                                     ▼
                     ③ Tokenise locally:  "Maria Lopez" → [[PERSON_1]]  (vault in memory only)
                                                                     ▼
                     ④ Airlock review UI: user sees outbound payload, can withhold more
                                                                     ▼  Redacted text only
                     ⑤ Analyse (PREFER_IN_CLOUD, gemini-3.5-flash-lite, JSON schema)
                         offline → falls back to Nano automatically (same schema)
                                                                     ▼
                     ⑥ Re-hydrate locally: tokens → real values (string replace, no AI)
                                                                     ▼
                     ⑦ Follow-up Q&A (PREFER_ON_DEVICE over redacted context) → re-hydrate
```

- `src/pii.ts` rules engine + tokeniser + re-hydrator (pure, unit-tested).
- `src/ai.ts` Firebase init, App Check, four model instances, device-model state.
- `src/pipeline.ts` steps ①–⑦, returns per-step `{source: on_device|in_cloud|local_rules, ms}`.
- `src/main.ts` UI (vanilla TS, no framework), `src/samples.ts` fictional sample letters.
- Hosting: Firebase Hosting (Spark, free) for the public demo link judges can open.

## 5. Demo video storyboard (≈2:50, captions + screen only, no voice, no face)

1. 0:00 Title card: "You got a letter. It has a deadline. You can't paste it into a chatbot." (stock-free: just text on dark bg)
2. 0:10 Fictional eviction notice photo dropped into Airlock. Status bar: "Gemini Nano: ready · Online · Cloud ready".
3. 0:20 Step ① badge ON DEVICE — text appears. Caption: "Transcribed by Gemini Nano. The photo never leaves this laptop."
4. 0:35 Step ② — names, address, case number light up. Caption: "Found 9 personal details. Rules + on-device model."
5. 0:50 Airlock review: side-by-side "stays here / leaves device". User clicks landlord's phone to also withhold. Caption: "You see exactly what crosses the line."
6. 1:10 Step ⑤ badge IN CLOUD (gemini-3.5-flash-lite): plain-language summary, deadline countdown "4 days", 3 action steps, tenant-rights questions.
7. 1:35 Reply draft appears with [[PERSON_1]] chips that flip to the real name — caption "Re-filled on your device."
8. 1:50 DevTools Network tab: the only request body contains tokens, no name. Caption: "Proof."
9. 2:05 Wi-Fi off. Ask a follow-up; badge ON DEVICE; a second letter analysed offline (badge shows fallback). Caption: "No signal? Still works."
10. 2:30 Architecture slide (diagram from §4) + mode table.
11. 2:45 End card: name, link, "Built with Firebase AI Logic hybrid inference".
Record with OBS/Chrome screen capture; captions burned in with ffmpeg. All sample data fictional.

## 6. Milestones (all dates Asia/Shanghai; hard deadline Dec 1 06:00 CST = Nov 30 14:00 PT)

- **Nov 9** — Research, plan, v0 app (paste → rules redaction → cloud/on-device analysis → re-hydrate, status bar, fallbacks), tests. ✅ done (20 tests pass, build passes; see AUDIT.md).
- **Nov 10–12** — Firebase project (Spark, Gemini Developer API), App Check debug token, first real cloud call; real Chrome + Gemini Nano test on a physical desktop; read official rules once published.
- **Nov 13–16** — Image path (Nano transcription), Nano entity extraction tuning on 10 fictional letters, chunking, click-to-withhold review UI, deadline countdown.
- **Nov 17–20** — Q&A, offline mode polish, accessibility pass, mobile-width layout (cloud-only on mobile with clear label), Firebase Hosting deploy + reCAPTCHA App Check.
- **Nov 21–24** — Redaction quality eval script (precision/recall on labelled fictional set, published in README), bug bash, copy polish.
- **Nov 25–27** — Record and caption demo video, Devpost write-up, screenshots, architecture image.
- **Nov 28** — Submit (2 days buffer). Nov 29–30 only fixes.

## 7. Risks

- Gemini Nano needs real Chrome desktop (Win 10/11, macOS 13+, Linux, Chromebook Plus) with ≥22 GB free disk and GPU >4 GB VRAM or 16 GB RAM + 4 cores (https://developer.chrome.com/docs/ai/get-started); Nano text languages from Chrome 149: en, es, ja, de, fr — cannot be verified in our headless sandbox; need one physical machine run for the video.
- App Check now mandatory — cloud calls fail until debug token / reCAPTCHA registered.
- Free-tier Gemini Developer API rate limits — fine for judging; cache sample analyses as a last resort (clearly labelled).
- Rules may add requirements (e.g. Android, public repo, specific category) — re-plan within 24h of publication.
