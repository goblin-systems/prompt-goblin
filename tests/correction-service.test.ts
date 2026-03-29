import { describe, expect, test } from "bun:test";
import {
  getCorrectionLabel,
  getCorrectionRuntime,
  getCorrectionSelectedModel,
  isTranscriptionCorrectionEnabled,
} from "../src/correction/service";
import { buildCorrectionPromptParts, buildCorrectionUserPrompt } from "../src/correction/prompt";
import { getDefaultSettings } from "../src/settings";

describe("correction service", () => {
  test("exposes gemini and openai providers", () => {
    expect(getCorrectionRuntime("gemini").label).toBe("Gemini");
    expect(getCorrectionRuntime("openai").label).toBe("OpenAI");
    expect(getCorrectionLabel("gemini")).toBe("Gemini");
  });

  test("returns codex provider when authMode is oauth_experimental", () => {
    expect(getCorrectionRuntime("openai", "oauth_experimental").label).toBe("Codex");
    expect(getCorrectionLabel("openai", "oauth_experimental")).toBe("Codex");
  });

  test("returns openai provider when authMode is api_key", () => {
    expect(getCorrectionRuntime("openai", "api_key").label).toBe("OpenAI");
    expect(getCorrectionLabel("openai", "api_key")).toBe("OpenAI");
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

  test("builds shared correction prompt parts for provider runtimes", () => {
    const prompt = buildCorrectionPromptParts("bonjour le monde", "auto", "English");

    expect(prompt.input).toBe("bonjour le monde");
    expect(prompt.instructions).toContain("Translate the corrected transcript into English.");
    expect(prompt.instructions).toContain(
      "Do not convert those command phrases into punctuation or symbols."
    );
  });

  test("builds a provider-agnostic user prompt from shared prompt parts", () => {
    const prompt = buildCorrectionUserPrompt("hello world", "en", "");

    expect(prompt).toContain("The source language is en.");
    expect(prompt).toEndWith("\n\nhello world");
  });
});
