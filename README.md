# VOX.AI — Chrome Extension (Prototype)

VOX.AI is a privacy-first Chrome Extension prototype that demonstrates a client-side flow to record audio, transcribe it with an on-device AI (Gemini Nano), map the transcription to a form schema, and auto-fill web forms.

This repository contains a working UI and audio recording flow that uses the browser's built-in Prompt API (LanguageModel / Gemini Nano) in the page context. The extension sends audio to the active tab where the model runs locally on the user's device.

Files added:

- `manifest.json` — extension manifest (MV3)
- `service_worker.js` — background worker (minimal messaging). AI calls are run in-page via the Prompt API per browser docs.
- `content_script.js` — injects floating microphone, analyzes forms, records audio, fills fields
- `popup.html` / `popup.js` — small popup with notes and README link
- `tailwind.css` — small utility CSS matching VOX.AI branding

Important: Gemini Nano / Prompt API notes

1. The Prompt API must run in page context. This extension injects `inpage.js` into each page so the Prompt API (`LanguageModel`) can be used directly.
2. The model may need to be downloaded the first time it's used. Check the page console for download progress. The extension's in-page session monitor logs download progress.
3. The extension passes audio as a `File` (wrapped from a Blob) to the Prompt API. If you want different audio wrappers or additional responseConstraint options, edit `inpage.js`.

Quick test (developer):

1. Load the extension in Chrome: go to chrome://extensions, enable Developer Mode, "Load unpacked", and select this folder.
2. Open any page with a form. Click the floating microphone in the lower-right, give microphone permission, speak, stop recording.
3. The form should be filled with the model's structured output when a page is active and the model is ready.

Next steps I can implement for you:

- Wire real Gemini Nano/Proofreader calls if you provide the relevant documentation snippets.
- Add unit tests for schema extraction and mapping logic.
- Improve UI: add a settings page in popup for language, model selection, and microphone sensitivity.
