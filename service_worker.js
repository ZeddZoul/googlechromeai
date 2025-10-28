// Survsay - service_worker.js
// Minimal background/service worker. No AI processing is done here; AI runs
// in the page context via the injected inpage.js.

self.addEventListener('install', (e) => {
  console.log('Survsay service worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  console.log('Survsay service worker activated');
  self.clients.claim();
});

// Simple message responder for health checks
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'PING') {
    sendResponse({ ok: true });
    return;
  }
  // Unknown messages return nothing (noop)
});
