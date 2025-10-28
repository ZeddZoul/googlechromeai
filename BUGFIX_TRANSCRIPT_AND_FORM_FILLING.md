# Bug Fix Documentation: Transcript Capture and Form Filling

## Date

October 24, 2025

## Issues Identified

### 1. Firebase SDK Loading Failure

**Problem:** Extension failed to load Firebase SDK files that didn't exist.

**Symptoms:**

```
ReferenceError: firebase is not defined
```

**Root Cause:**

- `manifest.json` referenced non-existent files: `firebase-functions.js`, `firebase-app.js`, `firebase-config.js`
- These files were listed in `content_scripts` but didn't exist in the project
- Firebase Cloud Functions require backend deployment which wasn't set up

**Fix:**

- Removed non-existent Firebase files from `manifest.json`
- Commented out Firebase transcription function in `content_script.js`
- Made extension rely on Web Speech API as primary transcription method

---

### 2. Web Speech API Transcript Lost During Cleanup

**Problem:** Transcript was being captured successfully but became empty when trying to process it.

**Symptoms:**

```
Survsay: Speech recognition interim/final: first name is Wisdom...
Survsay: Recording stopped.
Survsay: Processing recording...
Survsay: No transcription available  // ← Empty!
```

**Root Cause:**

```javascript
recordingState.mediaRecorder.onstop = async () => {
  const blob = new Blob(recordingState.chunks, { type: "audio/webm" });
  await processRecording(blob); // ← Async call
  cleanupAudioResources(); // ← This runs immediately after
};
```

The issue was a **race condition**:

