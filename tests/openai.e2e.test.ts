import { describe, expect, test } from "bun:test";
import {
  computeSentenceCoverage,
  countNormalizedOccurrences,
  LONG_SAMPLE_BANNED_MARKERS,
  LONG_SAMPLE_EXPECTED_SENTENCES,
  EXPECTED_LONG_SAMPLE_TRANSCRIPT,
  EXPECTED_SAMPLE_TRANSCRIPT,
  LONG_SAMPLE_REQUIRED_PASSAGES,
  loadLongSamplePcmChunksBase64,
  loadSamplePcmChunksBase64,
  normalizeTranscript,
} from "./helpers/audio-sample";
import {
  getOpenAITestModel,
  requireOpenAIApiKeyForTests,
} from "./helpers/openai-test-config";
import { runLiveTranscriberE2E } from "./helpers/stt-e2e";

describe("OpenAI e2e", () => {
  async function expectOpenAISampleTranscript(
    pcmChunksBase64: string[],
    expectedTranscript: string,
    timeout = 30000,
    options: {
      exact?: boolean;
      typingMode?: "incremental" | "all_at_once";
    } = { exact: true, typingMode: "incremental" }
  ) {
    const normalizedExpected = normalizeTranscript(expectedTranscript);

    const result = await runLiveTranscriberE2E({
      provider: "openai",
      apiKey: requireOpenAIApiKeyForTests(),
      language: "en",
      typingMode: options.typingMode ?? "incremental",
      preferredModel: getOpenAITestModel(),
      fallbackModels: ["gpt-4o-mini-transcribe", "whisper-1"],
      pcmChunksBase64,
      chunkIntervalMs: 20,
      settleTimeoutMs: Math.min(timeout - 3000, 6000),
    });

    const normalizedFinal = normalizeTranscript(result.finalText);
    const normalizedTyped = normalizeTranscript(result.typedText);

    expect(result.turnBoundaryCount).toBeGreaterThan(0);

    if (options.exact ?? true) {
      expect(normalizedTyped).toBe(normalizedFinal);
      expect(normalizedFinal).toBe(normalizedExpected);
      expect(countNormalizedOccurrences(normalizedFinal, normalizedExpected)).toBe(1);
      expect(countNormalizedOccurrences(normalizedTyped, normalizedExpected)).toBe(1);
    } else {
      expect(normalizedFinal.split(" ").filter(Boolean).length).toBeGreaterThan(35);
      let matchedPassages = 0;
      for (const passage of LONG_SAMPLE_REQUIRED_PASSAGES) {
        const normalizedPassage = normalizeTranscript(passage);
        if (normalizedFinal.includes(normalizedPassage)) {
          matchedPassages += 1;
          expect(countNormalizedOccurrences(normalizedFinal, normalizedPassage)).toBe(1);
        }
      }
      expect(matchedPassages).toBeGreaterThanOrEqual(LONG_SAMPLE_REQUIRED_PASSAGES.length - 1);

      for (const sentence of LONG_SAMPLE_EXPECTED_SENTENCES) {
        expect(computeSentenceCoverage(normalizedFinal, sentence)).toBeGreaterThan(0.9);
      }

      if ((options.typingMode ?? "incremental") === "all_at_once") {
        expect(normalizedTyped).toBe(normalizedFinal);
        for (const marker of LONG_SAMPLE_BANNED_MARKERS) {
          expect(normalizedFinal.includes(normalizeTranscript(marker))).toBe(false);
        }
      }
    }

    for (const event of result.transcriptEvents) {
      const normalizedEvent = normalizeTranscript(event.text);
      const duplicateNeedle = (options.exact ?? true)
        ? normalizedExpected
        : normalizeTranscript(LONG_SAMPLE_REQUIRED_PASSAGES[0]);
      expect(countNormalizedOccurrences(normalizedEvent, duplicateNeedle)).toBeLessThanOrEqual(1);
    }
  }

  test(
    "sample audio stays stable through app-like live typing flow",
    { timeout: 30000 },
    async () => {
      await expectOpenAISampleTranscript(loadSamplePcmChunksBase64(), EXPECTED_SAMPLE_TRANSCRIPT);
    }
  );

  test(
    "sample audio stays stable through app-like all-at-once flow",
    { timeout: 30000 },
    async () => {
      await expectOpenAISampleTranscript(loadSamplePcmChunksBase64(), EXPECTED_SAMPLE_TRANSCRIPT, 30000, {
        exact: true,
        typingMode: "all_at_once",
      });
    }
  );

  test(
    "long sample audio stays stable through app-like live typing flow",
    { timeout: 60000 },
    async () => {
      await expectOpenAISampleTranscript(
        loadLongSamplePcmChunksBase64(),
        EXPECTED_LONG_SAMPLE_TRANSCRIPT,
        60000,
        { exact: false, typingMode: "incremental" }
      );
    }
  );

  test(
    "long sample audio stays stable through app-like all-at-once flow",
    { timeout: 60000 },
    async () => {
      await expectOpenAISampleTranscript(
        loadLongSamplePcmChunksBase64(),
        EXPECTED_LONG_SAMPLE_TRANSCRIPT,
        60000,
        { exact: false, typingMode: "all_at_once" }
      );
    }
  );
});
