import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Firebase layer: we test routing, privacy and fallback logic, not Google's SDK.
const calls: { fn: string; payload: string }[] = [];
let cloudFails: boolean | "refused" = false;
let deviceEntities: unknown = { entities: [] };
let analyseValue: unknown = null; // overrides the default mocked cloud answer when set

vi.mock("./ai", () => ({
  CloudRefusedError: class CloudRefusedError extends Error {
    constructor(public problem: { kind: string; short: string; message: string; raw: string }) {
      super(problem.message);
    }
  },
  getCloudProblem: () => null,
  findEntitiesOnDevice: vi.fn(async (raw: string) => {
    calls.push({ fn: "findEntitiesOnDevice", payload: raw });
    return { value: deviceEntities, source: "on_device", ms: 5 };
  }),
  analyse: vi.fn(async (letter: string) => {
    calls.push({ fn: "analyse", payload: letter });
    if (cloudFails === "refused") {
      const { CloudRefusedError } = await import("./ai");
      throw new CloudRefusedError({ kind: "app_check", short: "Cloud: refused (App Check)", message: "Firebase refused the cloud request.", raw: "[401 ] App Check" });
    }
    if (cloudFails) throw new Error("FETCH_ERROR");
    if (analyseValue) return { value: analyseValue, source: "in_cloud", ms: 10 };
    return {
      value: {
        letterType: "Notice",
        plainSummary: "[[RECIPIENT_PERSON_1]] owes rent.",
        replyDraft: "Dear [[SENDER_PERSON_1]],\nI, [[RECIPIENT_PERSON_1]], will pay. Please contact me at [[SENDER_PHONE_1]].\nSincerely,\n[[RECIPIENT_PERSON_1]]",
      },
      source: "in_cloud",
      ms: 10,
    };
  }),
  ask: vi.fn(async (letter: string, q: string) => {
    calls.push({ fn: "ask", payload: letter + "\n" + q });
    return { value: "Yes, [[RECIPIENT_PERSON_1]] can.", source: "on_device", ms: 3 };
  }),
}));

import { build, discover, followUp, runAnalysis, type StepLog } from "./pipeline";
import { SAMPLES } from "./samples";

const eviction = SAMPLES.find((s) => s.id === "eviction")!.text;

beforeEach(() => {
  calls.length = 0;
  cloudFails = false;
  deviceEntities = { entities: [] };
  analyseValue = null;
});

