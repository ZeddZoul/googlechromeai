// VOX.AI - content_script.js

// --- Helper Functions & State ---

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

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
    fallbackTranscript: '',
    activeForm: null,
};

function attachMicsToForms() {
    const forms = document.querySelectorAll('form');
    forms.forEach((form, index) => {
        const micId = `voxai-floating-mic-${index}`;
        if (document.getElementById(micId)) return;

        const el = document.createElement('div');
        el.id = micId;
        el.classList.add('voxai-floating-mic');
        el.style.position = 'absolute';
        el.style.width = '32px';
        el.style.height = '32px';
        el.style.borderRadius = '16px';
        el.style.background = 'rgba(0,0,0,0.1)';
        el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.cursor = 'pointer';
        el.style.zIndex = 2147483646;
        el.style.transition = 'all 0.2s ease-in-out';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.8)';
        el.title = 'VOX.AI - Click to record for this form';

        el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" fill="#333"/><path d="M19 11a1 1 0 0 1-2 0 5 5 0 0 1-10 0 1 1 0 0 1-2 0 5 5 0 0 0 4 4.9V20a1 1 0 1 0 2 0v-4.1A5 5 0 0 0 19 11z" fill="#333" opacity="0.6"/></svg>`;

        form.style.position = 'relative';
        form.appendChild(el);

        chrome.storage.sync.get({ micPosition: 'top-right' }, (settings) => {
            switch (settings.micPosition) {
                case 'top-left': el.style.top = '10px'; el.style.left = '10px'; break;
                case 'center': el.style.top = '50%'; el.style.left = '50%'; el.style.transform = 'translate(-50%, -50%) scale(0.8)'; break;
                default: el.style.top = '10px'; el.style.right = '10px'; break;
            }
        });

        form.addEventListener('mouseenter', () => { el.style.opacity = '1'; el.style.transform = el.style.transform.replace('scale(0.8)', 'scale(1)'); });
        form.addEventListener('mouseleave', () => { if (!el.classList.contains('voxai-recording')) { el.style.opacity = '0'; el.style.transform = el.style.transform.replace('scale(1)', 'scale(0.8)'); } });
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (recordingState.isInitializing || recordingState.isStopping) return;
            if (!recordingState.isRecording) { await handleStartRecording(el, form); } else { await handleStopRecording(el); }
        });
    });
}

function removeAllMics() {
    const mics = document.querySelectorAll('.voxai-floating-mic');
    mics.forEach(mic => mic.remove());
}

async function handleStartRecording(el, form) {
    recordingState.isInitializing = true;
    recordingState.activeForm = form;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordingState.currentStream = stream;

        recordingState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        recordingState.sourceNode = recordingState.audioContext.createMediaStreamSource(stream);
        recordingState.analyser = recordingState.audioContext.createAnalyser();
        recordingState.analyser.fftSize = 2048;
        recordingState.sourceNode.connect(recordingState.analyser);

        recordingState.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        recordingState.chunks = [];
        recordingState.mediaRecorder.ondataavailable = e => e.data.size && recordingState.chunks.push(e.data);
        recordingState.mediaRecorder.onstop = async () => {
            const blob = new Blob(recordingState.chunks, { type: 'audio/webm' });
            // The processRecording function now returns a promise that resolves
            // after the entire message exchange with inpage.js is complete.
            await processRecording(blob, recordingState.fallbackTranscript);
            cleanupAudioResources();
        };
        recordingState.mediaRecorder.start(100);

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
                if (transcript.trim()) recordingState.fallbackTranscript = transcript.trim();
            };
            recordingState.recognizer.start();
        }

        startAnalyseLoop();
        recordingState.isRecording = true;
        el.classList.add('voxai-recording');
        el.style.background = '#ff6b6b';
    } catch (err) {
        console.error('VOX.AI: Failed to start recording:', err);
        cleanupAudioResources();
    }
    recordingState.isInitializing = false;
}

async function handleStopRecording(el) {
    recordingState.isStopping = true;
    if (recordingState.recognizer) recordingState.recognizer.stop();
    if (recordingState.mediaRecorder && recordingState.mediaRecorder.state !== 'inactive') recordingState.mediaRecorder.stop();
    else cleanupAudioResources();
    el.classList.remove('voxai-recording');
    el.style.background = '#FFD700';
    recordingState.isStopping = false;
}

