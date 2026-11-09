import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Firebase layer: we test routing, privacy and fallback logic, not Google's SDK.
const calls: { fn: string; payload: string }[] = [];
let cloudFails: boolean | "refused" = false;
let deviceEntities: unknown = { entities: [] };

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
