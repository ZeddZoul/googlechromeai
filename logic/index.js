import { onFlow } from "@firebase/rules-unit-testing";
import { gemini } from "@firebase/rules-unit-testing/ai";

export const transcribeAudio = onFlow(
  {
    // TODO: Add any necessary security rules here
  },
  async (request) => {
    const apiKey = "YOUR_API_KEY"; // As requested for the hackathon
    const model = gemini({ apiKey });

    const audioBase64 = request.data.audioBase64;

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ inlineData: { mimeType: "audio/webm", data: audioBase64 } }]
      }]
    });

    const response = result.response;
    const text = response.text();

    return { transcription: text };
  }
);