describe("pipeline", () => {
  it("merges Gemini Nano findings with rules and ignores invented spans", async () => {
    deviceEntities = { entities: [{ text: "Oakridge", type: "ADDRESS" }, { text: "Not In Letter", type: "PERSON" }] };
    const log: StepLog[] = [];
    const ents = await discover(eviction, true, log);
    expect(ents.some((e) => e.text === "Oakridge" && e.by === "on_device")).toBe(true);
    expect(ents.some((e) => e.text === "Not In Letter")).toBe(false);
    expect(log.map((l) => l.source)).toEqual(["local_rules", "on_device"]);
  });

  it("never calls the device model when it is not ready", async () => {
    const log: StepLog[] = [];
    await discover(eviction, false, log);
    expect(calls.find((c) => c.fn === "findEntitiesOnDevice")).toBeUndefined();
    expect(log[1].source).toBe("skipped");
  });

  it("sends only redacted text to analyse() and re-hydrates the result locally", async () => {
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const r = await runAnalysis(p, true, log);
    const sent = calls.find((c) => c.fn === "analyse")!.payload;
    for (const secret of ["Maria Elena Lopez", "Lopez", "1427 Maple Avenue", "88-1234-77", "Daniel Okafor"]) {
      expect(sent).not.toContain(secret);
    }
    expect(r.source).toBe("in_cloud");
    expect(r.analysis.plainSummary).toContain("Maria Elena Lopez");
    expect(r.analysis.replyDraft).toContain("Daniel Okafor");
    expect(r.tokenised.plainSummary).toContain("[[RECIPIENT_PERSON_1]]");
    expect(r.bytesSent).toBeGreaterThan(0);
  });

  it("falls back to a local rules-only scan when every model fails", async () => {
    cloudFails = true;
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const r = await runAnalysis(p, false, log);
    expect(r.source).toBe("local_rules");
    expect(r.bytesSent).toBe(0);
    expect(r.analysis.deadlines?.[0]?.when).toBe("3 days");
    expect(r.analysis.amounts?.map((a) => a.amount)).toContain("$2,180.00");
  });

  it("refuses to analyse while the outbound text still contains personal data", async () => {
    const log: StepLog[] = [];
    const p = build(eviction, [], new Set(), log);
    // no entities at all -> rules second net still catches email/phone in the outbound payload
    expect(p.leaks.length).toBeGreaterThan(0);
    await expect(runAnalysis(p, true, log)).rejects.toThrow(/Blocked/);
    expect(calls.find((c) => c.fn === "analyse")).toBeUndefined();
  });

  it("redacts personal details typed into a follow-up question", async () => {
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const r = await followUp(p, "Can Maria Elena Lopez pay by email at maria.l@mail.example?", log);
    const sent = calls.find((c) => c.fn === "ask")!.payload;
    expect(sent).not.toContain("Maria Elena Lopez");
    expect(sent).not.toContain("maria.l@mail.example");
    expect(r.text).toBe("Yes, Maria Elena Lopez can.");
  });

  it("falls back to the local scan with a plain-language notice when the cloud refuses (App Check)", async () => {
    cloudFails = "refused";
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const r = await runAnalysis(p, true, log);
    expect(r.source).toBe("local_rules");
    expect(r.cloudNotice).toContain("refused");
    expect(r.bytesSent).toBe(0);
    expect(log.some((l) => l.source === "error" && l.detail?.includes("App Check"))).toBe(true);
  });

  it("Nano post-filter in discover(): service date stays visible, label bleed trimmed to one account token", async () => {
    deviceEntities = { entities: [
      { text: "Oakridge, CA 94110", type: "POSTCODE" },
      { text: "Tenant Account No: 88-1234-77", type: "ACCOUNT" },
      { text: "November 6", type: "DOB" },
    ] };
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, true, log), new Set(), log);
    expect(p.entities.some((e) => e.type === "DOB")).toBe(false);
    expect(p.redacted).toContain("Date of service: November 6");
    expect(p.redacted).toContain("Tenant Account No: [[RECIPIENT_ACCOUNT_1]]");
    expect(p.redacted).not.toContain("88-1234-77");
    expect(p.redacted).not.toContain("Oakridge, CA 94110");
    expect(p.leaks).toEqual([]);
    expect(log[1].detail).toContain("dropped");
    await runAnalysis(p, true, log);
    expect(calls.find((c) => c.fn === "analyse")!.payload).toContain("November 6");
  });

  it("reply draft never offers the landlord's phone as the tenant's own", async () => {
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const sent = calls.length;
    const r = await runAnalysis(p, true, log);
    expect(calls.length).toBe(sent + 1);
    expect(r.analysis.replyDraft).not.toContain("(415) 555-0198");
    expect(r.analysis.replyDraft).toContain("contact me at [your phone]");
    expect(r.analysis.replyDraft).toContain("Dear Daniel Okafor");
    expect(r.analysis.replyDraft).toMatch(/Sincerely,\nMaria Elena Lopez$/);
  });

  it("local scan after a cloud refusal does not tell the user to connect to the internet", async () => {
    cloudFails = "refused";
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const r = await runAnalysis(p, false, log);
    expect(r.source).toBe("local_rules");
    expect(r.analysis.plainSummary).not.toMatch(/internet/i);
    expect(r.analysis.plainSummary).toMatch(/declined/);
  });

  it("local scan with no model and no refusal still suggests Nano or going online", async () => {
    cloudFails = true;
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const r = await runAnalysis(p, false, log);
    expect(r.analysis.plainSummary).toMatch(/internet/);
  });
});

