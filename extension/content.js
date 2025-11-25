// content.js - improved
(function () {
if (window.__recorder_installed) return;
window.__recorder_installed = true;

function now() { return Date.now(); }

// simple unique-ish CSS selector generator (works for most elements)
function cssSelector(el) {
if (!el) return null;
if (el.id) return `css=#${el.id}`;
const parts = [];
let cur = el;
while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
let name = cur.tagName.toLowerCase();
if (cur.className && typeof cur.className === 'string') {
const cls = cur.className.trim().split(/\s+/).join('.');
if (cls) name += '.' + cls;
}
const parent = cur.parentNode;
if (parent) {
const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
if (siblings.length > 1) {
const idx = Array.prototype.indexOf.call(parent.children, cur) + 1;
name += `:nth-child(${idx})`;
}
}
parts.unshift(name);
cur = cur.parentNode;
if (parts.length > 6) break; // limit length
}
return 'css=' + parts.join(' > ');
}

// send action to bg
function pushAction(action) {
try {
chrome.runtime.sendMessage({ cmd: 'PUSH_ACTION', action });
} catch (e) {
console.warn('send push failed', e);
}
}

// click handler
function onClick(e) {
const el = e.target;
const sel = cssSelector(el);
pushAction({ action: 'click', selector: sel, time: now() });
}

// For typing, record the element value (debounced)
const inputTimers = new WeakMap();
function onInput(e) {
const el = e.target;
if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
return;
}
const sel = cssSelector(el);
// debounce: wait 200ms after last input then push final value
if (inputTimers.has(el)) clearTimeout(inputTimers.get(el));
const t = setTimeout(() => {
let value = '';
if (el.isContentEditable) value = el.innerText || '';
else value = el.value || '';
pushAction({ action: 'type', selector: sel, value: value, time: now() });
inputTimers.delete(el);
}, 200);
inputTimers.set(el, t);
}

// capture navigation events (push navigate when single page app route changes)
let lastUrl = location.href;
setInterval(() => {
if (location.href !== lastUrl) {
lastUrl = location.href;
pushAction({ action: 'navigate', url: lastUrl, time: now() });
}
}, 500);

// attach listeners
document.addEventListener('click', onClick, true);
document.addEventListener('input', onInput, true);

// listen for explicit START/STOP messages from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
if (msg && msg.cmd === 'STOP_RECORDING') {
// remove listeners on stop
document.removeEventListener('click', onClick, true);
document.removeEventListener('input', onInput, true);
sendResponse({ ok: true });
}
});

console.log('[content] recorder installed');
})();