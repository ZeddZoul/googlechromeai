import { onFlow } from "@firebase/rules-unit-testing";
import { gemini } from "@firebase/rules-unit-testing/ai";

export const transcribeAudio = onFlow(
  {
    // TODO: Add any necessary security rules here
  },
  async (request) => {
    const apiKey = "YOUR_API_KEY"; // As requested for the hackathon
    const model = gemini({ apiKey });

    const { audioBase64, schema } = request.data;

    const prompt = `
      You are a helpful assistant that fills out web forms.
      Transcribe the audio and use the information to fill out the form fields described in the following JSON schema.
      Your response should be a JSON object with two keys: "transcription" (the full transcribed text) and "structured" (an object where the keys are the field names from the schema and the values are the information extracted from the audio).

      Schema:
      ${JSON.stringify(schema)}
    `;

    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: prompt }] },
        { role: "model", parts: [{ text: "Okay, I am ready to help. Please provide the audio." }] },
        { role: "user", parts: [{ inlineData: { mimeType: "audio/webm", data: audioBase64 } }] }
      ]
    });

    const response = result.response;
    const text = response.text();

    try {
      const json = JSON.parse(text);
      return json;
    } catch (e) {
      // If the response is not valid JSON, return it as the transcription.
      return { transcription: text, structured: {} };
    }
  }
);