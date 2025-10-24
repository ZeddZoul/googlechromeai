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

      let isAvailable = false;
      try {
        if (typeof LanguageModel !== 'undefined' && LanguageModel.availability) {
          const availability = await LanguageModel.availability(modelCapabilities);
          isAvailable = availability !== 'unavailable';
        }
      } catch (e) {
        isAvailable = false;
      }

      respond(channel, { isAvailable });
      return;
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

          Transcription: "${text}"

          Schema:
          ${JSON.stringify(schema)}
        `;

        const result = await session.prompt(prompt);
        const json = JSON.parse(result);
        console.log('VOX.AI: Inferred form data:', json);
        respond(channel, { success: true, result: json });
      } catch (err) {
        console.error('VOX.AI inpage error', err);
        respond(channel, { success: false, error: String(err) });
      }
    }
  });
})();