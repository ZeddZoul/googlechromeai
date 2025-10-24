import { onFlow } from "@firebase/rules-unit-testing";
import { gemini } from "@firebase/rules-unit-testing/ai";

export const transcribeAudio = onFlow(
  {
    // TODO: Add any necessary security rules here
  },
  async (request) => {
    const apiKey = "YOUR_API_KEY"; // As requested for the hackathon
    const model = gemini({ apiKey });

    const { audioBase64 } = request.data;

    const prompt = "Please transcribe the following audio.";

    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: prompt }] },
        { role: "model", parts: [{ text: "Okay, I am ready to help. Please provide the audio." }] },
        { role: "user", parts: [{ inlineData: { mimeType: "audio/webm", data: audioBase64 } }] }
      ]
    });

    const response = result.response;
    const text = response.text();

    return { transcription: text };
  }
);