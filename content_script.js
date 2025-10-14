// VOX.AI - content_script.js
// Provides a small floating microphone UI that the user can click to start/stop
// recording. Audio is forwarded to the injected in-page script (inpage.js)
// which is responsible for calling the browser's built-in Prompt API.

if (window.__voxai_installed) {
  console.debug('VOX.AI: content script already installed on this page');
} else {
  window.__voxai_installed = true;

  const FLOAT_ID = 'voxai-floating-mic';

  // Inject inpage.js so the Prompt API can be used from page context
  (function injectInpage() {
    try {
      const src = chrome.runtime.getURL('inpage.js');
      const s = document.createElement('script');
      s.src = src;
      s.type = 'text/javascript';
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => {
        console.log('VOX.AI: In-page script injected.');
        s.remove();
      };
    } catch (err) { console.warn('VOX.AI: failed to inject inpage', err); }
  })();

  // Build and attach floating mic
  function createFloatingMic() {
    if (document.getElementById(FLOAT_ID)) return;
    console.log('VOX.AI: Floating mic icon is being added to the page.');
    const el = document.createElement('div');
    el.id = FLOAT_ID;
    el.style.position = 'fixed';
  // docked pill style at bottom-right with VOX.AI yellow/white theme
  el.style.right = '18px';
  el.style.bottom = '18px';
  el.style.width = '72px';
  el.style.height = '72px';
  el.style.borderRadius = '36px';
  el.style.background = '#FFD700'; // VOX.AI yellow
  el.style.boxShadow = '0 8px 30px rgba(0,0,0,0.15)';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.cursor = 'pointer';
    el.style.zIndex = 2147483647;
    el.title = 'VOX.AI — click to start/stop recording';
    // inner level indicator + icon
    // Inner structure: waveform container + central mic button
    el.innerHTML = `
      <div id="voxai-wave" style="position:absolute;inset:8px;border-radius:28px;pointer-events:none;display:flex;align-items:center;justify-content:center;">
        <div id="voxai-level" style="display:flex;gap:3px;align-items:center;justify-content:center;pointer-events:none;">
          ${Array.from({ length: 9 }).map(() => '<div class="vox-bar" style="width:3px;height:10px;background:rgba(255,255,255,0.28);border-radius:2px;transition:height 0.08s linear, background 120ms linear"></div>').join('')}
        </div>
      </div>
      <div id="voxai-button" style="position:relative;width:52px;height:52px;border-radius:26px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,0.15);">
        <svg id="voxai-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" fill="#FFD700"/><path d="M19 11a1 1 0 0 1-2 0 5 5 0 0 1-10 0 1 1 0 0 1-2 0 5 5 0 0 0 4 4.9V20a1 1 0 1 0 2 0v-4.1A5 5 0 0 0 19 11z" fill="#FFD700" opacity="0.6"/></svg>
      </div>`;
    document.body.appendChild(el);

    // cache a reference to the inner level element for real-time updates
    el._levelEl = el.querySelector('#voxai-level');

    el.addEventListener('click', async () => {
      console.log('VOX.AI: Floating mic icon clicked.');
      if (isStopping) {
        console.log('VOX.AI: Still stopping, please wait.');
        return;
      }
      if (!el.dataset.recording) {
        const ok = await startRecording();
        if (ok && ok.success) {
          console.log('VOX.AI: Recording started.');
          el.dataset.recording = '1';
          el.style.background = '#ff6b6b';
        }
      } else {
        stopRecording();
        delete el.dataset.recording;
        el.style.background = '#FFD700';
      }
    });
  }

  // Recording state
  let mediaRecorder = null;
  let chunks = [];
  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let rafId = null;
  let currentStream = null;
  let recognizer = null;
  let fallbackTranscript = '';
  let fallbackError = null;
  let isStopping = false;

  async function startRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') return { success: false, error: 'already recording' };
    if (isStopping) return { success: false, error: 'still stopping previous recording' };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      currentStream = stream;

      // Create AudioContext and analyser for VU meter
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        sourceNode = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        sourceNode.connect(analyser);
      } catch (err) {
        console.warn('VOX.AI: audio analyser not available', err);
        audioContext = null;
        analyser = null;
        sourceNode = null;
      }

      mediaRecorder = new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const buffer = await blob.arrayBuffer();
        // Send to in-page handler via window.postMessage
        const channel = `voxai_resp_${Math.random().toString(36).slice(2)}`;
        let responded = false;
        function onMsg(e) {
          // A valid response must have data, the correct channel, and a payload.
          if (!e.data || e.data.channel !== channel || typeof e.data.payload === 'undefined') return;
          responded = true;
          window.removeEventListener('message', onMsg);
          console.log('VOX.AI: inpage response', e.data.payload);
        }
        window.addEventListener('message', onMsg);
        // include any fallback transcript produced by the SpeechRecognition API
        window.postMessage({ voxai: 'PROCESS_AUDIO_INPAGE', audioBuffer: buffer, mimeType: 'audio/webm', schema: null, channel, fallbackTranscript, fallbackError }, '*');

        // safety timeout: if no response within 12s, log helpful debug info
        setTimeout(() => {
          if (!responded) {
            console.warn('VOX.AI: no inpage response within 12s — last fallbackTranscript:', fallbackTranscript, 'fallbackError:', fallbackError);
          }
        }, 12000);

        // Send the audio data, then clean up all resources.
        window.postMessage({ voxai: 'PROCESS_AUDIO_INPAGE', audioBuffer: buffer, mimeType: 'audio/webm', schema: null, channel, fallbackTranscript, fallbackError }, '*');

        cleanupAudioResources();
      };
      mediaRecorder.start();

      // start SpeechRecognition fallback if available
      try {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
          recognizer = new SpeechRecognition();
          recognizer.lang = 'en-US';
          recognizer.interimResults = true;
          fallbackTranscript = '';
          recognizer.onresult = (ev) => {
            let final = '';
            for (let i = 0; i < ev.results.length; i++) {
              if (ev.results[i].isFinal) final += ev.results[i][0].transcript + ' ';
            }
            if (final.trim()) fallbackTranscript = final.trim();
          };
          recognizer.onerror = (err) => { console.warn('VOX.AI SR error', err); fallbackError = String(err && err.error ? err.error : err); };
          try { recognizer.start(); } catch (e) { console.error("VOX.AI: Failed to start SpeechRecognition", e); }
        }
      } catch (e) { /* ignore */ }

      // start the analyser draw loop if available
      if (analyser) startAnalyseLoop();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  function startAnalyseLoop() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    const el = document.getElementById(FLOAT_ID);
    const levelEl = el && el._levelEl;

    function draw() {
      analyser.getByteTimeDomainData(data);
      // compute RMS
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128; // -1..1
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const normalized = Math.min(1, rms * 2.5); // scale to make it more responsive

      if (levelEl) {
        const scale = 0.6 + normalized * 0.8; // 0.6..1.4
        levelEl.style.transform = `scale(${scale})`;
        // color shift: low->dark, high->red
        const hue = Math.round((1 - normalized) * 120); // 120 -> green to 0 -> red
        levelEl.style.background = `hsl(${hue} 80% ${normalized > 0.4 ? 40 : 18}%)`;
      }

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
  }

  function cleanupAudioResources() {
    // Stop and nullify the recognizer
    if (recognizer) {
      try { recognizer.stop(); } catch (e) {}
      recognizer = null;
    }

    // Stop media tracks
    if (currentStream) {
      currentStream.getTracks().forEach(t => t.stop());
      currentStream = null;
    }

    // Disconnect and close the audio context
    if (analyser) analyser.disconnect();
    if (sourceNode) sourceNode.disconnect();
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }

    // Nullify the recorder
    mediaRecorder = null;

    // All cleanup is done, release the lock
    isStopping = false;
    console.log('VOX.AI: Cleanup complete. Ready to record again.');
  }

  function stopRecording() {
    console.log('VOX.AI: Recording stopped.');
    if (!mediaRecorder) return { success: false, error: 'not recording' };
    if (isStopping) return { success: false, error: 'already stopping' };
    try {
      isStopping = true;
      // stop analyser UI loop immediately
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      const el = document.getElementById(FLOAT_ID);
      if (el && el._levelEl) {
        el._levelEl.style.transform = 'scale(1)';
        el._levelEl.style.background = '#111';
      }

      // This will trigger the 'onstop' event where cleanup now happens
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      } else {
        // If already inactive, cleanup never triggered, so do it manually.
        cleanupAudioResources();
      }
      return { success: true };
    } catch (err) {
      isStopping = false; // Reset the lock on error
      return { success: false, error: String(err) };
    }
  }

  // Message API from popup
  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'START_RECORDING') { startRecording().then(send); return true; }
    if (msg.type === 'STOP_RECORDING') { send(stopRecording()); return; }
    if (msg.type === 'PROCESS_AUDIO_TAB') {
      (async () => {
        try {
          const { audioBuffer, mimeType, schema } = msg.payload;
          const channel = `voxai_resp_${Math.random().toString(36).slice(2)}`;
          function onMsg(e) { if (!e.data || e.data.channel !== channel) return; window.removeEventListener('message', onMsg); send(e.data.payload); }
          window.addEventListener('message', onMsg);
          window.postMessage({ voxai: 'PROCESS_AUDIO_INPAGE', audioBuffer, mimeType, schema, channel }, '*');
        } catch (err) { send({ success: false, error: String(err) }); }
      })();
      return true;
    }
  });


  // Attach UI immediately
  try { createFloatingMic(); } catch (e) { /* ignore for pages that restrict injection */ }

} // end install guard
