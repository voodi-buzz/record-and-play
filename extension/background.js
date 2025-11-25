// background.js - improved service worker for Record & Play Extension
console.log("[bg] Service worker loaded.");

// keys for local backup storage
const ACTIONS_KEY = "rp_actions";
const START_URL_KEY = "rp_startUrl";

// runtime state (kept in-memory while SW alive)
let isRecording = false;
let actions = [];
let startUrl = null;

// util: check http(s) url
function isHttpUrl(url) {
return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

// ==== storage helpers (use chrome.storage.local) ====
async function saveActionsToStorageLocal() {
try {
await chrome.storage.local.set({ [ACTIONS_KEY]: actions || [], [START_URL_KEY]: startUrl || null });
console.log("[bg] saved actions to storage", actions ? actions.length : 0);
} catch (e) {
console.error("[bg] storage save error", e);
}
}

async function readActionsFromStorageLocal() {
try {
const obj = await chrome.storage.local.get([ACTIONS_KEY, START_URL_KEY]);
const loadedActions = obj[ACTIONS_KEY] || [];
const loadedStart = obj[START_URL_KEY] || null;
console.log("[bg] loaded backup from storage", loadedActions.length, "startUrl=", loadedStart);
return { actions: loadedActions, startUrl: loadedStart };
} catch (e) {
console.error("[bg] storage read error", e);
return { actions: [], startUrl: null };
}
}

async function clearStorageLocal() {
try {
await chrome.storage.local.remove([ACTIONS_KEY, START_URL_KEY]);
console.log("[bg] cleared stored actions");
} catch (e) {
console.error("[bg] storage clear error", e);
}
}

// on service worker start: restore any backup so we don't lose actions if worker restarted
(async () => {
try {
const backup = await readActionsFromStorageLocal();
// restore into memory but do not auto-start recording
if (Array.isArray(backup.actions) && backup.actions.length > 0) {
actions = backup.actions;
startUrl = backup.startUrl;
console.log("[bg] restored actions into memory count=", actions.length);
}
} catch (e) {
console.error("[bg] startup restore error", e);
}
})();

// capture top-level navigations while recording (works even when SW wakes)
chrome.webNavigation.onCommitted.addListener((details) => {
try {
if (!isRecording) return;
// only top-level navigations
if (typeof details.frameId !== "undefined" && details.frameId !== 0) return;

const nav = { action: "navigate", url: details.url, time: Date.now() };
actions.push(nav);
if (!startUrl) startUrl = details.url;
// persist backup
saveActionsToStorageLocal();
console.log("[bg] NAV recorded:", nav);
} catch (e) {
console.error("[bg] webNavigation handler error", e);
}
});

// ensure we respond and keep async sendResponse by returning true when we will respond async
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
console.log("[bg] received:", msg);

// START_RECORDING
if (msg && msg.cmd === "START_RECORDING") {
(async () => {
try {
isRecording = true;
actions = [];
startUrl = null;
await saveActionsToStorageLocal(); // reset backup

// find active tab
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
const t = tabs && tabs[0];
if (!t) {
console.warn("[bg] no active tab");
sendResponse({ ok: false, error: "no active tab" });
return;
}

// if http(s) record initial URL immediately (ensures startUrl)
if (isHttpUrl(t.url)) {
const nav = { action: "navigate", url: t.url, time: Date.now() };
actions.push(nav);
if (!startUrl) startUrl = t.url;
await saveActionsToStorageLocal();
console.log("[bg] INITIAL NAVIGATION recorded:", t.url);
} else {
console.log("[bg] active tab not http(s), will rely on webNavigation for navigations:", t.url);
}

// try to inject content script only for http(s) pages
if (isHttpUrl(t.url)) {
try {
await chrome.scripting.executeScript({
target: { tabId: t.id },
files: ["content.js"]
});
console.log("[bg] content script injected to tab", t.id);

// ask content.js to start (in case it's already loaded)
chrome.tabs.sendMessage(t.id, { cmd: "START_RECORDING" }, (resp) => {
console.log("[bg] start message sent to content script", resp);
// respond back to popup
sendResponse({ ok: true });
});
} catch (injectErr) {
console.error("[bg] injection failed", injectErr);
// still continue and respond; navigations will still be captured via webNavigation
sendResponse({ ok: true, message: "recording started (injection failed)", error: String(injectErr) });
}
} else {
// not an http(s) URL: still return ok and let webNavigation record later
sendResponse({ ok: true, message: "recording started (no content injection)" });
}
});
} catch (e) {
console.error("[bg] START_RECORDING error", e);
sendResponse({ ok: false, error: String(e) });
}
})();

return true; // we will call sendResponse asynchronously
}

// PUSH_ACTION (from content.js)
if (msg && msg.cmd === "PUSH_ACTION") {
try {
if (!isRecording) {
console.warn("[bg] PUSH_ACTION while not recording. Ignoring.");
return;
}
const a = msg.action;
if (!a || !a.action) return;

// sanitize type null values to empty string (extra safety)
if (a.action === "type" && (a.value === null || typeof a.value === "undefined")) {
a.value = "";
}

// push and persist
actions.push(a);
if (!startUrl && a.action === "navigate" && a.url) startUrl = a.url;
saveActionsToStorageLocal();
console.log("[bg] action added (count=" + actions.length + "):", a);
} catch (e) {
console.error("[bg] PUSH_ACTION handler error", e);
}
return;
}

// STOP_RECORDING
if (msg && msg.cmd === "STOP_RECORDING") {
(async () => {
try {
console.log("[bg] STOP_RECORDING received");
if (!isRecording) {
sendResponse({ ok: false, error: "not recording" });
return;
}
isRecording = false;

// Tell active content script to stop (best-effort)
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
try {
const t = tabs && tabs[0];
if (t && isHttpUrl(t.url)) {
chrome.tabs.sendMessage(t.id, { cmd: "STOP_RECORDING" }, (resp) => {
console.log("[bg] content script stop response:", resp);
});
}

// if we have no in-memory actions fallback to storage
if (!actions || actions.length === 0) {
const backup = await readActionsFromStorageLocal();
actions = backup.actions || [];
startUrl = backup.startUrl || startUrl;
console.log("[bg] restored from storage count=", actions.length);
}

if (!actions || actions.length === 0) {
sendResponse({ ok: false, message: "No actions recorded" });
return;
}

// Build payload for backend (the backend expects { startUrl, actions })
const payload = { startUrl: startUrl || null, actions: actions };

// Upload to backend
fetch("http://localhost:3000/save", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload)
}).then(r => r.json())
.then(async (data) => {
console.log("[bg] save response:", data);
// clear backup & in-memory state
await clearStorageLocal();
actions = [];
startUrl = null;
sendResponse({ ok: true, saved: data });
})
.catch((err) => {
console.error("[bg] save failed:", err);
// keep backup so user can retry
sendResponse({ ok: false, error: String(err) });
});

} catch (e) {
console.error("[bg] STOP_RECORDING internal error", e);
sendResponse({ ok: false, error: String(e) });
}
});

} catch (e) {
console.error("[bg] STOP_RECORDING outer error", e);
sendResponse({ ok: false, error: String(e) });
}
})();

return true; // we will call sendResponse asynchronously
}
});
