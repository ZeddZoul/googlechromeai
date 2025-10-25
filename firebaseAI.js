// firebaseAI.js - Hybrid AI orchestrator (Nano -> Firebase -> Web Speech)

/**
 * LAYER 1: Try Nano on-device AI
 * LAYER 2: Fall back to Firebase Gemini
 * LAYER 3: Fall back to Web Speech API
 */

async function transcribeAudio(audioBlob, webSpeechTranscript) {
  console.log('VOX.AI [Transcription Orchestrator]: Starting 3-layer transcription pipeline...');

  // LAYER 1: Try Nano (if model detection shows it's available)
  // Note: Nano doesn't support audio directly, but we check availability first
  const nanoAvailable = await checkNanoAvailability();
  if (nanoAvailable) {
    console.log('VOX.AI [Transcription Orchestrator]: Nano detected, but Nano does not support audio - skipping to Layer 2');
  }

  // LAYER 2: Firebase Gemini
  console.log('VOX.AI [Transcription Orchestrator]: Layer 2 - Attempting Firebase Gemini transcription');
  const firebaseResult = await transcribeWithFirebase(audioBlob);
  if (firebaseResult && firebaseResult.trim()) {
    console.log('VOX.AI [Transcription Orchestrator]: ✓ SUCCESS via Firebase (Layer 2)');
    return firebaseResult;
  }
  console.log('VOX.AI [Transcription Orchestrator]: Layer 2 failed, moving to Layer 3...');

  // LAYER 3: Web Speech API fallback
  console.log('VOX.AI [Transcription Orchestrator]: Layer 3 - Using Web Speech API fallback');
  if (webSpeechTranscript && webSpeechTranscript.trim()) {
    console.log('VOX.AI [Transcription Orchestrator]: ✓ SUCCESS via Web Speech API (Layer 3)');
    return webSpeechTranscript;
  }

  console.error('VOX.AI [Transcription Orchestrator]: ✗ ALL LAYERS FAILED - No transcription obtained');
  showNotification('VOX.AI is experiencing some distress on this device. Try again later.');
  return null;
}

async function extractFormData(text, schema, nanoSession) {
  console.log('VOX.AI [Extraction Orchestrator]: Starting 3-layer form extraction pipeline...');

  // LAYER 1: Try Nano on-device AI
  if (nanoSession) {
    console.log('VOX.AI [Extraction Orchestrator]: Layer 1 - Attempting Nano (on-device) form extraction');
    const nanoResult = await extractWithNano(text, schema, nanoSession);
    if (nanoResult && Object.keys(nanoResult).length > 0) {
      console.log('VOX.AI [Extraction Orchestrator]: ✓ SUCCESS via Nano (Layer 1) -', Object.keys(nanoResult).length, 'fields');
      return nanoResult;
    }
    console.log('VOX.AI [Extraction Orchestrator]: Layer 1 failed, moving to Layer 2...');
  } else {
    console.log('VOX.AI [Extraction Orchestrator]: Layer 1 skipped (Nano not available)');
  }

  // LAYER 2: Firebase Gemini
  console.log('VOX.AI [Extraction Orchestrator]: Layer 2 - Attempting Firebase Gemini form extraction');
  const firebaseResult = await extractFormDataWithFirebase(text, schema);
  if (firebaseResult && Object.keys(firebaseResult).length > 0) {
    console.log('VOX.AI [Extraction Orchestrator]: ✓ SUCCESS via Firebase (Layer 2) -', Object.keys(firebaseResult).length, 'fields');
    return firebaseResult;
  }
  console.log('VOX.AI [Extraction Orchestrator]: Layer 2 failed, moving to Layer 3...');

  // LAYER 3: Pattern-matching fallback (existing logic)
  console.log('VOX.AI [Extraction Orchestrator]: Layer 3 - Using pattern-matching fallback');
  const patternResult = await extractWithPatternMatching(text, schema);
  if (patternResult && Object.keys(patternResult).length > 0) {
    console.log('VOX.AI [Extraction Orchestrator]: ✓ SUCCESS via Pattern-Matching (Layer 3) -', Object.keys(patternResult).length, 'fields');
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
