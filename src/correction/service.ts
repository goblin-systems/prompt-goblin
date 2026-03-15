import type { Settings, SttProvider } from "../settings";
import { geminiCorrectionProvider } from "./providers/gemini";
import { openAICorrectionProvider } from "./providers/openai";
import type { CorrectionRuntime } from "./types";

const PROVIDERS: Record<SttProvider, CorrectionRuntime> = {
  gemini: geminiCorrectionProvider,
  openai: openAICorrectionProvider,
};

export function getCorrectionRuntime(provider: SttProvider): CorrectionRuntime {
  return PROVIDERS[provider];
}

export function getCorrectionLabel(provider: SttProvider): string {
  return PROVIDERS[provider].label;
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
