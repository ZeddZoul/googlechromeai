// inpage.js - Handles on-device text-based inference.
(function () {
  if (window.__voxai_inpage_installed) return;
  window.__voxai_inpage_installed = true;

  function respond(channel, payload) {
    try {
      window.postMessage({ channel, payload }, '*');
    } catch (e) {
      console.error('VOX.AI: inpage.js respond error:', e);
      const safe = { success: false, error: 'Failed to post response: ' + String(e) };
      window.postMessage({ channel, payload: safe }, '*');
    }
  }

  const modelCapabilities = {
    expectedInputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }],
    expectedOutputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }]
  };

  async function ensureSession() {
    if (window.__voxai_languageModelSession) return window.__voxai_languageModelSession;
    if (typeof LanguageModel === 'undefined') throw new Error('LanguageModel API not present');

    const sessionOptions = {
      monitor(m) {
        try { m.addEventListener && m.addEventListener('downloadprogress', (ev) => console.log('LanguageModel download progress', ev.loaded)); } catch (e) { }
      },
      systemPrompt: 'You are a helpful assistant. Always respond in English.',
      ...modelCapabilities
    };
    window.__voxai_languageModelSession = await LanguageModel.create(sessionOptions);
    return window.__voxai_languageModelSession;
  }

  window.addEventListener('message', async (ev) => {
    if (!ev.data || !ev.data.voxai) return;

    if (ev.data.voxai === 'CHECK_ON_DEVICE') {
      const { channel } = ev.data;
      if (!channel) return;

      let isAvailable = false;
      let session = null;
      try {
        if (typeof LanguageModel !== 'undefined' && LanguageModel.availability) {
          const availability = await LanguageModel.availability(modelCapabilities);
          isAvailable = availability !== 'unavailable';
          
          // If available, create session for form extraction (Layer 1)
          if (isAvailable) {
            try {
              session = await ensureSession();
            } catch (e) {
              console.warn('VOX.AI: Could not create Nano session', e);
              session = null;
            }
          }
        }
      } catch (e) {
        isAvailable = false;
      }

      respond(channel, { isAvailable, session: isAvailable ? 'available' : null });
      return;
    }

    if (ev.data.voxai === 'PROCESS_AUDIO_INPAGE') {
      const { audioBase64, channel } = ev.data;
      if (!channel) return;

      try {
        const session = await ensureSession();

        const prompt = `Please transcribe the following audio. Return only the transcribed text, nothing else.`;

        const result = await session.prompt(prompt, {
          contents: [
            { role: "user", parts: [{ text: prompt }] },
            { role: "model", parts: [{ text: "I'm ready to transcribe audio. Please provide the audio." }] },
            { role: "user", parts: [{ inlineData: { mimeType: "audio/webm", data: audioBase64 } }] }
          ]
        });

        // Check if the result is actually a transcription or just a generic response
        if (result && result.length > 10 && !result.includes("paste the audio") && !result.includes("transcribe it")) {
          respond(channel, { success: true, result: { transcription: result } });
        } else {
          respond(channel, { success: false, error: 'On-device transcription failed - generic response' });
        }
      } catch (err) {
        console.error('VOX.AI audio processing error', err);
        respond(channel, { success: false, error: String(err) });
      }
    }

    if (ev.data.voxai === 'PROCESS_TEXT_INPAGE') {
      const { text, schema, channel } = ev.data;
      if (!channel) return;

      try {
        const session = await ensureSession();

        const prompt = `
          You are a helpful assistant that fills out web forms.
          Based on the following transcription, fill out the form fields described in the JSON schema.
          Your response should be a JSON object with a single key: "structured", where the value is an object of the filled form fields.
          Respond in English.

          Transcription: "${text}"

          Schema:
          ${JSON.stringify(schema)}
        `;

        const result = await session.prompt(prompt);

        // Extract JSON from markdown format if present
        let jsonString = result;
        if (result.includes('```json')) {
          const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            jsonString = jsonMatch[1].trim();
          }
        }

        const json = JSON.parse(jsonString);
        respond(channel, { success: true, result: json });
      } catch (err) {
        console.warn('VOX.AI: Nano extraction failed (Layer 1 will fallback to Firebase):', err);
        // Return failure - content_script will use Firebase fallback (Layer 2)
        respond(channel, { success: false, error: String(err) });
      }
    }
  });
})();