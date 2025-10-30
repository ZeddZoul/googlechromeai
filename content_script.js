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

// --- Busy Overlay (uses brand palette) ---
const SURVSAY_PALETTE = ['#696FC7', '#A7AAE1', '#F5D3C4', '#F2AEBB'];
function ensureBusyUI() {
    if (document.getElementById('survsay-busy')) return;
    const style = document.createElement('style');
    style.id = 'survsay-busy-style';
    style.textContent = `
            .survsay-hidden{display:none !important}
            #survsay-busy{position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:14px;background:rgba(255,255,255,0.9);backdrop-filter:saturate(120%) blur(6px);border:1px solid #e8e7f5;box-shadow:0 10px 25px rgba(0,0,0,.08)}
            #survsay-busy .spinner{width:22px;height:22px;border-radius:50%;position:relative;overflow:hidden;animation:survsay-rotate 1.1s linear infinite}
            #survsay-busy .spinner::before{content:'';position:absolute;inset:0;border-radius:50%;padding:2px;background:conic-gradient(${SURVSAY_PALETTE.join(',')});-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;}
            #survsay-busy .dot{position:absolute;inset:4px;border-radius:50%;background:linear-gradient(135deg, ${SURVSAY_PALETTE[1]}, #fff)}
            #survsay-busy .label{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Noto Sans',sans-serif;font-size:13px;font-weight:600;color:#3b3b55}
            #survsay-busy .progress{height:3px;border-radius:999px;background:#f2f2f8;overflow:hidden;margin-top:6px}
            #survsay-busy .bar{width:35%;height:100%;background:linear-gradient(90deg, ${SURVSAY_PALETTE.join(',')});border-radius:999px;animation:survsay-indet 1.4s ease-in-out infinite}
            @keyframes survsay-rotate{to{transform:rotate(360deg)}}
            @keyframes survsay-indet{0%{margin-left:-40%}50%{margin-left:60%}100%{margin-left:120%}}
        `;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.id = 'survsay-busy';
    box.className = 'survsay-hidden';
    box.innerHTML = `
            <div class="spinner"><div class="dot"></div></div>
            <div style="display:flex;flex-direction:column;gap:2px;min-width:160px">
                <div class="label">Survsay is working…</div>
                <div class="progress"><div class="bar"></div></div>
            </div>
        `;
    document.body.appendChild(box);
}

function showBusy(message) {
    ensureBusyUI();
    const box = document.getElementById('survsay-busy');
    const label = box.querySelector('.label');
    if (message) label.textContent = message;
    box.classList.remove('survsay-hidden');
}

function hideBusy() {
    const box = document.getElementById('survsay-busy');
    if (box) box.classList.add('survsay-hidden');
}

function init() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({ micEnabled: true }, (settings) => {
            if (settings.micEnabled) {
                attachMicsToForms();

                // Listen for Firebase ready signal via postMessage
                let firebaseReady = false;
                const onFirebaseReadyMessage = (event) => {
                    if (event.data && event.data.action === 'SURVSAY_FIREBASE_READY') {
                        console.log('Survsay: Firebase injector confirmed ready via postMessage');
                        firebaseReady = true;
                        window.removeEventListener('message', onFirebaseReadyMessage);
                    }
                };
                window.addEventListener('message', onFirebaseReadyMessage);

                setTimeout(() => {
                    window.removeEventListener('message', onFirebaseReadyMessage);
                    if (!firebaseReady) {
                        console.warn('Survsay: Firebase injector failed to load, likely due to CSP. Disabling mics.');
                        removeAllMics();
                        chrome.runtime.sendMessage({ type: 'CSP_BLOCKED' });
                    }
                    resolve();
                }, 5000);
            } else {
                resolve();
            }
        });
    });
}