function cleanupAudioResources() {
    if (recordingState.rafId) cancelAnimationFrame(recordingState.rafId);
    if (recordingState.currentStream) recordingState.currentStream.getTracks().forEach(t => t.stop());
    if (recordingState.analyser) recordingState.analyser.disconnect();
    if (recordingState.sourceNode) recordingState.sourceNode.disconnect();
    if (recordingState.audioContext) recordingState.audioContext.close();
    Object.assign(recordingState, {
        isRecording: false, isInitializing: false, isStopping: false,
        mediaRecorder: null, chunks: [], audioContext: null, analyser: null,
        sourceNode: null, rafId: null, currentStream: null, recognizer: null,
        fallbackTranscript: '', activeForm: null
    });
}

function startAnalyseLoop() {
    if (!recordingState.analyser) return;
    const data = new Uint8Array(recordingState.analyser.fftSize);
    const el = document.querySelector('.voxai-recording');
    function draw() {
        if (!recordingState.analyser) return;
        recordingState.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += Math.pow((data[i] - 128) / 128, 2);
        const rms = Math.sqrt(sum / data.length);
        if (el) el.style.transform = `scale(${1 + rms * 0.4})`;
        recordingState.rafId = requestAnimationFrame(draw);
    }
    draw();
}

async function processRecording(blob, fallbackTranscript) {
    console.log("VOX.AI: Starting multi-layer transcription process...");

    // Layer 1: Try Gemini Nano (On-Device)
    try {
        console.log("VOX.AI: Attempting transcription with Gemini Nano (Layer 1)...");
        const base64Audio = await blobToBase64(blob);
        const nanoResult = await new Promise((resolve, reject) => {
            const channel = `voxai_nano_transcribe_${Math.random().toString(36).slice(2)}`;
            const onNanoResponse = (e) => {
                if (e.data.channel === channel) {
                    window.removeEventListener('message', onNanoResponse);
                    if (e.data.payload && e.data.payload.success) {
                        resolve(e.data.payload.result.transcription);
                    } else {
                        reject(new Error(e.data.payload ? e.data.payload.error : 'Unknown Nano error'));
                    }
                }
            };
            window.addEventListener('message', onNanoResponse);
            window.postMessage({ voxai: 'PROCESS_AUDIO_INPAGE', audioBase64: base64Audio, channel }, '*');
        });

        if (nanoResult) {
            console.log("VOX.AI: Gemini Nano transcription successful (Layer 1).");
            await processTextWithAI(nanoResult);
            return;
        }
    } catch (error) {
        console.warn("VOX.AI: Gemini Nano transcription failed (Layer 1).", error);
    }

    // Layer 2: Try Firebase AI (Cloud)
    try {
        console.log("VOX.AI: Attempting transcription with Firebase AI (Layer 2)...");
        const base64Audio = await blobToBase64(blob);
        const firebaseResult = await new Promise((resolve, reject) => {
            const onFirebaseResponse = (e) => {
                if (e.data.action === 'VOX_FIREBASE_TRANSCRIPTION_RESULT') {
                    window.removeEventListener('message', onFirebaseResponse);
                    if (e.data.result) {
                        resolve(e.data.result);
                    } else {
                        reject(new Error(e.data.error || 'Unknown Firebase error'));
                    }
                }
            };
            window.addEventListener('message', onFirebaseResponse);
            window.postMessage({ action: 'VOX_TRANSCRIBE_AUDIO', audioBase64: base64Audio }, '*');
        });

        if (firebaseResult) {
            console.log("VOX.AI: Firebase AI transcription successful (Layer 2).");
            await processTextWithAI(firebaseResult);
            return;
        }
    } catch (error) {
        console.warn("VOX.AI: Firebase AI transcription failed (Layer 2).", error);
    }

    // Layer 3: Use Web Speech API Fallback
    if (fallbackTranscript) {
        console.log("VOX.AI: Using Web Speech API transcription as fallback (Layer 3).");
        await processTextWithAI(fallbackTranscript);
    } else {
        console.error("VOX.AI: All transcription layers failed and no fallback transcript is available.");
    }
}

