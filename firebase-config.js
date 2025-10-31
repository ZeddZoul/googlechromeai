// firebase-config.js - Firebase AI for VOX.AI hybrid pipeline

const firebaseConfig = {
  apiKey: 'AIzaSyCVLllZy_gnW44L5wkL9lXCeYqE2la6xRs',
  authDomain: 'realtimedb-94d99.firebaseapp.com',
  databaseURL: 'https://realtimedb-94d99-default-rtdb.firebaseio.com',
  projectId: 'realtimedb-94d99',
  storageBucket: 'realtimedb-94d99.firebasestorage.app',
  messagingSenderId: '367899135796',
  appId: '1:367899135796:web:d20432ccc0bfa4136b9f61'
};

let firebaseApp = null;
let firebaseGenerativeModel = null;
let firebaseInitialized = false;

async function getFirebaseFromPage(maxWaitMs = 10000) {
  console.log('VOX.AI [Firebase Init]: Retrieving Firebase objects from page context...');
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Query the page for Firebase objects via message passing
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Query timeout')), 1000);
        window.postMessage({ action: 'VOX_QUERY_FIREBASE' }, '*');
        
        const handler = (event) => {
          if (event.data.action === 'VOX_FIREBASE_READY') {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(event.data);
          }
        };
        window.addEventListener('message', handler);
      });
      
      if (response.ready) {
        console.log('VOX.AI [Firebase Init]: Firebase objects retrieved from page');
        return response;
      }
    } catch (e) {
      // Not ready yet, retry
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.warn('VOX.AI [Firebase Init]: Timeout retrieving Firebase from page');
  return null;
}

async function initializeFirebase() {
  if (firebaseInitialized) {
    console.log('VOX.AI [Firebase Init]: Already initialized');
    return true;
  }
  try {
    // Get Firebase from page context
    const fbData = await getFirebaseFromPage();
    if (!fbData) {
      console.warn('VOX.AI [Firebase Init]: Could not retrieve Firebase from page');
      return false;
    }
    
    console.log('VOX.AI [Firebase Init]: Firebase app initialized successfully');
    console.log('VOX.AI [Firebase Init]: Gemini model initialized (gemini-2.5-flash)');

    firebaseInitialized = true;
    // Store a flag so we can use transcribeWithFirebase
    window.__voxai_firebase_available = true;
    console.log('VOX.AI [Firebase Init]: Firebase AI fully initialized and ready');
    return true;
  } catch (error) {
    console.error('VOX.AI [Firebase Init]: Failed -', error);
    firebaseInitialized = false;
    return false;
  }
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function transcribeWithFirebase(audioBlob) {
  try {
    if (!window.__voxai_firebase_available) {
      const ok = await initializeFirebase();
      if (!ok) return null;
    }
    console.log('VOX.AI [Firebase Transcription]: Converting audio blob to base64...');
    const base64Audio = await blobToBase64(audioBlob);
    console.log('VOX.AI [Firebase Transcription]: Base64 size:', base64Audio.length, 'bytes');
    
    console.log('VOX.AI [Firebase Transcription]: Calling Gemini API with language=en...');
    
    // Send request to page context to use Firebase
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Firebase transcription timeout'));
      }, 30000);
      
      const handler = (event) => {
        if (event.data.action === 'VOX_FIREBASE_TRANSCRIPTION_RESULT') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            console.log('VOX.AI [Firebase Transcription]: SUCCESS - Got transcript:', event.data.result.substring(0, 100) + '...');
            resolve(event.data.result);
          }
        }
      };
      window.addEventListener('message', handler);
      
      // Request transcription from page
      window.postMessage({
        action: 'VOX_TRANSCRIBE_AUDIO',
        audioBase64: base64Audio
      }, '*');
    });
  } catch (e) {
    console.error('VOX.AI [Firebase Transcription]: FAILED -', e);
    return null;
  }
}

async function extractFormDataWithFirebase(text, schema) {
  try {
    if (!firebaseGenerativeModel) {
      const ok = await initializeFirebase();
      if (!ok) return null;
    }
    console.log('VOX.AI [Firebase Extraction]: Building prompt with', schema.fields.length, 'fields');
    
    // Build a detailed field mapping to help the model understand what to extract
    const fieldsList = schema.fields.map(f => {
      let fieldDesc = `- "${f.label || f.name}" (field name: "${f.name}", type: ${f.inputType || f.type})`;
      return fieldDesc;
    }).join('\n');
    
    const prompt = `Extract form field values from this text. IMPORTANT: Return JSON with field names as keys, exactly matching these names:
${fieldsList}

Text to extract from: "${text}"

Instructions:
1. Extract values for each field mentioned above
2. Return ONLY valid JSON with field names as keys: {"fieldName": "value"}
3. If a field is a dropdown/select (type: select), try to match the value to common options
4. Skip fields that have no clear values
5. Do NOT translate - keep values in their original language

Return ONLY the JSON, nothing else:`;
    
    console.log('VOX.AI [Firebase Extraction]: Calling Gemini API with language=en...');
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Firebase extraction timeout'));
      }, 30000);
      
      const handler = (event) => {
        if (event.data.action === 'VOX_FIREBASE_EXTRACTION_RESULT') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            console.log('VOX.AI [Firebase Extraction]: Got response:', event.data.result.substring(0, 100) + '...');
            
            try {
              const match = event.data.result.match(/\{[\s\S]*\}/);
              if (!match) {
                console.warn('VOX.AI [Firebase Extraction]: No JSON found in response');
                resolve(null);
                return;
              }
              
              const extracted = JSON.parse(match[0]);
              console.log('VOX.AI [Firebase Extraction]: SUCCESS - Extracted', Object.keys(extracted).length, 'fields');
              resolve(extracted);
            } catch (e) {
              console.error('VOX.AI [Firebase Extraction]: JSON parsing failed -', e);
              resolve(null);
            }
          }
        }
      };
      window.addEventListener('message', handler);
      
      // Request extraction from page
      window.postMessage({
        action: 'VOX_EXTRACT_FORM',
        text: text,
        prompt: prompt
      }, '*');
    });
  } catch (e) {
    console.error('VOX.AI [Firebase Extraction]: FAILED -', e);
    return null;
  }
}

function showNotification(msg, dur = 3000) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:white;padding:12px 20px;border-radius:8px;font-size:14px;z-index:2147483647;opacity:0;animation:voxIn 0.3s ease-out forwards;';
  const style = document.createElement('style');
  style.textContent = '@keyframes voxIn{from{opacity:0;transform:translateX(-50%) translateY(-20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}@keyframes voxOut{from{opacity:1;transform:translateX(-50%) translateY(0)}to{opacity:0;transform:translateX(-50%) translateY(-20px)}}';
  el.textContent = msg;
  document.head.appendChild(style);
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'voxOut 0.3s ease-out forwards';
    setTimeout(() => { el.remove(); style.remove(); }, 300);
  }, dur);
}
