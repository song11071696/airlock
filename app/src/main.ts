import { cloudConfigured, cloudReachable, CLOUD_MODEL, CloudRefusedError, deviceState, getCloudProblem, resetCloudProblem, prepareDeviceModel, transcribeImage, type Analysis, type DeviceState } from "./ai";
import { build, discover, errMsg, followUp, runAnalysis, type Prepared, type StepLog } from "./pipeline";
import { maskCard, TOKEN_RE, type Entity } from "./pii";
import { SAMPLES } from "./samples";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const LABEL: Record<string, string> = {
  on_device: "ON DEVICE", in_cloud: "IN CLOUD", local_rules: "LOCAL RULES", skipped: "SKIPPED", error: "ERROR",
};

let device: DeviceState = "unsupported";
let prepared: Prepared | null = null;
const log: StepLog[] = [];

// ---------------- status bar ----------------

async function refreshStatus(): Promise<void> {
  device = await deviceState();
  const pd = $("pill-device");
  const btn = $<HTMLButtonElement>("btn-device");
  const txt: Record<DeviceState, string> = {
    unsupported: "On-device: not supported in this browser",
    unavailable: "On-device: unavailable on this machine",
    downloadable: "On-device: Gemini Nano not downloaded",
    downloading: "On-device: downloading Gemini Nano…",
    available: "On-device: Gemini Nano ready",
  };
  pd.textContent = txt[device];
  pd.className = "pill " + (device === "available" ? "ok" : device === "downloadable" || device === "downloading" ? "warn" : "bad");
  btn.hidden = !(device === "downloadable" || device === "downloading");

  const pn = $("pill-net");
  pn.textContent = navigator.onLine ? "Network: online" : "Network: offline";
  pn.className = "pill " + (navigator.onLine ? "ok" : "warn");

  const pc = $("pill-cloud");
  const problem = getCloudProblem();
  pc.textContent = !cloudConfigured ? "Cloud: not configured"
    : problem ? problem.short
    : cloudReachable() ? `Cloud: ${CLOUD_MODEL}` : "Cloud: unreachable (offline)";
  pc.title = problem ? problem.message : "";
  pc.className = "pill " + (problem ? "bad" : cloudReachable() ? "cloud" : "warn");
  $("btn-cloud-retry").hidden = !problem;
  updateRoute();
}

$("btn-device").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("btn-device");
  btn.disabled = true;
  try {
    await prepareDeviceModel((f) => {
      $("pill-device").textContent = `On-device: downloading Gemini Nano ${Math.round(f * 100)}%`;
    });
  } catch (e) {
    $("pill-device").textContent = "On-device: " + errMsg(e);
  }
  btn.disabled = false;
  await refreshStatus();
});
$("btn-cloud-retry").addEventListener("click", () => {
  resetCloudProblem();
  refreshStatus();
});
window.addEventListener("online", refreshStatus);
window.addEventListener("offline", refreshStatus);

function updateRoute(): void {
  const el = $("route");
  if (!el) return;
  if (cloudReachable()) {
    el.innerHTML = `Next step runs <span class="badge in_cloud">IN CLOUD</span> (${esc(CLOUD_MODEL)}) on the redacted text only` +
      (device === "available" ? ", falling back to Gemini Nano if the network fails." : ".");
  } else if (device === "available") {
    el.innerHTML = `Offline or no cloud: next step runs <span class="badge on_device">ON DEVICE</span>. Nothing leaves this device.`;
  } else {
    el.innerHTML = `No AI model reachable: you will get a <span class="badge local_rules">LOCAL RULES</span> basic scan (deadlines and amounts).`;
  }
}

// ---------------- log ----------------

function renderLog(): void {
  $("log").innerHTML = log
    .map((s) => `<li><span class="badge ${s.source}">${LABEL[s.source]}</span>${esc(s.label)}` +
      `${s.ms ? ` <span class="muted">· ${s.ms} ms</span>` : ""}${s.detail ? ` <span class="muted">· ${esc(s.detail)}</span>` : ""}</li>`)
    .join("");
}

// ---------------- step 1: input ----------------

for (const s of SAMPLES) {
  const b = document.createElement("button");
  b.textContent = s.label;
  b.addEventListener("click", () => {
    $<HTMLTextAreaElement>("letter").value = s.text;
  });
  $("samples").appendChild(b);
}

