// Firebase AI Logic hybrid setup for Airlock.
// Privacy rule enforced by types: functions that may reach the cloud only accept `Redacted` text.

import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  Schema,
  type GenerativeModel,
  type Part,
} from "firebase/ai";
import type { Redacted } from "./pii";

const env = import.meta.env;

export const CLOUD_MODEL: string = env.VITE_CLOUD_MODEL || "gemini-3.5-flash-lite";

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** True when a real Firebase web config was provided in .env. */
export const cloudConfigured =
  !!firebaseConfig.apiKey && !!firebaseConfig.projectId && !!firebaseConfig.appId &&
  !String(firebaseConfig.apiKey).startsWith("YOUR_");

// The SDK needs *some* config object even for on-device-only use. With no .env we use inert
// placeholders and never issue a cloud request (see `cloudReachable`).
const app: FirebaseApp = initializeApp(
  cloudConfigured ? firebaseConfig : { apiKey: "not-configured", projectId: "not-configured", appId: "not-configured" },
);

// App Check is enforced for Firebase AI Logic (required since 2026-11-02).
if (cloudConfigured) {
  if (env.DEV || env.VITE_APPCHECK_DEBUG === "true") {
    // Prints a debug token in the console; register it in Firebase console > App Check > Manage debug tokens.
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  if (env.VITE_RECAPTCHA_SITE_KEY || env.DEV) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY || "debug-only"),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

const ai = getAI(app, { backend: new GoogleAIBackend() });

// ---------- schemas (shared by cloud responseSchema and on-device responseConstraint) ----------

const entityTypeEnum = Schema.enumString({
  enum: ["PERSON", "ADDRESS", "EMAIL", "PHONE", "ID_NUMBER", "ACCOUNT", "CARD", "DOB", "POSTCODE", "OTHER"],
});

export const entitySchema = Schema.object({
  properties: {
    entities: Schema.array({
      items: Schema.object({ properties: { text: Schema.string(), type: entityTypeEnum } }),
    }),
  },
});

export const analysisSchema = Schema.object({
  properties: {
    letterType: Schema.string({ description: "e.g. 'Notice to pay rent or quit', 'Insurance claim denial'" }),
    from: Schema.string({ description: "Sending organisation or role" }),
    urgency: Schema.enumString({ enum: ["high", "medium", "low"] }),
    plainSummary: Schema.string({ description: "2-4 sentences at a 6th-grade reading level" }),
    deadlines: Schema.array({
      items: Schema.object({
        properties: {
          what: Schema.string(),
          when: Schema.string({ description: "As written in the letter, or how it is calculated" }),
        },
      }),
    }),
    amounts: Schema.array({ items: Schema.object({ properties: { label: Schema.string(), amount: Schema.string() } }) }),
    nextSteps: Schema.array({ items: Schema.string() }),
    rightsAndOptions: Schema.array({ items: Schema.string() }),
    questionsToAsk: Schema.array({ items: Schema.string() }),
    replyDraft: Schema.string({ description: "Short reply letter. Use the [[TOKENS]] for any personal details." }),
    caveat: Schema.string({ description: "One line: not legal advice, where to get free help" }),
  },
});

// ---------- prompts ----------

const REDACTOR_SYSTEM =
  "You find personal data in letters so it can be removed. Return every span that identifies a private person: " +
  "names of people, home or mailing addresses, emails, phone numbers, ID/case/account/claim/policy/member numbers, " +
  "card numbers, dates of birth. Copy each span EXACTLY as it appears. Do NOT include organisation names, money " +
  "amounts, or deadlines. Ignore text that already looks like [[TOKEN_1]].";

const ANALYST_SYSTEM =
  "You help ordinary people understand official letters (housing, health insurance, debt, benefits). " +
  "Personal details have been replaced with tokens like [[PERSON_1]] or [[ADDRESS_1]]. Keep those tokens exactly as they are " +
  "and use them where personal details belong (e.g. in the reply draft). Never guess what a token stands for. " +
  "Be concrete about deadlines and amounts, explain in plain language, and do not invent laws or facts that are not in the letter; " +
  "when rights depend on location, say so and suggest free local legal aid.";

const HELPER_SYSTEM =
  "Answer the user's question about their letter briefly and plainly. Personal details are replaced with tokens like " +
  "[[PERSON_1]]; keep tokens unchanged. If unsure, say so.";

// ---------- models: one per privacy class ----------

/** Raw (unredacted) input: may ONLY ever run on device. No cloud fallback exists by construction. */
const transcriber: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: {
    createOptions: {
      expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    },
  },
});

const redactor: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: {
    createOptions: {
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      initialPrompts: [{ role: "system", content: [{ type: "text", value: REDACTOR_SYSTEM }] }],
    },
    promptOptions: { responseConstraint: entitySchema },
  },
});

function analystFor(mode: InferenceMode): GenerativeModel {
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: CLOUD_MODEL,
      systemInstruction: ANALYST_SYSTEM,
      generationConfig: { responseMimeType: "application/json", responseSchema: analysisSchema, temperature: 0.2 },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [{ role: "system", content: [{ type: "text", value: ANALYST_SYSTEM }] }],
      },
      promptOptions: { responseConstraint: analysisSchema },
    },
  });
}
/** Redacted input, cloud preferred for quality; SDK falls back to Nano on network errors. */
const analystCloud = analystFor(InferenceMode.PREFER_IN_CLOUD);
/** Used when the cloud is not configured or the browser is offline. */
const analystLocal = analystFor(InferenceMode.ONLY_ON_DEVICE);

