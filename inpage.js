// inpage.js - single, consistent implementation
(function () {
  if (window.__voxai_inpage_installed) return;
  window.__voxai_inpage_installed = true;

  function respond(channel, payload) {
    try {
      window.postMessage({ channel, payload }, '*');
    } catch (e) {
      // ensure we never post non-cloneable objects
      const safe = { success: false, error: 'Failed to post response: ' + String(e) };
      window.postMessage({ channel, payload: safe }, '*');
    }
  }

  function mimeToExt(mime) {
    if (!mime) return 'webm';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    if (mime.includes('wav')) return 'wav';
    if (mime.includes('ogg')) return 'ogg';
    return 'webm';
  }

  async function ensureSession() {
    if (window.__voxai_languageModelSession) return window.__voxai_languageModelSession;
    if (typeof LanguageModel === 'undefined') throw new Error('LanguageModel API not present');
    // create with a small monitor to log download progress
    window.__voxai_languageModelSession = await LanguageModel.create({
      monitor(m) {
        try { m.addEventListener && m.addEventListener('downloadprogress', (ev) => console.log('LanguageModel download progress', ev.loaded)); } catch (e) { }
      },
      expectedInputs: [{ type: 'audio', languages: ['en'] }]
    });
    return window.__voxai_languageModelSession;
  }

  // Expose for testing
  if (typeof jest !== 'undefined') {
    window.__voxai_ensureSession = ensureSession;
  }

  window.addEventListener('message', async (ev) => {
    if (!ev.data || ev.data.voxai !== 'PROCESS_AUDIO_INPAGE') return;
    const { audioBuffer, mimeType, audioBlobBase64, schema, channel, fallbackTranscript, fallbackError } = ev.data;

    if (!channel) return; // caller expects a channel to route response

    try {
      // reconstruct blob
      let blob;
      if (audioBuffer && mimeType) {
        blob = new Blob([audioBuffer], { type: mimeType });
      } else if (audioBlobBase64) {
        const parts = audioBlobBase64.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const binary = atob(parts[1]);
        const len = binary.length;
        const buffer = new Uint8Array(len);
        for (let i = 0; i < len; i++) buffer[i] = binary.charCodeAt(i);
        blob = new Blob([buffer], { type: mime });
      } else {
        respond(channel, { success: false, error: 'No audio provided' });
        return;
      }

      const ext = mimeToExt(blob.type);
      const filename = `voxai_${Date.now()}.${ext}`;
      const file = new File([blob], filename, { type: blob.type });

      // Check availability of the on-device model
      let avail = 'unavailable';
      try { if (typeof LanguageModel !== 'undefined' && LanguageModel && LanguageModel.availability) avail = await LanguageModel.availability(); } catch (e) { avail = 'unavailable'; }

      if (avail === 'unavailable') {
        // If the content script provided a speech recognition fallback transcript, return it.
        if (fallbackTranscript) {
          respond(channel, { success: true, result: { transcription: fallbackTranscript, structured: {} }, source: 'fallback' });
          return;
        }
        respond(channel, { success: false, error: 'LanguageModel unavailable and no fallback transcript' });
        return;
      }

      const session = await ensureSession();

      // Build a generic responseConstraint asking for structured+transcription
      const responseConstraint = {
        type: 'object',
        properties: {
          structured: { type: 'object' },
          transcription: { type: 'string' }
        },
        required: ['structured', 'transcription']
      };

      // If a schema was provided and looks valid, try to incorporate it
      if (schema && Array.isArray(schema.fields)) {
        try {
          const properties = {};
          const required = [];
          for (const f of schema.fields) {
            properties[f.name] = { type: 'string' };
            required.push(f.name);
          }
          responseConstraint.properties.structured = { type: 'object', properties };
          responseConstraint.required = ['structured', 'transcription'].concat(required);
        } catch (e) { /* ignore malformed schema */ }
      }

      // system prompt
      const systemPrompt = `You are VOX.AI. Transcribe the audio and return a JSON object matching the responseConstraint: structured (object) and transcription (string).`;

      // call the Prompt API session.prompt with audio File
      const raw = await session.prompt(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [{ type: 'audio', value: file }] }
        ],
        { responseConstraint }
      );

      // The Prompt API with a responseConstraint is expected to return a JSON string.
      // We'll keep this robust with a fallback.
      let result = null;
      try {
        if (typeof raw === 'string') {
          result = JSON.parse(raw);
        } else {
          // Fallback for unexpected response formats
          const content = String(raw || '');
          result = { transcription: content, structured: {} };
        }
      } catch (e) {
        // If JSON parsing fails, treat the raw output as the transcription.
        const content = String(raw || '');
        result = { transcription: content, structured: {} };
      }

      respond(channel, { success: true, result });
    } catch (err) {
      console.error('VOX.AI inpage error', err);
      respond(channel, { success: false, error: String(err) });
    }
  });
})();