$<HTMLInputElement>("photo").addEventListener("change", async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const status = $("photo-status");
  if (file.type !== "image/jpeg" && file.type !== "image/png") {
    status.textContent = "Only JPEG or PNG photos are supported.";
    return;
  }
  if (device !== "available") {
    status.textContent = "Reading photos needs Gemini Nano on this device (photos are never uploaded). Paste the text instead.";
    log.push({ label: "Read photo", source: "skipped", ms: 0, detail: "on-device model not ready; photo not uploaded" });
    renderLog();
    return;
  }
  status.textContent = "Reading the photo on this device…";
  try {
    const b64 = await fileToBase64(file);
    const r = await transcribeImage(b64, file.type);
    $<HTMLTextAreaElement>("letter").value = r.value.trim();
    status.textContent = `Read on this device in ${(r.ms / 1000).toFixed(1)} s. Check the text before continuing.`;
    log.push({ label: "Read photo (Gemini Nano, multimodal)", source: r.source, ms: r.ms, detail: "photo stayed on this device" });
  } catch (e) {
    status.textContent = "Could not read the photo on this device: " + errMsg(e);
    log.push({ label: "Read photo", source: "error", ms: 0, detail: errMsg(e) });
  }
  renderLog();
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

$("btn-airlock").addEventListener("click", async () => {
  const raw = $<HTMLTextAreaElement>("letter").value.trim();
  if (!raw) {
    $<HTMLTextAreaElement>("letter").focus();
    return;
  }
  const card = $("step-input");
  card.classList.add("busy");
  log.length = 0;
  const entities = await discover(raw, device === "available", log);
  prepared = build(raw, entities, new Set(), log);
  card.classList.remove("busy");
  $("step-review").hidden = false;
  $("step-result").hidden = true;
  $("step-ask").hidden = true;
  renderReview();
  renderLog();
  $("step-review").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------------- step 2: review ----------------

function renderReview(): void {
  if (!prepared) return;
  const p = prepared;
  const tokenOf = (e: Entity) => p.vault.byValue.get(e.text.toLowerCase()) ?? "";
  $("entities").innerHTML = p.entities.length
    ? p.entities
        .map((e) => {
          const rel = p.released.has(e.text.toLowerCase()) || (!!e.parent && p.released.has(e.parent.toLowerCase()));
          return `<button class="chip ${rel ? "released" : ""}" data-text="${esc(e.text)}" title="${rel ? "Will be sent as-is. Click to withhold." : "Withheld as " + esc(tokenOf(e)) + ". Click to release."}">` +
            `<small>${e.type}</small>${esc(e.text)}<span class="by">${e.by === "on_device" ? "Nano" : e.by}</span></button>`;
        })
        .join("")
    : `<p class="muted">No personal details found. Select text on the right to withhold anything.</p>`;
  const kept = p.vault.byToken.size;
  $("kept-count").textContent = `· ${kept} withheld`;
  $("outbound").innerHTML = esc(p.redacted).replace(TOKEN_RE, (t) => `<span class="tok">${t}</span>`);
  $("bytes-count").textContent = `· ${new TextEncoder().encode(p.redacted).length} bytes`;
  const leak = $("leak");
  if (p.leaks.length) {
    leak.className = "leak bad";
    leak.textContent = `Blocked: still contains ${p.leaks.map((l) => `"${l}"`).join(", ")}. Withhold it to continue.`;
  } else {
    leak.className = "leak ok";
    leak.textContent = "✓ Leak check passed: none of your withheld details appear in the outbound text.";
  }
  $<HTMLButtonElement>("btn-analyse").disabled = p.leaks.length > 0;
  updateRoute();
}

$("entities").addEventListener("click", (ev) => {
  const chip = (ev.target as HTMLElement).closest<HTMLElement>(".chip");
  if (!chip || !prepared) return;
  const key = (chip.dataset.text ?? "").toLowerCase();
  const rel = new Set(prepared.released);
  if (rel.has(key)) rel.delete(key);
  else rel.add(key);
  prepared = build(prepared.raw, prepared.entities, rel, prepared.log);
  renderReview();
});

document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  const inside = !!sel && sel.rangeCount > 0 && $("outbound").contains(sel.anchorNode);
  $<HTMLButtonElement>("btn-withhold").disabled = !(inside && sel!.toString().trim().length >= 2);
});

$("btn-withhold").addEventListener("click", () => {
  if (!prepared) return;
  const text = (window.getSelection()?.toString() ?? "").trim();
  if (text.length < 2 || /\[\[/.test(text)) return;
  const ent: Entity = { text, type: "OTHER", by: "user" };
  prepared = build(prepared.raw, [...prepared.entities, ent], prepared.released, prepared.log);
  window.getSelection()?.removeAllRanges();
  renderReview();
});

// ---------------- step 3: analysis ----------------

$("btn-analyse").addEventListener("click", async () => {
  if (!prepared) return;
  const card = $("step-review");
  card.classList.add("busy");
  try {
    const r = await runAnalysis(prepared, device === "available" || cloudReachable(), log);
    renderResult(r.analysis, r.tokenised, r.source, r.ms, r.bytesSent);
    const notice = $("cloud-notice");
    notice.hidden = !r.cloudNotice;
    notice.textContent = r.cloudNotice ? `${r.cloudNotice} Showing the ${r.source === "on_device" ? "on-device (Gemini Nano)" : "basic local"} result instead.` : "";
    refreshStatus();
    $("step-result").hidden = false;
    $("step-ask").hidden = false;
    $("step-result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    log.push({ label: "Analyse", source: "error", ms: 0, detail: errMsg(e) });
  }
  card.classList.remove("busy");
  renderLog();
});

function highlightFilled(s: string): string {
  if (!prepared) return esc(s);
  let html = esc(s);
  const cards = [...prepared.vault.byToken].filter(([t]) => /CARD_\d+\]\]$/.test(t)).map(([, v]) => maskCard(v));
  const values = [...prepared.vault.byToken.values(), ...cards].sort((a, b) => b.length - a.length);
  for (const v of values) {
    const ev = esc(v);
    if (ev.length < 3) continue;
    html = html.split(ev).join(`\u0000${ev}\u0001`);
  }
  return html.replace(/\u0000/g, '<span class="filled" title="Filled in on this device">').replace(/\u0001/g, "</span>");
}

function list(items: string[] | undefined): string {
  if (!items?.length) return `<p class="muted">—</p>`;
  return `<ul>${items.map((i) => `<li>${highlightFilled(i)}</li>`).join("")}</ul>`;
}

function renderResult(a: Analysis, tokenised: Analysis, source: string, ms: number, bytesSent: number): void {
  const badge = $("result-badge");
  badge.className = `badge ${source}`;
  badge.textContent = `${LABEL[source]} · ${(ms / 1000).toFixed(1)} s`;
  $("result").innerHTML = `
    <p><strong>${highlightFilled(a.letterType ?? "Letter")}</strong>${a.from ? ` · from ${highlightFilled(a.from)}` : ""}
       ${a.urgency ? ` · <span class="urg ${a.urgency}">${a.urgency} urgency</span>` : ""}</p>
    <p class="summary">${highlightFilled(a.plainSummary ?? "")}</p>
    <div class="result-grid">
      <div class="box"><h4>Deadlines</h4>${list((a.deadlines ?? []).map((d) => `${d.when ?? ""} — ${d.what ?? ""}`))}</div>
      <div class="box"><h4>Money</h4>${list((a.amounts ?? []).map((m) => `${m.amount ?? ""} — ${m.label ?? ""}`))}</div>
      <div class="box"><h4>What to do next</h4>${list(a.nextSteps)}</div>
      <div class="box"><h4>Your rights and options</h4>${list(a.rightsAndOptions)}</div>
      <div class="box"><h4>Questions to ask</h4>${list(a.questionsToAsk)}</div>
      <div class="box"><h4>Privacy receipt</h4><ul>
        <li>${bytesSent ? `${bytesSent} bytes of redacted text sent to ${esc(CLOUD_MODEL)}` : "Nothing was sent off this device"}</li>
        <li>${prepared ? prepared.vault.byToken.size : 0} personal details withheld and filled back in locally</li>
        <li>Photo (if any) never uploaded</li></ul></div>
    </div>
    ${a.replyDraft ? `<h3>Draft reply <span class="muted small">(highlighted parts were filled in on this device)</span></h3><div class="reply">${highlightFilled(a.replyDraft)}</div>` : ""}
    ${a.caveat ? `<p class="muted small">${highlightFilled(a.caveat)}</p>` : ""}`;
  $("tokenised").textContent = JSON.stringify(tokenised, null, 2);
}

// ---------------- step 4: follow-up ----------------

$("btn-ask").addEventListener("click", askQuestion);
$<HTMLInputElement>("question").addEventListener("keydown", (e) => {
  if (e.key === "Enter") askQuestion();
});

async function askQuestion(): Promise<void> {
  const q = $<HTMLInputElement>("question").value.trim();
  if (!q || !prepared) return;
  const box = document.createElement("div");
  box.className = "a";
  box.innerHTML = `<p><strong>${esc(q)}</strong></p><p class="muted">Thinking…</p>`;
  $("answers").prepend(box);
  try {
    const r = await followUp(prepared, q, log);
    box.innerHTML = `<p><strong>${esc(q)}</strong> <span class="badge ${r.source}">${LABEL[r.source]}</span></p><p>${highlightFilled(r.text)}</p>`;
  } catch (e) {
    const msg = e instanceof CloudRefusedError ? e.problem.message : errMsg(e);
    box.innerHTML = `<p><strong>${esc(q)}</strong> <span class="badge error">ERROR</span></p><p class="muted">${esc(msg)}</p>`;
    refreshStatus();
    log.push({ label: "Follow-up question", source: "error", ms: 0, detail: errMsg(e) });
  }
  $<HTMLInputElement>("question").value = "";
  renderLog();
}

refreshStatus();
setInterval(refreshStatus, 5000);
