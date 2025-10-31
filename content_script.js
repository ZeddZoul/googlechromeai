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
    return new Promise((resolve) => {
        if (document.getElementById('survsay-busy')) {
            resolve();
            return;
        }

        // Get position from settings
        chrome.storage.sync.get({ busyPosition: 'top-right' }, (settings) => {
            const pos = settings.busyPosition || 'top-right';
            let positionStyles = '';
            if (pos === 'top-right') positionStyles = 'top:16px;right:16px;';
            else if (pos === 'top-left') positionStyles = 'top:16px;left:16px;';
            else if (pos === 'bottom-right') positionStyles = 'bottom:16px;right:16px;';
            else if (pos === 'bottom-left') positionStyles = 'bottom:16px;left:16px;';

            const style = document.createElement('style');
            style.id = 'survsay-busy-style';
            style.textContent = `
            .survsay-hidden{display:none !important}
            #survsay-busy{position:fixed;${positionStyles}z-index:2147483647;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:14px;background:rgba(255,255,255,0.9);backdrop-filter:saturate(120%) blur(6px);border:1px solid #e8e7f5;box-shadow:0 10px 25px rgba(0,0,0,.08)}
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
                <div class="label">Survsay is filling your form…</div>
                <div class="progress"><div class="bar"></div></div>
            </div>
        `;
            document.body.appendChild(box);
            resolve();
        });
    });
}

