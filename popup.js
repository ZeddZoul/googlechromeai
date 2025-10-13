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
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
      logMsg('VOX.AI active on page.');
    } catch (err) {
      logMsg('Activate failed: ' + String(err));
    }
  });
  // helper: send a message to the tab and auto-inject the content script if there's no receiver
  async function sendToTabWithInject(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, async (resp) => {
        if (chrome.runtime.lastError) {
          // likely: "Could not establish connection. Receiving end does not exist."
          try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content_script.js'] });
            // retry once
            chrome.tabs.sendMessage(tabId, message, (resp2) => {
              if (chrome.runtime.lastError) return resolve({ success: false, error: chrome.runtime.lastError.message });
              return resolve(resp2);
            });
          } catch (e) {
            return resolve({ success: false, error: String(e) });
          }
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