function attachMicsToForms() {
    const forms = document.querySelectorAll('form');
    const divForms = findDivForms();
    const allForms = [...forms, ...divForms];

    allForms.forEach((form, index) => {
        const micId = `survsay-floating-mic-${index}`;
        if (document.getElementById(micId)) return;

        const el = document.createElement('button');
        el.id = micId;
        el.classList.add('survsay-floating-mic');
        el.style.position = 'absolute';
        el.style.background = 'white';
        el.style.color = 'black';
        el.style.border = '1px solid #7C3AED';
        el.style.borderRadius = '8px';
        el.style.padding = '2px 6px';
        el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.15)';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '8px';
        el.style.cursor = 'pointer';
        el.style.zIndex = 2147483646;
        el.style.fontFamily = 'sans-serif';
        el.style.fontSize = '12px';
        el.style.fontWeight = 'normal';
        el.style.transition = 'all 0.2s ease-in-out';
        el.style.opacity = '0';
        el.style.transform = 'translateY(5px)';
        el.title = 'Survsay - Click to fill this form with your voice';

        const micIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" fill="#7C3AED"/><path d="M19 11a1 1 0 0 1-2 0 5 5 0 0 1-10 0 1 1 0 0 1-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z" fill="#7C3AED" opacity="0.9"/></svg>`;
        el.innerHTML = `${micIconSvg}<span>fill this form with survsay</span>`;

        document.body.appendChild(el); // Append to body to avoid form layout issues

        const setPosition = () => {
            const formRect = form.getBoundingClientRect();
            chrome.storage.sync.get({ micPosition: 'top-right' }, (settings) => {
                let pos = settings.micPosition;
                el.style.position = 'fixed';

                // --- Calculate potential top position ---
                let topPos = 0;
                if (pos.includes('top')) {
                    topPos = formRect.top - el.offsetHeight - 5;
                } else { // 'bottom'
                    topPos = formRect.bottom + 5;
                }

                // --- Adjust if off-screen ---
                // If the calculated top is off the viewport, place it inside the form.
                if (topPos < 0) {
                    el.style.top = `${formRect.top + 10}px`;
                    el.style.left = `${formRect.right - el.offsetWidth - 10}px`;
                    return;
                }

                // --- Default positioning ---
                // Smarter positioning: if bottom is off-screen, flip to top
                if (pos.includes('bottom')) {
                    const buttonBottom = formRect.bottom + el.offsetHeight + 5;
                    if (buttonBottom > window.innerHeight) {
                        pos = pos.replace('bottom', 'top');
                    }
                }

                if (pos.includes('top')) {
                    el.style.top = `${formRect.top - el.offsetHeight - 5}px`;
                } else { // 'bottom'
                    el.style.top = `${formRect.bottom + 5}px`;
                }

                if (pos.includes('left')) {
                    el.style.left = `${formRect.left}px`;
                } else { // 'right'
                    el.style.left = `${formRect.right - el.offsetWidth}px`;
                }
            });
        };

        // Store the reposition function on the element for later removal
        el.__survsay_reposition = setPosition;

        // Set initial position and update on window resize
        setTimeout(setPosition, 100); // Delay to ensure button is rendered for size calcs
        window.addEventListener('resize', setPosition);

        let hideTimeout;
        const show = () => {
            clearTimeout(hideTimeout);
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        };
        const hide = () => {
            if (recordingState.isRecording && el.classList.contains('survsay-recording')) return;
            hideTimeout = setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(5px)';
            }, 300);
        };

        form.addEventListener('mouseenter', show);
        form.addEventListener('mouseleave', hide);
        el.addEventListener('mouseenter', show);
        el.addEventListener('mouseleave', hide);

        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (recordingState.isInitializing || recordingState.isStopping) return;
            if (!recordingState.isRecording) { await handleStartRecording(el, form); } else { await handleStopRecording(el); }
        });
    });
}

