import { onCall } from "firebase-functions/v2/https";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const transcribeAudio = onCall(
  {
    // Security rules
    cors: [
      "https://chrome-extension://*",
      "http://localhost:*",
      "https://localhost:*",
      "https://*.google.com",
      "https://*.firebaseapp.com"
    ],
  },
  async (request) => {
    try {
      // Get API key from environment or use your actual key
      const apiKey = process.env.GEMINI_API_KEY || "YOUR_ACTUAL_GEMINI_API_KEY";
      
      if (!apiKey || apiKey === "YOUR_ACTUAL_GEMINI_API_KEY") {
        throw new Error("Gemini API key not configured");
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const { audioBase64 } = request.data;

      if (!audioBase64) {
        throw new Error("No audio data provided");
      }

      const prompt = "Please transcribe the following audio. Return only the transcribed text, nothing else.";

      const result = await model.generateContent([
        {
          text: prompt
        },
        {
          inlineData: {
            mimeType: "audio/webm",
            data: audioBase64
          }
        }
      ]);

      const response = await result.response;
      const transcription = response.text();

      return { transcription };
    } catch (error) {
      console.error("Transcription error:", error);
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }
);