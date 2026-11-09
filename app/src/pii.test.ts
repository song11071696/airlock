import { describe, expect, it } from "vitest";
import {
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
    expect(redacted).toBe("Dear [[PERSON_1]]. Ms. [[PERSON_2]] must pay. [[PERSON_1]] agrees.");
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
