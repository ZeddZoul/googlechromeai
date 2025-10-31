# Survsay — Chrome Extension (Prototype)

Survsay helps you fill and rewrite form content using voice and on-device AI.

This README explains how to clone the repo, load the extension into Chrome, test it on a web form, and describes the main features (voice form filling, rewriting, and simplification).

## Highlights

- Voice-driven form filling using microphone input.
- Field rewriting (rewrite/rewrites) via a small inline button next to text inputs and textareas.
- Simplify Mode — simplify form labels and UI for accessibility.
  - This feature was built with people with dyslexia in mind: when enabled Survsay rewrites and shortens form labels, increases font sizes and adds contextual hints so fields are easier to read.
- Uses on-device Gemini Nano (when available) and falls back to a Firebase-based AI pipeline when necessary.

## Prerequisites

- Google Chrome (recommended) version 127 or later.
- A device eligible for Chrome on-device AI (Gemini Nano) if you want the on-device experience.
- For on-device AI, enable any required flags (for some Chrome builds): visit `chrome://flags` and enable "Prompt API for Gemini Nano" if present.
- Basic developer tools permissions: ability to open `chrome://extensions` and enable Developer Mode.

## Clone the project

Run this in your shell to clone the repo locally:

```bash
git clone https://github.com/ZeddZoul/survsay.git
cd survsay
```

Optional: install dev dependencies (used for tests)

```bash
npm install
```

There is no build step required to load the extension into Chrome — the extension is already a static MV3 extension that can be loaded as-is.

## Load the extension into Chrome

1. Open Chrome and navigate to chrome://extensions
2. Enable "Developer mode" (top-right)
3. Click "Load unpacked" and select the `survsay` project folder you cloned above
4. The Survsay extension should appear in your extensions list. Click the extension icon and open the popup to configure settings.

Note: the extension uses Manifest V3 and injects `inpage.js` and `firebase-injector.js` into pages. If a page sets a strict CSP, the injector may be blocked — see Troubleshooting below.

## Quick testing on a form (manual)

1. Open any web page that contains a form (e.g., a contact form, sign-up form, or an example page you control).
2. Make sure the popup settings have "Floating Mic" enabled (open the extension popup).
3. Hover over a form — you'll see a small floating microphone button appear near the form (or a form-like container).
4. Click the microphone button and allow Chrome to access your microphone when prompted.
5. Speak naturally (for example: "My name is Jane Doe, email jane@example.com, phone 555-1234").
6. Click the button again to stop recording. Survsay will process the audio, transcribe it and fill matching fields in the form.

Expected behavior:

- A "busy" UI appears while processing.
- Fields that are being filled show a brief glow effect, then a final highlight when filled.

## Rewriter (Rewrite a field's text)

- For text inputs and textareas that already have content, hover to reveal a small Rewriter button (pencil / swirl icon) near the field.
- Click that button to ask Survsay to rewrite the field contents according to the selected tone/length in the popup settings.
- Sensitive content like emails, phone numbers, IDs, dates, and URLs are automatically masked and preserved by the rewriter.

## Simplify Mode (Accessibility)

- In the popup, enable "Simplify Mode" to have Survsay simplify form labels and show short, clear instructions aimed at better readability — this mode was explicitly designed with people with dyslexia in mind.

## Examples and local testing

An example page is included in `examples/test-form.html` so you can test the extension without needing an external site.

To test locally:

1. From the project root, open the `examples/test-form.html` file in Chrome after loading the extension. You can open it directly via `file://` or serve it with a tiny static server.

Using a quick static server (recommended so extension inpage injection behaves similarly to real sites):

```bash
# Python 3 built-in server (runs on http://localhost:8000)
python3 -m http.server 8000 --directory examples
```

Then open http://localhost:8000/test-form.html in Chrome and follow the Quick testing steps above.

Test scenarios to try on the example page:

- Voice form-filling: click the floating mic and say: "My name is Jane Doe, email jane@example.com, phone +1 555 555 1212, I live at 123 Maple Street in San Francisco, California."
- Rewriter: type a long sentence into "Short bio" then click the Rewriter button and choose a tone from the popup to see rewritten text.
- Simplify Mode: enable Simplify Mode in the popup and reload the example page; labels should become shorter, clearer, and more readable.

## Settings

Open the extension popup to configure:

- Floating mic on/off
- Mic and busy indicator positions
- Transcription language
- Rewriter tone and length
- Simplify mode toggle

Changes in the popup are saved to `chrome.storage.sync` and the content script receives updates to apply immediately.

## How it works (brief)

- The extension injects `content_script.js` into pages. That script:
  - attaches floating microphone buttons to forms
  - handles recording and interim SpeechRecognition fallback
  - posts audio/text to the in-page bridge (`inpage.js`) to call the Prompt API when Gemini Nano is available
  - falls back to a Firebase-based AI pipeline (via `firebase-injector.js`) when necessary
  - performs field schema analysis and fills matched fields with the structured result

## Troubleshooting & debugging

- If nothing appears on a page:

  - Open DevTools (F12) → Console and look for Survsay logs. The content script logs important events such as injector load success/failure and eligibility checks.
  - Some sites use extremely strict Content Security Policies (CSP) that block the injected `firebase-injector.js` or `inpage.js`. When that occurs the popup will show a message saying Survsay is not available on this page.

- If Gemini Nano isn't available or the device is ineligible, Survsay will try a Firebase fallback. You will see warnings in the console when the on-device model is not eligible.

- Microphone permission issues: ensure Chrome has permission to use the microphone for the page you're testing.

## Development & tests

- There is no build step required for the extension itself. If you want to run tests (jest is declared as a dependency in package.json):

```bash
npm install
npm test
```

Note: the repo currently contains the content for unit-like exports in `content_script.js` for easier testing, but tests may need to be added/updated.

## Privacy

- Survsay prefers on-device processing when available (Gemini Nano) so that sensitive audio and text data can remain local to your device. When on-device processing is not available the extension uses a Firebase-based fallback — see the code (`firebase-injector.js`, `firebaseAI.js`) for how that pipeline is wired.

## Files of interest

- `manifest.json` — extension manifest (MV3)
- `content_script.js` — main form integration, recording, rewriting and simplify logic
- `popup.html`, `popup.js` — settings UI and storage sync
- `inpage.js` — in-page bridge used to call the Prompt API (Gemini Nano) from page context
- `firebase-injector.js`, `firebaseAI.js`, `firebase-config.js` — the Firebase fallback injector and helpers

## Contributing / Next steps

- Add automated tests for extraction/mapping logic
- Add screenshots and an example HTML page to make manual testing easier
- Improve multi-language transcription support

## License

This project includes a `LICENSE` file. Please consult that file for license details.

---

If you'd like, I can also:

- add a small example HTML page in `examples/` to make testing easier,
- add unit tests for key mapping functions in `content_script.js`, or
- add screenshots and copy into the popup UI for onboarding.

Tell me which of those you'd like next.
