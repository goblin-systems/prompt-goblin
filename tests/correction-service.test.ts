import { describe, expect, test } from "bun:test";
import {
  getCorrectionLabel,
  getCorrectionRuntime,
  getCorrectionSelectedModel,
  isTranscriptionCorrectionEnabled,
} from "../src/correction/service";
import { getDefaultSettings } from "../src/settings";

describe("correction service", () => {
  test("exposes gemini and openai providers", () => {
    expect(getCorrectionRuntime("gemini").label).toBe("Gemini");
    expect(getCorrectionRuntime("openai").label).toBe("OpenAI");
    expect(getCorrectionLabel("gemini")).toBe("Gemini");
  });

  test("correction is disabled by default", () => {
    const settings = getDefaultSettings();
    expect(isTranscriptionCorrectionEnabled(settings)).toBe(false);
  });

  test("reads provider-specific correction model selection", () => {
    const settings = getDefaultSettings();
    settings.transcriptionCorrection.providers.gemini.selectedModel = "gemini-2.5-flash";
    settings.transcriptionCorrection.providers.openai.selectedModel = "gpt-4.1-mini";

    expect(getCorrectionSelectedModel(settings, "gemini")).toBe("gemini-2.5-flash");
    expect(getCorrectionSelectedModel(settings, "openai")).toBe("gpt-4.1-mini");
  });
});
