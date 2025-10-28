// Survsay - content_script.js

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
        const micId = `survsay-floating-mic-${index}`;
        if (document.getElementById(micId)) return;

        const el = document.createElement('button');
        el.id = micId;
        el.classList.add('survsay-floating-mic');
        el.style.position = 'absolute';
        el.style.background = '#7C3AED';
        el.style.color = 'white';
        el.style.border = 'none';
        el.style.borderRadius = '8px';
        el.style.padding = '8px 12px';
        el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.15)';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '8px';
        el.style.cursor = 'pointer';
        el.style.zIndex = 2147483646;
        el.style.fontFamily = 'sans-serif';
        el.style.fontSize = '14px';
        el.style.fontWeight = '600';
        el.style.transition = 'all 0.2s ease-in-out';
        el.style.opacity = '0';
        el.style.transform = 'translateY(5px)';
        el.title = 'Survsay - Click to fill this form with your voice';

        const micIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" fill="#fff"/><path d="M19 11a1 1 0 0 1-2 0 5 5 0 0 1-10 0 1 1 0 0 1-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z" fill="#fff" opacity="0.9"/></svg>`;
        el.innerHTML = `${micIconSvg}<span>fill this form with survsay</span>`;

        form.style.position = 'relative';
        form.appendChild(el);

        chrome.storage.sync.get({ micPosition: 'top-right' }, (settings) => {
            if (settings.micPosition === 'top-left') {
                el.style.top = '10px';
                el.style.left = '10px';
            } else { // Default to top-right
                el.style.top = '10px';
                el.style.right = '10px';
            }
        });

        form.addEventListener('mouseenter', () => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
        form.addEventListener('mouseleave', () => { if (!el.classList.contains('survsay-recording')) { el.style.opacity = '0'; el.style.transform = 'translateY(5px)'; } });
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (recordingState.isInitializing || recordingState.isStopping) return;
            if (!recordingState.isRecording) { await handleStartRecording(el, form); } else { await handleStopRecording(el); }
        });
    });
}

function removeAllMics() {
    const mics = document.querySelectorAll('.survsay-floating-mic');
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

        recordingState.isRecording = true;
        el.classList.add('survsay-recording');
        el.style.background = '#6b21a8'; // Darker purple for recording state
        el.querySelector('span').textContent = 'Recording...';
    } catch (err) {
        console.error('Survsay: Failed to start recording:', err);
        cleanupAudioResources();
    }
    recordingState.isInitializing = false;
}

