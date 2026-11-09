// Airlock pipeline: raw letter -> local PII discovery -> tokenised payload -> analysis -> local re-hydration.
import { analyse, ask, findEntitiesOnDevice, type Analysis, type Source } from "./ai";
import { rulesOnlyAnalysis } from "./fallback";
import {
  chunk, expandNames, findByRules, leakCheck, mergeEntities, newVault, redact, rehydrate, sanitizeModelEntities,
  type Entity, type Redacted, type Vault,
} from "./pii";

export interface StepLog {
  label: string;
  source: Source | "skipped" | "error";
  ms: number;
  detail?: string;
}

export interface Prepared {
  raw: string;
  entities: Entity[];
  /** entities the user chose to release (send as-is) */
  released: Set<string>;
  redacted: Redacted;
  vault: Vault;
  leaks: string[];
  log: StepLog[];
}

export async function discover(raw: string, useDevice: boolean, log: StepLog[]): Promise<Entity[]> {
  const t0 = performance.now();
  const rules = findByRules(raw);
  log.push({ label: "Find personal details (rules)", source: "local_rules", ms: Math.round(performance.now() - t0), detail: `${rules.length} found` });

  let modelEnts: Entity[] = [];
  if (useDevice) {
    try {
      let ms = 0;
      for (const part of chunk(raw)) {
        const r = await findEntitiesOnDevice(part);
        ms += r.ms;
        modelEnts = modelEnts.concat(sanitizeModelEntities(r.value, part));
      }
      log.push({ label: "Find personal details (Gemini Nano)", source: "on_device", ms, detail: `${modelEnts.length} found` });
    } catch (e) {
      log.push({ label: "Find personal details (Gemini Nano)", source: "error", ms: 0, detail: errMsg(e) + " — continuing with rules only; nothing was sent anywhere" });
    }
  } else {
    log.push({ label: "Find personal details (Gemini Nano)", source: "skipped", ms: 0, detail: "on-device model not ready — rules only" });
  }
  return expandNames(mergeEntities(rules, modelEnts));
}

export function build(raw: string, entities: Entity[], released: Set<string>, log: StepLog[]): Prepared {
  const isReleased = (e: Entity) => released.has(e.text.toLowerCase()) || (!!e.parent && released.has(e.parent.toLowerCase()));
  const active = entities.filter((e) => !isReleased(e));
  const vault = newVault();
  const { redacted } = redact(raw, active, vault);
  const leaks = leakCheck(redacted, vault).filter((l) => !released.has(l.toLowerCase()));
  return { raw, entities, released, redacted, vault, leaks, log };
}

export interface Result {
  analysis: Analysis;
  /** what came back from the model, tokens intact */
  tokenised: Analysis;
  source: Source;
  ms: number;
  bytesSent: number;
}

export async function runAnalysis(p: Prepared, modelAvailable: boolean, log: StepLog[]): Promise<Result> {
  if (p.leaks.length) throw new Error("Blocked: personal details still present in the outbound text.");
  const bytesSent = new TextEncoder().encode(p.redacted).length;
  let tokenised: Analysis;
  let source: Source;
  let ms: number;
  try {
    const r = await analyse(p.redacted);
    tokenised = r.value;
    source = r.source;
    ms = r.ms;
    log.push({ label: "Analyse redacted letter", source, ms, detail: source === "in_cloud" ? `${bytesSent} bytes sent, 0 personal details` : "nothing left this device" });
  } catch (e) {
    if (modelAvailable) log.push({ label: "Analyse redacted letter", source: "error", ms: 0, detail: errMsg(e) });
    else log.push({ label: "Analyse redacted letter", source: "skipped", ms: 0, detail: "no model available" });
    const t0 = performance.now();
    tokenised = rulesOnlyAnalysis(p.redacted);
    source = "local_rules";
    ms = Math.round(performance.now() - t0);
    log.push({ label: "Basic scan (fallback)", source, ms, detail: "deadlines and amounts by text rules" });
  }
  const t0 = performance.now();
  const analysis = rehydrateAnalysis(tokenised, p.vault);
  log.push({ label: "Put your details back", source: "local_rules", ms: Math.round(performance.now() - t0), detail: `${p.vault.byToken.size} tokens re-filled on this device` });
  return { analysis, tokenised, source, ms, bytesSent: source === "in_cloud" ? bytesSent : 0 };
}

export function rehydrateAnalysis(a: Analysis, vault: Vault): Analysis {
  // Walk every string in the object and re-hydrate it.
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return rehydrate(v, vault);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(a) as Analysis;
}

export async function followUp(p: Prepared, question: string, log: StepLog[]): Promise<{ text: string; source: Source; ms: number }> {
  // The question itself may contain personal details: run it through the same airlock.
  const qEnts = mergeEntities(findByRules(question), p.entities.filter((e) => !p.released.has(e.text.toLowerCase())));
  const { redacted: q } = redact(question, qEnts, p.vault);
  if (leakCheck(q, p.vault).length) throw new Error("Blocked: your question contains personal details that could not be removed.");
  const r = await ask(p.redacted, q);
  log.push({ label: "Follow-up question", source: r.source, ms: r.ms, detail: r.source === "in_cloud" ? "redacted question sent" : "answered on this device" });
  return { text: rehydrate(r.value, p.vault), source: r.source, ms: r.ms };
}

export function errMsg(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 160 ? s.slice(0, 157) + "…" : s;
}
