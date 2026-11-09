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

/** Whose detail this is: the organisation/person who WROTE the letter, or the person it is addressed TO (the user). */
export type Role = "sender" | "recipient";

export interface Entity {
  text: string;
  type: EntityType;
  by: Finder;
  /** set when this entity was derived from another one (e.g. a surname from a full name) */
  parent?: string;
  /** set by assignRoles(); becomes part of the token name ([[SENDER_PHONE_1]], [[RECIPIENT_PERSON_1]]) */
  role?: Role;
}

/** Text that has passed through the airlock. Only this type may be sent to a cloud-capable model. */
export type Redacted = string & { readonly __brand: "Redacted" };

export interface Vault {
  /** token -> original value */
  byToken: Map<string, string>;
  /** original value (normalised) -> token */
  byValue: Map<string, string>;
  /** per token kind, e.g. "PHONE", "SENDER_PHONE", "RECIPIENT_PERSON" */
  counters: Record<string, number>;
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
      out.push({ text: last, type: "PERSON", by: e.by, parent: e.text });
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
  const kind = (e.role ? e.role.toUpperCase() + "_" : "") + e.type;
  const n = (vault.counters[kind] ?? 0) + 1;
  vault.counters[kind] = n;
  const token = `[[${kind}_${n}]]`;
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

// ---------- on-device (Gemini Nano) span post-filter ----------

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
/** A span that is nothing but a calendar date ("November 6", "6 Nov 2026", "04/12/1986", "2026-11-06"). */
const DATE_ONLY_RE = new RegExp(
  `^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\\s+)?(?:(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{2,4})?` +
    `|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\.?(?:,?\\s+\\d{2,4})?` +
    `|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{1,2}-\\d{1,2}|(?:${MONTHS})\\.?\\s+\\d{4})$`,
  "i",
);
const BIRTH_CTX_RE = /\b(?:birth|birthday|born|DOB|D\.O\.B)\b|\bdate\s+of\s+b/i;

export function isDateOnly(s: string): boolean {
  return DATE_ONLY_RE.test(s.trim());
}

function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  const h = text.toLowerCase();
  const n = needle.toLowerCase();
  for (let i = h.indexOf(n); i !== -1; i = h.indexOf(n, i + 1)) out.push(i);
  return out;
}

/** True when some occurrence of `span` sits right after birth/DOB wording on the same line. */
export function hasBirthContext(text: string, span: string): boolean {
  if (BIRTH_CTX_RE.test(span)) return true;
  return occurrences(text, span).some((i) => {
    const lineStart = text.lastIndexOf("\n", i - 1) + 1;
    const before = text.slice(Math.max(lineStart, i - 48), i);
    return BIRTH_CTX_RE.test(before);
  });
}

const ID_LABEL_RE =
  /^(?:(?:account|acct|case|claim|policy|member|reference|ref|file|docket|loan|invoice|patient|tenant|customer|receipt)\.?\s*){1,3}(?:no\.?|number|num|id)?\s*(?=[A-Z0-9]*\d)/i;

/**
 * Strip a field label the model copied along with the value:
 * "Tenant Account No: 88-1234-77" -> "88-1234-77", "Tenant: John Smith" -> "John Smith".
 */
