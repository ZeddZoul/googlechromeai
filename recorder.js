// recorder.js

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

function isRecording() {
  return recordingState.isRecording;
}

function isInitializing() {
    return recordingState.isInitializing;
}

function isStopping() {
    return recordingState.isStopping;
}

async function handleStartRecording() {
  recordingState.isInitializing = true;
  updateUIRecording();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingState.currentStream = stream;

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

    recordingState.mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });
    recordingState.chunks = [];
    recordingState.mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size) {
        recordingState.chunks.push(e.data);
      }
    };

    recordingState.mediaRecorder.onstop = async () => {
      const blob = new Blob(recordingState.chunks, { type: 'audio/webm' });
      const savedTranscript = recordingState.fallbackTranscript;
      cleanupAudioResources();
      await processRecording(blob, savedTranscript);
    };

    recordingState.mediaRecorder.start(100);

    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recordingState.recognizer = new SpeechRecognition();
        recordingState.recognizer.lang = 'en-US';
        recordingState.recognizer.interimResults = true;
        recordingState.recognizer.continuous = true;
        recordingState.fallbackTranscript = '';

        recordingState.recognizer.onresult = (ev) => {
          let transcript = '';
          for (let i = 0; i < ev.results.length; i++) {
            transcript += ev.results[i][0].transcript + ' ';
          }
          if (transcript.trim()) {
            recordingState.fallbackTranscript = transcript.trim();
          }
        };

        recordingState.recognizer.onerror = (err) => {
          console.warn('VOX.AI: SpeechRecognition error', err);
        };

        try {
          recordingState.recognizer.start();
        } catch (e) {
          console.error("VOX.AI: Failed to start SpeechRecognition", e);
        }
      }
    } catch (e) {
      console.error('VOX.AI: SpeechRecognition not available', e);
    }

    if (recordingState.analyser) startAnalyseLoop(recordingState.analyser);

    recordingState.isRecording = true;
    recordingState.isInitializing = false;

  } catch (err) {
    console.error('VOX.AI: Failed to start recording:', err);
    recordingState.isInitializing = false;
    cleanupAudioResources();
  }
}

async function handleStopRecording() {
  recordingState.isStopping = true;

  try {
    if (recordingState.rafId) {
      cancelAnimationFrame(recordingState.rafId);
      recordingState.rafId = null;
    }

    if (recordingState.recognizer) {
      recordingState.recognizer.stop();
    }
    if (recordingState.mediaRecorder && recordingState.mediaRecorder.state !== 'inactive') {
      recordingState.mediaRecorder.stop();
    } else {
      cleanupAudioResources();
    }

    recordingState.isRecording = false;
    recordingState.isStopping = false;
    updateUIStopped();

  } catch (err) {
    console.error('VOX.AI: Error stopping recording:', err);
    recordingState.isStopping = false;
    cleanupAudioResources();
  }
}

async function processRecording(blob, savedTranscript) {
  const channel = `voxai_resp_${Math.random().toString(36).slice(2)}`;

  const onDeviceCheck = async (e) => {
    if (!e.data || e.data.channel !== channel || typeof e.data.payload === 'undefined') return;
    window.removeEventListener('message', onDeviceCheck);

    let transcription = null;
    let nanoSession = e.data.payload.session || null;

    transcription = await transcribeAudio(blob, savedTranscript);

    if (!transcription) {
      showNotification('No speech detected. Please try again.');
      console.warn('VOX.AI: All transcription methods failed');
      return;
    }

    if (transcription && transcription.trim() !== '') {
    const schema = analyzeForm();

    const onInpageResponse = (e) => {
      if (e.data && e.data.voxai) {
        return;
      }

      if (!e.data || e.data.channel !== channel) {
        return;
      }

      window.removeEventListener('message', onInpageResponse);

      let nanoData = null;
      if (e.data.payload && e.data.payload.success) {
        nanoData = e.data.payload.result;
      }

      if (nanoData && Object.keys(nanoData).length > 0) {
        fillForm(nanoData);
      } else {
        extractFormData(transcription, schema, nanoSession).then(extractedData => {
          if (extractedData && Object.keys(extractedData).length > 0) {
            fillForm(extractedData);
          } else {
            showNotification('Could not extract form data. Please review manually.');
          }
        });
      }
    };

    window.addEventListener('message', onInpageResponse);

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

function cleanupAudioResources() {
  if (recordingState.recognizer) {
    recordingState.recognizer = null;
  }

  if (recordingState.currentStream) {
    recordingState.currentStream.getTracks().forEach(t => t.stop());
    recordingState.currentStream = null;
  }

  if (recordingState.analyser) recordingState.analyser.disconnect();
  if (recordingState.sourceNode) recordingState.sourceNode.disconnect();
  if (recordingState.audioContext) {
    recordingState.audioContext.close().catch(() => { });
    recordingState.audioContext = null;
  }

  recordingState.mediaRecorder = null;
  recordingState.isRecording = false;
  recordingState.isInitializing = false;
  recordingState.isStopping = false;
  recordingState.chunks = [];
  recordingState.fallbackTranscript = '';

  updateUIStopped();
}