function removeAllMics() {
    const mics = document.querySelectorAll('.survsay-floating-mic');
    mics.forEach(mic => {
        window.removeEventListener('resize', mic.__survsay_reposition);
        mic.remove();
    });
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
        el.classList.add('survsay-recording-pulse');
        el.style.background = '#DC2626'; // Red background for recording
        el.style.color = 'white';
        el.querySelector('span').textContent = 'stop recording';
        // Make sure all SVG paths turn white
        el.querySelectorAll('svg path').forEach(p => p.style.fill = 'white');
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
    el.classList.remove('survsay-recording-pulse');
    el.style.background = 'white'; // Back to original white
    el.style.color = 'black';
    el.querySelector('span').textContent = 'fill this form with survsay';
    // And all SVG paths back to purple
    el.querySelectorAll('svg path').forEach(p => p.style.fill = '#7C3AED');
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

function findDivForms() {
    const candidateDivs = [];
    document.querySelectorAll('div').forEach(div => {
        // A div is a candidate if it's not inside a real form and doesn't contain one.
        if (div.closest('form') || div.querySelector('form')) {
            return;
        }
        const inputs = div.querySelectorAll('input, textarea, select');
        if (inputs.length >= 2) {
            candidateDivs.push(div);
        }
    });

    // Filter out candidates that are nested inside other candidates.
    // This ensures we only attach a mic to the outermost "form-like" div.
    const divForms = candidateDivs.filter(d1 => {
        return !candidateDivs.some(d2 => d1 !== d2 && d2.contains(d1));
    });

    divForms.forEach(div => div.classList.add('survsay-div-form'));

    return divForms;
}

async function processRecording(blob, fallbackTranscript) {
    showBusy('Analyzing audio…');

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
        window.postMessage({ survsay: 'CHECK_NANO_ELIGIBILITY', channel }, '*');
    });

    let transcription = null;

    if (isNanoEligible) {
        // Layer 1: Try Gemini Nano for transcription.
        try {
            showBusy('Transcribing on-device…');
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
                window.postMessage({ survsay: 'PROCESS_AUDIO_INPAGE', audioBase64: base64Audio, channel }, '*');
            });

            if (nanoResult) {
                transcription = nanoResult;
            }
        } catch (error) {
            console.warn("Survsay: Gemini Nano transcription failed (Layer 1).", error);
        }
    } else {
        showBusy('Transcribing via cloud…');
    }

    // Layer 2: If Nano failed or was ineligible, try Firebase AI.
    if (!transcription) {
        try {
            showBusy('Transcribing via cloud…');
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
                transcription = firebaseResult;
            }
        } catch (error) {
            console.warn("Survsay: Firebase AI transcription failed (Layer 2).", error);
        }
    }

    // Layer 3: If all else fails, use the Web Speech API fallback.
    if (!transcription && fallbackTranscript) {
        showBusy('Using Web Speech API…');
        transcription = fallbackTranscript;
    }

    // Now, process the final transcription.
    if (transcription) {
        await processTextWithAI(transcription, isNanoEligible);
    } else {
        console.error("Survsay: All transcription layers failed.");
        hideBusy();
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
        showBusy('Extracting fields on-device…');
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
                window.postMessage({ survsay: 'PROCESS_TEXT_INPAGE', text: transcription, schema, context, channel }, '*');
            });
            fillForm(nanoResult, recordingState.activeForm);
            hideBusy();
        } catch (error) {
            console.warn("Survsay: Nano text processing failed (Layer 1). Now attempting Firebase fallback (Layer 2).", error);
            await processTextWithFirebase(transcription, schema, context);
        }
    } else {
        // Layer 2: Use Firebase for text extraction.
        showBusy('Extracting fields via cloud…');
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
        hideBusy();
    } catch (error) {
        console.error("Survsay: Firebase text processing failed (Layer 2).", error);
        hideBusy();
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

function attachRewriterButtons() {
    const fields = document.querySelectorAll('input[type="text"], textarea');

    fields.forEach((field, index) => {
        const buttonId = `survsay-rewriter-button-${index}`;
        if (document.getElementById(buttonId)) return;

        const button = document.createElement('button');
        button.id = buttonId;
        button.classList.add('survsay-rewriter-button');
        button.style.position = 'absolute';
        button.style.background = 'white';
        button.style.border = '1px solid #7C3AED';
        button.style.borderRadius = '6px';
        button.style.padding = '2px';
        button.style.cursor = 'pointer';
        button.style.zIndex = '2147483645';
        button.style.opacity = '0';
        button.style.transition = 'opacity 0.2s ease-in-out';
        button.style.lineHeight = '0';
        button.title = 'Rewrite this text with Survsay';

        const rewriterIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="#7C3AED"><path d="M9.5,3A1.5,1.5 0 0,0 8,4.5A1.5,1.5 0 0,0 9.5,6A1.5,1.5 0 0,0 11,4.5A1.5,1.5 0 0,0 9.5,3M19,13.5A1.5,1.5 0 0,0 17.5,12A1.5,1.5 0 0,0 16,13.5A1.5,1.5 0 0,0 17.5,15A1.5,1.5 0 0,0 19,13.5M19,3.5A1.5,1.5 0 0,0 17.5,2A1.5,1.5 0 0,0 16,3.5A1.5,1.5 0 0,0 17.5,5A1.5,1.5 0 0,0 19,3.5M14.5,21A1.5,1.5 0 0,0 16,19.5A1.5,1.5 0 0,0 14.5,18A1.5,1.5 0 0,0 13,19.5A1.5,1.5 0 0,0 14.5,21M4.14,11.5L2,9.36L5.03,6.34L7.17,8.47L4.14,11.5M19.86,11.5L16.83,8.47L18.97,6.34L22,9.36L19.86,11.5M4.14,14.22L2,16.36L5.03,19.39L7.17,17.25L4.14,14.22M19.86,14.22L16.83,17.25L18.97,19.39L22,16.36L19.86,14.22Z" /></svg>`;
        button.innerHTML = rewriterIconSvg;

        document.body.appendChild(button);

        const setPosition = () => {
            const fieldRect = field.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

            if (field.tagName.toLowerCase() === 'textarea') {
                button.style.top = `${fieldRect.bottom + scrollTop - button.offsetHeight - 8}px`;
                button.style.left = `${fieldRect.right + scrollLeft - button.offsetWidth - 8}px`;
            } else {
                button.style.top = `${fieldRect.top + scrollTop + (field.offsetHeight - button.offsetHeight) / 2}px`;
                button.style.left = `${fieldRect.right + scrollLeft + 5}px`;
            }
        };

        button.__survsay_reposition = setPosition;
        setPosition();
        window.addEventListener('resize', setPosition);
        window.addEventListener('scroll', setPosition, true);

        let hideTimeout;
        const show = () => { clearTimeout(hideTimeout); button.style.opacity = '1'; };
        const hide = () => { hideTimeout = setTimeout(() => { button.style.opacity = '0'; }, 300); };

        field.addEventListener('mouseenter', show);
        field.addEventListener('mouseleave', hide);
        button.addEventListener('mouseenter', show);
        button.addEventListener('mouseleave', hide);

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleRewrite(field, button);
        });
    });
}

async function handleRewrite(field, button) {
    const text = field.value;
    if (!text) return;

    // Simple loading indicator
    button.style.transform = 'rotate(360deg)';
    button.style.transition = 'transform 0.5s';

    const settings = await new Promise(resolve => {
        chrome.storage.sync.get({ rewriteTone: 'original', rewriteLength: 'original' }, resolve);
    });
    const { rewriteTone, rewriteLength } = settings;

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
        window.postMessage({ survsay: 'CHECK_NANO_ELIGIBILITY', channel }, '*');
    });

    let rewrittenText = null;

    if (isNanoEligible) {
        try {
            rewrittenText = await new Promise((resolve, reject) => {
                const channel = `survsay_rewrite_resp_${Math.random().toString(36).slice(2)}`;
                const onRewriteResponse = (event) => {
                    if (event.data.channel === channel) {
                        window.removeEventListener('message', onRewriteResponse);
                        if (event.data.payload && event.data.payload.success) {
                            resolve(event.data.payload.rewrittenText);
                        } else {
                            reject(new Error(event.data.payload ? event.data.payload.error : 'Unknown Nano rewrite error'));
                        }
                    }
                };
                window.addEventListener('message', onRewriteResponse);
                window.postMessage({ survsay: 'REWRITE_TEXT', text, tone: rewriteTone, length: rewriteLength, channel }, '*');
            });
        } catch (error) {
            console.warn("Survsay: Nano rewrite failed. Falling back to Firebase.", error);
        }
    }

    if (!rewrittenText) {
        try {
            rewrittenText = await new Promise((resolve, reject) => {
                const channel = `survsay_rewrite_firebase_resp_${Math.random().toString(36).slice(2)}`;
                const onFirebaseResponse = (e) => {
                    if (e.data.action === 'SURVSAY_FIREBASE_REWRITE_RESULT' && e.data.channel === channel) {
                        window.removeEventListener('message', onFirebaseResponse);
                        if (e.data.result) {
                            resolve(e.data.result);
                        } else {
                            reject(new Error(e.data.error || 'Unknown Firebase rewrite error'));
                        }
                    }
                };
                window.addEventListener('message', onFirebaseResponse);
                window.postMessage({ action: 'SURVSAY_REWRITE_TEXT_FIREBASE', text, tone: rewriteTone, length: rewriteLength, channel }, '*');
            });
        } catch (error) {
            console.error("Survsay: Firebase rewrite failed.", error);
        }
    }

    button.style.transform = 'rotate(0deg)';
    if (rewrittenText) {
        field.value = rewrittenText;
    }
}

function removeAllRewriterButtons() {
    const buttons = document.querySelectorAll('.survsay-rewriter-button');
    buttons.forEach(button => {
        window.removeEventListener('resize', button.__survsay_reposition);
        window.removeEventListener('scroll', button.__survsay_reposition, true);
        button.remove();
    });
}

// --- Main Execution ---

function injectAnimationStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes survsay-pulse-red {
            0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(220, 38, 38, 0); }
            100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
        }
        .survsay-recording-pulse {
            animation: survsay-pulse-red 2s infinite;
        }
    `;
    document.head.appendChild(style);
}

function main() {
    if (window.__survsay_installed) return;
    window.__survsay_installed = true;

    injectAnimationStyles();
    attachRewriterButtons();

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


    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'SETTINGS_UPDATED') {
            removeAllMics();
            if (msg.settings.micEnabled) {
                attachMicsToForms();
            }
            // The rewriter buttons should be independent of the mic setting.
            removeAllRewriterButtons();
            attachRewriterButtons();
        } else if (msg.type === 'PING') {
            sendResponse({ ok: true });
        }
    });

    init();
}

if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
    // Inject Firebase injector for cloud AI capabilities
    (function () {
        if (!window.__survsay_firebase_injected) {
            window.__survsay_firebase_injected = true;
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('firebase-injector.js');
            script.onload = () => {
                console.log('Survsay: Firebase injector script loaded, starting init with CSP check');
            };
            document.head.appendChild(script);
        }
    })();
    // Start main() after giving firebase-injector a chance to load
    setTimeout(() => {
        main();
    }, 100); // Small delay to ensure firebase-injector starts loading first
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
        init,
    };
}