describe("SENDER_* tokens in 'What to do next' are filled back locally", () => {
  it("eviction: landlord's phone/office cited by the cloud come back as real values; reply still guarded", async () => {
    analyseValue = {
      nextSteps: [
        "Pay $2,180.00 at [[SENDER_ADDRESS_1]], Oakridge, CA [[SENDER_POSTCODE_1]] (Mon-Fri 9am-5pm) or call [[SENDER_PHONE_1]] within 3 days.",
        "Email [[SENDER_EMAIL_1]] to ask for a payment plan, quoting account [[RECIPIENT_ACCOUNT_1]].",
      ],
      questionsToAsk: ["Can I call [[SENDER_PERSON_1]] at [[SENDER_PHONE_1]] to confirm the amount?"],
      replyDraft: "Dear [[SENDER_PERSON_1]],\nI can be reached at [[SENDER_PHONE_1]].\nSincerely,\n[[SENDER_PERSON_1]]",
    };
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const r = await runAnalysis(p, true, log);
    const sent = calls.find((c) => c.fn === "analyse")!.payload;
    for (const secret of ["(415) 555-0198", "500 Harbor Blvd", "d.okafor@greenline-pm.example", "Daniel Okafor"]) expect(sent).not.toContain(secret);
    expect(r.analysis.nextSteps![0]).toContain("500 Harbor Blvd, Suite 210, Oakridge, CA 94111");
    expect(r.analysis.nextSteps![0]).toContain("call (415) 555-0198");
    expect(r.analysis.nextSteps![1]).toBe("Email d.okafor@greenline-pm.example to ask for a payment plan, quoting account 88-1234-77.");
    expect(r.analysis.questionsToAsk![0]).toBe("Can I call Daniel Okafor at (415) 555-0198 to confirm the amount?");
    // the guard still stops the landlord's phone/name being used as the tenant's own
    expect(r.analysis.replyDraft).toBe("Dear Daniel Okafor,\nI can be reached at [your phone].\nSincerely,\n[your name]");
  });

  it("guard also catches 'contact me at [[SENDER_…]]' outside the reply draft", async () => {
    analyseValue = { nextSteps: ["Tell them: please contact me at [[SENDER_PHONE_1]]."] };
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const r = await runAnalysis(p, true, log);
    expect(r.analysis.nextSteps![0]).toBe("Tell them: please contact me at [your phone].");
  });

  it("local scan offers the sender's contact (filled back locally) when no model is available", async () => {
    cloudFails = true;
    const log: StepLog[] = [];
    const p = build(eviction, await discover(eviction, false, log), new Set(), log);
    const r = await runAnalysis(p, false, log);
    expect(r.analysis.nextSteps).toContain("To contact the sender: call (415) 555-0198 · email d.okafor@greenline-pm.example · write to 500 Harbor Blvd, Suite 210.");
  });
});

const insurance = SAMPLES.find((s) => s.id === "insurance")!.text;
const debt = SAMPLES.find((s) => s.id === "debt")!.text;

