import { describe, expect, it } from "vitest";
import {
  assignRoles, guardReplyDraft, hasBirthContext, isDateOnly, postFilterModelEntities, trimLabel, type Entity,
  chunk, expandNames, findByRules, leakCheck, mergeEntities, newVault, redact, rehydrate, sanitizeModelEntities,
} from "./pii";
import { SAMPLES } from "./samples";

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.text;

function airlock(text: string) {
  const ents = expandNames(findByRules(text));
  const { redacted, vault } = redact(text, ents);
  return { ents, redacted, vault, leaks: leakCheck(redacted, vault) };
}

describe("rules engine", () => {
  it("finds the identity details in the eviction notice", () => {
    const { redacted, leaks } = airlock(sample("eviction"));
    for (const secret of ["Maria Elena Lopez", "1427 Maple Avenue", "88-1234-77", "(415) 555-0198", "d.okafor@greenline-pm.example", "Daniel Okafor"]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain("$2,180.00"); // amounts must survive: the cloud needs them
    expect(redacted).toContain("THREE (3) days");
    expect(redacted).toContain("Greenline Property Management"); // organisations are not personal data
    expect(leaks).toEqual([]);
  });

  it("finds the identity details in the insurance denial", () => {
    const { redacted, leaks } = airlock(sample("insurance"));
    for (const secret of ["James T. Whitaker", "NBH-55302917", "04/12/1986", "CLM-2026-0088314", "Whitaker"]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain("180 days");
    expect(leaks).toEqual([]);
  });

  it("finds the identity details in the debt letter, incl. a Luhn-valid card", () => {
    const { redacted, leaks, ents } = airlock(sample("debt"));
    expect(ents.some((e) => e.type === "CARD")).toBe(true);
    for (const secret of ["Priya Natarajan", "4111 1111 1111 1111", "SRP-7781-2290", "collections@summit-recovery.example", "22 Willow Court"]) {
      expect(redacted).not.toContain(secret);
    }
    expect(leaks).toEqual([]);
  });

  it("does not flag random 16-digit numbers that fail Luhn as cards", () => {
    expect(findByRules("Order 1234 5678 9012 3456 shipped").some((e) => e.type === "CARD")).toBe(false);
  });
});

describe("tokenise / rehydrate", () => {
  it("round-trips exactly", () => {
    const text = sample("eviction");
    const { redacted, vault } = airlock(text);
    expect(rehydrate(redacted, vault)).toBe(text.replace(/Lopez/g, "Lopez")); // same text back
  });

  it("uses one stable token per value, longest first", () => {
    const ents = expandNames([{ text: "Maria Lopez", type: "PERSON" as const, by: "user" as const }]);
    const { redacted } = redact("Dear Maria Lopez. Ms. Lopez must pay. Maria Lopez agrees.", ents);
    expect(redacted).toBe("Dear [[PERSON_1]]. Ms. [[SURNAME_1]] must pay. [[PERSON_1]] agrees.");
  });

  it("rehydrates tokens inside model output and leaves unknown tokens visible", () => {
    const v = newVault();
    redact("Hi Ana Silva", [{ text: "Ana Silva", type: "PERSON", by: "user" }], v);
    expect(rehydrate("Dear [[PERSON_1]], see [[PERSON_9]].", v)).toBe("Dear Ana Silva, see [[PERSON_9]].");
  });

  it("leakCheck catches a value that slipped through", () => {
    const v = newVault();
    redact("Ana Silva", [{ text: "Ana Silva", type: "PERSON", by: "user" }], v);
    expect(leakCheck("payload mentions ana silva", v)).toEqual(["Ana Silva"]);
    expect(leakCheck("mail me at a@b.co", v)).toContain("a@b.co");
  });
});

describe("model output hygiene", () => {
  it("only accepts entities that literally occur in the letter", () => {
    const src = "Dear Ana Silva, your file is 77-AB.";
    const got = sanitizeModelEntities(
      { entities: [{ text: "Ana Silva", type: "PERSON" }, { text: "Invented Name", type: "PERSON" }, { text: "77-AB", type: "WEIRD" }] },
      src,
    );
    expect(got.map((e) => e.text)).toEqual(["Ana Silva", "77-AB"]);
    expect(got[1].type).toBe("OTHER");
  });

  it("merge de-duplicates case-insensitively", () => {
    const m = mergeEntities(
      [{ text: "Ana", type: "PERSON", by: "rules" }],
      [{ text: "ana", type: "OTHER", by: "on_device" }, { text: "Bo Li", type: "PERSON", by: "on_device" }],
    );
    expect(m.length).toBe(2);
  });

  it("chunks long text under the limit", () => {
    const long = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ` + "x".repeat(400)).join("\n\n");
    const parts = chunk(long, 6000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 6000)).toBe(true);
  });
});

const nano = (text: string, type: Entity["type"]): Entity => ({ text, type, by: "on_device" });

describe("Gemini Nano post-filter: dates", () => {
  const ev = sample("eviction");
  const ins = sample("insurance");

  it("recognises date-only spans", () => {
    for (const d of ["November 6", "Nov. 6, 2026", "6 November 2026", "04/12/1986", "2026-11-06", "Friday, November 6"]) expect(isDateOnly(d)).toBe(true);
    for (const d of ["88-1234-77", "Maria Lopez", "November rent of $2,180"]) expect(isDateOnly(d)).toBe(false);
  });

  it("drops a service/deadline date that Nano tagged as DOB", () => {
    const out = postFilterModelEntities([nano("November 6", "DOB")], findByRules(ev), ev);
    expect(out).toEqual([]);
    expect(hasBirthContext(ev, "November 6")).toBe(false);
  });

  it("drops plain dates under any type, keeps them visible to the analyst", () => {
    const text = "Your appeal is due by December 1, 2026. Payment due 11/30/2026.";
    const out = postFilterModelEntities([nano("December 1, 2026", "OTHER"), nano("11/30/2026", "ID_NUMBER")], findByRules(text), text);
    expect(out).toEqual([]);
    const { redacted } = redact(text, expandNames(mergeEntities(findByRules(text), out)));
    expect(redacted).toContain("December 1, 2026");
    expect(redacted).toContain("11/30/2026");
  });

  it("keeps a date only when the letter says it is a birth date", () => {
    const text = "Patient: Ana Silva\nBorn: March 3, 1980\nVisit date: March 9, 2026";
    const out = postFilterModelEntities([nano("March 3, 1980", "OTHER"), nano("March 9, 2026", "DOB")], [], text);
    expect(out).toEqual([{ text: "March 3, 1980", type: "DOB", by: "on_device" }]);
  });

  it("drops a Nano DOB span already covered by the rules (one value, one token)", () => {
    expect(postFilterModelEntities([nano("04/12/1986", "DOB")], findByRules(ins), ins)).toEqual([]);
  });
});

describe("Gemini Nano post-filter: label bleed", () => {
  const ev = sample("eviction");

  it("trims labels the model copied with the value", () => {
    expect(trimLabel("Tenant Account No: 88-1234-77")).toBe("88-1234-77");
    expect(trimLabel("Case #: 24-LT-00981")).toBe("24-LT-00981");
    expect(trimLabel("Policy Number ABC123456")).toBe("ABC123456");
    expect(trimLabel("Tenant: John A. Smith")).toBe("John A. Smith");
    expect(trimLabel("1427 Maple Avenue, Apt 3B")).toBe("1427 Maple Avenue, Apt 3B");
    expect(trimLabel("(415) 555-0198")).toBe("(415) 555-0198");
  });

  it("merges the trimmed Nano account span with the rules span: one token, label stays visible", () => {
    const rules = findByRules(ev);
    const model = postFilterModelEntities([nano("Tenant Account No: 88-1234-77", "ACCOUNT")], rules, ev);
    expect(model).toEqual([]); // rules already have 88-1234-77
    const { redacted, vault } = redact(ev, assignRoles(ev, expandNames(mergeEntities(rules, model))));
    expect(redacted).toContain("Tenant Account No: [[RECIPIENT_ACCOUNT_1]]");
    expect([...vault.byToken.values()].filter((v) => v.includes("88-1234-77"))).toEqual(["88-1234-77"]);
  });

  it("keeps a trimmed Nano value the rules missed, without its label", () => {
    const text = "Housing Ref Code: QX/7731\nDear tenant,";
    const out = postFilterModelEntities([nano("Housing Ref Code: QX/7731", "ACCOUNT")], [], text);
    expect(out.map((e) => e.text)).toEqual(["QX/7731"]);
  });
});

describe("role-aware tokens", () => {
  const roleOf = (ents: Entity[], text: string) => ents.find((e) => e.text === text)?.role;

  it("splits the eviction notice into recipient (tenant) and sender (landlord) details", () => {
    const ev = sample("eviction");
    const ents = assignRoles(ev, expandNames(findByRules(ev)));
    for (const t of ["Maria Elena Lopez", "Lopez", "1427 Maple Avenue, Apt 3B", "94110", "88-1234-77"]) expect([t, roleOf(ents, t)]).toEqual([t, "recipient"]);
    for (const t of ["Daniel Okafor", "Okafor", "(415) 555-0198", "d.okafor@greenline-pm.example", "500 Harbor Blvd, Suite 210", "94111"]) expect([t, roleOf(ents, t)]).toEqual([t, "sender"]);
    const { redacted } = redact(ev, ents);
    expect(redacted).toContain("Dear [[RECIPIENT_PERSON_1]]");
    expect(redacted).toContain("calling [[SENDER_PHONE_1]]");
    expect(redacted).toContain("[[SENDER_EMAIL_1]]");
    expect(redacted).not.toMatch(/RECIPIENT_(PHONE|EMAIL)/);
  });

  it("debt letter: collector contact is sender, the tear-off address block is recipient", () => {
    const d = sample("debt");
    const ents = assignRoles(d, expandNames(findByRules(d)));
    expect(roleOf(ents, "1-888-555-0177")).toBe("sender");
    expect(roleOf(ents, "collections@summit-recovery.example")).toBe("sender");
    expect(roleOf(ents, "77 Commerce Way")).toBe("sender");
    expect(roleOf(ents, "22 Willow Court")).toBe("recipient");
    expect(roleOf(ents, "Priya Natarajan")).toBe("recipient");
  });

  it("insurance denial: member is recipient, Member Services phone is sender", () => {
    const i = sample("insurance");
    const ents = assignRoles(i, expandNames(findByRules(i)));
    expect(roleOf(ents, "James T. Whitaker")).toBe("recipient");
    expect(roleOf(ents, "1-800-555-0142")).toBe("sender");
  });

  it("role tokens still round-trip and pass the leak check", () => {
    for (const s of SAMPLES) {
      const ents = assignRoles(s.text, expandNames(findByRules(s.text)));
      const { redacted, vault } = redact(s.text, ents);
      expect(leakCheck(redacted, vault)).toEqual([]);
      expect(rehydrate(redacted, vault)).toBe(s.text);
      // token names carry roles only, never values
      for (const tok of vault.byToken.keys()) expect(tok).toMatch(/^\[\[(?:(?:SENDER|RECIPIENT)_)?[A-Z_]+_\d+\]\]$/);
    }
  });

  it("reply guard: sender contact offered as the user's own becomes a placeholder", () => {
    const draft =
      "Dear [[SENDER_PERSON_1]],\n\nI received your notice about account [[RECIPIENT_ACCOUNT_1]]. " +
      "Please contact me at [[SENDER_PHONE_1]] or via email at [[SENDER_EMAIL_1]]. You can reach your office at [[SENDER_PHONE_1]].\n\n" +
      "Sincerely,\n[[SENDER_PERSON_1]]";
    const g = guardReplyDraft(draft);
    expect(g).toContain("Please contact me at [your phone] or via email at [your email].");
    expect(g).toContain("Dear [[SENDER_PERSON_1]]"); // addressing the sender is fine
    expect(g).toContain("You can reach your office at [[SENDER_PHONE_1]]."); // not offered as own
    expect(g).toMatch(/Sincerely,\n\[your name\]$/);
  });

  it("reply guard keeps the recipient's own contact tokens", () => {
    const draft = "You can reach me at [[RECIPIENT_PHONE_1]] or my email [[RECIPIENT_EMAIL_1]].\nSincerely,\n[[RECIPIENT_PERSON_1]]";
    expect(guardReplyDraft(draft)).toBe(draft);
  });
});