1. `mediaRecorder.onstop` is triggered
2. `processRecording(blob)` is called (async function)
3. `cleanupAudioResources()` is called immediately (doesn't wait for async)
4. `cleanupAudioResources()` sets `recordingState.fallbackTranscript = ''`
5. When `processRecording()` finally tries to read the transcript, it's already empty

**Fix:**
Save the transcript value BEFORE cleanup:

```javascript
recordingState.mediaRecorder.onstop = async () => {
  const blob = new Blob(recordingState.chunks, { type: "audio/webm" });
  // Save transcript BEFORE cleanup (cleanup will clear it)
  const savedTranscript = recordingState.fallbackTranscript;
  console.log("Survsay: Saved transcript before cleanup:", savedTranscript);
  cleanupAudioResources();
  await processRecording(blob, savedTranscript); // ← Pass as parameter
};
```

Updated `processRecording` to accept the saved transcript:

```javascript
async function processRecording(blob, savedTranscript) {
  // Use savedTranscript instead of recordingState.fallbackTranscript
  transcription = savedTranscript;
  // ... rest of processing
}
```

---

### 3. Web Speech API Not Capturing Full Transcript

**Problem:** Only final results were being captured, and recognition stopped too early.

**Symptoms:**

- Partial transcripts during recording
- Final transcript was incomplete or empty

**Root Cause:**

```javascript
recordingState.recognizer.interimResults = true;
// But only capturing final results:
recordingState.recognizer.onresult = (ev) => {
  let final = "";
  for (let i = 0; i < ev.results.length; i++) {
    if (ev.results[i].isFinal) final += ev.results[i][0].transcript + " ";
  }
  if (final.trim()) recordingState.fallbackTranscript = final.trim();
};
```

**Fix:**

1. Set `continuous: true` to keep recognition running
2. Capture ALL results (both interim and final)
3. Continuously update the transcript

```javascript
recordingState.recognizer.continuous = true; // ← Keep running

recordingState.recognizer.onresult = (ev) => {
  // Accumulate ALL results (both interim and final)
  let transcript = "";
  for (let i = 0; i < ev.results.length; i++) {
    transcript += ev.results[i][0].transcript + " ";
  }
  // Always update with the latest transcript
  if (transcript.trim()) {
    recordingState.fallbackTranscript = transcript.trim();
    console.log(
      "Survsay: Speech recognition interim/final:",
      recordingState.fallbackTranscript
    );
  }
};
```

---

### 4. Form Filling Not Working - Message Listener Catching Wrong Message

**Problem:** Data extraction worked, but form fields weren't being filled.

**Symptoms:**

```
Survsay: Extracted structured data: {firstName: 'John', lastName: 'Smith', ...}
Survsay: Final parsed data: {structured: {...}}
Survsay: Channel matched! Processing response...
Survsay: e.data.payload: undefined
Survsay: Form data extraction failed. Payload: undefined
```

**Root Cause:**
The `onInpageResponse` listener was catching **its own outgoing request message** instead of waiting for the response from inpage.js!

Message flow:

1. content_script sends: `{voxai: 'PROCESS_TEXT_INPAGE', channel: 'xxx', text: '...', schema: {...}}`
2. **BUG:** `onInpageResponse` listener catches THIS message (has `channel` property)
3. But this message has `voxai` property (request), not `payload` property (response)
4. Result: `e.data.payload` is `undefined`
5. The actual response from inpage.js `{channel: 'xxx', payload: {...}}` comes later but listener is already removed

**Fix:**
Ignore messages that have a `voxai` property (those are requests, not responses):

```javascript
const onInpageResponse = (e) => {
  console.log("Survsay: Received message in onInpageResponse:", e.data);

  // Ignore messages that are requests (have 'voxai' property)
  if (e.data && e.data.voxai) {
    console.log("Survsay: Ignoring request message with voxai:", e.data.voxai);
    return; // ← Skip request messages
  }

  if (!e.data || e.data.channel !== channel) {
    return;
  }

  window.removeEventListener("message", onInpageResponse);

  if (e.data.payload && e.data.payload.success) {
    console.log(
      "Survsay: Form data extraction successful:",
      e.data.payload.result
    );
    fillForm(e.data.payload.result); // ← Now this actually gets called!
  }
};
```

---

### 5. No Fallback When Gemini Nano Unavailable

**Problem:** Extension failed completely when on-device AI (Gemini Nano) wasn't available.

**Symptoms:**

```
The device is not eligible for running on-device model.
NotAllowedError: The device is not eligible for running on-device model.
```

**Fix:**
Added pattern-matching fallback in `inpage.js`:

```javascript
if (ev.data.voxai === "PROCESS_TEXT_INPAGE") {
  // Check if on-device AI is available
  let isAvailable = false;
  if (typeof LanguageModel !== "undefined" && LanguageModel.availability) {
    const availability = await LanguageModel.availability(modelCapabilities);
    isAvailable = availability !== "unavailable";
  }

  let json;

  if (isAvailable) {
    // Use on-device AI (Gemini Nano)
    const session = await ensureSession();
    const result = await session.prompt(prompt);
    json = JSON.parse(result);
  } else {
    // Fallback: Use pattern matching
    json = extractFormDataFromText(text, schema);
  }

  respond(channel, { success: true, result: json });
}
```

Created `extractFormDataFromText()` function that uses regex patterns to extract:

- Names: "I am John Smith" → firstName: John, lastName: Smith
- Age: "age 30" or "30 years old" → age: 30
- Experience: "5 years of experience" → experience: 5
- Role: Detects job titles (developer, salesman, etc.)
- Tools: Finds technology names (AWS, Python, React, etc.)
- Salary: Extracts amounts like "$80,000"

---

## Files Modified

### 1. `manifest.json`

**Before:**

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": [
      "firebase-app.js",
      "firebase-functions.js",
      "firebase-config.js",
      "content_script.js"
    ]
  }
]
```

**After:**

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": [
      "content_script.js"
    ]
  }
]
```

### 2. `content_script.js`

- Commented out Firebase transcription function
- Fixed transcript race condition in `mediaRecorder.onstop`
- Updated `processRecording()` to accept `savedTranscript` parameter
- Improved Web Speech API configuration (continuous mode, capture all results)
- Fixed message listener to ignore request messages
- Enhanced `fillForm()` to handle radio buttons, selects, and better logging

