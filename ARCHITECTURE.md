# Survsay Architecture Diagrams & Flow Charts

## System Architecture

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃           CHROME EXTENSION (Survsay)                ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃                                                    ┃
┃  ┌─────────────────────────────────────────────┐ ┃
┃  │      content_script.js                      │ ┃
┃  │  ┌─────────────────────────────────────┐   │ ┃
┃  │  │  Floating Microphone UI             │   │ ┃
┃  │  │  • Golden button (72px)             │   │ ┃
┃  │  │  • VU meter visualization           │   │ ┃
┃  │  │  • Recording indicator              │   │ ┃
┃  │  └─────────────────────────────────────┘   │ ┃
┃  │                                             │ ┃
┃  │  ┌─────────────────────────────────────┐   │ ┃
┃  │  │  Audio Capture                      │   │ ┃
┃  │  │  • MediaRecorder (WebM/Opus)        │   │ ┃
┃  │  │  • Parallel Web Speech capture      │   │ ┃
┃  │  │  • Audio context for VU meter       │   │ ┃
┃  │  └─────────────────────────────────────┘   │ ┃
┃  │                 ↓                           │ ┃
┃  │  ┌─────────────────────────────────────┐   │ ┃
┃  │  │  processRecording(blob, transcript) │   │ ┃
┃  │  │  • Call firebaseAI orchestrator     │   │ ┃
┃  │  │  • Handle responses                 │   │ ┃
┃  │  │  • Fill form with results           │   │ ┃
┃  │  └─────────────────────────────────────┘   │ ┃
┃  └─────────────────────────────────────────────┘ ┃
┃                                                    ┃
┃  ┌─────────────────────────────────────────────┐ ┃
┃  │      firebaseAI.js (ORCHESTRATOR)          │ ┃
┃  │                                             │ ┃
┃  │  transcribeAudio(blob, fallback)            │ ┃
┃  │  ├─ Layer 2: Firebase Gemini (95%)         │ ┃
┃  │  └─ Layer 3: Web Speech API (85%)          │ ┃
┃  │                                             │ ┃
┃  │  extractFormData(text, schema, nano)        │ ┃
┃  │  ├─ Layer 1: Nano (98%)                    │ ┃
┃  │  ├─ Layer 2: Firebase Gemini (95%)         │ ┃
┃  │  └─ Layer 3: Pattern Matching (60%)        │ ┃
┃  └─────────────────────────────────────────────┘ ┃
┃                                                    ┃
┃  ┌─────────────────────────────────────────────┐ ┃
┃  │      inpage.js (NANO INTEGRATION)           │ ┃
┃  │  • Check Nano availability                  │ ┃
┃  │  • Create Language Model session            │ ┃
┃  │  • Extract form fields (Layer 1)            │ ┃
┃  │  • Message passing                          │ ┃
┃  └─────────────────────────────────────────────┘ ┃
┃                                                    ┃
┃  ┌─────────────────────────────────────────────┐ ┃
┃  │      firebase-config.js (FIREBASE API)      │ ┃
┃  │  • Firebase initialization                  │ ┃
┃  │  • Gemini model setup                       │ ┃
┃  │  • transcribeWithFirebase()                 │ ┃
┃  │  • extractFormDataWithFirebase()            │ ┃
┃  │  • showNotification()                       │ ┃
┃  │  • Base64 encoding                          │ ┃
┃  └─────────────────────────────────────────────┘ ┃
┃                                                    ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
         ↓              ↓              ↓
    ┌─────────┬─────────┴──────────┬─────────┐
    ↓         ↓                    ↓         ↓
  Firebase  Firebase        Browser    Nano
  Gemini   Firestore    Web Speech API  Model
  (Cloud)  (Data)        (Browser)   (Device)
```

## Audio Transcription Pipeline

```
START: User speaks
  ↓
┌────────────────────────────────────────┐
│  recordingState.mediaRecorder.start()  │ ────→ 100ms chunks
│  recordingState.recognizer.start()     │ ────→ Web Speech API
└────────────────────────────────────────┘
  ↓
User finishes speaking
  ↓
┌────────────────────────────────────────┐
│  processRecording(blob, fallback)      │
└────────────────────────────────────────┘
  ↓
