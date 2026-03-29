import { debugLog, isDebugLoggingEnabled } from "../../logger";
import type { ProviderAuth } from "../../settings";
import type {
  LivePipelineOptions,
  LiveTranscriber,
  LiveTranscriberConfig,
  StatusCallback,
  SttProviderRuntime,
  TranscriptCallback,
} from "../types";
import {
  base64ToBytes,
  bytesToBase64,
  float32MonoToPcm16Bytes,
  pcm16BytesToFloat32Mono,
  pcm16ToWavBytes,
  resampleMono,
} from "../utils";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const OPENAI_REALTIME_TRANSCRIPTION_SESSIONS_URL = `${OPENAI_API_BASE}/realtime/transcription_sessions`;
const OPENAI_MODEL_FETCH_TIMEOUT_MS = 12000;
const OPENAI_TRANSCRIPTION_TIMEOUT_MS = 25000;
const OPENAI_CONNECT_TIMEOUT_MS = 12000;
const OPENAI_INPUT_SAMPLE_RATE = 16000;
const OPENAI_REALTIME_SAMPLE_RATE = 24000;
const OPENAI_COMMIT_SPEECH_RMS_THRESHOLD = 0.012;
const OPENAI_MODEL_PRIORITY = [
  "gpt-4o-transcribe",
  "gpt-4o-transcribe-latest",
  "gpt-4o-mini-transcribe",
  "whisper-1",
  "gpt-4o-transcribe-diarize",
] as const;

type OpenAIRealtimeServerEvent = {
  type?: string;
  item_id?: string;
  previous_item_id?: string | null;
  delta?: string;
  transcript?: string;
  session?: {
    audio?: {
      input?: {
        transcription?: {
          model?: string;
        };
      };
    };
    input_audio_transcription?: {
      model?: string;
    };
  };
  error?: {
    message?: string;
  };
};

function normalizeModelName(model: string): string {
  return model.trim();
}

function resolveOpenAIAuthToken(auth: ProviderAuth): string {
  if (auth.type === "api_key") {
    return auth.token;
  }

  if (auth.expiresAt <= Date.now()) {
    throw new Error("OpenAI Codex OAuth session expired. Reconnect from settings (experimental). ");
  }

  return auth.accessToken;
}

function toAuthHeaders(auth: ProviderAuth): HeadersInit {
  if (auth.type === "oauth") {
    return {
      Authorization: `Bearer ${resolveOpenAIAuthToken(auth)}`,
      "ChatGPT-Account-Id": auth.accountId,
    };
  }

  return {
    Authorization: `Bearer ${resolveOpenAIAuthToken(auth)}`,
  };
}

function extractApiErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Unknown API error";
  }

  const maybeError = (payload as { error?: { message?: string } }).error;
  if (maybeError?.message) {
    return maybeError.message;
  }

  return "Unknown API error";
}

function getLanguageHint(language: string): string | undefined {
  if (!language || language === "auto") {
    return undefined;
  }
  return language;
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.message.includes("timed out"));
}

function getOpenAITimeoutMessage(operation: string, timeoutMs: number): string {
  return `${operation} timed out after ${Math.round(timeoutMs / 1000)}s`;
}

function isSupportedOpenAITranscriptionModel(model: string): boolean {
  const normalized = normalizeModelName(model).toLowerCase();
  if (!normalized) {
    return false;
  }

  return OPENAI_MODEL_PRIORITY.some(
    (candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`)
  );
}

function compareOpenAIModelPriority(left: string, right: string): number {
  const score = (model: string) => {
    const normalized = model.toLowerCase();
    const index = OPENAI_MODEL_PRIORITY.findIndex(
      (candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`)
    );
    return index === -1 ? OPENAI_MODEL_PRIORITY.length : index;
  };

  return score(left) - score(right) || left.localeCompare(right);
}

function buildModelCandidates(preferredModel: string, fallbackModels: string[]): string[] {
  const unique = new Set<string>();
  const ordered = [preferredModel, ...fallbackModels]
    .map((entry) => normalizeModelName(entry))
    .filter(Boolean);

  for (const model of ordered) {
    unique.add(model);
  }

  return Array.from(unique);
}