function processTextWithAI(transcription) {
    return new Promise((resolve) => {
        if (!transcription) {
            console.warn("VOX.AI: Cannot process empty transcription.");
            return resolve();
        }

        const channel = `voxai_resp_${Math.random().toString(36).slice(2)}`;
        const schema = analyzeForm(recordingState.activeForm);
        const context = getSurroundingText(recordingState.activeForm);

        const onInpageResponse = (e) => {
            if (e.data.channel !== channel || !e.data.payload) return;
            window.removeEventListener('message', onInpageResponse);
            if (e.data.payload.success) {
                fillForm(e.data.payload.result, recordingState.activeForm);
            }
            resolve();
        };

        window.addEventListener('message', onInpageResponse);
        window.postMessage({ voxai: 'PROCESS_TEXT_INPAGE', text: transcription, schema, context, channel }, '*');
    });
}

function analyzeForm(form) {
    if (!form) return null;
    const fields = [];
    form.querySelectorAll('input, textarea, select').forEach(input => {
        if (input.type === 'hidden' || input.type === 'submit') return;
        const label = document.querySelector(`label[for="${input.id}"]`) || input.closest('label');
        fields.push({ name: input.name || input.id, type: input.tagName.toLowerCase(), inputType: input.type, label: label ? label.textContent.trim() : '' });
    });
    return { fields };
}

function fillForm(data, form) {
    if (!data || !data.structured || !form) return;

    for (const [name, value] of Object.entries(data.structured)) {
        const elements = form.querySelectorAll(`[name="${name}"]`);
        if (elements.length === 0) continue;

        const el = elements[0];

        if (el.tagName === 'SELECT') {
            const option = Array.from(el.options).find(o => o.text.toLowerCase() === String(value).toLowerCase());
            if (option) {
                el.value = option.value;
            }
        } else if (el.type === 'radio') {
            const radioToSelect = Array.from(elements).find(r => r.value.toLowerCase() === String(value).toLowerCase());
            if (radioToSelect) {
                radioToSelect.checked = true;
            }
        } else if (el.type === 'checkbox') {
            // This assumes the value is a boolean or can be interpreted as one.
            el.checked = Boolean(value);
        } else {
            el.value = value;
        }
    }
}

function getSurroundingText(form) {
    let contextText = '';
    // Robustness: Ensure 'form' is a valid DOM element before proceeding.
    // A TypeError would occur if 'form' is not an element and lacks element properties.
    if (!form || typeof form.previousElementSibling === 'undefined') {
        return contextText;
    }

    let sibling = form.previousElementSibling;
    while (sibling && contextText.length < 500) {
        contextText = (sibling.textContent || '') + '\n' + contextText;
        sibling = sibling.previousElementSibling;
    }
    return contextText.trim();
}

// --- Main Execution ---

function main() {
    if (window.__voxai_installed) return;
    window.__voxai_installed = true;

    // Inject inpage.js
    (function injectInpage() {
        try {
            const src = chrome.runtime.getURL('inpage.js');
            const s = document.createElement('script');
            s.src = src;
            s.type = 'text/javascript';
            (document.head || document.documentElement).appendChild(s);
            s.onload = () => s.remove();
        } catch (err) { console.warn('VOX.AI: failed to inject inpage', err); }
    })();

    function init() {
        chrome.storage.sync.get({ micEnabled: true }, (settings) => {
            if (settings.micEnabled) attachMicsToForms();
        });
    }

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'SETTINGS_UPDATED') {
            removeAllMics();
            if (msg.settings.micEnabled) attachMicsToForms();
        }
    });

    init();
}

if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
    (function() {
        if (!window.__voxai_firebase_injected) {
            window.__voxai_firebase_injected = true;
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('firebase-injector.js');
            document.head.appendChild(script);
        }
    })();
    main();
}

// --- Exports for Testing ---

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        attachMicsToForms,
        removeAllMics,
        getSurroundingText,
        handleStartRecording,
        handleStopRecording,
        recordingState,
        analyzeForm,
        fillForm,
    };
}
