// firebase-injector.js - Injects Firebase SDK with Gemini Developer API into page context

(function() {
  let firebaseReady = false;
  let firebaseModel = null;

  // Create and inject Firebase SDK module script
  const script = document.createElement('script');
  script.type = 'module';
  script.textContent = `
    import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
    import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-ai.js";
    
    const firebaseConfig = {
      apiKey: "AIzaSyCHB0fH6WmOe94lg2DnyYyVEFY4KFcxbiQ",
      authDomain: "chrome-vox-ai.firebaseapp.com",
      projectId: "chrome-vox-ai",
      storageBucket: "chrome-vox-ai.firebasestorage.app",
      messagingSenderId: "718814904599",
      appId: "1:718814904599:web:215317fe55368780347752",
      measurementId: "G-570TLMN8H7"
    };
    
    try {
      const app = initializeApp(firebaseConfig);
      console.log('Survsay [Firebase Injector]: Firebase app initialized');
      
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      console.log('Survsay [Firebase Injector]: Gemini Developer API initialized');
      
      const model = getGenerativeModel(ai, { model: "gemini-2.5-flash" });
      console.log('Survsay [Firebase Injector]: Generative model created (gemini-2.5-flash)');
      
      // Expose to global scope for content scripts to access
      window.__survsay_firebase_app = app;
      window.__survsay_firebase_ai = ai;
      window.__survsay_firebase_model = model;
      window.__survsay_firebase_ready = true;
      
      // Listen for transcription requests from content script
      window.addEventListener('message', async (event) => {
        if (event.data.action === 'SURVSAY_TRANSCRIBE_AUDIO') {
          try {
            console.log('Survsay [Firebase Injector]: Received transcription request');
            const base64Audio = event.data.audioBase64;
            
            const result = await model.generateContent([
              { text: 'Transcribe this audio. Return ONLY the transcribed text in the ORIGINAL LANGUAGE SPOKEN. Do NOT translate. Do NOT add explanations. Just the text.' },
              { inlineData: { data: base64Audio, mimeType: 'audio/webm' } }
            ]);
            
            const transcription = result.response.text();
            console.log('Survsay [Firebase Injector]: Transcription complete:', transcription.substring(0, 100) + '...');
            
            // Send result back to content script
            window.postMessage({
              action: 'SURVSAY_FIREBASE_TRANSCRIPTION_RESULT',
              result: transcription
            }, '*');
          } catch (error) {
            console.error('Survsay [Firebase Injector]: Transcription failed:', error);
            window.postMessage({
              action: 'SURVSAY_FIREBASE_TRANSCRIPTION_RESULT',
              error: error.message
            }, '*');
          }
        }
        
        if (event.data.action === 'SURVSAY_PROCESS_TEXT_FIREBASE') {
          try {
            console.log('Survsay [Firebase Injector]: Received text processing request (Layer 2)');
            const { text, schema, context } = event.data;

            const prompt = \`
              You are a highly precise assistant that fills out web forms based ONLY on the information a user provides.
              Your task is to analyze the user's speech (transcription) and fill the form fields from the provided JSON schema.

              **CRITICAL INSTRUCTIONS:**
              1.  **Be very strict.** Only fill in fields for which the user has explicitly provided a value in their speech.
              2.  **If no value is given for a field, you MUST omit it entirely from your response.** Do not include the key for that field in the output JSON.
              3.  **Do not guess or infer values.** Do not use the field's label or name as its value.
              4.  **For numeric fields, if no number is provided, do not default to 0.** Omit the field completely.

              Your response MUST be a JSON object with a single key: "structured", where the value is an object containing ONLY the filled form fields.

              ---
              Surrounding Context: \${context || 'No context provided.'}
              ---
              Transcription: "\${text}"
              ---
              Schema:
              \${JSON.stringify(schema)}
            \`;
            
            const result = await model.generateContent(prompt);
            let jsonString = result.response.text();
            console.log('Survsay [Firebase Injector]: Firebase extraction complete:', jsonString.substring(0, 100) + '...');
            
            // Clean the response to ensure it's valid JSON
            if (jsonString.includes('\\\`\\\`\\\`json')) {
              const jsonMatch = jsonString.match(/\\\`\\\`\\\`json\\s*([\\s\\S]*?)\\s*\\\`\\\`\\\`/);
              if (jsonMatch) {
                jsonString = jsonMatch[1].trim();
              }
            }
            const json = JSON.parse(jsonString);

            window.postMessage({
              action: 'SURVSAY_FIREBASE_EXTRACTION_RESULT',
              result: json
            }, '*');
          } catch (error) {
            console.error('Survsay [Firebase Injector]: Firebase text processing failed:', error);
            window.postMessage({
              action: 'SURVSAY_FIREBASE_EXTRACTION_RESULT',
              error: error.message
            }, '*');
          }
        }
        
        if (event.data.action === 'SURVSAY_QUERY_FIREBASE') {
          console.log('Survsay [Firebase Injector]: Received Firebase availability query');
          window.postMessage({
            action: 'SURVSAY_FIREBASE_READY',
            ready: true
          }, '*');
        }
      });
      
      console.log('Survsay [Firebase Injector]: Firebase initialized and ready');
    } catch (error) {
      console.error('Survsay [Firebase Injector]: Initialization failed:', error);
      window.__survsay_firebase_ready = false;
    }
  `;
  document.head.appendChild(script);
  console.log('Survsay [Firebase Injector]: Firebase SDK module injected into page');
  window.__survsay_firebase_injector_complete = true; // Signal successful execution
})();
