import { describe, expect, test } from "bun:test";
import { openaiProvider } from "../src/stt/providers/openai";
import {
  countNormalizedOccurrences,
  EXPECTED_SAMPLE_TRANSCRIPT,
  loadSamplePcmChunksBase64,
  normalizeTranscript,
} from "./helpers/audio-sample";
import {
  getOpenAITestModel,
  requireOpenAIApiKeyForTests,
} from "./helpers/openai-test-config";

describe("OpenAI integration", () => {
  test("requires OPENAI_API_KEY", () => {
    const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
    expect(apiKey.length).toBeGreaterThan(0);
  });

  test(
    "live pipeline transcribes the sample phrase once without duplication",
    { timeout: 30000 },
    async () => {
      const transcript = await openaiProvider.transcribeWithLivePipeline({
        apiKey: requireOpenAIApiKeyForTests(),
        language: "en",
        preferredModel: getOpenAITestModel(),
        fallbackModels: ["gpt-4o-mini-transcribe", "whisper-1"],
        pcmChunksBase64: loadSamplePcmChunksBase64(),
        settleDelayMs: 1200,
        chunkIntervalMs: 0,
      });

      const normalizedTranscript = normalizeTranscript(transcript);
      const normalizedExpected = normalizeTranscript(EXPECTED_SAMPLE_TRANSCRIPT);
      expect(normalizedTranscript).toBe(normalizedExpected);
      expect(countNormalizedOccurrences(normalizedTranscript, normalizedExpected)).toBe(1);
    }
  );
});
