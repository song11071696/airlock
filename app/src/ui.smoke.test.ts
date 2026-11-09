// @vitest-environment jsdom
// End-to-end UI smoke test with the REAL Firebase SDK initialised and no .env:
// no Gemini Nano (jsdom has no LanguageModel), no cloud config -> app must still work in LOCAL RULES mode
// and must never issue a network request.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled in test")));
vi.stubGlobal("fetch", fetchSpy);
if (!("scrollIntoView" in Element.prototype)) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
} else {
  Element.prototype.scrollIntoView = () => {};
}

const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
document.body.innerHTML = html.split("<body>")[1].split("<script")[0];

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("Airlock UI (no model, no cloud)", () => {
  it("runs the full flow in local-rules mode with a visible mode indicator", async () => {
    await import("./main");
    await tick();

    expect(document.getElementById("pill-device")!.textContent).toContain("not supported");
    expect(document.getElementById("pill-cloud")!.textContent).toContain("not configured");

    // load a sample
    const sampleBtn = [...document.querySelectorAll("#samples button")][0] as HTMLButtonElement;
    sampleBtn.click();
    expect((document.getElementById("letter") as HTMLTextAreaElement).value).toContain("NOTICE TO PAY RENT");

    // airlock
    (document.getElementById("btn-airlock") as HTMLButtonElement).click();
    await tick();
    expect(document.getElementById("step-review")!.hidden).toBe(false);
    const outbound = document.getElementById("outbound")!.textContent!;
    expect(outbound).not.toContain("Maria Elena Lopez");
    expect(outbound).toContain("[[RECIPIENT_PERSON_1]]");
    expect(outbound).toContain("[[SENDER_PHONE_1]]");
    expect(document.getElementById("leak")!.textContent).toContain("Leak check passed");
    expect(document.getElementById("route")!.textContent).toContain("LOCAL RULES");

    // release a detail -> outbound changes; withhold again -> back
    const chip = document.querySelector('#entities .chip[data-text="Daniel Okafor"]') as HTMLButtonElement;
    chip.click();
    expect(document.getElementById("outbound")!.textContent).toContain("Daniel Okafor");
    (document.querySelector('#entities .chip[data-text="Daniel Okafor"]') as HTMLButtonElement).click();
    expect(document.getElementById("outbound")!.textContent).not.toContain("Daniel Okafor");

    // analyse -> rules-only fallback, details re-filled locally
    (document.getElementById("btn-analyse") as HTMLButtonElement).click();
    await tick(60);
    expect(document.getElementById("step-result")!.hidden).toBe(false);
    expect(document.getElementById("result-badge")!.textContent).toContain("LOCAL RULES");
    expect(document.getElementById("result")!.textContent).toContain("$2,180.00");
    expect(document.getElementById("result")!.textContent).toContain("Nothing was sent off this device");

    const log = document.getElementById("log")!.textContent!;
    expect(log).toContain("LOCAL RULES");
    expect(log).toContain("SKIPPED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
