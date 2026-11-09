// Last-resort analysis when neither Gemini Nano nor the cloud is usable.
// Deterministic, local, honest about being limited.
import type { Analysis } from "./ai";

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, fifteen: 15, thirty: 30, sixty: 60, ninety: 90,
};

export function rulesOnlyAnalysis(text: string, opts: { cloudRefused?: boolean } = {}): Analysis {
  const deadlines: { what: string; when: string }[] = [];
  const re = /\b(?:within|in)\s+((?:\w+\s+)?\(?\d+\)?|\w+)[\s-]+(calendar\s+|business\s+)?days?\b[^.]*\./gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = m[1].match(/\d+/)?.[0] ?? WORD_NUM[m[1].toLowerCase().trim()];
    if (n === undefined) continue;
    deadlines.push({ what: m[0].trim().slice(0, 220), when: `${n} ${m[2] ? m[2].trim() + " " : ""}days` });
  }
  const amounts = [...new Set(text.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) ?? [])].map((a) => ({ label: "Amount mentioned", amount: a }));
  const first = text.split("\n").map((l) => l.trim()).find((l) => l.length > 3) ?? "Letter";
  return {
    letterType: first.slice(0, 80),
    urgency: deadlines.some((d) => parseInt(d.when) <= 7) ? "high" : deadlines.length ? "medium" : "low",
    plainSummary: opts.cloudRefused
      ? "The cloud AI declined this request and Gemini Nano is not ready on this device, so this is a basic scan: the deadlines and amounts below were found by simple text rules. " +
        "Turn on Gemini Nano in Chrome for a full explanation that never leaves this device."
      : "No AI model is available right now, so this is a basic scan: the deadlines and amounts below were found by simple text rules. " +
        "Enable Gemini Nano or connect to the internet for a full explanation.",
    deadlines,
    amounts,
    nextSteps: deadlines.length ? ["Note the earliest deadline above in your calendar today."] : [],
    rightsAndOptions: [],
    questionsToAsk: [],
    replyDraft: "",
    caveat: "Basic scan only. Not legal advice.",
  };
}
