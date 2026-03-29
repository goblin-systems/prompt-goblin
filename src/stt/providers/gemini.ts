import {
  fetchLiveModels,
  GeminiTranscriber,
  probeLiveModelForTranscription,
  transcribeWavBase64,
  transcribeWithLivePipeline,
  validateApiKey,
  validateLiveModel,
} from "../../gemini";
import type { ProviderAuth } from "../../settings";
import type {
  LivePipelineOptions,
  LiveTranscriber,
  LiveTranscriberConfig,
  StatusCallback,
  SttProviderRuntime,
  TranscriptCallback,
} from "../types";

class GeminiProviderTranscriber implements LiveTranscriber {
  private readonly inner = new GeminiTranscriber();

  configure(config: LiveTranscriberConfig): void {
    const maybeLegacyApiKey = (config as unknown as { apiKey?: string }).apiKey;
    const auth = config.auth ?? (maybeLegacyApiKey ? { type: "api_key", token: maybeLegacyApiKey } : null);
    if (!auth || auth.type !== "api_key") {
      throw new Error("Gemini provider requires API key authentication");
    }
    this.inner.configure(
      auth.token,
      config.language ?? "auto",
      config.preferredModel,
      config.fallbackModels ?? []
    );
  }

  setCallbacks(onTranscript: TranscriptCallback, onStatus: StatusCallback): void {
    this.inner.setCallbacks(onTranscript, onStatus);
  }

  connect(options?: { preserveTranscript?: boolean }): Promise<void> {
    return this.inner.connect(options);
  }

  disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  isConnected(): boolean {
    return this.inner.isConnected();
  }

  sendAudio(base64PcmData: string): void {
    this.inner.sendAudio(base64PcmData);
  }

  signalAudioStreamBoundary(reason?: string): boolean {
    return this.inner.signalAudioStreamBoundary(reason);
  }

  reconnectForRecovery(): Promise<void> {
    return this.inner.reconnectForRecovery();
  }

  getTranscript(): string {
    return this.inner.getTranscript();
  }

  resetTranscript(): void {
    this.inner.resetTranscript();
  }

  getActiveModel(): string {
    return this.inner.getActiveLiveModel();
  }

  waitForPendingTurnSettle(timeoutMs?: number): Promise<void> {
    return this.inner.waitForPendingTurnSettle(timeoutMs);
  }
}

function requireGeminiApiKey(auth: ProviderAuth): string {
  if (auth.type !== "api_key") {
    throw new Error("Gemini provider requires API key authentication");
  }
  return auth.token;
}

export const geminiProvider: SttProviderRuntime = {
  id: "gemini",
  label: "Gemini",
  createLiveTranscriber() {
    return new GeminiProviderTranscriber();
  },
  fetchModels(auth: ProviderAuth) {
    return fetchLiveModels(requireGeminiApiKey(auth));
  },
  validateApiKey(auth: ProviderAuth) {
    return validateApiKey(requireGeminiApiKey(auth));
  },
  validateModel(auth: ProviderAuth, model: string) {
    return validateLiveModel(requireGeminiApiKey(auth), model);
  },
  probeModelForTranscription(auth: ProviderAuth, model: string, timeoutMs?: number) {
    return probeLiveModelForTranscription(requireGeminiApiKey(auth), model, timeoutMs);
  },
  transcribeWavBase64(auth: ProviderAuth, wavBase64: string, language?: string, model?: string) {
    return transcribeWavBase64(requireGeminiApiKey(auth), wavBase64, language, model);
  },
  transcribeWithLivePipeline(options: LivePipelineOptions) {
    const maybeLegacyApiKey = (options as unknown as { apiKey?: string }).apiKey;
    const auth = options.auth ?? (maybeLegacyApiKey ? { type: "api_key", token: maybeLegacyApiKey } : null);
    const apiKey = requireGeminiApiKey(auth as ProviderAuth);
    return transcribeWithLivePipeline({
      apiKey,
      language: options.language,
      preferredLiveModel: options.preferredModel,
      fallbackLiveModels: options.fallbackModels,
      pcmChunksBase64: options.pcmChunksBase64,
      settleDelayMs: options.settleDelayMs,
      chunkIntervalMs: options.chunkIntervalMs,
    });
  },
};
