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
      console.log('VOX.AI [Firebase Injector]: Firebase app initialized');
      
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      console.log('VOX.AI [Firebase Injector]: Gemini Developer API initialized');
      
      const model = getGenerativeModel(ai, { model: "gemini-2.5-flash" });
      console.log('VOX.AI [Firebase Injector]: Generative model created (gemini-2.5-flash)');
      
      // Expose to global scope for content scripts to access
      window.__voxai_firebase_app = app;
      window.__voxai_firebase_ai = ai;
      window.__voxai_firebase_model = model;
      window.__voxai_firebase_ready = true;
      
      // Listen for transcription requests from content script
      window.addEventListener('message', async (event) => {
        if (event.data.action === 'VOX_TRANSCRIBE_AUDIO') {
          try {
            console.log('VOX.AI [Firebase Injector]: Received transcription request');
            const base64Audio = event.data.audioBase64;
            
            const result = await model.generateContent([
              { text: 'Transcribe this audio. Return ONLY the transcribed text in the ORIGINAL LANGUAGE SPOKEN. Do NOT translate. Do NOT add explanations. Just the text.' },
              { inlineData: { data: base64Audio, mimeType: 'audio/webm' } }
            ]);
            
            const transcription = result.response.text();
            console.log('VOX.AI [Firebase Injector]: Transcription complete:', transcription.substring(0, 100) + '...');
            
            // Send result back to content script
            window.postMessage({
              action: 'VOX_FIREBASE_TRANSCRIPTION_RESULT',
              result: transcription
            }, '*');
          } catch (error) {
            console.error('VOX.AI [Firebase Injector]: Transcription failed:', error);
            window.postMessage({
              action: 'VOX_FIREBASE_TRANSCRIPTION_RESULT',
              error: error.message
            }, '*');
          }
        }
        
        if (event.data.action === 'VOX_EXTRACT_FORM') {
          try {
            console.log('VOX.AI [Firebase Injector]: Received form extraction request');
            const text = event.data.text;
            const prompt = event.data.prompt;
            
            const result = await model.generateContent(prompt);
            const extraction = result.response.text();
            console.log('VOX.AI [Firebase Injector]: Form extraction complete:', extraction.substring(0, 100) + '...');
            
            // Send result back to content script
            window.postMessage({
              action: 'VOX_FIREBASE_EXTRACTION_RESULT',
              result: extraction
            }, '*');
          } catch (error) {
            console.error('VOX.AI [Firebase Injector]: Form extraction failed:', error);
            window.postMessage({
              action: 'VOX_FIREBASE_EXTRACTION_RESULT',
              error: error.message
            }, '*');
          }
        }
        
        if (event.data.action === 'VOX_QUERY_FIREBASE') {
          console.log('VOX.AI [Firebase Injector]: Received Firebase availability query');
          window.postMessage({
            action: 'VOX_FIREBASE_READY',
            ready: true
          }, '*');
        }
      });
      
      console.log('VOX.AI [Firebase Injector]: Firebase initialized and ready');
    } catch (error) {
      console.error('VOX.AI [Firebase Injector]: Initialization failed:', error);
      window.__voxai_firebase_ready = false;
    }
  `;
  document.head.appendChild(script);
  console.log('VOX.AI [Firebase Injector]: Firebase SDK module injected into page');
})();
