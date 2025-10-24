# Firebase Setup & Deployment Guide

## 🔧 **Issues Found & How to Fix Them:**

### **1. Firebase Project Configuration**
Your `firebase-config.js` needs the correct values from your Firebase project.

**To get the correct values:**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `chrome-vox-ai`
3. Go to Project Settings (gear icon)
4. Scroll down to "Your apps" section
5. Click on your web app or create one if it doesn't exist
6. Copy the config values

**Replace these in `firebase-config.js`:**
```javascript
const firebaseConfig = {
  apiKey: "your-actual-api-key",
  authDomain: "chrome-vox-ai.firebaseapp.com",
  projectId: "chrome-vox-ai",
  storageBucket: "chrome-vox-ai.appspot.com",
  messagingSenderId: "your-actual-sender-id", // Numbers only
  appId: "your-actual-app-id" // Format: 1:123456789:web:abcdef
};
```

### **2. Gemini API Key**
You need a Google AI Studio API key for the transcription.

**To get the API key:**
1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Sign in with your Google account
3. Click "Get API Key" in the left sidebar
4. Create a new API key
5. Copy the key

**Set the API key in your Firebase Functions:**
```bash
# In your Firebase Functions directory
firebase functions:config:set gemini.api_key="your-actual-gemini-api-key"
```

### **3. Deploy Firebase Functions**
Make sure your Firebase Functions are deployed:

```bash
# In your project root
firebase deploy --only functions
```

### **4. Enable Required APIs**
In your Firebase project, enable:
- Cloud Functions
- Google AI API (if using Gemini)

## 🚀 **Quick Deployment Steps:**

### **1. Install Dependencies**
```bash
# In your project root
npm install firebase-functions@latest firebase-admin@latest @google/generative-ai
```

### **2. Set Environment Variables**
```bash
# Set your Gemini API key
firebase functions:config:set gemini.api_key="your-actual-gemini-api-key"

# Or set it as a secret (recommended)
firebase functions:secrets:set GEMINI_API_KEY
# Then enter your API key when prompted
```

### **3. Deploy Functions**
```bash
# Deploy only the functions
firebase deploy --only functions

# Or deploy everything
firebase deploy
```

### **4. Test the Function**
After deployment, test with:
```bash
# Check function logs
firebase functions:log

# Test the function directly
curl -X POST https://us-central1-chrome-vox-ai.cloudfunctions.net/transcribeAudio \
  -H "Content-Type: application/json" \
  -d '{"data": {"audioBase64": "test"}}'
```

## 🔍 **Testing:**
After setup, test the transcription by recording audio. You should see:
```
VOX.AI: Trying Firebase transcription...
VOX.AI: Firebase transcription successful: "your speech here"
```

If you still get errors, check the Firebase Functions logs:
```bash
firebase functions:log
```
