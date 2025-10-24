// inpage.js - Handles on-device text-based inference.
(function () {
  if (window.__voxai_inpage_installed) return;
  window.__voxai_inpage_installed = true;

  function respond(channel, payload) {
    try {
      window.postMessage({ channel, payload }, '*');
    } catch (e) {
      const safe = { success: false, error: 'Failed to post response: ' + String(e) };
      window.postMessage({ channel, payload: safe }, '*');
    }
  }

  const modelCapabilities = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }]
  };

  async function ensureSession() {
    if (window.__voxai_languageModelSession) return window.__voxai_languageModelSession;
    if (typeof LanguageModel === 'undefined') throw new Error('LanguageModel API not present');

    const sessionOptions = {
      monitor(m) {
        try { m.addEventListener && m.addEventListener('downloadprogress', (ev) => console.log('LanguageModel download progress', ev.loaded)); } catch (e) { }
      },
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

      console.log('VOX.AI: Checking on-device availability...');
      let isAvailable = false;
      try {
        if (typeof LanguageModel !== 'undefined' && LanguageModel.availability) {
          const availability = await LanguageModel.availability(modelCapabilities);
          isAvailable = availability !== 'unavailable';
          console.log('VOX.AI: LanguageModel availability:', availability);
        } else {
          console.log('VOX.AI: LanguageModel not available');
        }
      } catch (e) {
        console.log('VOX.AI: LanguageModel check failed:', e);
        isAvailable = false;
      }

      console.log('VOX.AI: On-device available:', isAvailable);
      respond(channel, { isAvailable });
      return;
    }

    if (ev.data.voxai === 'PROCESS_AUDIO_INPAGE') {
      const { audioBase64, channel } = ev.data;
      if (!channel) return;

      console.log('VOX.AI: Processing audio in page, base64 length:', audioBase64.length);

      try {
        const session = await ensureSession();
        console.log('VOX.AI: Session created for audio processing...');
        
        const prompt = `Please transcribe the following audio. Return only the transcribed text, nothing else.`;

        console.log('VOX.AI: Calling session.prompt for audio transcription...');
        const result = await session.prompt(prompt, {
          contents: [
            { role: "user", parts: [{ text: prompt }] },
            { role: "model", parts: [{ text: "I'm ready to transcribe audio. Please provide the audio." }] },
            { role: "user", parts: [{ inlineData: { mimeType: "audio/webm", data: audioBase64 } }] }
          ]
        });
        
        console.log('VOX.AI: Audio transcription result:', result);
        
        // Check if the result is actually a transcription or just a generic response
        if (result && result.length > 10 && !result.includes("paste the audio") && !result.includes("transcribe it")) {
          respond(channel, { success: true, result: { transcription: result } });
        } else {
          console.log('VOX.AI: On-device transcription returned generic response, treating as failure');
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

      console.log('VOX.AI: Processing text in page:', text);
      console.log('VOX.AI: Form schema:', schema);

      try {
        const session = await ensureSession();
        console.log('VOX.AI: Session created, generating prompt...');
        
        const prompt = `
          You are a helpful assistant that fills out web forms.
          Based on the following transcription, fill out the form fields described in the JSON schema.
          Your response should be a JSON object with a single key: "structured", where the value is an object of the filled form fields.

          Transcription: "${text}"

          Schema:
          ${JSON.stringify(schema)}
        `;

        console.log('VOX.AI: Calling session.prompt...');
        const result = await session.prompt(prompt);
        console.log('VOX.AI: Session prompt result:', result);
        
        // Extract JSON from markdown format if present
        let jsonString = result;
        if (result.includes('```json')) {
          const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            jsonString = jsonMatch[1].trim();
          }
        }
        
        console.log('VOX.AI: Extracted JSON string:', jsonString);
        const json = JSON.parse(jsonString);
        console.log('VOX.AI: Parsed JSON:', json);
        respond(channel, { success: true, result: json });
      } catch (err) {
        console.error('VOX.AI inpage error', err);
        respond(channel, { success: false, error: String(err) });
      }
    }
  });
})();