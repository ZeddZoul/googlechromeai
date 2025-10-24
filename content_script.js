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
      
      // Prevent multiple simultaneous operations
      if (recordingState.isInitializing || recordingState.isStopping) {
        console.log('VOX.AI: Operation already in progress, ignoring click.');
        return;
      }
      
      if (!recordingState.isRecording) {
        await handleStartRecording(el);
      } else {
        await handleStopRecording(el);
      }
    });
  }

  // Recording state - centralized state management
  let recordingState = {
    isRecording: false,
    isInitializing: false,
    isStopping: false,
    mediaRecorder: null,
    chunks: [],
    audioContext: null,
    analyser: null,
    sourceNode: null,
    rafId: null,
    currentStream: null,
    recognizer: null,
    fallbackTranscript: ''
  };

  async function handleStartRecording(el) {
    console.log('VOX.AI: Starting recording...');
    recordingState.isInitializing = true;
    
    try {
      // Request microphone access - SINGLE CALL
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingState.currentStream = stream;

      // Create AudioContext and analyser for VU meter
      try {
        recordingState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        recordingState.sourceNode = recordingState.audioContext.createMediaStreamSource(stream);
        recordingState.analyser = recordingState.audioContext.createAnalyser();
        recordingState.analyser.fftSize = 2048;
        recordingState.sourceNode.connect(recordingState.analyser);
      } catch (err) {
        console.warn('VOX.AI: audio analyser not available', err);
        recordingState.audioContext = null;
        recordingState.analyser = null;
        recordingState.sourceNode = null;
      }

      // Setup MediaRecorder
      recordingState.mediaRecorder = new MediaRecorder(stream);
      recordingState.chunks = [];
      recordingState.mediaRecorder.ondataavailable = e => { 
        if (e.data && e.data.size) recordingState.chunks.push(e.data); 
      };
      
      recordingState.mediaRecorder.onstop = async () => {
        const blob = new Blob(recordingState.chunks, { type: 'audio/webm' });
        await processRecording(blob);
        cleanupAudioResources();
      };
      
      recordingState.mediaRecorder.start();

      // Start SpeechRecognition fallback if available
      try {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
          recordingState.recognizer = new SpeechRecognition();
          recordingState.recognizer.lang = 'en-US';
          recordingState.recognizer.interimResults = true;
          recordingState.fallbackTranscript = '';
          recordingState.recognizer.onresult = (ev) => {
            let final = '';
            for (let i = 0; i < ev.results.length; i++) {
              if (ev.results[i].isFinal) final += ev.results[i][0].transcript + ' ';
            }
            if (final.trim()) recordingState.fallbackTranscript = final.trim();
          };
          recordingState.recognizer.onerror = (err) => { console.warn('VOX.AI SR error', err); };
          try { recordingState.recognizer.start(); } catch (e) { console.error("VOX.AI: Failed to start SpeechRecognition", e); }
        }
      } catch (e) { /* ignore */ }

      // Start the analyser draw loop if available
      if (recordingState.analyser) startAnalyseLoop();
      
      // Update UI state
      recordingState.isRecording = true;
      recordingState.isInitializing = false;
      el.dataset.recording = '1';
      el.style.background = '#ff6b6b';
      console.log('VOX.AI: Recording started.');
      
    } catch (err) {
      console.error('VOX.AI: Failed to start recording:', err);
      recordingState.isInitializing = false;
      cleanupAudioResources();
    }
  }

  async function handleStopRecording(el) {
    console.log('VOX.AI: Stopping recording...');
    recordingState.isStopping = true;
    
    try {
      // Stop analyser UI loop immediately
      if (recordingState.rafId) { 
        cancelAnimationFrame(recordingState.rafId); 
        recordingState.rafId = null; 
      }
      
      const levelEl = el && el._levelEl;
      if (levelEl) {
        levelEl.style.transform = 'scale(1)';
        levelEl.style.background = '#111';
      }

      // Stop both services simultaneously
      if (recordingState.recognizer) {
        recordingState.recognizer.stop();
      }
      if (recordingState.mediaRecorder && recordingState.mediaRecorder.state !== 'inactive') {
        recordingState.mediaRecorder.stop();
      } else {
        // If the recorder is already stopped, trigger cleanup manually
        cleanupAudioResources();
      }
      
      // Update UI state
      recordingState.isRecording = false;
      recordingState.isStopping = false;
      delete el.dataset.recording;
      el.style.background = '#FFD700';
      console.log('VOX.AI: Recording stopped.');
      
    } catch (err) {
      console.error('VOX.AI: Error stopping recording:', err);
      recordingState.isStopping = false;
      cleanupAudioResources();
    }
  }

  async function processRecording(blob) {
    const channel = `voxai_resp_${Math.random().toString(36).slice(2)}`;
    const onDeviceCheck = async (e) => {
      if (!e.data || e.data.channel !== channel || typeof e.data.payload === 'undefined') return;
      window.removeEventListener('message', onDeviceCheck);

      let transcription = null;
      if (e.data.payload.isAvailable) {
        // On-device transcription would go here if it worked.
        // For now, we'll just use the fallback transcript.
        transcription = recordingState.fallbackTranscript;
      } else {
        transcription = await getTranscription(blob);
      }

      if (transcription) {
        console.log('VOX.AI: Transcription result:', transcription);
        const schema = analyzeForm();
        window.postMessage({
          voxai: 'PROCESS_TEXT_INPAGE',
          text: transcription,
          schema: schema,
          channel
        }, '*');
      }
    };
    window.addEventListener('message', onDeviceCheck);
    window.postMessage({ voxai: 'CHECK_ON_DEVICE', channel }, '*');
  }

  function startAnalyseLoop() {
    if (!recordingState.analyser) return;
    const data = new Uint8Array(recordingState.analyser.fftSize);
    const el = document.getElementById(FLOAT_ID);
    const levelEl = el && el._levelEl;

    function draw() {
      recordingState.analyser.getByteTimeDomainData(data);
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

      recordingState.rafId = requestAnimationFrame(draw);
    }

    recordingState.rafId = requestAnimationFrame(draw);
  }

  function cleanupAudioResources() {
    // Stop and nullify the recognizer
    if (recordingState.recognizer) {
      recordingState.recognizer = null;
    }

    // Stop media tracks
    if (recordingState.currentStream) {
      recordingState.currentStream.getTracks().forEach(t => t.stop());
      recordingState.currentStream = null;
    }

    // Disconnect and close the audio context
    if (recordingState.analyser) recordingState.analyser.disconnect();
    if (recordingState.sourceNode) recordingState.sourceNode.disconnect();
    if (recordingState.audioContext) {
      recordingState.audioContext.close().catch(() => {});
      recordingState.audioContext = null;
    }

    // Nullify the recorder
    recordingState.mediaRecorder = null;

    // Reset all state
    recordingState.isRecording = false;
    recordingState.isInitializing = false;
    recordingState.isStopping = false;
    recordingState.chunks = [];
    recordingState.fallbackTranscript = '';
    
    console.log('VOX.AI: Cleanup complete. Ready to record again.');
  }


  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function analyzeForm() {
    const form = document.querySelector('form');
    if (!form) return null;

    const fields = [];
    const inputs = form.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
      if (input.type === 'hidden' || input.type === 'submit') return;

      const label = document.querySelector(`label[for="${input.id}"]`) || input.closest('label');
      fields.push({
        name: input.name || input.id,
        type: input.tagName.toLowerCase(),
        inputType: input.type,
        label: label ? label.textContent.trim() : ''
      });
    });

    return { fields };
  }

  function fillForm(data) {
    if (!data || !data.structured) return;

    for (const [name, value] of Object.entries(data.structured)) {
      const input = document.querySelector(`[name="${name}"]`);
      if (input) {
        input.value = value;
      }
    }
  }

  async function getTranscription(blob) {
    const audioBase64 = await blobToBase64(blob);
    const app = window.FirebaseApp.initializeApp(window.firebaseConfig);
    const functions = window.FirebaseFunctions.getFunctions(app);
    const transcribeAudio = window.FirebaseFunctions.httpsCallable(functions, 'transcribeAudio');

    try {
      const result = await transcribeAudio({ audioBase64 });
      return result.data.transcription;
    } catch (error) {
      console.error('VOX.AI: Firebase AI Logic call failed:', error);
      return null;
    }
  }

  // Message API from popup
  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'START_RECORDING') { 
      const el = document.getElementById(FLOAT_ID);
      if (el) {
        handleStartRecording(el).then(() => send({ success: true }));
      } else {
        send({ success: false, error: 'UI not ready' });
      }
      return true; 
    }
    if (msg.type === 'STOP_RECORDING') { 
      const el = document.getElementById(FLOAT_ID);
      if (el) {
        handleStopRecording(el).then(() => send({ success: true }));
      } else {
        send({ success: false, error: 'UI not ready' });
      }
      return true; 
    }
  });


  // Attach UI immediately
  try { createFloatingMic(); } catch (e) { /* ignore for pages that restrict injection */ }

} // end install guard