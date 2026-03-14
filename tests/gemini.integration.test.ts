import { describe, expect, test } from "bun:test";
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import {
  fetchLiveModels,
  probeLiveModelForTranscription,
  validateApiKey,
  validateLiveModel,
} from "../src/gemini";
import { requireGeminiApiKeyForTests } from "./helpers/gemini-test-config";

describe("Gemini integration", () => {
  test("requires GEMINI_API_KEY", () => {
    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
    expect(apiKey.length).toBeGreaterThan(0);
  });

  test("validateApiKey succeeds with configured key", async () => {
    const apiKey = requireGeminiApiKeyForTests();
    await validateApiKey(apiKey);
  });

  test("live model is discoverable", async () => {
    const apiKey = requireGeminiApiKeyForTests();
    const models = await fetchLiveModels(apiKey);
    expect(models.length).toBeGreaterThan(0);
    await validateLiveModel(apiKey, models[0]);
  });

  test("each discovered model passes live transcription probe", async () => {
    const apiKey = requireGeminiApiKeyForTests();
    const models = await fetchLiveModels(apiKey);
    expect(models.length).toBeGreaterThan(0);

    for (const model of models) {
      await probeLiveModelForTranscription(apiKey, model, 1800);
    }
  });

  test("can open and close a live session", async () => {
    const apiKey = requireGeminiApiKeyForTests();
    const models = await fetchLiveModels(apiKey);
    expect(models.length).toBeGreaterThan(0);
    const selectedModel = models[0];

    const ai = new GoogleGenAI({ apiKey });

    let opened = false;
    let closed = false;
    let closeReason = "";
    let closeCode = -1;
    let receivedMessages = 0;

    const session = await ai.live.connect({
      model: selectedModel,
      config: {
        responseModalities: [
          selectedModel.toLowerCase().includes("native-audio")
            ? Modality.AUDIO
            : Modality.TEXT,
        ],
        inputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          opened = true;
        },
        onmessage: (_message: LiveServerMessage) => {
          receivedMessages += 1;
        },
        onerror: (event: Event) => {
          const err = event as ErrorEvent;
          throw new Error(`Live socket error during integration test: ${err.message}`);
        },
        onclose: (event?: unknown) => {
          closed = true;
          if (event && typeof event === "object") {
            const code = (event as { code?: unknown }).code;
            const reason = (event as { reason?: unknown }).reason;
            if (typeof code === "number") {
              closeCode = code;
            }
            if (typeof reason === "string") {
              closeReason = reason;
            }
          }
        },
      },
    });

    expect(opened).toBe(true);

    session.sendRealtimeInput({
      media: {
        data: "AAAA",
        mimeType: "audio/pcm;rate=16000",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    session.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(closed).toBe(true);
    expect(closeCode).not.toBe(1008);
    expect(closeReason.includes("not found")).toBe(false);
    expect(receivedMessages).toBeGreaterThanOrEqual(0);
  });
});