describe("all three sample letters through the pipeline", () => {
  it("insurance denial: member details are RECIPIENT, appeals contact is SENDER, surname shares the person's number", async () => {
    // spans Gemini Nano typically returns, incl. label bleed and a plain service date
    deviceEntities = { entities: [
      { text: "James T. Whitaker", type: "PERSON" },
      { text: "Member ID: NBH-55302917", type: "ACCOUNT" },
      { text: "Date of birth: 04/12/1986", type: "DOB" },
      { text: "September 18", type: "DOB" },
      { text: "PO Box 4410, Lakeview, IL 60601", type: "ADDRESS" },
    ] };
    const log: StepLog[] = [];
    const p = build(insurance, await discover(insurance, true, log), new Set(), log);
    expect(p.leaks).toEqual([]);
    expect(p.redacted).toContain("Member: [[RECIPIENT_PERSON_1]]");
    expect(p.redacted).toContain("Dear Mr. [[RECIPIENT_SURNAME_1]],");
    expect(p.redacted).toContain("Member ID: [[RECIPIENT_ACCOUNT_");
    expect(p.redacted).toContain("Date of birth: [[RECIPIENT_DOB_1]]");
    expect(p.redacted).toMatch(/Claim number: \[\[RECIPIENT_ACCOUNT_\d\]\]/);
    expect(p.redacted).toContain("performed on September 18"); // service date reaches the analyst
    expect(p.redacted).toContain("within 180 days");
    expect(p.redacted).toContain("$3,450.00");
    expect(p.redacted).toContain("Riverside Imaging Center"); // organisations stay
    expect(p.redacted).toContain("call Member Services at [[SENDER_PHONE_1]]");
    expect(p.redacted).toMatch(/write to Northbridge Health Plan Appeals, \[\[SENDER_ADDRESS_1\]\]/);
    expect(p.redacted).not.toMatch(/RECIPIENT_(PHONE|EMAIL|ADDRESS)/);
    for (const secret of ["Whitaker", "NBH-55302917", "04/12/1986", "CLM-2026-0088314"]) expect(p.redacted).not.toContain(secret);

    analyseValue = {
      nextSteps: ["Send your appeal to Northbridge Health Plan Appeals, [[SENDER_ADDRESS_1]] or call [[SENDER_PHONE_1]], quoting claim [[RECIPIENT_ACCOUNT_1]]."],
      replyDraft: "Dear Appeals and Grievances Unit,\nI, [[RECIPIENT_PERSON_1]] (Member ID [[RECIPIENT_ACCOUNT_2]], DOB [[RECIPIENT_DOB_1]]), appeal the denial. Call me at [[SENDER_PHONE_1]].\nSincerely,\nMr. [[RECIPIENT_SURNAME_1]]",
    };
    const r = await runAnalysis(p, true, log);
    expect(r.analysis.nextSteps![0]).toMatch(/^Send your appeal to Northbridge Health Plan Appeals, PO Box 4410, Lakeview, IL 60601 or call 1-800-555-0142, quoting claim (CLM-2026-0088314|NBH-55302917)\.$/);
    expect(r.analysis.replyDraft).toContain("James T. Whitaker");
    expect(r.analysis.replyDraft).toContain("DOB 04/12/1986");
    expect(r.analysis.replyDraft).toContain("Call me at [your phone].");
    expect(r.analysis.replyDraft).not.toContain("1-800-555-0142");
    expect(r.analysis.replyDraft).toMatch(/Sincerely,\nMr\. Whitaker$/);
  });

  it("debt collection: collector contact is SENDER, debtor block is RECIPIENT, card number masked in everything the model wrote", async () => {
    deviceEntities = { entities: [
      { text: "Priya Natarajan", type: "PERSON" },
      { text: "22 Willow Court\nDover, DE 19904", type: "ADDRESS" },
      { text: "Card ending: 4111 1111 1111 1111", type: "CARD" },
      { text: "Ref: SRP-7781-2290", type: "ACCOUNT" },
    ] };
    const log: StepLog[] = [];
    const p = build(debt, await discover(debt, true, log), new Set(), log);
    expect(p.leaks).toEqual([]);
    expect(p.redacted).toContain("Ref: [[RECIPIENT_ACCOUNT_1]]");
    expect(p.redacted).toContain("Card ending: [[RECIPIENT_CARD_1]]");
    expect(p.redacted).toContain("Dear [[RECIPIENT_PERSON_1]],");
    expect(p.redacted).toContain("reach us at [[SENDER_PHONE_1]] or [[SENDER_EMAIL_1]]");
    expect(p.redacted).toMatch(/Mail payments to \[\[SENDER_ADDRESS_1\]\]/);
    expect(p.redacted).toContain("Coastline Bank Card Services");
    expect(p.redacted).toContain("$1,912.47");
    expect(p.redacted).toContain("within thirty days");
    expect(p.redacted).not.toMatch(/SENDER_PERSON/); // nobody signed it; the debtor block is not a signature
    for (const secret of ["Priya", "Natarajan", "Willow", "19904", "4111 1111", "SRP-7781-2290"]) expect(p.redacted).not.toContain(secret);

    analyseValue = {
      nextSteps: ["Within 30 days, send a written dispute to [[SENDER_ADDRESS_1]] quoting [[RECIPIENT_ACCOUNT_1]] (card [[RECIPIENT_CARD_1]])."],
      replyDraft: "Summit Recovery Partners LLC\n[[SENDER_ADDRESS_1]]\n\nRe: [[RECIPIENT_ACCOUNT_1]], card [[RECIPIENT_CARD_1]]\n\nI dispute this debt and request validation. Please contact me at [[SENDER_EMAIL_1]].\n\nSincerely,\n[[RECIPIENT_PERSON_1]]\n[[RECIPIENT_ADDRESS_1]]",
    };
    const r = await runAnalysis(p, true, log);
    expect(r.analysis.nextSteps![0]).toContain("send a written dispute to 77 Commerce Way");
    expect(r.analysis.nextSteps![0]).toContain("SRP-7781-2290 (card •••• 1111)");
    expect(r.analysis.replyDraft).not.toContain("4111 1111 1111 1111");
    expect(r.analysis.replyDraft).toContain("card •••• 1111");
    expect(r.analysis.replyDraft).toContain("contact me at [your email]");
    expect(r.analysis.replyDraft).toMatch(/Sincerely,\nPriya Natarajan\n22 Willow Court/);
  });

  it("every sample: no leaks, organisations/amounts survive, and re-hydration of the outbound text is exact", async () => {
    for (const s of SAMPLES) {
      const log: StepLog[] = [];
      const p = build(s.text, await discover(s.text, false, log), new Set(), log);
      expect([s.id, p.leaks]).toEqual([s.id, []]);
      for (const amt of s.text.match(/\$[\d,]+\.\d{2}/g) ?? []) expect(p.redacted).toContain(amt);
      const { rehydrate } = await import("./pii");
      expect(rehydrate(p.redacted, p.vault)).toBe(s.text);
    }
  });
});
