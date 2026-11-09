// Airlock privacy core: deterministic PII rules, tokenisation and local re-hydration.
// Everything in this file is pure and runs locally. No network, no model.

export type EntityType =
  | "PERSON"
  | "ADDRESS"
  | "EMAIL"
  | "PHONE"
  | "ID_NUMBER"
  | "ACCOUNT"
  | "CARD"
  | "DOB"
  | "POSTCODE"
  | "OTHER";

export const ENTITY_TYPES: EntityType[] = [
  "PERSON", "ADDRESS", "EMAIL", "PHONE", "ID_NUMBER", "ACCOUNT", "CARD", "DOB", "POSTCODE", "OTHER",
];

export type Finder = "rules" | "on_device" | "user";

export interface Entity {
  text: string;
  type: EntityType;
  by: Finder;
}

/** Text that has passed through the airlock. Only this type may be sent to a cloud-capable model. */
export type Redacted = string & { readonly __brand: "Redacted" };

export interface Vault {
  /** token -> original value */
  byToken: Map<string, string>;
  /** original value (normalised) -> token */
  byValue: Map<string, string>;
  counters: Partial<Record<EntityType, number>>;
}

export function newVault(): Vault {
  return { byToken: new Map(), byValue: new Map(), counters: {} };
}

export const TOKEN_RE = /\[\[([A-Z_]+)_(\d+)\]\]/g;

function luhnOk(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

interface Rule {
  type: EntityType;
  re: RegExp;
  /** which capture group holds the value (default 0) */
  group?: number;
  accept?: (m: string) => boolean;
}

// Order matters: more specific rules first. All regexes are global.
const RULES: Rule[] = [
  { type: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  {
    type: "CARD",
    re: /\b(?:\d[ -]?){13,19}\b/g,
    accept: (m) => luhnOk(m.replace(/\D/g, "")),
  },
  { type: "ID_NUMBER", re: /\b\d{3}-\d{2}-\d{4}\b/g }, // US SSN shape
  { type: "ACCOUNT", re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g }, // IBAN shape
  {
    type: "DOB",
    re: /\b(?:DOB|D\.O\.B\.|date of birth|born(?: on)?)[:\s]*((?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})|(?:[A-Z][a-z]+ \d{1,2},? \d{4}))/gi,
    group: 1,
  },
  {
    type: "PHONE",
    re: /(?:\+\d{1,3}[\s.-]?|\b1[\s.-])?(?:\(\d{2,4}\)[\s.-]?|\b\d{2,4}[\s.-])\d{3,4}[\s.-]\d{3,4}\b/g,
    accept: (m) => m.replace(/\D/g, "").length >= 9,
  },
  {
    // "Account No: 88-1234-77", "Case #: 24-LT-00981", "Policy Number ABC123456", "Member ID: XJ99..."
    type: "ACCOUNT",
    re: /\b(?:(?:account|acct|case|claim|policy|member|reference|ref|file|docket|loan|invoice|patient|tenant|customer|A-?number|receipt)\s*){1,3}(?:no\.?|number|num|#|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/gi,
    group: 1,
    accept: (m) => /\d/.test(m),
  },
  {
    // US-style street address: "1427 Maple Ave, Apt 3B"
    type: "ADDRESS",
    re: /\b\d{1,6}\s+(?:[A-Z][a-z0-9]+\s){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy)\.?(?:,?\s+(?:Apt|Apartment|Unit|Suite|Ste|#)\.?\s*[A-Za-z0-9-]+)?/g,
  },
  { type: "POSTCODE", re: /\b[A-Z]{2}\s+(\d{5}(?:-\d{4})?)\b/g, group: 1 }, // "CA 94110"
  {
    // Salutations and labelled names: "Dear Maria Lopez", "Tenant: John A. Smith", "Dear Mr. Daniel Okafor"
    type: "PERSON",
    re: /\b(?:(?:Dear|To|Attn|Mr|Mrs|Ms|Mx|Dr)\.?[:,]?|(?:Tenants?|Patient|Member|Insured|Debtor|Applicant|Beneficiary|Name|Resident|Client)[ \t]*:)[ \t]+(?:(?:Mr|Mrs|Ms|Mx|Dr)\.?[ \t]+)?((?:[A-Z][a-z'’-]+|[A-Z]\.)(?:[ \t]+(?:[A-Z][a-z'’-]+|[A-Z]\.)){0,3})/g,
    group: 1,
    accept: (m) => !STOP_NAMES.has(m.split(/\s+/)[0]) && m.length > 2,
  },
  {
    // Signature blocks: "Sincerely,\nDaniel Okafor"
    type: "PERSON",
    re: /\b(?:Signed|Sincerely|Regards|Best regards|Kind regards|Respectfully|Yours truly|Yours faithfully)[ \t]*,?[ \t]*\n[ \t]*((?:[A-Z][a-z'’-]+|[A-Z]\.)(?:[ \t]+(?:[A-Z][a-z'’-]+|[A-Z]\.)){1,3})[ \t]*(?=\n|$)/g,
    group: 1,
    accept: (m) => !STOP_NAMES.has(m.split(/\s+/)[0]) && !/\b(Unit|Department|Team|Office|Services|Group)\b/.test(m),
  },
];

const STOP_NAMES = new Set([
  "Sir", "Madam", "Customer", "Tenant", "Resident", "Occupant", "Member", "Patient", "Applicant", "Whom",
  "The", "This", "Your", "All", "Valued", "Account", "Services", "Department", "Claims", "Appeals",
]);

/** Deterministic, always-on PII detection. Never depends on any model being available. */
export function findByRules(text: string): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const raw = (rule.group ? m[rule.group] : m[0]) ?? "";
      const val = raw.trim().replace(/[.,;:]+$/, "");
      if (!val || val.length < 3) continue;
      if (rule.accept && !rule.accept(val)) continue;
      const key = val.toLowerCase();
      if (seen.has(key)) continue;
      // skip if fully contained in an already-found entity (e.g. postcode inside an address)
      if (out.some((e) => e.text.includes(val))) continue;
      seen.add(key);
      out.push({ text: val, type: rule.type, by: "rules" });
    }
  }
  return out;
}

