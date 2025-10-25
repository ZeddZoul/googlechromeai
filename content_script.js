// VOX.AI - content_script.js
// Provides a small floating microphone UI that the user can click to start/stop
// recording. Audio is forwarded to the injected in-page script (inpage.js)
// which is responsible for calling the browser's built-in Prompt API.

// --- Inject Firebase SDK into page context ---
(function() {
  if (!window.__voxai_firebase_injected) {
    window.__voxai_firebase_injected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('firebase-injector.js');
    document.head.appendChild(script);
    console.log('VOX.AI [Content Script]: Injected Firebase SDK loader');
  }
})();

// --- Firebase transcription function (disabled - requires backend setup) ---
// Uncomment and configure if you have Firebase Functions deployed
/*
let firebaseModel;
async function getTranscription(blob) {
  if (!firebaseModel) {
    try {
      const firebaseApp = firebase.app.initializeApp(window.firebaseConfig);
      const ai = firebase.ai.getAI(firebaseApp);
      firebaseModel = firebase.ai.getGenerativeModel(ai, { model: "gemini-pro" });
      console.log('VOX.AI: Firebase AI Logic SDK initialized for fallback.');
    } catch (e) {
      console.error('VOX.AI: Could not initialize Firebase AI Logic SDK for fallback.', e);
      return null;
    }
  }

  try {
    const audioPart = {
      inlineData: {
        data: await blobToBase64(blob),
        mimeType: blob.type,
      },
    };
    const result = await firebaseModel.generateContent([
      "Please transcribe this audio recording.",
      audioPart
    ]);
    return result.response.text();
  } catch (error) {
    console.error('VOX.AI: Firebase AI Logic SDK transcription failed:', error);
    return null;
  }
}
*/

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

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
    el.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    el.style.transform = 'scale(1)';
    el.title = 'VOX.AI — click to start/stop recording';

    // Add hover effects
    el.addEventListener('mouseenter', () => {
      if (!recordingState.isRecording && !recordingState.isInitializing && !recordingState.isStopping) {
        el.style.transform = 'scale(1.05)';
        el.style.boxShadow = '0 12px 40px rgba(0,0,0,0.2)';
      }
    });

    el.addEventListener('mouseleave', () => {
      if (!recordingState.isRecording) {
        el.style.transform = 'scale(1)';
        el.style.boxShadow = '0 8px 30px rgba(0,0,0,0.15)';
      }
    });

    // Add click animation
    el.addEventListener('mousedown', () => {
      el.style.transform = 'scale(0.95)';
    });

    el.addEventListener('mouseup', () => {
      if (!recordingState.isRecording) {
        el.style.transform = 'scale(1.05)';
      }
    });

    // Inner structure: waveform container + central mic button
    el.innerHTML = `
      <div id="voxai-wave" style="position:absolute;inset:8px;border-radius:28px;pointer-events:none;display:flex;align-items:center;justify-content:center;">
        <div id="voxai-level" style="display:flex;gap:3px;align-items:center;justify-content:center;pointer-events:none;">
          ${Array.from({ length: 9 }).map(() => '<div class="vox-bar" style="width:3px;height:10px;background:rgba(255,255,255,0.28);border-radius:2px;transition:height 0.08s linear, background 120ms linear"></div>').join('')}
        </div>
      </div>
      <div id="voxai-button" style="position:relative;width:52px;height:52px;border-radius:26px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,0.15);transition:all 0.3s ease;">
        <svg id="voxai-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="transition:all 0.3s ease;">
          <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" fill="#FFD700"/>
          <path d="M19 11a1 1 0 0 1-2 0 5 5 0 0 1-10 0 1 1 0 0 1-2 0 5 5 0 0 0 4 4.9V20a1 1 0 1 0 2 0v-4.1A5 5 0 0 0 19 11z" fill="#FFD700" opacity="0.6"/>
        </svg>
      </div>
      <div id="voxai-status" style="position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:#4CAF50;display:none;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.2);">
        <div style="width:8px;height:8px;border-radius:50%;background:#fff;animation:pulse 1.5s infinite;"></div>
      </div>`;

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.2); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes recordingPulse {
        0% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0.7); }
        70% { box-shadow: 0 0 0 10px rgba(255, 107, 107, 0); }
        100% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0); }
      }
      .voxai-recording {
        animation: recordingPulse 2s infinite;
      }
    `;
    document.head.appendChild(style);

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

      // Setup MediaRecorder with proper configuration
      recordingState.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      recordingState.chunks = [];
      recordingState.mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size) {
          recordingState.chunks.push(e.data);
          console.log('VOX.AI: Audio chunk received, size:', e.data.size);
        }
      };

      recordingState.mediaRecorder.onstop = async () => {
        const blob = new Blob(recordingState.chunks, { type: 'audio/webm' });
        // Save the transcript BEFORE cleanup (cleanup will clear it)
        const savedTranscript = recordingState.fallbackTranscript;
        console.log('VOX.AI: Saved transcript before cleanup:', savedTranscript);
        cleanupAudioResources();
        await processRecording(blob, savedTranscript);
      };

      recordingState.mediaRecorder.start(100); // Collect data every 100ms
      console.log('VOX.AI: MediaRecorder started with 100ms intervals');

      // Start SpeechRecognition fallback if available
      try {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
          recordingState.recognizer = new SpeechRecognition();
          recordingState.recognizer.lang = 'en-US';
          recordingState.recognizer.interimResults = true;
          recordingState.recognizer.continuous = true; // Keep recognition running
          recordingState.fallbackTranscript = '';

          recordingState.recognizer.onresult = (ev) => {
            // Accumulate all results (both interim and final)
            let transcript = '';
            for (let i = 0; i < ev.results.length; i++) {
              transcript += ev.results[i][0].transcript + ' ';
            }
            // Always update with the latest transcript
            if (transcript.trim()) {
              recordingState.fallbackTranscript = transcript.trim();
              console.log('VOX.AI: Speech recognition interim/final:', recordingState.fallbackTranscript);
            }
          };

          recordingState.recognizer.onerror = (err) => {
            console.warn('VOX.AI: SpeechRecognition error', err);
          };

          recordingState.recognizer.onend = () => {
            console.log('VOX.AI: SpeechRecognition ended, final transcript:', recordingState.fallbackTranscript);
          };

          try {
            recordingState.recognizer.start();
            console.log('VOX.AI: SpeechRecognition started');
          } catch (e) {
            console.error("VOX.AI: Failed to start SpeechRecognition", e);
          }
        }
      } catch (e) {
        console.error('VOX.AI: SpeechRecognition not available', e);
      }

      // Start the analyser draw loop if available
      if (recordingState.analyser) startAnalyseLoop();

      // Update UI state
      recordingState.isRecording = true;
      recordingState.isInitializing = false;
      el.dataset.recording = '1';
      el.style.background = '#ff6b6b';
      el.classList.add('voxai-recording');

      // Show recording status indicator
      const statusEl = el.querySelector('#voxai-status');
      if (statusEl) {
        statusEl.style.display = 'flex';
      }

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
      el.classList.remove('voxai-recording');

      // Hide recording status indicator
      const statusEl = el.querySelector('#voxai-status');
      if (statusEl) {
        statusEl.style.display = 'none';
      }

      console.log('VOX.AI: Recording stopped.');

    } catch (err) {
      console.error('VOX.AI: Error stopping recording:', err);
      recordingState.isStopping = false;
      cleanupAudioResources();
    }
  }

  async function processRecording(blob, savedTranscript) {
    console.log('VOX.AI: Processing recording with hybrid pipeline...');
    const channel = `voxai_resp_${Math.random().toString(36).slice(2)}`;

    const onDeviceCheck = async (e) => {
      if (!e.data || e.data.channel !== channel || typeof e.data.payload === 'undefined') return;
      window.removeEventListener('message', onDeviceCheck);

      console.log('VOX.AI: Device check response:', e.data.payload);

      let transcription = null;
      let nanoSession = e.data.payload.session || null;

      // Use hybrid transcription pipeline: Firebase -> Web Speech API
      console.log('VOX.AI: Starting hybrid transcription (Firebase with Web Speech fallback)');
      transcription = await transcribeAudio(blob, savedTranscript);

      if (!transcription) {
        showNotification('No speech detected. Please try again.');
        console.warn('VOX.AI: All transcription methods failed');
        return;
      }

      console.log('VOX.AI: Transcription successful:', transcription);

      if (transcription && transcription.trim() !== '') {
        console.log('VOX.AI: Transcription successful:', transcription);
      const schema = analyzeForm();
      console.log('VOX.AI: Form schema:', schema);

      // Setup listener for inpage response (for Nano session if available)
      const onInpageResponse = (e) => {
        console.log('VOX.AI: Received message in onInpageResponse:', e.data);

        // Ignore messages that are requests (have 'voxai' property)
        if (e.data && e.data.voxai) {
          console.log('VOX.AI: Ignoring request message with voxai:', e.data.voxai);
          return;
        }

        if (!e.data || e.data.channel !== channel) {
          return;
        }

        window.removeEventListener('message', onInpageResponse);
        console.log('VOX.AI: Channel matched! Processing response...');

        // Get Nano extraction result if available
        let nanoData = null;
        if (e.data.payload && e.data.payload.success) {
          nanoData = e.data.payload.result;
        }

        // If Nano succeeded, use it. Otherwise, use hybrid fallback
        if (nanoData && Object.keys(nanoData).length > 0) {
          console.log('VOX.AI: Using Nano extraction:', nanoData);
          fillForm(nanoData);
        } else {
          console.log('VOX.AI: Nano extraction failed, using Firebase fallback...');
          // Use Firebase/Pattern matching fallback
          extractFormData(transcription, schema, nanoSession).then(extractedData => {
            if (extractedData && Object.keys(extractedData).length > 0) {
              console.log('VOX.AI: Fallback extraction successful:', extractedData);
              fillForm(extractedData);
            } else {
              showNotification('Could not extract form data. Please review manually.');
            }
          });
        }
      };

      window.addEventListener('message', onInpageResponse);
      console.log('VOX.AI: Listener added for channel:', channel);

      // Send to Nano for Layer 1 extraction
      window.postMessage({
        voxai: 'PROCESS_TEXT_INPAGE',
        text: transcription,
        schema: schema,
        channel
      }, '*');
      } // closing if for transcription check
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
      recordingState.audioContext.close().catch(() => { });
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

    // Reset UI state
    const el = document.getElementById(FLOAT_ID);
    if (el) {
      el.style.background = '#FFD700';
      el.classList.remove('voxai-recording');
      delete el.dataset.recording;

      const statusEl = el.querySelector('#voxai-status');
      if (statusEl) {
        statusEl.style.display = 'none';
      }

      const levelEl = el._levelEl;
      if (levelEl) {
        levelEl.style.transform = 'scale(1)';
        levelEl.style.background = '#111';
      }
    }

    console.log('VOX.AI: Cleanup complete. Ready to record again.');
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
    console.log('VOX.AI: fillForm() called with data:', data);

    if (!data || !data.structured) {
      console.warn('VOX.AI: No structured data to fill form');
      return;
    }

    console.log('VOX.AI: Filling form with data:', data.structured);
    let filledCount = 0;

    for (const [name, value] of Object.entries(data.structured)) {
      console.log(`VOX.AI: Processing field: ${name} = ${value}`);

      // Try to find input by name attribute
      let inputs = document.querySelectorAll(`[name="${name}"]`);
      console.log(`VOX.AI: Found ${inputs.length} inputs for name="${name}"`);

      if (inputs.length === 0) {
        // Try by id if name doesn't work
        const inputById = document.getElementById(name);
        if (inputById) inputs = [inputById];
      }

      if (inputs.length > 0) {
        inputs.forEach(input => {
          if (input.type === 'radio') {
            // For radio buttons, find the one matching the value
            if (input.value.toLowerCase() === value.toLowerCase()) {
              input.checked = true;
              filledCount++;
              console.log(`VOX.AI: Filled radio ${name} = ${value}`);
            }
          } else if (input.tagName.toLowerCase() === 'select') {
            // For select elements, try to find matching option
            const options = Array.from(input.options);
            const matchingOption = options.find(opt =>
              opt.value.toLowerCase().includes(value.toLowerCase()) ||
              opt.text.toLowerCase().includes(value.toLowerCase())
            );
            if (matchingOption) {
              input.value = matchingOption.value;
              filledCount++;
              console.log(`VOX.AI: Filled select ${name} = ${matchingOption.value}`);
            }
          } else {
            // For text inputs and textareas
            input.value = value;
            filledCount++;
            console.log(`VOX.AI: Filled ${input.tagName} ${name} = ${value}`);
          }

          // Trigger change event
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      } else {
        console.warn(`VOX.AI: Could not find form field: ${name}`);
      }
    }

    console.log(`VOX.AI: Form filling complete. ${filledCount} fields filled.`);
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { analyzeForm, fillForm, getTranscription, blobToBase64 };
}