function helperFor(mode: InferenceMode): GenerativeModel {
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: { model: CLOUD_MODEL, systemInstruction: HELPER_SYSTEM },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [{ role: "system", content: [{ type: "text", value: HELPER_SYSTEM }] }],
      },
    },
  });
}
/** Follow-ups: fast and free on device, cloud only if Nano is missing. Input is redacted either way. */
const helperHybrid = helperFor(InferenceMode.PREFER_ON_DEVICE);
const helperLocal = helperFor(InferenceMode.ONLY_ON_DEVICE);

// ---------- device model state ----------

export type DeviceState = "unsupported" | "unavailable" | "downloadable" | "downloading" | "available";

interface LanguageModelStatic {
  availability(opts?: unknown): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
}

export async function deviceState(): Promise<DeviceState> {
  const LM = (globalThis as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  if (!LM) return "unsupported";
  try {
    return await LM.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
  } catch {
    return "unavailable";
  }
}

/** Must be called from a user gesture. Starts/continues the Gemini Nano download. */
export async function prepareDeviceModel(onProgress: (fraction: number) => void): Promise<void> {
  await redactor.initializeDeviceModel(onProgress);
}

/**
 * Guard for every ONLY_ON_DEVICE call.
 * Found while testing firebase@13.2.0: when the browser has no `LanguageModel` global (Firefox, Safari,
 * mobile, older Chrome) the SDK creates no Chrome adapter and `callCloudOrDevice()` sends even
 * ONLY_ON_DEVICE requests to the cloud. For raw letters that would be a privacy leak, so we refuse locally.
 */
export async function assertOnDevice(): Promise<void> {
  const state = await deviceState();
  if (state !== "available") {
    throw new Error(`On-device model not available (${state}); refusing to run this step anywhere else.`);
  }
}

export function cloudReachable(): boolean {
  return cloudConfigured && navigator.onLine;
}

// ---------- calls ----------

export type Source = "on_device" | "in_cloud" | "local_rules";

export interface Timed<T> {
  value: T;
  source: Source;
  ms: number;
}

function srcOf(s: InferenceSource | undefined): Source {
  return s === InferenceSource.IN_CLOUD ? "in_cloud" : "on_device";
}

async function timed<T>(fn: () => Promise<{ value: T; source: Source }>): Promise<Timed<T>> {
  const t0 = performance.now();
  const r = await fn();
  return { ...r, ms: Math.round(performance.now() - t0) };
}

/** RAW image -> text. On device only. */
export function transcribeImage(base64: string, mimeType: "image/jpeg" | "image/png"): Promise<Timed<string>> {
  return timed(async () => {
    await assertOnDevice();
    const parts: Part[] = [
      { type: "text", text: "Transcribe all text in this letter exactly, preserving line breaks. Output only the text." },
      { type: "inlineData", inlineData: { data: base64, mimeType } },
    ];
    const r = await transcriber.generateContent(parts);
    return { value: r.response.text(), source: srcOf(r.response.inferenceSource) };
  });
}

/** RAW text -> entity JSON. On device only. */
export function findEntitiesOnDevice(rawChunk: string): Promise<Timed<unknown>> {
  return timed(async () => {
    await assertOnDevice();
    const r = await redactor.generateContent(`Letter:\n"""\n${rawChunk}\n"""`);
    return { value: JSON.parse(r.response.text()), source: srcOf(r.response.inferenceSource) };
  });
}

/** REDACTED text -> structured analysis. Cloud preferred; Nano if the cloud is unreachable or refuses. */
export function analyse(letter: Redacted): Promise<Timed<Analysis>> {
  const prompt = `Explain this letter and draft a short reply.\n\nLetter:\n"""\n${letter}\n"""`;
  const runLocal = async () => {
    await assertOnDevice();
    const r = await analystLocal.generateContent(prompt);
    return { value: JSON.parse(r.response.text()) as Analysis, source: srcOf(r.response.inferenceSource) };
  };
  return timed(async () => {
    if (!cloudReachable()) return runLocal();
    try {
      // SDK falls back to Nano itself on network errors; other errors (quota, App Check) land in catch.
      const r = await analystCloud.generateContent(prompt);
      return { value: JSON.parse(r.response.text()) as Analysis, source: srcOf(r.response.inferenceSource) };
    } catch (cloudErr) {
      if ((await deviceState()) === "available") return runLocal();
      throw cloudErr;
    }
  });
}

/** REDACTED context + question -> answer. On device preferred. */
export function ask(letter: Redacted, question: Redacted): Promise<Timed<string>> {
  const local = !cloudReachable();
  const model = local ? helperLocal : helperHybrid;
  return timed(async () => {
    if (local) await assertOnDevice();
    const r = await model.generateContent(`Letter:\n"""\n${letter}\n"""\n\nQuestion: ${question}`);
    return { value: r.response.text(), source: srcOf(r.response.inferenceSource) };
  });
}

export interface Analysis {
  letterType?: string;
  from?: string;
  urgency?: "high" | "medium" | "low";
  plainSummary?: string;
  deadlines?: { what?: string; when?: string }[];
  amounts?: { label?: string; amount?: string }[];
  nextSteps?: string[];
  rightsAndOptions?: string[];
  questionsToAsk?: string[];
  replyDraft?: string;
  caveat?: string;
}