┌────────────────────────────────────────┐
│  transcribeAudio(blob, webSpeechTxt)   │
└────────────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│  LAYER 2: FIREBASE GEMINI       │
│  ├─ Blob → Base64 encoding      │
│  ├─ Send to Firebase API        │
│  ├─ Get transcript response     │
│  └─ Return transcript           │
└─────────────────────────────────┘
  ↓
IF SUCCESS:
  ↓ Transcription obtained
  ↓
ELSE (Firebase failed):
  ↓
┌─────────────────────────────────┐
│  LAYER 3: WEB SPEECH FALLBACK   │
│  ├─ Retrieve captured transcript│
│  └─ Return fallback transcript  │
└─────────────────────────────────┘
  ↓
IF SUCCESS:
  ↓ Transcription obtained
  ↓
ELSE (Both failed):
  ↓ Show error notification
  ↓ Return null
  ↓
DONE
```

## Form Extraction Pipeline

```
START: Have transcription
  ↓
┌────────────────────────────────────┐
│  analyzeForm()                     │
│  └─ Get form schema from DOM       │
└────────────────────────────────────┘
  ↓
window.postMessage({
  voxai: 'PROCESS_TEXT_INPAGE',
  text: transcription,
  schema: schema,
  channel: unique_id
})
  ↓
┌────────────────────────────────────┐
│  inpage.js MESSAGE HANDLER         │
└────────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│  LAYER 1: NANO (ON-DEVICE)      │
│  ├─ Check Nano availability     │
│  │  └─ if (!available) skip     │
│  ├─ Create Language Model       │
│  ├─ Build extraction prompt     │
│  ├─ Call session.prompt()       │
│  ├─ Parse JSON response         │
│  └─ Send back via postMessage   │
└─────────────────────────────────┘
  ↓
IF SUCCESS (has data):
  ↓ content_script receives
  ↓ fillForm(nano_result)
  ↓ DONE ✅
  ↓
ELSE (Nano failed):
  ↓ content_script gets failure
  ↓
┌─────────────────────────────────┐
│  LAYER 2: FIREBASE GEMINI       │
│  ├─ Build extraction prompt     │
│  ├─ Send text + schema          │
│  ├─ Get structured JSON         │
│  └─ Return extracted data       │
└─────────────────────────────────┘
  ↓
IF SUCCESS (has data):
  ↓ fillForm(firebase_result)
  ↓ DONE ✅
  ↓
ELSE (Firebase failed):
  ↓
┌─────────────────────────────────┐
│  LAYER 3: PATTERN MATCHING      │
│  ├─ Split text into words       │
│  ├─ Match field labels          │
│  ├─ Extract nearby values       │
│  └─ Return best-effort data     │
└─────────────────────────────────┘
  ↓
IF SUCCESS (has data):
  ↓ fillForm(pattern_result)
  ↓ DONE ✅
  ↓
ELSE (All failed):
  ↓ Show error notification
  ↓ DONE ❌
```

## Form Filling Sequence

```
START: Have extracted data
  ↓
┌──────────────────────────────┐
│  fillForm(data)              │
│  {                           │
│    name: "John Smith",       │
│    email: "john@example.com" │
│  }                           │
└──────────────────────────────┘
  ↓
FOR EACH field in data:
  ↓
  ├─ Find input element
  │  └─ By name attribute
  │  └─ Fallback to id
  │
  ├─ Match field type
  │  ├─ radio → find matching option
  │  ├─ select → find matching option
  │  └─ text → direct fill
  │
  ├─ Set value
  │
  ├─ Trigger events
  │  ├─ change event
  │  └─ input event
  │
  └─ Increment success counter

END LOOP

  ↓
┌──────────────────────────────┐
│  Show notification           │
│  "Form filled successfully"  │
└──────────────────────────────┘
  ↓
DONE ✅
```

## Message Flow Diagram

```
┌──────────────────┐
│  content_script  │
└────────┬─────────┘
         │ postMessage({voxai: 'CHECK_ON_DEVICE'})
         ↓
┌──────────────────┐
│   inpage.js      │
├──────────────────┤
│ Checks LanguageModel
│ availability
└────────┬─────────┘
         │ postMessage({isAvailable, session})
         ↓
