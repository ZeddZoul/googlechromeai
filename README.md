# VOX.AI — Chrome Extension (Prototype)

VOX.AI is a privacy-first Chrome Extension prototype that demonstrates a client-side flow to record audio, transcribe it with an on-device AI (Gemini Nano), map the transcription to a form schema, and auto-fill web forms.

## ⚠️ Requirements

**This extension requires Gemini Nano (Chrome's on-device AI) to work.**

- Chrome version 127 or later with Gemini Nano enabled
- Device must be eligible for on-device AI models
- Enable "Prompt API for Gemini Nano" in `chrome://flags`

## How It Works

This repository contains a working UI and audio recording flow that uses:

1. **Web Speech API** - Captures real-time transcription while you speak
2. **Gemini Nano (Prompt API)** - Extracts structured data from transcription
3. **DOM Manipulation** - Automatically fills form fields

The extension sends audio to the active tab where the model runs locally on the user's device.

Files added:

- `manifest.json` — extension manifest (MV3)
- `service_worker.js` — background worker (minimal messaging). AI calls are run in-page via the Prompt API per browser docs.
- `content_script.js` — injects floating microphone, analyzes forms, records audio, fills fields
- `popup.html` / `popup.js` — small popup with notes and README link
- `tailwind.css` — small utility CSS matching VOX.AI branding

Important: Gemini Nano / Prompt API notes

**This extension ONLY works on devices with Gemini Nano support.**

1. The Prompt API must run in page context. This extension injects `inpage.js` into each page so the Prompt API (`LanguageModel`) can be used directly.
2. The model may need to be downloaded the first time it's used. Check the page console for download progress. The extension's in-page session monitor logs download progress.
3. If your device is not eligible for Gemini Nano, the extension will show an error message and will not function.
4. Web Speech API is used for real-time transcription, but Gemini Nano is required for form data extraction.

Quick test (developer):

1. Load the extension in Chrome: go to chrome://extensions, enable Developer Mode, "Load unpacked", and select this folder.
2. **Verify Gemini Nano is available**: Check console for "Gemini Nano is available! ✅"
3. Open any page with a form. Click the floating microphone in the lower-right, give microphone permission, speak, stop recording.
4. The form should be filled with the model's structured output when the page is active and Gemini Nano is ready.

Next steps I can implement for you:

- Add multi-language support for transcription
- Improve AI prompts for better form field mapping
- Add unit tests for schema extraction and mapping logic
- Improve UI: add a settings page in popup for language, model selection, and microphone sensitivity
