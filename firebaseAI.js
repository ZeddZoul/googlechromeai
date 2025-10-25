// firebaseAI.js - Hybrid AI orchestrator (Nano -> Firebase -> Web Speech)

/**
 * LAYER 1: Try Nano on-device AI
 * LAYER 2: Fall back to Firebase Gemini
 * LAYER 3: Fall back to Web Speech API
 */

async function transcribeAudio(audioBlob, webSpeechTranscript) {
  // LAYER 1: Try Nano (if model detection shows it's available)
  // Note: Nano doesn't support audio directly, but we check availability first
  const nanoAvailable = await checkNanoAvailability();
  if (nanoAvailable) {
  }

  // LAYER 2: Firebase Gemini
  const firebaseResult = await transcribeWithFirebase(audioBlob);
  if (firebaseResult && firebaseResult.trim()) {
    return firebaseResult;
  }

  // LAYER 3: Web Speech API fallback
  if (webSpeechTranscript && webSpeechTranscript.trim()) {
    return webSpeechTranscript;
  }

  console.error('VOX.AI [Transcription Orchestrator]: ✗ ALL LAYERS FAILED - No transcription obtained');
  showNotification('VOX.AI is experiencing some distress on this device. Try again later.');
  return null;
}

async function extractFormData(text, schema, nanoSession) {
  // LAYER 1: Try Nano on-device AI
  if (nanoSession) {
    const nanoResult = await extractWithNano(text, schema, nanoSession);
    if (nanoResult && Object.keys(nanoResult).length > 0) {
      return nanoResult;
    }
  }

  // LAYER 2: Firebase Gemini
  const firebaseResult = await extractFormDataWithFirebase(text, schema);
  if (firebaseResult && Object.keys(firebaseResult).length > 0) {
    return firebaseResult;
  }

  // LAYER 3: Pattern-matching fallback (existing logic)
  const patternResult = await extractWithPatternMatching(text, schema);
  if (patternResult && Object.keys(patternResult).length > 0) {
    return patternResult;
  }

  console.error('VOX.AI [Extraction Orchestrator]: ✗ ALL LAYERS FAILED - Could not extract form data');
  showNotification('VOX.AI is experiencing some distress on this device. Try again later.');
  return null;
}

async function checkNanoAvailability() {
  try {
    if (typeof LanguageModel === 'undefined') return false;
    const availability = await LanguageModel.availability();
    return availability !== 'unavailable';
  } catch (e) {
    console.warn('VOX.AI: Nano check failed', e);
    return false;
  }
}

async function extractWithNano(text, schema, session) {
  try {
    if (!session) return null;
    const fieldsList = schema.fields.map(f => `${f.label || f.name}`).join(', ');
    const prompt = `Extract values for these fields from: "${text}"\nFields: ${fieldsList}\nReturn JSON like: {"field": "value"}`;
    const result = await session.prompt(prompt);
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('VOX.AI: Nano extraction failed', e);
    return null;
  }
}

async function extractWithPatternMatching(text, schema) {
  try {
    const result = {};
    const words = text.toLowerCase().split(/\s+/);

    for (const field of schema.fields) {
      const label = (field.label || field.name).toLowerCase();
      let foundValue = null;

      for (let i = 0; i < words.length; i++) {
        if (label.includes(words[i]) || words[i].includes(label.split(' ')[0])) {
          foundValue = words.slice(i + 1, i + 3).join(' ');
          break;
        }
      }

      if (foundValue && foundValue.trim()) {
        result[field.name] = foundValue.trim();
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (e) {
    console.error('VOX.AI: Pattern matching failed', e);
    return null;
  }
}
