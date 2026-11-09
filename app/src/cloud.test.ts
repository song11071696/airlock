// @vitest-environment jsdom
// App Check mode parsing and cloud error classification (pure).
import { describe, expect, it } from "vitest";

describe("App Check mode + cloud error classification", () => {
  it("parses VITE_APPCHECK, defaulting to off", async () => {
    const { parseAppCheckMode } = await import("./ai");
    expect(parseAppCheckMode(undefined)).toBe("off");
    expect(parseAppCheckMode("")).toBe("off");
    expect(parseAppCheckMode("nonsense")).toBe("off");
    expect(parseAppCheckMode("DEBUG")).toBe("debug");
    expect(parseAppCheckMode("recaptcha-v3")).toBe("recaptcha-v3");
  });

  it("classifies typical refusals", async () => {
    const { classifyCloudError } = await import("./ai");
    expect(classifyCloudError(new Error("Error fetching from https://x: [401 ] Firebase App Check token is invalid.")).kind).toBe("app_check");
    expect(classifyCloudError(new Error("[403 ] Requests from referer https://a are blocked.")).kind).toBe("auth");
    expect(classifyCloudError(new Error("[429 ] Resource has been exhausted (e.g. check quota).")).kind).toBe("quota");
    expect(classifyCloudError(new Error("[404 ] models/foo is not found for API version v1beta")).kind).toBe("model");
    expect(classifyCloudError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(classifyCloudError("weird").kind).toBe("other");
  });
});