┌──────────────────┐
│  content_script  │
├──────────────────┤
│ Calls orchestrator
│ firebaseAI.js
└────────┬─────────┘
         │
         ├─→ firebase-config.js (API calls)
         │   ├─ Firebase Gemini transcription
         │   └─ Firebase Gemini extraction
         │
         ├─→ Browser Web Speech API (parallel)
         │   └─ Real-time transcription
         │
         └─→ inpage.js (Nano extraction)
             └─ Language Model processing
```

## Fallback Decision Tree

```
User clicks microphone
  ↓
Start recording (audio → blob)
  ↓
Stop recording
  ↓
"Do we have transcription?"
  ├─ NO → Error (no audio captured)
  └─ YES ↓
       transcribeAudio()
       ↓
       "Try Firebase?"
       ├─ YES → Send blob to Firebase
       │        ├─ SUCCESS → Use Firebase transcription
       │        └─ FAIL → Continue
       │
       ├─ NO (Firebase unavailable) → Continue
       │
       "Use Web Speech fallback?"
       └─ YES → Use Web Speech transcript
                └─ If available, otherwise error

"Do we have extracted data?"
  ├─ NO → Error
  └─ YES ↓
       extractFormData()
       ↓
       "Nano available?"
       ├─ YES → Try Nano extraction
       │        ├─ SUCCESS → Use Nano result
       │        └─ FAIL → Continue
       │
       ├─ NO (Nano unavailable) → Continue
       │
       "Try Firebase?"
       ├─ YES → Try Firebase extraction
       │        ├─ SUCCESS → Use Firebase result
       │        └─ FAIL → Continue
       │
       ├─ NO (Firebase unavailable) → Continue
       │
       "Try pattern matching?"
       └─ YES → Use pattern matching result
                └─ If data found, otherwise error

"Fill form with result?"
  └─ YES → Set form values, trigger events
           └─ DONE ✅
```

## File Dependencies

```
manifest.json
  └─ references all scripts and permissions

content_script.js
  ├─ loads: firebaseAI.js
  ├─ loads: firebase-config.js
  ├─ injects: inpage.js
  └─ communicates with: inpage.js

firebaseAI.js
  ├─ calls: firebase-config.js functions
  ├─ calls: inpage.js via postMessage
  └─ returns results to: content_script.js

firebase-config.js
  ├─ initializes Firebase
  ├─ creates Gemini model
  └─ exports API functions

inpage.js
  ├─ checks Nano availability
  ├─ creates Language Model session
  └─ communicates with: content_script.js
```

## Layer Performance Comparison

```
┌────────────────────────┬─────────┬──────────┬─────────────┐
│ Layer                  │ Speed   │ Accuracy │ Availability│
├────────────────────────┼─────────┼──────────┼─────────────┤
│ Nano (On-Device)       │ <500ms  │ 98%      │ ~20% device │
│ Firebase Gemini        │ 1-3s    │ 95%      │ 100% online │
│ Web Speech API         │ <1s     │ 85%      │ 100% device │
│ Pattern Matching       │ <100ms  │ 60%      │ 100% device │
└────────────────────────┴─────────┴──────────┴─────────────┘

Best Case (Nano available + Online):
  Nano (98%, 500ms) ← BEST ✅

Good Case (Nano unavailable + Online):
  Firebase (95%, 2s) ← GOOD ✅

Basic Case (Offline only):
  Pattern Matching (60%, <100ms) ← WORKS ✅

Failure Case (All offline + no Nano):
  Error message ← INFORM USER ⚠️
```

## State Machine

```
                    ┌────────────┐
                    │   IDLE     │
                    └────────────┘
                         ↑  ↓
                    Click mic ↓
                         │
                    ┌────────────┐
                    │ INITIALIZING│
                    └────────────┘
                         ↓
                    Get mic access
                         │
                    ┌────────────┐
                    │ RECORDING  │
                    │ (animating)│
                    └────────────┘
                         ↑  ↓
                    Click mic ↓
                         │
                    ┌────────────┐
                    │  STOPPING  │
                    └────────────┘
                         ↓
                    Stop recorders
                         │
                    ┌────────────┐
                    │ PROCESSING │
                    │ - Firebase │
                    │ - inpage   │
                    │ - Extract  │
                    │ - Fill     │
                    └────────────┘
                         ↓
                    Show result
                         ↓
                    ┌────────────┐
                    │   IDLE     │
                    └────────────┘
```

---

**These diagrams represent the complete Survsay architecture and flow! 🎨**