async function showBusy(message) {
    await ensureBusyUI();
    const box = document.getElementById('survsay-busy');
    const label = box.querySelector('.label');
    label.textContent = message || 'Survsay is filling your form…';
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
        el.style.border = '1px solid #696FC7';
        el.style.borderRadius = '8px';
        el.style.padding = '8px 16px';
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

        // Detect if this form behaves like a search bar
        const isSearchForm = (
            form.matches('[role="search"]') ||
            form.closest('[role="search"]') ||
            !!form.querySelector('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i], input[name="q" i], input[name*="search" i]')
        );
        el.dataset.survsayContext = isSearchForm ? 'search' : 'form';
        el.title = isSearchForm ? 'Search with Survsay' : 'Fill this form with Survsay';

        const logoImg = `<img src="${chrome.runtime.getURL('logo.PNG')}" alt="Survsay" style="width:30px;height:30px;object-fit:contain;border-radius:3px;" />`;
        el.innerHTML = `${logoImg}`;

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
        // Update title to reflect stop action
        el.title = 'Survsay - Click to stop recording';
        // Visual cue handled via background color; logo remains unchanged
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
    // Restore title based on context (search vs form)
    el.title = (el.dataset && el.dataset.survsayContext === 'search') ? 'Search with Survsay' : 'Fill this form with Survsay';
    // Reset to original content (logo only)
    const logoImg = `<img src="${chrome.runtime.getURL('logo.PNG')}" alt="Survsay" style="width:14px;height:14px;object-fit:contain;border-radius:3px;" />`;
    el.innerHTML = `${logoImg}`;
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
    showBusy();

    // Add processing glow to all form fields immediately
    if (recordingState.activeForm) {
        const fields = recordingState.activeForm.querySelectorAll('input, textarea, select');
        fields.forEach(field => {
            // Only add glow to visible, editable fields
            if (field.type !== 'hidden' && field.type !== 'submit' && field.type !== 'button') {
                addFieldGlow(field, true);
            }
        });
    }

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
            showBusy();
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
        showBusy();
    }

    // Layer 2: If Nano failed or was ineligible, try Firebase AI.
    if (!transcription) {
        try {
            showBusy();
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
        showBusy();
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
        showBusy();
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
        showBusy();
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

function addFieldGlow(element, isProcessing = true) {
    if (!element) return;

    // Inject glow styles if not already present
    if (!document.getElementById('survsay-glow-styles')) {
        const style = document.createElement('style');
        style.id = 'survsay-glow-styles';
        style.textContent = `
            @keyframes survsay-glow-pulse {
                0%, 100% { box-shadow: 0 0 5px rgba(242, 174, 187, 0.5), 0 0 10px rgba(242, 174, 187, 0.3); }
                50% { box-shadow: 0 0 15px rgba(242, 174, 187, 0.8), 0 0 25px rgba(242, 174, 187, 0.5); }
            }
            @keyframes survsay-glow-climax {
                0% { box-shadow: 0 0 15px rgba(242, 174, 187, 0.8), 0 0 25px rgba(242, 174, 187, 0.5); }
                50% { box-shadow: 0 0 30px rgba(242, 174, 187, 1), 0 0 50px rgba(242, 174, 187, 0.8), 0 0 70px rgba(242, 174, 187, 0.6); }
                100% { box-shadow: none; }
            }
            .survsay-field-processing {
                animation: survsay-glow-pulse 1.5s ease-in-out infinite !important;
                transition: box-shadow 0.3s ease-in-out !important;
            }
            .survsay-field-filled {
                animation: survsay-glow-climax 1s ease-out forwards !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Store original box-shadow
    if (!element.dataset.survsayOriginalShadow) {
        element.dataset.survsayOriginalShadow = element.style.boxShadow || 'none';
    }

    if (isProcessing) {
        element.classList.add('survsay-field-processing');
        element.classList.remove('survsay-field-filled');
    } else {
        element.classList.remove('survsay-field-processing');
        element.classList.add('survsay-field-filled');

        // Remove the filled class after animation completes
        setTimeout(() => {
            element.classList.remove('survsay-field-filled');
            // Restore original shadow
            if (element.dataset.survsayOriginalShadow) {
                element.style.boxShadow = element.dataset.survsayOriginalShadow;
                delete element.dataset.survsayOriginalShadow;
            }
        }, 1000);
    }
}

function fillForm(data, form) {
    if (!data || !data.structured || !form) return;

    for (const [name, value] of Object.entries(data.structured)) {
        const elements = form.querySelectorAll(`[name="${name}"]`);
        if (elements.length === 0) continue;

        const el = elements[0];

        // Field is already glowing from processRecording, just fill and climax
        if (el.tagName === 'SELECT') {
            const option = Array.from(el.options).find(o => o.text.toLowerCase() === String(value).toLowerCase());
            if (option) {
                el.value = option.value;
                // Climax glow after filling
                addFieldGlow(el, false);
            }
        } else if (el.type === 'radio') {
            const radioToSelect = Array.from(elements).find(r => r.value.toLowerCase() === String(value).toLowerCase());
            if (radioToSelect) {
                radioToSelect.checked = true;
                // Climax glow after filling
                addFieldGlow(radioToSelect, false);
            }
        } else if (el.type === 'checkbox') {
            // This assumes the value is a boolean or can be interpreted as one.
            el.checked = Boolean(value);
            // Climax glow after filling
            addFieldGlow(el, false);
        } else {
            el.value = value;
            // Climax glow after filling
            addFieldGlow(el, false);
        }
    }

    // Remove processing glow from any fields that weren't filled
    const allFields = form.querySelectorAll('input, textarea, select');
    allFields.forEach(field => {
        if (field.classList.contains('survsay-field-processing')) {
            // This field wasn't filled, remove the glow
            field.classList.remove('survsay-field-processing');
            if (field.dataset.survsayOriginalShadow) {
                field.style.boxShadow = field.dataset.survsayOriginalShadow;
                delete field.dataset.survsayOriginalShadow;
            }
        }
    });
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
        button.style.border = '1px solid #696FC7';
        button.style.borderRadius = '6px';
        button.style.padding = '2px';
        button.style.cursor = 'pointer';
        button.style.zIndex = '2147483645';
        button.style.opacity = '0';
        button.style.transition = 'opacity 0.2s ease-in-out';
        button.style.lineHeight = '0';
        button.title = 'Rewrite this text with Survsay';

        const rewriterIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#696FC7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`;
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

        // Only show when field has non-empty content
        const updateVisibility = () => {
            const hasValue = (field.value || '').trim().length > 0;
            if (!hasValue) {
                button.style.opacity = '0';
                button.style.display = 'none';
            } else {
                button.style.display = 'block';
            }
        };
        updateVisibility();
        field.addEventListener('input', () => { updateVisibility(); setPosition(); });
        field.addEventListener('change', () => { updateVisibility(); setPosition(); });

        let hideTimeout;
        const show = () => {
            clearTimeout(hideTimeout);
            if ((field.value || '').trim().length === 0) return;
            button.style.display = 'block';
            button.style.opacity = '1';
        };
        const hide = () => {
            hideTimeout = setTimeout(() => {
                button.style.opacity = '0';
                if ((field.value || '').trim().length === 0) button.style.display = 'none';
            }, 300);
        };

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

// Gather context about a field to improve rewriting
function getFieldContext(field) {
    const context = {
        label: '',
        placeholder: field.placeholder || '',
        type: field.type || 'text',
        name: field.name || '',
        id: field.id || '',
        hasNumbers: /\d/.test(field.value),
        hasProperNouns: false,
        isNameField: false,
        isEmailField: false,
        isPhoneField: false,
        isIdField: false,
        isUrlField: false,
        isDateField: false,
        isAddressField: false,
        instructions: ''
    };

    // Try to find associated label
    if (field.id) {
        const label = document.querySelector(`label[for="${field.id}"]`);
        if (label) context.label = label.textContent.trim();
    }
    if (!context.label) {
        const parent = field.closest('label');
        if (parent) context.label = parent.textContent.replace(field.value, '').trim();
    }
    if (!context.label) {
        const prevLabel = field.previousElementSibling;
        if (prevLabel && (prevLabel.tagName === 'LABEL' || prevLabel.classList.contains('label'))) {
            context.label = prevLabel.textContent.trim();
        }
    }

    // Detect if field is for names (first name, last name, full name, etc.)
    const meta = `${context.label} ${context.placeholder} ${context.name} ${context.id}`.toLowerCase();

    // Name fields
    const namePatterns = /(\bname\b|\bfirst\b|\blast\b|\bsurname\b|\bgiven\b|full\s*-?\s*name|user\s*-?\s*name|username)/i;
    const isNameField = namePatterns.test(meta);
    context.isNameField = isNameField;

    // Email fields
    const emailPatterns = /(e[-\s]?mail|\bemail\b)/i;
    context.isEmailField = emailPatterns.test(meta) || context.type === 'email';

    // Phone fields
    const phonePatterns = /(phone|mobile|telephone|tel\b|cell\b|whatsapp|contact\s*number|phone\s*number)/i;
    context.isPhoneField = phonePatterns.test(meta) || context.type === 'tel';

    // ID fields (employee id, student id, account number, national id, ssn, passport, etc.)
    const idPatterns = /(employee|student|tax|account|national|passport|driver|applicant|customer|user)\s*(id|number|no\.?|#)\b|\b(id\s*number|id#|id no\.?|ssn|nin|nid|pan|aadhaar|aadhar|dni|cedula|rfc|curp|nif)\b/i;
    context.isIdField = idPatterns.test(meta);

    // URL fields
    const urlPatterns = /(url|website|web\s*site|link|homepage|home\s*page|portfolio)/i;
    context.isUrlField = urlPatterns.test(meta) || context.type === 'url';

    // Date/time fields
    const datePatterns = /(date|dob|birth\s*date|birthday|start\s*date|end\s*date|expiry|expiration|exp\s*date|mm\/?yy(?:yy)?|yy(?:yy)?)/i;
    const dateTypes = ['date', 'datetime-local', 'month', 'time', 'week'];
    context.isDateField = datePatterns.test(meta) || dateTypes.includes(context.type);

    // Address fields previously blocked; now we let AI + masking preserve them. Keep detection for instruction hints only.
    const addressPatterns = /(address|street|st\.?\b|avenue|ave\.?\b|road|rd\.?\b|boulevard|blvd\.?\b|lane|ln\.?\b|drive|dr\.?\b|court|ct\.?\b|place|pl\.?\b|square|sq\.?\b|trail|trl\.?\b|parkway|pkwy\.?\b|circle|cir\.?\b|city|state|province|region|county|zip|postal|postcode|country|apt|apartment|suite|ste\.?\b|unit|building|bldg)/i;
    context.isAddressField = addressPatterns.test(meta);

    // Detect if field contains capitalized words (likely proper nouns)
    const words = field.value.split(/\s+/);
    context.hasProperNouns = words.some(word =>
        word.length > 1 && word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()
    );

    // Build context instructions for the AI
    const hints = [];
    if (isNameField || context.hasProperNouns) {
        hints.push("Do NOT change any names or proper nouns");
    }
    if (context.hasNumbers) {
        hints.push("Do NOT change any numbers");
    }
    if (context.isEmailField) {
        hints.push("Do NOT change any email addresses");
    }
    if (context.isPhoneField) {
        hints.push("Do NOT change any phone numbers");
    }
    if (context.isIdField) {
        hints.push("Do NOT change any IDs or identification numbers");
    }
    if (context.isUrlField) {
        hints.push("Do NOT change any URLs or links");
    }
    if (context.isDateField) {
        hints.push("Do NOT change any dates or date formats");
    }
    // Currency and percentages guidance (applies when present in text)
    if (/[€£¥₹$]|\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD)\b/.test(field.value)) {
        hints.push("Do NOT change any currency amounts");
    }
    if (/\d+\s*%|\bpercent\b/i.test(field.value)) {
        hints.push("Do NOT change any percentages");
    }
    if (context.isAddressField) {
        hints.push("Do NOT change any postal addresses");
    }
    if (context.label) {
        hints.push(`This is for: "${context.label}"`);
    } else if (context.placeholder) {
        hints.push(`Placeholder: "${context.placeholder}"`);
    }

    context.instructions = hints.length > 0 ? hints.join('. ') + '.' : '';
    return context;
}

// Replace sensitive substrings with placeholders so the rewriter preserves them
function maskSensitiveSubstrings(text) {
    let tokens = [];
    let idxEmail = 0, idxPhone = 0, idxId = 0, idxUrl = 0, idxDate = 0, idxCurr = 0, idxPct = 0, idxAddr = 0;
    let out = text;

    // URLs (http/https/www or common domain forms)
    const urlRe = /(https?:\/\/[^\s)]+|www\.[^\s)]+|\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w#?&=+%\-.]*)?)/gi;
    out = out.replace(urlRe, (m) => {
        const ph = `__SURVSAY_URL_${++idxUrl}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    // Emails
    const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    out = out.replace(emailRe, (m) => {
        const ph = `__SURVSAY_EMAIL_${++idxEmail}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    // Phone numbers (7-15 digits total, allow separators)
    const phoneRe = /\+?\d[\d\s().-]{5,}\d/g;
    out = out.replace(phoneRe, (m) => {
        // Heuristic: ensure at least 7 digits
        const digits = (m.match(/\d/g) || []).length;
        if (digits < 7 || digits > 15) return m;
        const ph = `__SURVSAY_PHONE_${++idxPhone}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    // Generic IDs (common keywords, then token)
    const idRe = /(\b(?:ssn|nin|nid|pan|aadhaar|aadhar|dni|cedula|curp|rfc|nif|passport|driver'?s?\s?license|account(?:\s*number)?|customer\s*id|user\s*id|employee\s*id|student\s*id|national\s*id)\b[^\n\r\t]*)?\b([A-Za-z0-9][A-Za-z0-9\-]{3,})\b/gim;
    out = out.replace(idRe, (m) => {
        // Avoid replacing if it already contains a placeholder
        if (/__SURVSAY_(EMAIL|PHONE|ID)_\d+__/.test(m)) return m;
        // Avoid obvious words-only tokens
        if (/^[A-Za-z]{1,}$/.test(m)) return m;
        const ph = `__SURVSAY_ID_${++idxId}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    // Dates
    const datePatterns = [
        /\b\d{4}-\d{2}-\d{2}\b/g,                         // YYYY-MM-DD
        /\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})\b/g,  // 12/31/2025 or 31-12-25
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/gi, // Month 12, 2025
        /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi
    ];
    datePatterns.forEach(re => {
        out = out.replace(re, (m) => {
            const ph = `__SURVSAY_DATE_${++idxDate}__`;
            tokens.push({ placeholder: ph, value: m });
            return ph;
        });
    });

    // Currency amounts (symbol/code before or after number)
    const currBefore = /(?<!\w)(?:[$€£¥₹]|\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD)\b)\s?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?/gi;
    out = out.replace(currBefore, (m) => {
        const ph = `__SURVSAY_CURR_${++idxCurr}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });
    const currAfter = /\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?\s?(?:[$€£¥₹]|\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD)\b)/gi;
    out = out.replace(currAfter, (m) => {
        const ph = `__SURVSAY_CURR_${++idxCurr}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    // Percentages
    const pctRe1 = /\b\d+(?:[.,]\d+)?\s*%\b/g;
    out = out.replace(pctRe1, (m) => {
        const ph = `__SURVSAY_PCT_${++idxPct}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });
    const pctRe2 = /\b\d+(?:[.,]\d+)?\s*(?:percent|per\s*cent)\b/gi;
    out = out.replace(pctRe2, (m) => {
        const ph = `__SURVSAY_PCT_${++idxPct}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    // Postal addresses: number + street word
    const addrStreetWords = '(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Place|Pl\.?|Square|Sq\.?|Trail|Trl\.?|Parkway|Pkwy\.?|Circle|Cir\.?)';
    const addrRe = new RegExp(`\\b\\d{1,6}\\s+[A-Za-z0-9.'\\-]+\\s+${addrStreetWords}(?:\\s+(?:Apt|Apartment|Unit|Suite|Ste\.?|#)\\s*[^,\n]+)?`, 'gi');
    out = out.replace(addrRe, (m) => {
        const ph = `__SURVSAY_ADDR_${++idxAddr}__`;
        tokens.push({ placeholder: ph, value: m });
        return ph;
    });

    return { sanitizedText: out, tokens };
}

function unmaskSensitiveSubstrings(text, tokens) {
    let out = text;
    tokens.forEach(t => {
        out = out.replaceAll(t.placeholder, t.value);
    });
    return out;
}

// Heuristic: return true when the content is essentially just URLs with little/no extra text
function isLikelyUrlOnlyContent(text) {
    if (!text) return false;
    const urlRe = /(https?:\/\/[^\s)]+|www\.[^\s)]+|\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w#?&=+%\-.]*)?)/gi;
    const withoutUrls = text.replace(urlRe, ' ').replace(/[\s,;|:()\-_/]+/g, '').trim();
    // If after removing URLs and common separators there's almost nothing left, treat as URL-only
    return withoutUrls.length < 3;
}

async function handleRewrite(field, button) {
    const text = field.value;
    if (!text) return;

    // Gather context about this field
    const fieldContext = getFieldContext(field);

    // Minimal logging only on critical failures (verbose logs removed)

    // If this is a protected field (names, emails, phones, IDs), do not rewrite
    if (
        fieldContext.isNameField ||
        fieldContext.isEmailField ||
        fieldContext.isPhoneField ||
        fieldContext.isIdField ||
        fieldContext.isDateField ||
        /* Allow address fields to go through; AI and masking will preserve them */
        field.type === 'url'
    ) {
        // no-op: keep original text
        button.style.transform = 'rotate(0deg)';
        return;
    }

    // Show global busy overlay
    showBusy();
    // Add processing glow to field
    addFieldGlow(field, true);
    // Subtle local affordance
    button.style.transform = 'rotate(360deg)';
    button.style.transition = 'transform 0.5s';

    const settings = await new Promise(resolve => {
        chrome.storage.sync.get({ rewriteTone: 'original', rewriteLength: 'original' }, resolve);
    });
    const { rewriteTone, rewriteLength } = settings;

    // Mask sensitive data inside free text so the rewriter preserves them
    const { sanitizedText, tokens } = maskSensitiveSubstrings(text);
    // Masking done; proceed

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
                window.postMessage({ survsay: 'REWRITE_TEXT', text: sanitizedText, tone: rewriteTone, length: rewriteLength, context: fieldContext, channel }, '*');
            });
        } catch (error) {
            // Silent fallback to Firebase
        }
    }

    if (!rewrittenText) {
        try {
            const firebasePromise = new Promise((resolve, reject) => {
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
                window.postMessage({ action: 'SURVSAY_REWRITE_TEXT_FIREBASE', text: sanitizedText, tone: rewriteTone, length: rewriteLength, context: fieldContext, channel }, '*');
            });
            // Add a timeout so we don't hang forever if something goes wrong
            const timeoutMs = 15000;
            rewrittenText = await Promise.race([
                firebasePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase rewrite timeout after ' + timeoutMs + 'ms')), timeoutMs))
            ]);
        } catch (error) {
            console.error("Survsay: Firebase rewrite failed.", error);
        }
    }

    button.style.transform = 'rotate(0deg)';
    if (rewrittenText) {
        // Restore sensitive substrings
        const restored = unmaskSensitiveSubstrings(rewrittenText, tokens);
        field.value = restored;
        // Add climax glow after rewriting
        addFieldGlow(field, false);
    } else {
        // No output; remain silent
    }
    hideBusy();
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

// --- Simplify Mode for Accessibility ---

let simplifyModeActive = false;
const simplifiedElements = new Map(); // Store original content

async function simplifyFormLabel(labelElement) {
    const originalText = labelElement.textContent.trim();
    if (!originalText || originalText.length < 5) return; // Skip very short labels

    // Check if already simplified
    if (simplifiedElements.has(labelElement)) return;

    // Find associated select/dropdown
    let dropdownOptions = '';
    const forAttr = labelElement.getAttribute('for');
    let associatedSelect = null;

    if (forAttr) {
        associatedSelect = document.getElementById(forAttr);
    } else {
        // Check if select is inside the label
        associatedSelect = labelElement.querySelector('select');
    }

    // If no direct association, look for nearby select
    if (!associatedSelect) {
        const nextElement = labelElement.nextElementSibling;
        if (nextElement && nextElement.tagName === 'SELECT') {
            associatedSelect = nextElement;
        }
    }

    // Extract dropdown options
    if (associatedSelect && associatedSelect.tagName === 'SELECT') {
        const options = Array.from(associatedSelect.options)
            .filter((opt) => opt.value && opt.text.trim())
            .map((opt) => opt.text.trim());

        if (options.length > 0) {
            if (options.length <= 5) {
                // Show all options
                dropdownOptions = ` (Options: ${options.join(', ')})`;
            } else {
                // Show first 3 options
                dropdownOptions = ` (Options include: ${options.slice(0, 3).join(', ')}, and ${options.length - 3} more)`;
            }
        }
    }

    // Add processing glow to label
    addFieldGlow(labelElement, true);

    // Store original
    simplifiedElements.set(labelElement, {
        text: originalText,
        styles: {
            fontSize: labelElement.style.fontSize,
            lineHeight: labelElement.style.lineHeight,
            fontWeight: labelElement.style.fontWeight,
            color: labelElement.style.color,
            backgroundColor: labelElement.style.backgroundColor,
            padding: labelElement.style.padding,
            letterSpacing: labelElement.style.letterSpacing
        }
    });

    // Simplify the text using AI
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

    let simplifiedText = null;

    if (isNanoEligible) {
        try {
            simplifiedText = await new Promise((resolve, reject) => {
                const channel = `survsay_simplify_${Math.random().toString(36).slice(2)}`;
                const onResponse = (e) => {
                    if (e.data.channel === channel) {
                        window.removeEventListener('message', onResponse);
                        if (e.data.payload && e.data.payload.success) {
                            resolve(e.data.payload.rewrittenText);
                        } else {
                            reject(new Error(e.data.payload ? e.data.payload.error : 'Unknown error'));
                        }
                    }
                };
                window.addEventListener('message', onResponse);
                const prompt = `Rewrite this form label to be simpler, clearer, and more friendly. Use plain language that's easy for everyone to understand, especially people with ADHD or dyslexia. Keep it concise. Return ONLY the simplified text, nothing else.\n\nOriginal: "${originalText}"`;
                window.postMessage({ survsay: 'REWRITE_TEXT', text: originalText, tone: 'friendly', length: 'shorter', context: { instructions: 'Make this very simple and clear for people with ADHD and dyslexia' }, channel }, '*');
            });
        } catch (error) {
            console.warn('Survsay: Nano simplification failed, trying Firebase');
        }
    }

    // Fallback to Firebase
    if (!simplifiedText) {
        try {
            simplifiedText = await new Promise((resolve, reject) => {
                const channel = `survsay_simplify_fb_${Math.random().toString(36).slice(2)}`;
                const onResponse = (e) => {
                    if (e.data.action === 'SURVSAY_FIREBASE_REWRITE_RESULT' && e.data.channel === channel) {
                        window.removeEventListener('message', onResponse);
                        if (e.data.result) {
                            resolve(e.data.result);
                        } else {
                            reject(new Error(e.data.error || 'Unknown error'));
                        }
                    }
                };
                window.addEventListener('message', onResponse);
                window.postMessage({
                    action: 'SURVSAY_REWRITE_TEXT_FIREBASE',
                    text: originalText,
                    tone: 'friendly',
                    length: 'shorter',
                    context: { instructions: 'Make this very simple and clear for people with ADHD and dyslexia' },
                    channel
                }, '*');
            });
        } catch (error) {
            console.error('Survsay: Simplification failed completely', error);
            return;
        }
    }

    if (simplifiedText) {
        // Add dropdown options to the simplified text
        labelElement.textContent = simplifiedText + dropdownOptions;
    } else {
        // If simplification failed, at least add the options to original text
        labelElement.textContent = originalText + dropdownOptions;
    }

    // Apply accessible styling
    labelElement.style.fontSize = '16px';
    labelElement.style.lineHeight = '1.6';
    labelElement.style.fontWeight = '600';
    labelElement.style.color = '#1a1a1a';
    labelElement.style.backgroundColor = '#f9f9f9';
    labelElement.style.padding = '8px 12px';
    labelElement.style.letterSpacing = '0.02em';
    labelElement.style.borderRadius = '6px';
    labelElement.style.display = 'block';
    labelElement.style.marginBottom = '8px';

    // Add climax glow after simplification
    addFieldGlow(labelElement, false);
}

async function applySimplifyMode() {
    if (simplifyModeActive) return;
    simplifyModeActive = true;

    // Find all form labels
    const labels = document.querySelectorAll('label, .form-label, [class*="label"]');
    const legendElements = document.querySelectorAll('legend');
    const allLabelElements = [...labels, ...legendElements];

    // Simplify each label
    for (const label of allLabelElements) {
        await simplifyFormLabel(label);
    }

    // Apply general form styling for better readability
    const forms = document.querySelectorAll('form, .survsay-div-form');
    forms.forEach(form => {
        form.style.maxWidth = '800px';
        form.style.margin = '0 auto';
    });

    // Style input fields for better accessibility
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
    inputs.forEach(input => {
        input.style.fontSize = '16px';
        input.style.padding = '12px';
        input.style.border = '2px solid #d1d5db';
        input.style.borderRadius = '8px';
        input.style.marginBottom = '16px';
    });
}

function removeSimplifyMode() {
    if (!simplifyModeActive) return;
    simplifyModeActive = false;

    // Restore original content and styles
    simplifiedElements.forEach((original, element) => {
        element.textContent = original.text;
        Object.assign(element.style, original.styles);
    });
    simplifiedElements.clear();

    // Remove form styling
    const forms = document.querySelectorAll('form, .survsay-div-form');
    forms.forEach(form => {
        form.style.maxWidth = '';
        form.style.margin = '';
    });

    // Remove input styling
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
    inputs.forEach(input => {
        input.style.fontSize = '';
        input.style.padding = '';
        input.style.border = '';
        input.style.borderRadius = '';
        input.style.marginBottom = '';
    });
}

// Listen for settings updates
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SETTINGS_UPDATED') {
        if (msg.settings.simplifyMode && !simplifyModeActive) {
            applySimplifyMode();
        } else if (!msg.settings.simplifyMode && simplifyModeActive) {
            removeSimplifyMode();
        }
    }
    if (msg.type === 'PING') {
        sendResponse({ ok: true });
    }
});

// Check simplify mode on load
chrome.storage.sync.get({ simplifyMode: false }, (settings) => {
    if (settings.simplifyMode) {
        applySimplifyMode();
    }
});

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