async function postTranscription(
  auth: ProviderAuth,
  wavBytes: Uint8Array,
  model: string,
  language: string
) {
  const normalizedModel = normalizeModelName(model);
  if (!normalizedModel) {
    throw new Error("No model selected");
  }

  const form = new FormData();
  form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "audio.wav");
  form.append("model", normalizedModel);

  const languageHint = getLanguageHint(language);
  if (languageHint) {
    form.append("language", languageHint);
  }

  const timeout = withTimeout(OPENAI_TRANSCRIPTION_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: toAuthHeaders(auth),
      body: form,
      signal: timeout.signal,
    });
  } catch (err) {
    timeout.cancel();
    if (isAbortError(err)) {
      throw new Error(getOpenAITimeoutMessage("OpenAI transcription request", OPENAI_TRANSCRIPTION_TIMEOUT_MS));
    }
    throw err;
  }
  timeout.cancel();

  const payload = (await response.json().catch(() => null)) as
    | { text?: string; error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(
      `OpenAI transcription failed: ${extractApiErrorMessage(payload)} (HTTP ${response.status})`
    );
  }

  return typeof payload?.text === "string" ? payload.text : "";
}

function createSilentWavBase64(durationMs = 180, sampleRate = 16000): string {
  const sampleCount = Math.max(1, Math.floor((durationMs / 1000) * sampleRate));
  const pcm = new Uint8Array(sampleCount * 2);
  const wav = pcm16ToWavBytes(pcm, sampleRate);
  return bytesToBase64(wav);
}

function joinTranscriptSegments(left: string, right: string): string {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (!normalizedRight) {
    return normalizedLeft;
  }
  if (!normalizedLeft) {
    return normalizedRight;
  }
  return `${normalizedLeft} ${normalizedRight}`;
}

function normalizeTranscriptForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return normalizeTranscriptForComparison(text)
    .split(" ")
    .filter(Boolean).length;
}

function shouldDiscardTranscriptAsDuplicate(existingTranscript: string, candidateTranscript: string): boolean {
  const existingNormalized = normalizeTranscriptForComparison(existingTranscript);
  const candidateNormalized = normalizeTranscriptForComparison(candidateTranscript);

  if (!candidateNormalized) {
    return true;
  }

  if (!existingNormalized) {
    return false;
  }

  if (existingNormalized === candidateNormalized) {
    return true;
  }

  if (existingNormalized.endsWith(candidateNormalized)) {
    return true;
  }

  if (candidateNormalized.startsWith(existingNormalized)) {
    const candidateWordCount = countWords(candidateTranscript);
    const existingWordCount = countWords(existingTranscript);
    if (candidateWordCount <= existingWordCount + 1) {
      return true;
    }
  }

  return false;
}

function convertPcm16kChunkToRealtime24k(base64PcmData: string): string {
  const inputBytes = base64ToBytes(base64PcmData);
  if (inputBytes.length === 0) {
    return "";
  }

  const floatSamples = pcm16BytesToFloat32Mono(inputBytes);
  const resampled = resampleMono(floatSamples, OPENAI_INPUT_SAMPLE_RATE, OPENAI_REALTIME_SAMPLE_RATE);
  const outputBytes = float32MonoToPcm16Bytes(resampled);
  return bytesToBase64(outputBytes);
}

function estimatePcm16ChunkRms(base64PcmData: string): number {
  const inputBytes = base64ToBytes(base64PcmData);
  if (inputBytes.length < 2) {
    return 0;
  }

  let sumSquares = 0;
  let sampleCount = 0;
  for (let index = 0; index + 1 < inputBytes.length; index += 2) {
    const low = inputBytes[index] ?? 0;
    const high = inputBytes[index + 1] ?? 0;
    const value = (high << 8) | low;
    const signed = value >= 0x8000 ? value - 0x10000 : value;
    const normalized = signed < 0 ? signed / 32768 : signed / 32767;
    sumSquares += normalized * normalized;
    sampleCount += 1;
  }

  if (sampleCount === 0) {
    return 0;
  }

  return Math.sqrt(sumSquares / sampleCount);
}

