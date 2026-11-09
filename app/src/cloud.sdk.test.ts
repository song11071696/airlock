// @vitest-environment jsdom
// REAL Firebase SDK with cloud configured and App Check off; the (mocked) Firebase AI Logic endpoint rejects the
// call the way an App Check-enforced API does. Separate file so the Firebase app registry starts clean.
import { afterAll, describe, expect, it, vi } from "vitest";

describe("real SDK, cloud configured, API rejects un-attested call", () => {
  const fetchSpy = vi.fn(async () =>
    new Response(
      JSON.stringify({ error: { code: 401, message: "Firebase App Check token is invalid.", status: "UNAUTHENTICATED" } }),
      { status: 401, headers: { "content-type": "application/json" } },
    ),
  );
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("throws CloudRefusedError(app_check), stops using the cloud, sends only redacted text", async () => {
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("VITE_FIREBASE_API_KEY", "AIzaTestKeyNotReal");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "airlock-test");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "1:1:web:1");
    vi.stubEnv("VITE_APPCHECK", "off");
    const ai = await import("./ai");
    expect(ai.cloudConfigured).toBe(true);
    expect(ai.appCheckMode).toBe("off");
    expect(ai.cloudReachable()).toBe(true);

    const redacted = "Dear [[PERSON_1]], you owe $100 by [[DATE_1]]." as never;
    const err = await ai.analyse(redacted).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ai.CloudRefusedError);
    expect((err as InstanceType<typeof ai.CloudRefusedError>).problem.kind).toBe("app_check");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain("[[PERSON_1]]");
    // App Check is off: no attestation header was attached
    const headers = new Headers((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.has("X-Firebase-AppCheck")).toBe(false);

    expect(ai.getCloudProblem()?.kind).toBe("app_check");
    expect(ai.getCloudProblem()?.raw).toMatch(/^\[401 \] Firebase App Check token is invalid/);
    // follow-up with cloud refused and no Nano: plain-language refusal, no second request
    const err2 = await ai.ask(redacted, "When?" as never).then(() => null, (e: unknown) => e);
    expect(err2).toBeInstanceOf(ai.CloudRefusedError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(ai.cloudReachable()).toBe(false);
    ai.resetCloudProblem();
    expect(ai.cloudReachable()).toBe(true);
  });
});
