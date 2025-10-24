// Popup controls for VOX.AI
document.addEventListener('DOMContentLoaded', () => {
  const injectBtn = document.getElementById('inject');
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  const log = document.getElementById('log');

  function logMsg(s) { log.textContent = s; }

  injectBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id === 'undefined') { logMsg('No active tab found. Open a page first.'); return; }
    try {
      // Content script is automatically injected via manifest.json
      // Just refresh the page to ensure it's active
      await chrome.tabs.reload(tab.id);
      logMsg('VOX.AI active on page.');
    } catch (err) {
      logMsg('Activate failed: ' + String(err));
    }
  });
  // helper: send a message to the tab (content script auto-injected via manifest)
  async function sendToTabWithInject(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        if (chrome.runtime.lastError) {
          return resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          return resolve(resp);
        }
      });
    });
  }

  startBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id === 'undefined') { logMsg('No active tab. Open a page first.'); return; }
    const r = await sendToTabWithInject(tab.id, { type: 'START_RECORDING' });
    if (r && r.success === false && r.error) logMsg('Start failed: ' + r.error); else logMsg('Recording...');
  });

  stopBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id === 'undefined') { logMsg('No active tab. Open a page first.'); return; }
    const r = await sendToTabWithInject(tab.id, { type: 'STOP_RECORDING' });
    if (r && r.success === false && r.error) logMsg('Stop failed: ' + r.error); else logMsg('Stopped');
  });
  // no file upload: VOX.AI records live audio only
});
