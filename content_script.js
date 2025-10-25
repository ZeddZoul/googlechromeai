// VOX.AI - content_script.js

(function() {
  if (window.__voxai_installed) {
    console.debug('VOX.AI: content script already installed on this page');
    return;
  }
  window.__voxai_installed = true;

  // Inject inpage.js
  (function injectInpage() {
    try {
      const src = chrome.runtime.getURL('inpage.js');
      const s = document.createElement('script');
      s.src = src;
      s.type = 'text/javascript';
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => {
        s.remove();
      };
    } catch (err) { console.warn('VOX.AI: failed to inject inpage', err); }
  })();

  // Create the floating mic UI
  createFloatingMic();

  // Message listener from popup
  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'START_RECORDING') {
      handleStartRecording().then(() => send({ success: true }));
      return true;
    }
    if (msg.type === 'STOP_RECORDING') {
      handleStopRecording().then(() => send({ success: true }));
      return true;
    }
  });

})();
