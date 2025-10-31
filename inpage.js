// inpage.js - Handles on-device text-based inference.
(function () {
  if (window.__survsay_inpage_installed) return;
  window.__survsay_inpage_installed = true;

  function respond(channel, payload) {
    try {
      console.log('Survsay: inpage.js responding on channel:', channel, 'with payload:', payload);
      window.postMessage({ channel, payload }, '*');
    } catch (e) {
      console.error('Survsay: inpage.js respond error:', e);
      const safe = { success: false, error: 'Failed to post response: ' + String(e) };
      window.postMessage({ channel, payload: safe }, '*');
    }
  }

  const modelCapabilities = {
    expectedInputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }],
    expectedOutputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }]
  };

  async function ensureSession() {
    if (window.__survsay_languageModelSession) return window.__survsay_languageModelSession;
    if (typeof LanguageModel === 'undefined') throw new Error('LanguageModel API not present');

    const sessionOptions = {
      monitor(m) {
        try { m.addEventListener && m.addEventListener('downloadprogress', (ev) => console.log('LanguageModel download progress', ev.loaded)); } catch (e) { }
      },
      systemPrompt: 'You are a helpful assistant. Always respond in English.',
      ...modelCapabilities
    };
    window.__survsay_languageModelSession = await LanguageModel.create(sessionOptions);
    return window.__survsay_languageModelSession;
  }

  window.addEventListener('message', async (ev) => {
    if (!ev.data || !ev.data.survsay) return;

    if (ev.data.survsay === 'CHECK_NANO_ELIGIBILITY') {
      const { channel } = ev.data;
      if (!channel) return;

      console.log('Survsay: Checking Nano eligibility...');
      let isEligible = false;
      try {
        if (typeof LanguageModel !== 'undefined' && LanguageModel.availability) {
          const availability = await LanguageModel.availability(modelCapabilities);
          isEligible = availability !== 'unavailable';
          console.log('Survsay: Nano availability status:', availability);
        } else {
          console.log('Survsay: LanguageModel API not found for eligibility check.');
        }
      } catch (e) {
        console.error('Survsay: Error during Nano eligibility check:', e);
        isEligible = false;
      }

      console.log('Survsay: Nano eligibility:', isEligible);
      respond(channel, { success: true, isEligible });
      return;
    }

    if (ev.data.survsay === 'CHECK_ON_DEVICE') {
      const { channel } = ev.data;
      if (!channel) return;

      console.log('Survsay: Checking on-device availability...');
      let isAvailable = false;
      let session = null;
      try {
        if (typeof LanguageModel !== 'undefined' && LanguageModel.availability) {
          const availability = await LanguageModel.availability(modelCapabilities);
          isAvailable = availability !== 'unavailable';
          console.log('Survsay: LanguageModel availability:', availability);

          // If available, create session for form extraction (Layer 1)
          if (isAvailable) {
            try {
              session = await ensureSession();
              console.log('Survsay: Nano session ready for form extraction');
            } catch (e) {
              console.warn('Survsay: Could not create Nano session', e);
              session = null;
            }
          }
        } else {
          console.log('Survsay: LanguageModel not available');
        }
      } catch (e) {
        console.log('Survsay: LanguageModel check failed:', e);
        isAvailable = false;
      }

      console.log('Survsay: On-device available:', isAvailable);
      respond(channel, { isAvailable, session: isAvailable ? 'available' : null });
      return;
    }

    if (ev.data.survsay === 'PROCESS_AUDIO_INPAGE') {
      const { audioBase64, channel } = ev.data;
      if (!channel) return;

      console.log('Survsay: Processing audio in page, base64 length:', audioBase64.length);

      try {
        const session = await ensureSession();
        console.log('Survsay: Session created for audio processing...');

        const prompt = `Please transcribe the following audio. Return only the transcribed text, nothing else.`;

        console.log('Survsay: Calling session.prompt for audio transcription...');
        const result = await session.prompt(prompt, {
          contents: [
            { role: "user", parts: [{ text: prompt }] },
            { role: "model", parts: [{ text: "I'm ready to transcribe audio. Please provide the audio." }] },
            { role: "user", parts: [{ inlineData: { mimeType: "audio/webm", data: audioBase64 } }] }
          ]
        });

        console.log('Survsay: Audio transcription result:', result);

        // Check if the result is actually a transcription or just a generic response
        if (result && result.length > 10 && !result.includes("paste the audio") && !result.includes("transcribe it")) {
          respond(channel, { success: true, result: { transcription: result } });
        } else {
          console.log('Survsay: On-device transcription returned generic response, treating as failure');
          respond(channel, { success: false, error: 'On-device transcription failed - generic response' });
        }
      } catch (err) {
        console.error('Survsay audio processing error', err);
        respond(channel, { success: false, error: String(err) });
      }
    }

    if (ev.data.survsay === 'PROCESS_TEXT_INPAGE') {
      const { text, schema, context, channel } = ev.data;
      if (!channel) return;

      console.log('Survsay: Processing text with Nano (Layer 1):', text.substring(0, 50) + '...');
      console.log('Survsay: Form schema:', schema);
      console.log('Survsay: Surrounding text context:', context);

      try {
        const session = await ensureSession();
        console.log('Survsay: Nano session ready for form extraction');

        const prompt = `
          You are a highly precise assistant that fills out web forms based ONLY on the information a user provides.
          Your task is to analyze the user's speech (transcription) and fill the form fields from the provided JSON schema.

          **CRITICAL INSTRUCTIONS:**
          1.  **Be very strict.** Only fill in fields for which the user has explicitly provided a value in their speech.
          2.  **If no value is given for a field, you MUST omit it entirely from your response.** Do not include the key for that field in the output JSON.
          3.  **Do not guess or infer values.** Do not use the field's label or name as its value. For example, if the user doesn't state their "Years of Experience", do not return \`"experience": "Years of Experience"\`.
          4.  **For numeric fields, if no number is provided, do not default to 0.** Omit the field completely.

          Your response MUST be a JSON object with a single key: "structured", where the value is an object containing ONLY the filled form fields.

          ---
          Surrounding Context: ${context || 'No context provided.'}
          ---
          Transcription: "${text}"
          ---
          Schema:
          ${JSON.stringify(schema)}
        `;

        console.log('Survsay: Calling Nano model for extraction with language=en...');
        const result = await session.prompt(prompt);
        console.log('Survsay: Nano extraction result:', result);

        // Extract JSON from markdown format if present
        let jsonString = result;
        if (result.includes('```json')) {
          const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            jsonString = jsonMatch[1].trim();
          }
        }

        console.log('Survsay: Extracted JSON string:', jsonString);
        const json = JSON.parse(jsonString);
        console.log('Survsay: Nano extraction successful:', json);
        respond(channel, { success: true, result: json });
      } catch (err) {
        console.warn('Survsay: Nano extraction failed (Layer 1 will fallback to Firebase):', err);
        // Return failure - content_script will use Firebase fallback (Layer 2)
        respond(channel, { success: false, error: String(err) });
      }
    }

    if (ev.data.survsay === 'REWRITE_TEXT') {
      const { text, tone, length, context, channel } = ev.data;
      if (!channel) return;

      console.log(`Survsay: Rewriting text with tone '${tone}' and length '${length}':`, text.substring(0, 50) + '...');

      try {
        const session = await ensureSession();

        let lengthInstruction = '';
        if (length === 'shorter') {
          lengthInstruction = ' Make the text shorter.';
        } else if (length === 'longer') {
          lengthInstruction = ' Make the text longer.';
        }

        let contextHint = '';
        if (context && context.instructions) {
          contextHint = ' IMPORTANT: ' + context.instructions;
        }

        const prompt = 'Rewrite the following text in a ' + tone + ' tone.' +
          lengthInstruction +
          contextHint +
          ' Return only the rewritten text, and nothing else.' +
          '\n\nText: "' + text + '"';

        const result = await session.prompt(prompt);
        console.log('Survsay: Nano rewrite result:', result);
        respond(channel, { success: true, rewrittenText: result });
      } catch (err) {
        console.warn('Survsay: Nano rewrite failed:', err);
        respond(channel, { success: false, error: String(err) });
      }
    }
  });
})();