function createRealtimeSocket(apiKey: string): WebSocket {
  return new WebSocket(OPENAI_REALTIME_URL, [
    "realtime",
    `openai-insecure-api-key.${apiKey}`,
    "openai-beta.realtime-v1",
  ]);
}

function buildRealtimeTranscriptionSessionRequest(model: string, language: string) {
  return {
    include: ["item.input_audio_transcription.logprobs"],
    input_audio_format: "pcm16",
    input_audio_transcription: {
      model,
      ...(getLanguageHint(language) ? { language: getLanguageHint(language) } : {}),
    },
    turn_detection: null,
    input_audio_noise_reduction: {
      type: "near_field",
    },
  };
}

async function createRealtimeTranscriptionSession(
  auth: ProviderAuth,
  model: string,
  language: string
): Promise<string> {
  const response = await fetch(OPENAI_REALTIME_TRANSCRIPTION_SESSIONS_URL, {
    method: "POST",
    headers: {
      ...toAuthHeaders(auth),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRealtimeTranscriptionSessionRequest(model, language)),
  });

  const payload = (await response.json().catch(() => null)) as
    | { client_secret?: { value?: string }; error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(
      `OpenAI realtime session create failed: ${extractApiErrorMessage(payload)} (HTTP ${response.status})`
    );
  }

  const clientSecret = payload?.client_secret?.value?.trim();
  if (!clientSecret) {
    throw new Error("OpenAI realtime session create failed: missing client secret");
  }

  return clientSecret;
}

class OpenAILiveTranscriber implements LiveTranscriber {
  private auth: ProviderAuth | null = null;
  private language = "auto";
  private preferredModel = "";
  private fallbackModels: string[] = [];
  private activeModel = "";
  private onTranscript: TranscriptCallback | null = null;
  private onStatus: StatusCallback | null = null;
  private socket: WebSocket | null = null;
  private connected = false;
  private closeExpected = false;
  private pendingAudioChunks: string[] = [];
  private hasBufferedAudio = false;
  private bufferedPeakRms = 0;
  private transcriptPrefix = "";
  private committedItemOrder: string[] = [];
  private committedItemTexts = new Map<string, string>();
  private itemOrder: string[] = [];
  private itemTexts = new Map<string, string>();
  private pendingItemTexts = new Map<string, string>();
  private pendingCommittedItems = new Set<string>();
  private pendingCommitRequests = 0;
  private settleResolvers: Array<() => void> = [];
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((reason?: unknown) => void) | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  configure(config: LiveTranscriberConfig): void {
    const maybeLegacyApiKey = (config as unknown as { apiKey?: string }).apiKey;
    this.auth = config.auth ?? (maybeLegacyApiKey ? { type: "api_key", token: maybeLegacyApiKey } : null);
    this.language = config.language ?? "auto";
    this.preferredModel = normalizeModelName(config.preferredModel ?? "");
    this.fallbackModels = buildModelCandidates("", config.fallbackModels ?? []);
    this.activeModel = buildModelCandidates(this.preferredModel, this.fallbackModels)[0] ?? "";
    debugLog(
      `OpenAI configured (language='${this.language}', preferredModel='${this.preferredModel}', fallbackModels=${this.fallbackModels.length}, activeModel='${this.activeModel}', authPresent=${Boolean(this.auth)})`,
      "INFO"
    );
  }

  setCallbacks(onTranscript: TranscriptCallback, onStatus: StatusCallback): void {
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
  }

  async connect(options: { preserveTranscript?: boolean } = {}): Promise<void> {
    if (!this.auth) {
      this.onStatus?.("error", "Provider auth not configured");
      return;
    }

    if (!this.activeModel) {
      this.onStatus?.("error", "No model selected. Pick a model from the model dropdown first.");
      return;
    }

    if (options.preserveTranscript) {
      this.transcriptPrefix = this.getTranscript();
    } else {
      this.transcriptPrefix = "";
    }
    this.clearTranscriptState();

    this.onStatus?.("connecting");
    await this.connectWithFallbackModels();
    this.flushPendingAudioChunks();
  }

