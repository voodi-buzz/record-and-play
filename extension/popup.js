// popup.js
console.log("[popup] loaded");

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");

function setStatus(s) { statusEl.textContent = "Status: " + s; }

startBtn.onclick = () => {
  setStatus("starting...");
  chrome.runtime.sendMessage({ cmd: "START_RECORDING" }, (resp) => {
    if (chrome.runtime.lastError) {
      setStatus("error: " + chrome.runtime.lastError.message);
      console.error("[popup] send error", chrome.runtime.lastError);
      return;
    }
    if (resp && resp.ok) {
      setStatus("recording");
    } else {
      setStatus("recording (partial) - " + (resp && resp.error ? resp.error : ""));
    }
    console.log("[popup] start response", resp);
  });
};

stopBtn.onclick = () => {
  setStatus("stopping...");
  chrome.runtime.sendMessage({ cmd: "STOP_RECORDING" }, (resp) => {
    if (chrome.runtime.lastError) {
      setStatus("error: " + chrome.runtime.lastError.message);
      console.error("[popup] stop send error", chrome.runtime.lastError);
      return;
    }
    if (resp && resp.ok) {
      setStatus("uploaded: " + (resp.saved && resp.saved.name ? resp.saved.name : JSON.stringify(resp.saved)));
    } else {
      setStatus("not saved: " + (resp && resp.error ? resp.error : resp && resp.message ? resp.message : "unknown"));
    }
    console.log("[popup] stop response", resp);
  });
};