// @vitest-environment jsdom
// Documents an SDK behaviour Airlock defends against (firebase@13.2.0):
// without a `LanguageModel` global, a model created with ONLY_ON_DEVICE still sends the request to the cloud.
import { describe, expect, it, vi } from "vitest";
import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";

describe("firebase/ai ONLY_ON_DEVICE without Chrome's LanguageModel", () => {
  it("SDK: request goes to the network (contrary to the docs' 'throw an exception')", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError("network disabled in test")));
    vi.stubGlobal("fetch", fetchSpy);
    const app = initializeApp({ apiKey: "k", projectId: "p", appId: "a" }, "sdk-behaviour");
    const model = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), { mode: InferenceMode.ONLY_ON_DEVICE });
    await expect(model.generateContent("secret raw text")).rejects.toBeTruthy();
    expect(fetchSpy).toHaveBeenCalled();
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain("googleapis.com");
    vi.unstubAllGlobals();
  });

  it("Airlock: on-device steps refuse locally instead", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError("network disabled in test")));
    vi.stubGlobal("fetch", fetchSpy);
    const { findEntitiesOnDevice, transcribeImage } = await import("./ai");
    await expect(findEntitiesOnDevice("Dear Ana Silva")).rejects.toThrow(/refusing/);
    await expect(transcribeImage("AAAA", "image/png")).rejects.toThrow(/refusing/);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
