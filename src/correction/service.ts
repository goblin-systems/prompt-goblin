import type { OpenAIAuthMode, Settings, SttProvider } from "../settings";
import { codexCorrectionProvider } from "./providers/codex";
import { geminiCorrectionProvider } from "./providers/gemini";
import { openAICorrectionProvider } from "./providers/openai";
import type { CorrectionRuntime } from "./types";

const PROVIDERS: Record<SttProvider, CorrectionRuntime> = {
  gemini: geminiCorrectionProvider,
  openai: openAICorrectionProvider,
};

export function getCorrectionRuntime(
  provider: SttProvider,
  authMode?: OpenAIAuthMode
): CorrectionRuntime {
  if (provider === "openai" && authMode === "oauth_experimental") {
    return codexCorrectionProvider;
  }
  return PROVIDERS[provider];
}

export function getCorrectionLabel(
  provider: SttProvider,
  authMode?: OpenAIAuthMode
): string {
  return getCorrectionRuntime(provider, authMode).label;
}

export function isTranscriptionCorrectionEnabled(settings: Settings): boolean {
  return settings.transcriptionCorrection.enabled;
}

export function getCorrectionSelectedModel(
  settings: Settings,
  provider = settings.sttProvider
): string {
  return settings.transcriptionCorrection.providers[provider].selectedModel;
}

export function getCorrectionFallbackModels(
  settings: Settings,
  provider = settings.sttProvider
): string[] {
  return settings.transcriptionCorrection.providers[provider].modelCache?.models ?? [];
}