### 3. `inpage.js`

- Added availability check before using Gemini Nano
- Created `extractFormDataFromText()` fallback function
- Added detailed logging for debugging
- Improved error handling

---

## Testing Results

### Before Fix:

- ❌ Firebase errors blocked extension
- ❌ Transcript captured but lost
- ❌ Form fields remained empty
- ❌ Extension failed on devices without Gemini Nano

### After Fix:

- ✅ Extension loads without Firebase
- ✅ Web Speech API captures full transcript
- ✅ Transcript preserved through cleanup
- ✅ Form fields filled automatically
- ✅ Works with pattern matching fallback (no Gemini Nano needed)
- ✅ Will automatically use Gemini Nano when available

---

## Technical Lessons Learned

1. **Async/Await Race Conditions:** When mixing async functions with synchronous cleanup, always save critical state before cleanup runs.

2. **Message Passing:** When using `window.postMessage()` for bidirectional communication, ensure messages have distinct properties to differentiate requests from responses.

3. **Web Speech API:** Set `continuous: true` and capture all results (not just final) for better real-time transcription.

4. **Graceful Degradation:** Always provide fallbacks for optional features (like on-device AI) to ensure core functionality works everywhere.

5. **Debug Logging:** Comprehensive logging at each step is crucial for diagnosing race conditions and message flow issues.

---

## Current System Architecture

```
User speaks → Web Speech API (real-time transcript)
              ↓
            Recording stops
              ↓
      Save transcript (before cleanup)
              ↓
         Cleanup resources
              ↓
    Process saved transcript
              ↓
    Check Gemini Nano availability
         ↙            ↘
   Available      Unavailable
      ↓                ↓
  Use AI          Pattern Matching
      ↓                ↓
    Extract form data ←┘
              ↓
         Fill form fields
```

---

## Future Improvements

1. **Backend Transcription:** Set up Firebase Cloud Functions for audio transcription as additional fallback
2. **Better Pattern Matching:** Improve regex patterns for more field types
3. **Multi-language Support:** Add language detection and multi-language patterns
4. **Form Field Mapping:** Add AI-powered field name matching for non-standard forms
5. **User Corrections:** Allow users to edit extracted data before form submission

---

## Verification Steps

To verify the fixes work:

1. **Load Extension:**

   - Go to `chrome://extensions`
   - Enable Developer Mode
   - Click "Load unpacked"
   - Select project folder

2. **Test Recording:**

   - Open `index.html` test page
   - Click floating mic button
   - Speak: "My name is John Smith, age 30, 20 years of experience, applying for backend developer, familiar with AWS and Python"
   - Stop recording

3. **Expected Results:**

   - Console shows: "Speech recognition interim/final: ..."
   - Console shows: "Saved transcript before cleanup: ..."
   - Console shows: "Extracted structured data: ..."
   - Console shows: "fillForm() called with data: ..."
   - **Form fields are filled automatically** ✅

4. **Check Console Logs:**
   ```
   Survsay: SpeechRecognition started
   Survsay: Speech recognition interim/final: [full transcript]
   Survsay: Recording stopped
   Survsay: Saved transcript before cleanup: [full transcript]
   Survsay: Processing recording...
   Survsay: Final transcription result: [full transcript]
   Survsay: Extracted structured data: {firstName: 'John', ...}
   Survsay: fillForm() called with data: {structured: {...}}
   Survsay: Processing field: firstName = John
   Survsay: Found 1 inputs for name="firstName"
   Survsay: Filled input firstName = John
   [... more fields ...]
   Survsay: Form filling complete. X fields filled.
   ```

---

## Status: ✅ RESOLVED

All issues have been identified and fixed. The extension now works reliably with Web Speech API + pattern matching fallback, with Gemini Nano support ready for compatible devices.