  async disconnect(): Promise<void> {
    await this.waitForPendingTurnSettle(2500);

    const socket = this.socket;
    this.socket = null;
    this.closeExpected = true;
    this.connected = false;

    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    } else if (socket && socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }

    this.resolveConnectIfPending();
    this.onStatus?.("disconnected");
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendAudio(base64PcmData: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.connected) {
      this.pendingAudioChunks.push(base64PcmData);
      return;
    }

    const converted = convertPcm16kChunkToRealtime24k(base64PcmData);
    if (!converted) {
      return;
    }

    this.bufferedPeakRms = Math.max(this.bufferedPeakRms, estimatePcm16ChunkRms(base64PcmData));
    this.socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: converted }));
    this.hasBufferedAudio = true;
  }

  signalAudioStreamBoundary(_reason = "periodic"): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.connected) {
      return false;
    }
    if (!this.hasBufferedAudio) {
      return false;
    }

    if (
      this.bufferedPeakRms < OPENAI_COMMIT_SPEECH_RMS_THRESHOLD &&
      this.committedItemOrder.length > 0
    ) {
      const skippedPeakRms = this.bufferedPeakRms;
      this.hasBufferedAudio = false;
      this.bufferedPeakRms = 0;
      if (isDebugLoggingEnabled()) {
        debugLog(
          `Skipping OpenAI commit for low-energy buffer (peakRms=${skippedPeakRms.toFixed(4)})`,
          "INFO"
        );
      }
      return false;
    }

    this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    this.hasBufferedAudio = false;
    this.bufferedPeakRms = 0;
    this.pendingCommitRequests += 1;
    return true;
  }

  async reconnectForRecovery(): Promise<void> {
    this.transcriptPrefix = this.getTranscript();
    await this.disconnect();
    await this.connect({ preserveTranscript: true });
  }

  getTranscript(): string {
    let transcript = this.transcriptPrefix;
    for (const itemId of this.committedItemOrder) {
      transcript = joinTranscriptSegments(transcript, this.committedItemTexts.get(itemId) ?? "");
    }
    return transcript;
  }

  resetTranscript(): void {
    this.transcriptPrefix = "";
    this.clearTranscriptState();
  }

  getActiveModel(): string {
    return this.activeModel;
  }

  async waitForPendingTurnSettle(timeoutMs = 1500): Promise<void> {
    this.signalAudioStreamBoundary("settle");

    if (!this.hasPendingTurnWork()) {
      return;
    }

    await Promise.race([
      new Promise<void>((resolve) => {
        const finish = () => resolve();
        this.settleResolvers.push(finish);
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  private clearTranscriptState() {
    this.committedItemOrder = [];
    this.committedItemTexts.clear();
    this.itemOrder = [];
    this.itemTexts.clear();
    this.pendingItemTexts.clear();
    this.pendingCommittedItems.clear();
    this.pendingCommitRequests = 0;
    this.hasBufferedAudio = false;
    this.bufferedPeakRms = 0;
    this.resolvePendingTurnSettles();
  }

  private hasPendingTurnWork(): boolean {
    return this.hasBufferedAudio || this.pendingCommitRequests > 0 || this.pendingCommittedItems.size > 0;
  }

  private resolvePendingTurnSettles() {
    if (this.hasPendingTurnWork()) {
      return;
    }

    const resolvers = this.settleResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve();
    }
  }

  private async connectWithFallbackModels(): Promise<void> {
    const candidates = buildModelCandidates(this.preferredModel, this.fallbackModels);
    let lastError: unknown = null;

    for (const candidate of candidates) {
      try {
        await this.openRealtimeSession(candidate);
        this.activeModel = candidate;
        return;
      } catch (err) {
        lastError = err;
        debugLog(`OpenAI realtime connect failed for model '${candidate}': ${String(err)}`, "WARN");
      }
    }

    throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? "OpenAI realtime connection failed")));
  }

  private async openRealtimeSession(model: string): Promise<void> {
    this.closeExpected = false;
    this.connected = false;

    const auth = this.auth;
    if (!auth) {
      throw new Error("Provider auth not configured");
    }

    const clientSecret = await createRealtimeTranscriptionSession(auth, model, this.language);

    const socket = createRealtimeSocket(clientSecret);
    this.socket = socket;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    this.connectTimer = setTimeout(() => {
      this.rejectConnect(new Error(getOpenAITimeoutMessage("OpenAI realtime session", OPENAI_CONNECT_TIMEOUT_MS)));
      if (this.socket === socket) {
        this.socket = null;
      }
      try {
        socket.close();
      } catch {
        // ignore
      }
    }, OPENAI_CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (isDebugLoggingEnabled()) {
        debugLog(`OpenAI realtime socket opened for model '${model}'`, "INFO");
      }
    });

    socket.addEventListener("message", (event) => {
      this.handleSocketMessage(event, model);
    });

    socket.addEventListener("error", (event) => {
      debugLog(`OpenAI realtime socket error event: ${JSON.stringify(event)}`, "ERROR");
      if (!this.closeExpected) {
        this.rejectConnect(new Error("OpenAI realtime socket error"));
      }
    });

    socket.addEventListener("close", (event) => {
      const expected = this.closeExpected;
      debugLog(
        `OpenAI realtime socket closed (expected=${expected}, code=${event.code}, reason='${event.reason || ""}', clean=${event.wasClean})`,
        expected ? "INFO" : "WARN"
      );
      if (this.socket === socket) {
        this.socket = null;
      }
      this.connected = false;
      this.resolvePendingTurnSettles();

      if (!expected) {
        this.rejectConnect(new Error("OpenAI realtime socket closed unexpectedly"));
        this.onStatus?.("disconnected");
      }
    });

    await this.connectPromise;
  }

  private handleSocketMessage(event: MessageEvent, requestedModel: string) {
    let payload: OpenAIRealtimeServerEvent;
    try {
      payload = JSON.parse(String(event.data)) as OpenAIRealtimeServerEvent;
    } catch {
      return;
    }

    if (isDebugLoggingEnabled()) {
      debugLog(`OpenAI realtime event: ${payload.type ?? "unknown"}`, "INFO");
    }

    switch (payload.type) {
      case "session.created":
      case "session.updated": {
        const confirmedModel = payload.session?.audio?.input?.transcription?.model;
        if (typeof confirmedModel === "string" && confirmedModel.trim()) {
          this.activeModel = confirmedModel;
        } else {
          this.activeModel = requestedModel;
        }

        if (!this.connected) {
          this.connected = true;
          this.resolveConnectIfPending();
          this.onStatus?.("connected");
        }
        break;
      }

      case "transcription_session.created":
      case "transcription_session.updated": {
        const confirmedModel = payload.session?.input_audio_transcription?.model;
        if (typeof confirmedModel === "string" && confirmedModel.trim()) {
          this.activeModel = confirmedModel;
        } else {
          this.activeModel = requestedModel;
        }

        if (!this.connected) {
          this.connected = true;
          this.resolveConnectIfPending();
          this.onStatus?.("connected");
        }
        break;
      }

      case "input_audio_buffer.committed": {
        if (payload.item_id) {
          this.pendingCommitRequests = Math.max(0, this.pendingCommitRequests - 1);
          this.insertItemIntoOrder(payload.item_id, payload.previous_item_id ?? null);
          this.pendingCommittedItems.add(payload.item_id);
          this.resolvePendingTurnSettles();
        }
        break;
      }

      case "conversation.item.input_audio_transcription.delta": {
        if (!payload.item_id || typeof payload.delta !== "string" || payload.delta.length === 0) {
          break;
        }

        this.insertItemIntoOrder(payload.item_id, null);
        const current = this.pendingItemTexts.get(payload.item_id) ?? "";
        this.pendingItemTexts.set(payload.item_id, current + payload.delta);
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        if (!payload.item_id) {
          break;
        }

        this.insertItemIntoOrder(payload.item_id, null);
        const transcript = typeof payload.transcript === "string"
          ? payload.transcript.trim()
          : (this.pendingItemTexts.get(payload.item_id) ?? "").trim();

        this.pendingItemTexts.delete(payload.item_id);
        if (transcript) {
          const currentTranscript = this.getTranscript();
          if (shouldDiscardTranscriptAsDuplicate(currentTranscript, transcript)) {
            this.itemTexts.delete(payload.item_id);
          } else {
            this.committedItemTexts.set(payload.item_id, transcript);
            if (!this.committedItemOrder.includes(payload.item_id)) {
              this.insertCommittedItemIntoOrder(payload.item_id, payload.previous_item_id ?? null);
            }
            this.itemTexts.delete(payload.item_id);
          }
        }
        this.pendingCommittedItems.delete(payload.item_id);
        this.onTranscript?.(this.getTranscript(), true);
        this.resolvePendingTurnSettles();
        break;
      }

      case "conversation.item.input_audio_transcription.failed": {
        if (payload.item_id) {
          this.pendingItemTexts.delete(payload.item_id);
          this.pendingCommittedItems.delete(payload.item_id);
        }
        this.pendingCommitRequests = Math.max(0, this.pendingCommitRequests - 1);
        this.resolvePendingTurnSettles();
        break;
      }

      case "error": {
        const message = payload.error?.message ?? "OpenAI realtime session error";
        this.onStatus?.("error", message);
        this.rejectConnect(new Error(message));
        break;
      }

      default:
        break;
    }
  }

  private insertItemIntoOrder(itemId: string, previousItemId: string | null) {
    if (this.itemOrder.includes(itemId)) {
      return;
    }

    if (!previousItemId) {
      this.itemOrder.push(itemId);
      return;
    }

    const previousIndex = this.itemOrder.indexOf(previousItemId);
    if (previousIndex === -1) {
      this.itemOrder.push(itemId);
      return;
    }

    this.itemOrder.splice(previousIndex + 1, 0, itemId);
  }

  private insertCommittedItemIntoOrder(itemId: string, previousItemId: string | null) {
    if (this.committedItemOrder.includes(itemId)) {
      return;
    }

    if (previousItemId) {
      const previousIndex = this.committedItemOrder.indexOf(previousItemId);
      if (previousIndex !== -1) {
        this.committedItemOrder.splice(previousIndex + 1, 0, itemId);
        return;
      }
    }

    const orderIndex = this.itemOrder.indexOf(itemId);
    if (orderIndex !== -1) {
      for (let i = orderIndex - 1; i >= 0; i -= 1) {
        const candidate = this.itemOrder[i];
        const committedIndex = this.committedItemOrder.indexOf(candidate);
        if (committedIndex !== -1) {
          this.committedItemOrder.splice(committedIndex + 1, 0, itemId);
          return;
        }
      }

      for (let i = orderIndex + 1; i < this.itemOrder.length; i += 1) {
        const candidate = this.itemOrder[i];
        const committedIndex = this.committedItemOrder.indexOf(candidate);
        if (committedIndex !== -1) {
          this.committedItemOrder.splice(committedIndex, 0, itemId);
          return;
        }
      }
    }

    this.committedItemOrder.push(itemId);
  }

  private flushPendingAudioChunks() {
    if (this.pendingAudioChunks.length === 0) {
      return;
    }

    const chunks = this.pendingAudioChunks;
    this.pendingAudioChunks = [];
    for (const chunk of chunks) {
      this.sendAudio(chunk);
    }
  }

  private resolveConnectIfPending() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.connectResolve?.();
    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
  }

  private rejectConnect(reason: unknown) {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.connectReject?.(reason);
    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
  }
}