/** Also withhold each part of a multi-word person name (e.g. "Ms. Lopez" later in the letter). */
export function expandNames(entities: Entity[]): Entity[] {
  const out = [...entities];
  const have = new Set(entities.map((e) => e.text.toLowerCase()));
  for (const e of entities) {
    if (e.type !== "PERSON") continue;
    const parts = e.text.split(/\s+/).filter((p) => p.length > 2 && !p.endsWith("."));
    if (parts.length < 2) continue;
    // surname (last part) is the one most often repeated alone
    const last = parts[parts.length - 1];
    if (!have.has(last.toLowerCase())) {
      have.add(last.toLowerCase());
      out.push({ text: last, type: "PERSON", by: e.by });
    }
  }
  return out;
}

/** Merge entity lists, de-duplicating by text; earlier lists win on type. */
export function mergeEntities(...lists: Entity[][]): Entity[] {
  const map = new Map<string, Entity>();
  for (const list of lists) {
    for (const e of list) {
      const t = e.text.trim();
      if (t.length < 2) continue;
      const k = t.toLowerCase();
      if (!map.has(k)) map.set(k, { ...e, text: t });
    }
  }
  return [...map.values()];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenFor(vault: Vault, e: Entity): string {
  const key = e.text.toLowerCase();
  const existing = vault.byValue.get(key);
  if (existing) return existing;
  const n = (vault.counters[e.type] ?? 0) + 1;
  vault.counters[e.type] = n;
  const token = `[[${e.type}_${n}]]`;
  vault.byValue.set(key, token);
  vault.byToken.set(token, e.text);
  return token;
}

/**
 * Replace every occurrence of every entity with a stable token.
 * Longest entities first so "Maria Lopez" is replaced before "Lopez".
 */
export function redact(text: string, entities: Entity[], vault: Vault = newVault()): { redacted: Redacted; vault: Vault } {
  const sorted = [...entities].sort((a, b) => b.text.length - a.text.length);
  let out = text;
  for (const e of sorted) {
    const token = tokenFor(vault, e);
    const boundaryL = /^\w/.test(e.text) ? "\\b" : "";
    const boundaryR = /\w$/.test(e.text) ? "\\b" : "";
    const re = new RegExp(`${boundaryL}${escapeRe(e.text)}${boundaryR}`, "gi");
    // never touch text that is already inside a token
    out = out
      .split(/(\[\[[A-Z_]+_\d+\]\])/)
      .map((seg) => (/^\[\[[A-Z_]+_\d+\]\]$/.test(seg) ? seg : seg.replace(re, token)))
      .join("");
  }
  return { redacted: out as Redacted, vault };
}

/** Put the real values back. Runs locally; unknown tokens are left visible. */
export function rehydrate(text: string, vault: Vault): string {
  return text.replace(TOKEN_RE, (tok) => vault.byToken.get(tok) ?? tok);
}

/** Final safety check before anything leaves the device: no known original value may remain. */
export function leakCheck(payload: string, vault: Vault): string[] {
  const lower = payload.toLowerCase();
  const leaks: string[] = [];
  for (const original of vault.byToken.values()) {
    if (original.length >= 3 && lower.includes(original.toLowerCase())) leaks.push(original);
  }
  // rules are re-run on the outbound payload as a second net
  for (const e of findByRules(payload.replace(TOKEN_RE, ""))) {
    if (e.type === "EMAIL" || e.type === "CARD" || e.type === "ID_NUMBER" || e.type === "PHONE") leaks.push(e.text);
  }
  return [...new Set(leaks)];
}

/** Split text into chunks that fit Gemini Nano's 9,216-token window with room for prompt + output. */
export function chunk(text: string, maxChars = 6000): string[] {
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > maxChars && cur) {
      chunks.push(cur);
      cur = "";
    }
    if (p.length > maxChars) {
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Validate and clean an entity list returned by the on-device model. */
export function sanitizeModelEntities(raw: unknown, sourceText: string): Entity[] {
  const list = (raw as { entities?: unknown })?.entities;
  if (!Array.isArray(list)) return [];
  const out: Entity[] = [];
  for (const item of list) {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    const type = ENTITY_TYPES.includes(item?.type) ? (item.type as EntityType) : "OTHER";
    // Only accept spans that literally occur in the letter: the model may not invent text.
    if (text.length >= 2 && sourceText.toLowerCase().includes(text.toLowerCase())) {
      out.push({ text, type, by: "on_device" });
    }
  }
  return out;
}