export function trimLabel(span: string): string {
  const s = span.trim();
  const m = /^([A-Za-z][A-Za-z .'’/&()-]{0,40}?)\s*(?:#\s*:?|:)\s*(\S[\s\S]*)$/.exec(s);
  if (m && !/\d/.test(m[1])) return m[2].trim();
  const m2 = ID_LABEL_RE.exec(s);
  if (m2 && m2[0].length < s.length) return s.slice(m2[0].length).trim();
  return s;
}

/**
 * Clean Gemini Nano's spans before they are withheld:
 *  - trim copied labels so the token covers only the value (and lines up with the rules span);
 *  - drop plain dates unless the letter says it is a birth date: deadlines and service dates must reach the analyst;
 *  - drop spans a rules entity already covers, so one value gets one token.
 */
export function postFilterModelEntities(model: Entity[], rules: Entity[], source: string): Entity[] {
  const out: Entity[] = [];
  for (const e of model) {
    let text = trimLabel(e.text).replace(/[.,;:]+$/, "").trim();
    let type = e.type;
    if (text.length < 2) continue;
    if (type === "DOB" || isDateOnly(text)) {
      if (!hasBirthContext(source, text)) continue;
      type = "DOB";
    }
    const lower = text.toLowerCase();
    if (rules.some((r) => r.text.toLowerCase().includes(lower))) continue;
    out.push({ ...e, text, type });
  }
  return out;
}

// ---------- sender / recipient roles ----------

const RECIPIENT_NAME_RE =
  /\b(?:(?:Dear|To|Attn)\.?[:,]?|(?:Tenants?|Patient|Member|Insured|Debtor|Applicant|Beneficiary|Name|Resident|Client)[ \t]*:)[ \t]+(?:(?:Mr|Mrs|Ms|Mx|Dr)\.?[ \t]+)?((?:[A-Z][a-z'’-]+|[A-Z]\.)(?:[ \t]+(?:[A-Z][a-z'’-]+|[A-Z]\.)){0,3})/g;
const SIGN_OFF_RE =
  /\b(?:Signed|Sincerely|Regards|Best regards|Kind regards|Respectfully|Yours truly|Yours faithfully|Yours sincerely)[ \t]*,?[ \t]*(?=\n)/gi;
/** Wording that introduces the WRITER's own contact details. */
const SENDER_CTX_RE =
  /\b(?:call(?:ing)?|phone us|contact (?:us|our)|reach (?:us|our)|write (?:to )?us|write to|email us|us at|our (?:office|address|team)|deliver(?:ed)? to|mail (?:\w+ )?to|send (?:\w+ )?to|remit|member services|customer service|visit us|office hours)\b/i;

interface Span { start: number; end: number }

function lineBlock(text: string, at: number): Span {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const blank = text.indexOf("\n\n", at);
  return { start, end: blank === -1 ? text.length : blank };
}

/**
 * Decide whose detail each entity is, without any model: the recipient (the user the letter is addressed to)
 * or the sender (who wrote it). Unknown stays unset. Existing roles are kept.
 */
export function assignRoles(text: string, entities: Entity[]): Entity[] {
  const recipientNames = new Set<string>();
  RECIPIENT_NAME_RE.lastIndex = 0;
  for (let m; (m = RECIPIENT_NAME_RE.exec(text)); ) {
    if (!STOP_NAMES.has(m[1].split(/\s+/)[0])) recipientNames.add(m[1].toLowerCase());
  }
  const recipientBlocks: Span[] = [];
  const senderBlocks: Span[] = [];
  // address block that starts on a line naming the recipient ("To: Maria Lopez" / a bare "Priya Natarajan" line)
  for (const name of recipientNames) {
    for (const i of occurrences(text, name)) {
      const ls = text.lastIndexOf("\n", i - 1) + 1;
      const le = text.indexOf("\n", i);
      const line = text.slice(ls, le === -1 ? text.length : le).trim();
      if (/^(?:To|Attn)\b/i.test(line) || line.toLowerCase() === name) recipientBlocks.push(lineBlock(text, i));
    }
  }
  SIGN_OFF_RE.lastIndex = 0;
  for (let m; (m = SIGN_OFF_RE.exec(text)); ) senderBlocks.push(lineBlock(text, m.index));
  const senderNames = new Set<string>();
  for (const b of senderBlocks) {
    const nameLine = text.slice(b.start, b.end).split("\n")[1]?.trim();
    if (nameLine) senderNames.add(nameLine.toLowerCase());
  }

  const inAny = (blocks: Span[], i: number) => blocks.some((b) => i >= b.start && i < b.end);
  const nameRole = (n: string): Role | undefined => {
    const k = n.toLowerCase();
    if ([...recipientNames].some((r) => r === k || r.split(/\s+/).includes(k) && k.length > 2)) return "recipient";
    if ([...senderNames].some((s) => s === k || s.split(/\s+/).includes(k) && k.length > 2)) return "sender";
    return undefined;
  };

  const decide = (e: Entity): Role | undefined => {
    if (e.role) return e.role;
    if (e.type === "PERSON") {
      const r = nameRole(e.parent ?? e.text);
      if (r) return r;
    }
    for (const i of occurrences(text, e.text)) {
      if (inAny(recipientBlocks, i)) return "recipient";
      if (inAny(senderBlocks, i)) return "sender";
      const lineStart = text.lastIndexOf("\n", i - 1) + 1;
      let before = text.slice(Math.max(lineStart, i - 200), i);
      const cut = Math.max(before.lastIndexOf(". "), before.lastIndexOf("? "));
      if (cut !== -1) before = before.slice(cut + 2);
      if (SENDER_CTX_RE.test(before)) return "sender";
    }
    // the user's own identifiers: account / case / member numbers, their card, their birth date
    if (e.type === "ACCOUNT" || e.type === "ID_NUMBER" || e.type === "CARD" || e.type === "DOB") return "recipient";
    return undefined;
  };
  return entities.map((e) => {
    const role = decide(e);
    return role ? { ...e, role } : { ...e };
  });
}

// ---------- reply-draft guard ----------

const OWN_CONTACT_RE =
  /\b(?:contact me|reach me|call me|text me|phone me|email me|e-mail me|write to me|reply to me|get in touch with me|I can be reached|I am reachable|my (?:phone|telephone|number|cell|mobile|email|e-mail|address|contact))\b/i;
const NOT_MINE_CONTACT_RE = /\[\[(?!RECIPIENT_)(?:SENDER_)?(PHONE|EMAIL|ADDRESS|POSTCODE)_\d+\]\]/g;
const PLACEHOLDER: Record<string, string> = { PHONE: "[your phone]", EMAIL: "[your email]", ADDRESS: "[your address]", POSTCODE: "[your address]" };

/**
 * Deterministic safety net on the model's reply draft (run on the TOKENISED text, before re-filling):
 * the reply is written by the recipient, so a sender's (or unknown) phone/email/address offered as "contact me at"
 * becomes a placeholder, and the writer's name under the sign-off becomes [your name].
 */
export function guardReplyDraft(draft: string): string {
  if (!draft) return draft;
  const sentences = draft.split(/(?<=[.!?\n])/);
  let out = sentences
    .map((s) => (OWN_CONTACT_RE.test(s) ? s.replace(NOT_MINE_CONTACT_RE, (_t, k: string) => PLACEHOLDER[k]) : s))
    .join("");
  out = out.replace(
    /(\b(?:Sincerely|Regards|Best regards|Kind regards|Respectfully|Yours truly|Yours faithfully|Yours sincerely|Thank you|Thanks)[ \t]*,?[ \t]*\n[ \t]*)\[\[SENDER_PERSON_\d+\]\]/gi,
    "$1[your name]",
  );
  return out;
}