async function fetchOpenAIModels(auth: ProviderAuth): Promise<string[]> {
  if (auth.type === "oauth") {
    return OPENAI_MODEL_PRIORITY.filter((model) => model !== "whisper-1");
  }

  const timeout = withTimeout(OPENAI_MODEL_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${OPENAI_API_BASE}/models`, {
      method: "GET",
      headers: toAuthHeaders(auth),
      signal: timeout.signal,
    });
  } catch (err) {
    timeout.cancel();
    if (isAbortError(err)) {
      throw new Error(getOpenAITimeoutMessage("OpenAI model fetch", OPENAI_MODEL_FETCH_TIMEOUT_MS));
    }
    throw err;
  }
  timeout.cancel();

  const payload = (await response.json().catch(() => null)) as
    | { data?: Array<{ id?: string }>; error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(`Failed to list OpenAI models: ${extractApiErrorMessage(payload)} (HTTP ${response.status})`);
  }

  const discovered = new Set<string>();
  for (const model of payload?.data ?? []) {
    const id = typeof model.id === "string" ? model.id : "";
    if (isSupportedOpenAITranscriptionModel(id)) {
      discovered.add(id);
    }
  }

  return Array.from(discovered).sort(compareOpenAIModelPriority);
}

async function validateOpenAIModel(auth: ProviderAuth, model: string): Promise<void> {
  const models = await fetchOpenAIModels(auth);
  const normalized = normalizeModelName(model);
  if (!normalized) {
    throw new Error("No transcription model selected");
  }

  if (!models.includes(normalized)) {
    throw new Error(`Model '${normalized}' is not available for this API key`);
  }
}

async function probeOpenAIModel(auth: ProviderAuth, model: string): Promise<void> {
  const silenceWav = createSilentWavBase64();
  await postTranscription(auth, base64ToBytes(silenceWav), model, "auto");
}

async function transcribeOpenAIWavBase64(
  auth: ProviderAuth,
  wavBase64: string,
  language = "auto",
  model = ""
): Promise<string> {
  if (!wavBase64.trim()) {
    return "";
  }

  const wavBytes = base64ToBytes(wavBase64);
  const candidates = buildModelCandidates(model, []);
  if (candidates.length === 0) {
    throw new Error("No model selected");
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return (await postTranscription(auth, wavBytes, candidate, language)).trim();
    } catch (err) {
      lastError = err;
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? "OpenAI transcription failed")));
}

async function transcribeOpenAIWithLivePipeline(options: LivePipelineOptions): Promise<string> {
  const transcriber = new OpenAILiveTranscriber();
  let latest = "";
  let statusMessage = "";

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const maybeLegacyApiKey = (options as unknown as { apiKey?: string }).apiKey;
  const auth = options.auth ?? (maybeLegacyApiKey ? { type: "api_key", token: maybeLegacyApiKey } : null);

  transcriber.configure({
    auth: auth as ProviderAuth,
    language: options.language,
    preferredModel: options.preferredModel,
    fallbackModels: options.fallbackModels,
  });

  transcriber.setCallbacks(
    (text) => {
      latest = text;
    },
    (status, message) => {
      if (status === "error") {
        statusMessage = message ?? "Live transcription failed";
      }
    }
  );

  try {
    await transcriber.connect();

    for (const chunk of options.pcmChunksBase64) {
      transcriber.sendAudio(chunk);
      await sleep(options.chunkIntervalMs ?? 20);
    }

    await sleep(options.settleDelayMs ?? 1200);
    transcriber.signalAudioStreamBoundary("pipeline-settle");
    await transcriber.waitForPendingTurnSettle(Math.max(2000, options.settleDelayMs ?? 2200));

    if (statusMessage) {
      throw new Error(statusMessage);
    }

    return (latest || transcriber.getTranscript()).trim();
  } finally {
    await transcriber.disconnect();
  }
}

export const openaiProvider: SttProviderRuntime = {
  id: "openai",
  label: "OpenAI",
  createLiveTranscriber() {
    return new OpenAILiveTranscriber();
  },
  fetchModels(auth: ProviderAuth) {
    return fetchOpenAIModels(auth);
  },
  validateApiKey(auth: ProviderAuth) {
    return fetchOpenAIModels(auth).then(() => undefined);
  },
  validateModel(auth: ProviderAuth, model: string) {
    return validateOpenAIModel(auth, model);
  },
  probeModelForTranscription(auth: ProviderAuth, model: string) {
    return probeOpenAIModel(auth, model);
  },
  transcribeWavBase64(auth: ProviderAuth, wavBase64: string, language?: string, model?: string) {
    return transcribeOpenAIWavBase64(auth, wavBase64, language ?? "auto", model ?? "");
  },
  transcribeWithLivePipeline(options: LivePipelineOptions) {
    return transcribeOpenAIWithLivePipeline(options);
  },
};
