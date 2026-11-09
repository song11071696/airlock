import { describe, expect, it } from "vitest";
import { newVault, normaliseTokens, rehydrate } from "./pii";
import { tidyBrackets } from "./pipeline";

describe("model output repair", () => {
  it("repairs mangled token brackets", () => {
    expect(normaliseTokens("Dear [[SENDER_PERSON_1],")).toBe("Dear [[SENDER_PERSON_1]],");
    expect(normaliseTokens("call [SENDER_PHONE_1]]")).toBe("call [[SENDER_PHONE_1]]");
    expect(normaliseTokens("[your phone]")).toBe("[your phone]");
  });
  it("fills back a mangled token", () => {
    const v = newVault();
    v.byToken.set("[[SENDER_PERSON_1]]", "Daniel Okafor");
    expect(rehydrate("Dear [[SENDER_PERSON_1],", v)).toBe("Dear Daniel Okafor,");
  });
  it("drops unmatched wrapping brackets", () => {
    expect(tidyBrackets("[Call (415) 555-0198 before the deadline")).toBe("Call (415) 555-0198 before the deadline");
    expect(tidyBrackets("[You may have rights. Contact legal aid.]")).toBe("You may have rights. Contact legal aid.");
    expect(tidyBrackets("[your phone] is best")).toBe("[your phone] is best");
    expect(tidyBrackets("Reach me at [your phone].")).toBe("Reach me at [your phone].");
  });
});
