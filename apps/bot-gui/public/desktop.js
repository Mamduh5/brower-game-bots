const $ = id => document.getElementById(id);
let windows = [], profiles = [], skills = [], previewMode = false, lastImage = "", active = false;
const kinds = { click: "Click", hold: "Press / hold keys and buttons", move: "Move mouse to point", "relative-move": "Relative mouse movement", "key-down": "Key down", "key-up": "Key up", "button-down": "Mouse button down", "button-up": "Mouse button up", drag: "Drag", scroll: "Scroll", wait: "Wait", "release-all": "Release all held input" };
const keyNames = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(k => "Key" + k).concat([..."0123456789"].map(k => "Digit" + k), ["Space", "Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift", "Control", "Alt", "Home", "End", "PageUp", "PageDown"], [1,2,3,4,5,6,7,9,10,11,12].map(n => "F" + n));
async function api(route, value) {
  const response = await fetch("/api/desktop/" + route, value === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
}
function handle(id, fn) { $(id).addEventListener("click", () => { $("message").textContent = ""; void fn().catch(error => { $("message").textContent = error.message; }); }); }
function option(select, value, label) { const el = document.createElement("option"); el.value = value; el.textContent = label; select.append(el); }
function field(parent, name, label, value, choices) {
  const wrapper = document.createElement("label"); wrapper.textContent = label;
  const input = document.createElement(choices ? "select" : "input"); input.dataset.field = name;
  if (choices) for (const choice of choices) option(input, choice, choice);
  else { input.type = typeof value === "number" ? "number" : "text"; if (input.type === "number") input.step = "any"; }
  input.value = value; wrapper.append(input); parent.append(wrapper); return input;
}
function addAction(action = { kind: "click", point: { x: .5, y: .5 }, button: "left", durationMs: 50 }) {
  const row = document.createElement("div"); row.className = "desktop-action";
  const select = field(row, "kind", "Action", action.kind, Object.keys(kinds));
  for (const op of select.options) op.textContent = kinds[op.value];
  const params = document.createElement("div"); params.className = "params"; row.append(params);
  const remove = document.createElement("button"); remove.textContent = "Remove"; remove.onclick = () => row.remove(); row.append(remove);
  const draw = () => {
    params.replaceChildren(); const kind = select.value;
    const xy = (prefix, point) => { field(params, prefix + "x", prefix + "X %", (point?.x ?? .5) * 100); field(params, prefix + "y", prefix + "Y %", (point?.y ?? .5) * 100); };
    if (["click", "move"].includes(kind)) xy("", action.point);
    if (kind === "drag") { xy("from", action.from); xy("to", action.to); }
    if (["click", "drag", "button-down", "button-up"].includes(kind)) field(params, "button", "Button", action.button ?? "left", ["left", "right", "middle"]);
    if (["click", "drag", "hold", "wait"].includes(kind)) field(params, "durationMs", "Duration ms", action.durationMs ?? 100);
    if (["key-down", "key-up"].includes(kind)) field(params, "key", "Key", action.key ?? "Space", keyNames);
    if (kind === "hold") {
      field(params, "keys", "Keys, comma-separated (e.g. Control,KeyA)", (action.keys ?? ["Space"]).join(","));
      field(params, "buttons", "Buttons, comma-separated (optional)", (action.buttons ?? []).join(","));
    }
    if (kind === "relative-move") { field(params, "dx", "Delta X", action.dx ?? 30); field(params, "dy", "Delta Y", action.dy ?? 0); }
    if (kind === "scroll") { field(params, "ticks", "Wheel ticks", action.ticks ?? -1); field(params, "axis", "Axis", action.axis ?? "vertical", ["vertical", "horizontal"]); }
  };
  select.onchange = () => { action = {}; draw(); }; draw(); $("actions").append(row);
}
function readActions() {
  return [...$("actions").children].map(row => {
    const get = name => row.querySelector(`[data-field="${name}"]`)?.value;
    const number = name => Number(get(name));
    const point = prefix => ({ x: number(prefix + "x") / 100, y: number(prefix + "y") / 100 });
    const kind = get("kind"), action = { kind };
    if (["click", "move"].includes(kind)) action.point = point("");
    if (kind === "drag") { action.from = point("from"); action.to = point("to"); }
    if (["click", "drag", "button-down", "button-up"].includes(kind)) action.button = get("button");
    if (["click", "drag", "hold", "wait"].includes(kind)) action.durationMs = number("durationMs");
    if (["key-down", "key-up"].includes(kind)) action.key = get("key");
    if (kind === "hold") for (const name of ["keys", "buttons"]) action[name] = get(name).split(",").map(s => s.trim()).filter(Boolean);
    if (kind === "relative-move") { action.dx = number("dx"); action.dy = number("dy"); }
    if (kind === "scroll") { action.ticks = number("ticks"); action.axis = get("axis"); }
    return action;
  });
}
function profile() { return { version: 1, name: $("name").value, mode: "automation", goal: $("goal").value, intervalMs: Number($("interval").value), startDelayMs: Number($("delay").value) * 1000, maxActions: Number($("count").value), maxDurationMs: Number($("duration").value) * 1000, maxUnchangedObservations: Number($("unchanged").value), actions: readActions(), skills }; }
function renderSkills() { $("skills").replaceChildren(); skills.forEach((s,i) => option($("skills"), String(i), s.id)); }
function loadProfile(p) {
  $("name").value = p.name; $("goal").value = p.goal; $("interval").value = p.intervalMs; $("delay").value = p.startDelayMs / 1000;
  $("count").value = p.maxActions; $("duration").value = p.maxDurationMs / 1000; $("unchanged").value = p.maxUnchangedObservations;
  skills = p.skills; renderSkills(); $("actions").replaceChildren(); p.actions.forEach(addAction);
}
async function refreshProfiles() { ({ profiles } = await api("profiles")); $("profiles").replaceChildren(); option($("profiles"), "", "Choose a configuration"); profiles.forEach((p,i) => option($("profiles"), String(i), p.name)); }
function target() { const found = windows.find(w => w.handle === $("target").value); if (!found) throw new Error("Refresh windows and choose an application"); return found; }
handle("windows", async () => { ({ windows } = await api("windows")); $("target").replaceChildren(); for (const w of windows) option($("target"), w.handle, `${w.title} · ${w.processName} (${w.pid})`); });
handle("preview", async () => { const result = await api("preview", target()); previewMode = true; $("observation").src = result.image; $("observation").hidden = false; $("message").textContent = "Preview captured. Return here and click a point to configure the last action."; });
handle("add", async () => addAction());
handle("save", async () => { await api("profiles", profile()); await refreshProfiles(); $("message").textContent = "Configuration saved locally."; });
handle("start", async () => { await api("start", { target: target(), profile: profile() }); previewMode = false; await poll(); });
for (const control of ["pause", "resume", "stop"]) handle(control, async () => { await api(control, {}); await poll(); });
handle("save-skill", async () => { const id = $("skill-name").value; if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Use 1–64 letters, numbers, underscores or hyphens for the behavior name"); skills = skills.filter(s => s.id !== id); skills.push({ id, description: id, actions: readActions() }); renderSkills(); });
handle("use-skill", async () => { const skill = skills[Number($("skills").value)]; if (!skill) throw new Error("Choose a stored behavior"); $("actions").replaceChildren(); skill.actions.forEach(addAction); });
$("profiles").onchange = () => { if ($("profiles").value !== "") loadProfile(profiles[Number($("profiles").value)]); };
$("observation").onclick = event => {
  if (!previewMode || active) return;
  const row = $("actions").lastElementChild; if (!row) return;
  const box = event.currentTarget.getBoundingClientRect();
  for (const [name,value] of [["x", (event.clientX-box.left)/box.width*100], ["y", (event.clientY-box.top)/box.height*100]]) {
    const input = row.querySelector(`[data-field="${name}"]`); if (input) input.value = value.toFixed(2);
  }
};
async function poll() {
  const { run } = await api("state");
  active = run && !["stopped", "completed", "failed"].includes(run.status);
  $("start").disabled = Boolean(active); $("preview").disabled = Boolean(active);
  $("pause").disabled = !run || !["starting", "running"].includes(run.status); $("resume").disabled = run?.status !== "paused"; $("stop").disabled = !active;
  if (!run) return;
  $("status").textContent = `${run.status} · ${run.actionCount}/${run.profile.maxActions} actions · ${run.reason}`;
  $("latest-action").textContent = run.latestAction ? "Latest action: " + JSON.stringify(run.latestAction) : "";
  $("logs").textContent = run.logs.map(e => `${e.at} ${e.message}`).join("\n");
  if (run.latestScreenshot && !previewMode) {
    const image = `/artifact?path=${encodeURIComponent(run.latestScreenshot.relativePath)}&v=${encodeURIComponent(run.latestScreenshot.createdAt)}`;
    if (image !== lastImage) { lastImage = image; $("observation").src = image; $("observation").hidden = false; }
  }
  $("report").hidden = !run.report; if (run.report) $("report").href = "/artifact?path=" + encodeURIComponent(run.report.relativePath);
}
addAction();
void refreshProfiles().catch(error => { $("message").textContent = error.message; });
async function tick() { try { await poll(); } catch (error) { $("status").textContent = "Connection unavailable: " + error.message; } finally { setTimeout(tick, 750); } }
void tick();
