import type { ProviderAuth, SttProvider } from "../settings";

export type TranscriptCallback = (text: string, isFinal: boolean) => void;

export type StatusCallback = (
  status: "connecting" | "connected" | "disconnected" | "error",
  message?: string
) => void;

export interface LiveTranscriberConfig {
  auth: ProviderAuth;
  language?: string;
  preferredModel?: string;
  fallbackModels?: string[];
}

export interface LivePipelineOptions {
  auth: ProviderAuth;
  language?: string;
  preferredModel?: string;
  fallbackModels?: string[];
  pcmChunksBase64: string[];
  settleDelayMs?: number;
  chunkIntervalMs?: number;
}

export interface LiveTranscriber {
  configure(config: LiveTranscriberConfig): void;
  setCallbacks(onTranscript: TranscriptCallback, onStatus: StatusCallback): void;
  connect(options?: { preserveTranscript?: boolean }): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  sendAudio(base64PcmData: string): void;
  signalAudioStreamBoundary(reason?: string): boolean;
  reconnectForRecovery(): Promise<void>;
  getTranscript(): string;
  resetTranscript(): void;
  getActiveModel(): string;
  waitForPendingTurnSettle(timeoutMs?: number): Promise<void>;
}

export interface SttProviderRuntime {
  readonly id: SttProvider;
  readonly label: string;
  createLiveTranscriber(): LiveTranscriber;
  fetchModels(auth: ProviderAuth): Promise<string[]>;
  validateApiKey(auth: ProviderAuth): Promise<void>;
  validateModel(auth: ProviderAuth, model: string): Promise<void>;
  probeModelForTranscription(auth: ProviderAuth, model: string, timeoutMs?: number): Promise<void>;
  transcribeWavBase64(
    auth: ProviderAuth,
    wavBase64: string,
    language?: string,
    model?: string
  ): Promise<string>;
  transcribeWithLivePipeline(options: LivePipelineOptions): Promise<string>;
}