async function handleStopRecording(el) {
    recordingState.isStopping = true;
    if (recordingState.recognizer) recordingState.recognizer.stop();
    if (recordingState.mediaRecorder && recordingState.mediaRecorder.state !== 'inactive') recordingState.mediaRecorder.stop();
    else cleanupAudioResources();
    el.classList.remove('survsay-recording');
    el.style.background = '#7C3AED'; // Back to original purple
    el.querySelector('span').textContent = 'fill this form with survsay';
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

async function processRecording(blob, fallbackTranscript) {
    console.log("Survsay: Starting multi-layer transcription process...");

    // Perform a single, definitive eligibility check.
    const isNanoEligible = await new Promise((resolve) => {
        const channel = `survsay_nano_eligibility_${Math.random().toString(36).slice(2)}`;
        const onEligibilityResponse = (e) => {
            if (e.data.channel === channel) {
                window.removeEventListener('message', onEligibilityResponse);
                resolve(e.data.payload && e.data.payload.success && e.data.payload.isEligible);
            }
        };
        setTimeout(() => {
            window.removeEventListener('message', onEligibilityResponse);
            resolve(false);
        }, 1000);
        window.addEventListener('message', onEligibilityResponse);
        window.postMessage({ voxai: 'CHECK_NANO_ELIGIBILITY', channel }, '*');
    });

    let transcription = null;

    if (isNanoEligible) {
        // Layer 1: Try Gemini Nano for transcription.
        try {
            console.log("Survsay: Device is eligible. Attempting transcription with Gemini Nano (Layer 1)...");
            const base64Audio = await blobToBase64(blob);
            const nanoResult = await new Promise((resolve, reject) => {
                const channel = `survsay_nano_transcribe_${Math.random().toString(36).slice(2)}`;
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
                console.log("Survsay: Gemini Nano transcription successful (Layer 1).");
                transcription = nanoResult;
            }
        } catch (error) {
            console.warn("Survsay: Gemini Nano transcription failed (Layer 1).", error);
        }
    } else {
        console.log("Survsay: Gemini Nano not eligible. Proceeding to Layer 2 (Firebase).");
    }

    // Layer 2: If Nano failed or was ineligible, try Firebase AI.
    if (!transcription) {
        try {
            console.log("Survsay: Attempting transcription with Firebase AI (Layer 2)...");
            const base64Audio = await blobToBase64(blob);
            const firebaseResult = await new Promise((resolve, reject) => {
                const onFirebaseResponse = (e) => {
                    if (e.data.action === 'SURVSAY_FIREBASE_TRANSCRIPTION_RESULT') {
                        window.removeEventListener('message', onFirebaseResponse);
                        if (e.data.result) {
                            resolve(e.data.result);
                        } else {
                            reject(new Error(e.data.error || 'Unknown Firebase error'));
                        }
                    }
                };
                window.addEventListener('message', onFirebaseResponse);
                window.postMessage({ action: 'SURVSAY_TRANSCRIBE_AUDIO', audioBase64: base64Audio }, '*');
            });

            if (firebaseResult) {
                console.log("Survsay: Firebase AI transcription successful (Layer 2).");
                transcription = firebaseResult;
            }
        } catch (error) {
            console.warn("Survsay: Firebase AI transcription failed (Layer 2).", error);
        }
    }

    // Layer 3: If all else fails, use the Web Speech API fallback.
    if (!transcription && fallbackTranscript) {
        console.log("Survsay: Using Web Speech API transcription as fallback (Layer 3).");
        transcription = fallbackTranscript;
    }

    // Now, process the final transcription.
    if (transcription) {
        await processTextWithAI(transcription, isNanoEligible);
    } else {
        console.error("Survsay: All transcription layers failed.");
    }
}

async function processTextWithAI(transcription, isNanoEligible) {
    if (!transcription) {
        console.warn("Survsay: Cannot process empty transcription.");
        return;
    }

    const schema = analyzeForm(recordingState.activeForm);
    const context = getSurroundingText(recordingState.activeForm);

    if (isNanoEligible) {
        // Layer 1: Use Gemini Nano for text extraction.
        console.log("Survsay: Processing text with Gemini Nano (Layer 1)...");
        try {
            const nanoResult = await new Promise((resolve, reject) => {
                const channel = `survsay_resp_${Math.random().toString(36).slice(2)}`;
                const onInpageResponse = (e) => {
                    if (e.data.channel !== channel || !e.data.payload) return;
                    window.removeEventListener('message', onInpageResponse);
                    if (e.data.payload.success) {
                        resolve(e.data.payload.result);
                    } else {
                        reject(new Error(e.data.payload.error || 'Unknown Nano text processing error'));
                    }
                };
                window.addEventListener('message', onInpageResponse);
                window.postMessage({ voxai: 'PROCESS_TEXT_INPAGE', text: transcription, schema, context, channel }, '*');
            });
            fillForm(nanoResult, recordingState.activeForm);
        } catch (error) {
            console.warn("Survsay: Nano text processing failed (Layer 1). Now attempting Firebase fallback (Layer 2).", error);
            await processTextWithFirebase(transcription, schema, context);
        }
    } else {
        // Layer 2: Use Firebase for text extraction.
        console.log("Survsay: Nano not eligible for text processing. Using Firebase AI (Layer 2)...");
        await processTextWithFirebase(transcription, schema, context);
    }
}

async function processTextWithFirebase(transcription, schema, context) {
    try {
        const firebaseResult = await new Promise((resolve, reject) => {
            const onFirebaseResponse = (e) => {
                if (e.data.action === 'SURVSAY_FIREBASE_EXTRACTION_RESULT') {
                    window.removeEventListener('message', onFirebaseResponse);
                    if (e.data.result) {
                        resolve(e.data.result);
                    } else {
                        reject(new Error(e.data.error || 'Unknown Firebase extraction error'));
                    }
                }
            };
            window.addEventListener('message', onFirebaseResponse);
            window.postMessage({ action: 'SURVSAY_PROCESS_TEXT_FIREBASE', text: transcription, schema, context }, '*');
        });
        fillForm(firebaseResult, recordingState.activeForm);
    } catch (error) {
        console.error("Survsay: Firebase text processing failed (Layer 2).", error);
    }
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

function injectAnimationStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes survsay-pulse {
            0% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(124, 58, 237, 0); }
            100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0); }
        }
        .survsay-recording {
            animation: survsay-pulse 2s infinite;
        }
    `;
    document.head.appendChild(style);
}

function main() {
    if (window.__survsay_installed) return;
    window.__survsay_installed = true;

    injectAnimationStyles();

    // Inject inpage.js for Nano communication
    (function injectInpage() {
        try {
            const src = chrome.runtime.getURL('inpage.js');
            const s = document.createElement('script');
            s.src = src;
            s.type = 'text/javascript';
            (document.head || document.documentElement).appendChild(s);
            s.onload = () => s.remove();
        } catch (err) { console.warn('Survsay: failed to inject inpage.js', err); }
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
    // Inject Firebase injector for cloud AI capabilities
    (function() {
        if (!window.__survsay_firebase_injected) {
            window.__survsay_firebase_injected = true;
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
