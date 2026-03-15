import { GoogleGenAI, Modality, Session, LiveServerMessage } from "@google/genai";
import { debugLog, isDebugLoggingEnabled } from "./logger";

export type TranscriptCallback = (text: string, isFinal: boolean) => void;

export type StatusCallback = (
  status: "connecting" | "connected" | "disconnected" | "error",
  message?: string
) => void;

type ModelListResponse = {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
};

function normalizeModelName(model: string): string {
  return model.replace(/^models\//, "").trim();
}

function isNativeAudioModelName(model: string): boolean {
  return normalizeModelName(model).toLowerCase().includes("native-audio");
}

function getResponseModalityForModel(model: string): Modality {
  return isNativeAudioModelName(model) ? Modality.AUDIO : Modality.TEXT;
}

function toModelResource(model: string): string {
  const normalized = normalizeModelName(model);
  return `models/${normalized}`;
}

function assertModelSelected(model: string, context: string): string {
  const normalized = normalizeModelName(model);
  if (!normalized) {
    throw new Error(`No model selected for ${context}`);
  }
  return normalized;
}

function extractApiErrorMessage(body: string): string {
  if (!body) {
    return "No error details returned";
  }

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string; code?: number };
    };
    if (parsed.error?.message) {
      const status = parsed.error.status ? ` (${parsed.error.status})` : "";
      return `${parsed.error.message}${status}`;
    }
    return body;
  } catch {
    return body;
  }
}

/**
 * Joins committed transcript segments with proper spacing.
 * Handles the simple case of concatenating finalized turn texts.
 */
function joinTranscriptSegments(committed: string, pending: string): string {
  const left = committed.trimEnd();
  const right = pending.trim();
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return `${left} ${right}`;
}

function formatChunkTextForLog(text: string): string {
  return JSON.stringify(text);
}

export async function fetchLiveModels(apiKey: string): Promise<string[]> {
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  const startedAt = Date.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Failed to list Gemini models: ${extractApiErrorMessage(body)} (HTTP ${response.status})`
    );
  }

  const parsed = JSON.parse(body) as ModelListResponse;
  const discovered = new Set<string>();

  for (const model of parsed.models ?? []) {
    if (!model.name) {
      continue;
    }

    const normalized = normalizeModelName(model.name);
    if (!normalized) {
      continue;
    }

    const methods = (model.supportedGenerationMethods ?? []).map((m) =>
      m.toLowerCase()
    );
    const supportsBidi = methods.includes("bidigeneratecontent");
    const looksLive = normalized.toLowerCase().includes("live");

    if (supportsBidi || looksLive) {
      discovered.add(normalized);
    }
  }

  const models = Array.from(discovered).sort((a, b) => a.localeCompare(b));
  const nativeCount = models.filter((m) => isNativeAudioModelName(m)).length;
  debugLog(
    `Fetched live model list from API in ${Date.now() - startedAt}ms (count=${models.length}, nativeAudio=${nativeCount})`,
    "INFO"
  );
  return models;
}

export async function validateLiveModel(apiKey: string, model: string): Promise<void> {
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  const normalized = normalizeModelName(model);
  if (!normalized) {
    throw new Error("No live model selected");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${toModelResource(normalized)}?key=${encodeURIComponent(apiKey)}`
  );
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Selected model '${normalized}' is not usable: ${extractApiErrorMessage(body)} (HTTP ${response.status})`
    );
  }

  const parsed = JSON.parse(body) as {
    supportedGenerationMethods?: string[];
  };
  const methods = (parsed.supportedGenerationMethods ?? []).map((m) =>
    m.toLowerCase()
  );

  if (methods.length > 0 && !methods.includes("bidigeneratecontent")) {
    throw new Error(
      `Selected model '${normalized}' does not support bidiGenerateContent`
    );
  }
}

export async function probeLiveModelForTranscription(
  apiKey: string,
  model: string,
  timeoutMs = 1500
): Promise<void> {
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  const normalized = normalizeModelName(model);
  if (!normalized) {
    throw new Error("No live model selected");
  }

  const ai = new GoogleGenAI({ apiKey });
  const responseModality = getResponseModalityForModel(normalized);

  // Track the connect promise so we can always clean up the session,
  // even if it resolves after the probe timeout fires.
  let sessionPromise: Promise<Session> | null = null;
  let probeError: Error | null = null;

  debugLog(
    `Starting live probe for model '${normalized}' (responseModality='${responseModality}')`,
    "INFO"
  );

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    const finishReject = (message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(message));
    };

    const timeout = setTimeout(() => {
      finishResolve();
    }, timeoutMs);

    sessionPromise = ai.live.connect({
      model: normalized,
      config: {
        responseModalities: [responseModality],
        inputAudioTranscription: {},
      },
      callbacks: {
        onmessage: () => {
          // no-op; required for some SDK audio callback paths
        },
        onopen: () => {
          setTimeout(() => {
            // Session is available synchronously after connect resolves,
            // but onopen fires via the WebSocket so session may not be
            // assigned yet. We use sessionPromise in cleanup instead.
          }, 0);

          setTimeout(() => {
            finishResolve();
          }, 300);
        },
        onerror: (event: Event) => {
          const err = event as ErrorEvent;
          clearTimeout(timeout);
          finishReject(
            `Live probe error for model '${normalized}': ${
              err.message || "Connection error"
            }`
          );
        },
        onclose: (event?: unknown) => {
          const code =
            event && typeof event === "object" && typeof (event as { code?: unknown }).code === "number"
              ? ((event as { code: number }).code as number)
              : null;
          const reason =
            event && typeof event === "object" && typeof (event as { reason?: unknown }).reason === "string"
              ? ((event as { reason: string }).reason as string)
              : "";

          if (code === 1007 || code === 1008) {
            clearTimeout(timeout);
            finishReject(
              `Live probe rejected model '${normalized}' with code=${code}${
                reason ? ` reason=${reason}` : ""
              }`
            );
            return;
          }

          finishResolve();
        },
      },
    });

    sessionPromise.catch((err) => {
      clearTimeout(timeout);
      finishReject(
        `Live probe failed to connect for model '${normalized}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });
  }).catch((err) => {
    probeError = err instanceof Error ? err : new Error(String(err));
  });

  // Always await the session promise to ensure cleanup,
  // even if the probe timed out or errored before it resolved.
  if (sessionPromise) {
    try {
      const session = await sessionPromise;
      try {
        (session as unknown as { close: () => void }).close();
      } catch {
        // ignore close errors in probe cleanup
      }
    } catch {
      // connect itself failed — nothing to close
    }
  }

  if (probeError) {
    throw probeError;
  }

  debugLog(`Live probe passed for model '${normalized}'`, "INFO");
}

export class GeminiTranscriber {
  private ai: GoogleGenAI | null = null;
  private session: Session | null = null;
  private apiKey = "";
  private language = "auto";
  private preferredLiveModel = "";
  private fallbackLiveModels: string[] = [];
  private activeLiveModel = "";
  private onTranscript: TranscriptCallback | null = null;
  private onStatus: StatusCallback | null = null;

  // Per-turn transcript state machine:
  // committedTranscript: finalized text from all completed turns
  // pendingInputTranscription: latest cumulative inputTranscription for the current turn (replaced on each update)
  // pendingModelText: accumulated model text tokens for the current turn (direct concatenation, fallback only)
  // hasReceivedInputTranscription: tracks whether inputTranscription has been received in this session
  private committedTranscript = "";
  private pendingInputTranscription = "";
  private pendingModelText = "";
  private hasReceivedInputTranscription = false;

  private connectStartedAt = 0;
  private messageCount = 0;
  private inputTranscriptionChunkCount = 0;
  private modelTextChunkCount = 0;
  private sentAudioChunkCount = 0;
  private sentAudioApproxBytes = 0;
  private lastAudioSendLogChunk = 0;
  private droppedAudioChunkCount = 0;
  private consecutiveSendFailures = 0;
  private static readonly SEND_FAILURE_ESCALATION_THRESHOLD = 3;
  private turnCompleteCount = 0;
  private interruptedCount = 0;
  private generationCompleteCount = 0;
  private pendingAudioChunks: string[] = [];
  private queuedAudioApproxBytes = 0;
  private droppedQueuedAudioChunks = 0;
  private turnSettleResolvers: Array<() => void> = [];

  private static readonly MAX_PENDING_AUDIO_CHUNKS = 1200;

  configure(
    apiKey: string,
    language: string = "auto",
    preferredLiveModel: string = "",
    fallbackLiveModels: string[] = []
  ) {
    this.apiKey = apiKey;
    this.language = language;
    this.ai = new GoogleGenAI({ apiKey });
    this.preferredLiveModel = normalizeModelName(preferredLiveModel);
    this.fallbackLiveModels = fallbackLiveModels
      .map((m) => normalizeModelName(m))
      .filter((m) => Boolean(m));

    debugLog(
      `Gemini configured (language='${language}', preferredModel='${this.preferredLiveModel || "(none)"}', fallbackCount=${this.fallbackLiveModels.length}, apiKeyPresent=${Boolean(apiKey)})`,
      "INFO"
    );
  }

  setCallbacks(onTranscript: TranscriptCallback, onStatus: StatusCallback) {
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
  }

  getActiveLiveModel(): string {
    return this.activeLiveModel;
  }

  private async resolveConnectModel(): Promise<string> {
    const candidates = Array.from(
      new Set([
        this.preferredLiveModel,
        ...this.fallbackLiveModels,
      ])
    ).filter((m) => Boolean(m));

    if (candidates.length === 0) {
      throw new Error("No model selected. Pick a model from the model dropdown first.");
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        await validateLiveModel(this.apiKey, candidate);
        if (candidate !== this.preferredLiveModel) {
          debugLog(
            `Falling back from preferred model '${this.preferredLiveModel}' to '${candidate}'`,
            "WARN"
          );
        }
        return candidate;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${candidate}: ${message}`);
      }
    }

    throw new Error(`No compatible live model found. ${errors.join(" | ")}`);
  }

  async connect(options: { preserveTranscript?: boolean } = {}): Promise<void> {
    const { preserveTranscript = false } = options;

    if (!this.ai || !this.apiKey) {
      this.onStatus?.("error", "API key not configured");
      return;
    }

    this.onStatus?.("connecting");
    if (!preserveTranscript) {
      this.committedTranscript = "";
      this.pendingInputTranscription = "";
      this.pendingModelText = "";
    }
    this.hasReceivedInputTranscription = false;
    this.connectStartedAt = Date.now();
    this.messageCount = 0;
    this.inputTranscriptionChunkCount = 0;
    this.modelTextChunkCount = 0;
    this.sentAudioChunkCount = 0;
    this.sentAudioApproxBytes = 0;
    this.lastAudioSendLogChunk = 0;
    this.droppedAudioChunkCount = 0;
    this.consecutiveSendFailures = 0;
    this.turnCompleteCount = 0;
    this.interruptedCount = 0;
    this.generationCompleteCount = 0;

    try {
      this.activeLiveModel = await this.resolveConnectModel();
      const responseModality = getResponseModalityForModel(this.activeLiveModel);
      debugLog(
        `Connecting to Gemini Live API (model='${this.activeLiveModel}', responseModality='${responseModality}')`,
        "INFO"
      );

      const languageInstruction =
        this.language === "auto"
          ? "Detect the language automatically."
          : `The user is speaking in ${this.language}.`;

      this.session = await this.ai.live.connect({
        model: this.activeLiveModel,
        config: {
          responseModalities: [responseModality],
          inputAudioTranscription: {},
          systemInstruction: `You are a speech transcription assistant. Your ONLY job is to output the exact transcription of the user's speech. ${languageInstruction} Do not add any commentary, responses, greetings, or formatting. Output ONLY the transcribed words. If the user pauses, do not fill in words. If you cannot understand something, skip it. Never respond conversationally.`,
        },
        callbacks: {
          onopen: () => {
            this.handleSocketOpen();
          },
          onmessage: (message: LiveServerMessage) => {
            this.messageCount += 1;
            this.handleMessage(message);
          },
          onerror: (event: Event) => {
            this.handleSocketError(event);
          },
          onclose: (event?: unknown) => {
            this.handleSocketClose(event);
          },
        },
      });

      debugLog(
        `Gemini live.connect() returned session for model '${this.activeLiveModel}'`,
        "INFO"
      );

      this.flushPendingAudioChunks();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to connect to Gemini Live:", message);
      debugLog(`Failed to connect to Gemini Live: ${message}`, "ERROR");
      this.onStatus?.("error", message);
    }
  }

  private handleSocketOpen() {
    const elapsedMs =
      this.connectStartedAt > 0 ? Date.now() - this.connectStartedAt : 0;
    debugLog(`Gemini Live socket opened in ${elapsedMs}ms`, "INFO");
    this.onStatus?.("connected");
  }

  private handleSocketError(event: Event) {
    const errorEvent = event as ErrorEvent;
    console.error("Gemini Live error:", errorEvent);
    this.session = null;
    debugLog(
      `Gemini Live error: ${errorEvent.message || "Connection error"}`,
      "ERROR"
    );
    this.onStatus?.("error", errorEvent.message || "Connection error");
  }

  private handleSocketClose(event?: unknown) {
    const closeDetails = this.formatCloseEvent(event);
    debugLog(
      `Gemini Live socket closed${closeDetails ? ` (${closeDetails})` : ""} (messages=${this.messageCount}, inputChunks=${this.inputTranscriptionChunkCount}, modelChunks=${this.modelTextChunkCount}, sentAudioChunks=${this.sentAudioChunkCount}, ~sentAudioBytes=${this.sentAudioApproxBytes})`,
      "INFO"
    );
    this.session = null;
    this.onStatus?.("disconnected");
  }

  private formatCloseEvent(event?: unknown): string {
    if (!event || typeof event !== "object") {
      return "";
    }

    const maybeCode = (event as { code?: unknown }).code;
    const maybeReason = (event as { reason?: unknown }).reason;
    const maybeWasClean = (event as { wasClean?: unknown }).wasClean;

    const parts: string[] = [];
    if (typeof maybeCode === "number") {
      parts.push(`code=${maybeCode}`);
    }
    if (typeof maybeReason === "string" && maybeReason.length > 0) {
      parts.push(`reason=${maybeReason}`);
    }
    if (typeof maybeWasClean === "boolean") {
      parts.push(`wasClean=${maybeWasClean}`);
    }

    return parts.join(", ");
  }

  private handleMessage(message: LiveServerMessage) {
    const serverContent = message.serverContent as Record<string, unknown> | undefined;
    if (serverContent) {
      if (serverContent.setupComplete === true) {
        debugLog(
          `Gemini lifecycle: setupComplete (message=${this.messageCount})`,
          "INFO"
        );
      }

      if (serverContent.interrupted === true) {
        this.interruptedCount += 1;
        debugLog(
          `Gemini lifecycle: interrupted #${this.interruptedCount} (message=${this.messageCount}, transcriptChars=${this.computeFullTranscript().length})`,
          "WARN"
        );
      }

      if (serverContent.generationComplete === true) {
        this.generationCompleteCount += 1;
        debugLog(
          `Gemini lifecycle: generationComplete #${this.generationCompleteCount} (message=${this.messageCount}, transcriptChars=${this.computeFullTranscript().length})`,
          "INFO"
        );
      }

      if (isDebugLoggingEnabled() && serverContent.modelTurn !== undefined) {
        debugLog(
          `Gemini lifecycle: modelTurn event (message=${this.messageCount}, transcriptChars=${this.computeFullTranscript().length})`,
          "INFO"
        );
      }
    }

    // PRIMARY PATH: Server-side ASR via inputTranscription.
    // Chunks are incremental token-level deltas (BPE fragments) with embedded
    // spacing (leading spaces mark word boundaries). They must be concatenated
    // directly — no extra spaces should be inserted.
    const inputTranscription = message.serverContent?.inputTranscription as
      | { text?: string; finished?: boolean }
      | undefined;
    if (inputTranscription?.text) {
      const text = inputTranscription.text;
      this.inputTranscriptionChunkCount += 1;
      this.hasReceivedInputTranscription = true;
      this.pendingInputTranscription += text;

      if (isDebugLoggingEnabled()) {
        debugLog(
          `Gemini input transcription chunk #${this.inputTranscriptionChunkCount}: text=${formatChunkTextForLog(text)} (${text.length} chars, pending=${this.pendingInputTranscription.length}, committed=${this.committedTranscript.length})`,
          "INFO"
        );
      }

      // If this transcription segment is finished, commit it
      if (inputTranscription.finished === true) {
        if (isDebugLoggingEnabled()) {
          debugLog(
            `Gemini input transcription finished (committing pending: ${this.pendingInputTranscription.length} chars)`,
            "INFO"
          );
        }
        this.commitPendingTurn();
      }

      this.onTranscript?.(this.computeFullTranscript(), false);
    }

    // FALLBACK PATH: Model text output (serverContent.modelTurn.parts[].text).
    // Only used when inputTranscription hasn't been received for this session.
    // Tokens are concatenated directly (no space insertion) since they arrive
    // as subword BPE fragments.
    if (message.text && !this.hasReceivedInputTranscription) {
      this.modelTextChunkCount += 1;
      this.pendingModelText += message.text;

      if (isDebugLoggingEnabled()) {
        debugLog(
          `Gemini model text chunk #${this.modelTextChunkCount}: text=${formatChunkTextForLog(message.text)} (+${message.text.length} chars, pendingModel=${this.pendingModelText.length}, committed=${this.committedTranscript.length})`,
          "INFO"
        );
      }
      this.onTranscript?.(this.computeFullTranscript(), false);
    } else if (message.text && this.hasReceivedInputTranscription) {
      // Still count model text chunks for diagnostics, but don't use them
      this.modelTextChunkCount += 1;
      if (isDebugLoggingEnabled()) {
        debugLog(
          `Gemini model text chunk #${this.modelTextChunkCount} (ignored, using inputTranscription): text=${formatChunkTextForLog(message.text)}`,
          "INFO"
        );
      }
    }

    if (message.serverContent?.turnComplete) {
      this.turnCompleteCount += 1;
      debugLog(
        `Gemini turn complete #${this.turnCompleteCount} (transcriptChars=${this.computeFullTranscript().length}, message=${this.messageCount})`,
        "INFO"
      );
      this.commitPendingTurn();
      this.onTranscript?.(this.computeFullTranscript(), true);
    }
  }

  sendAudio(base64PcmData: string) {
    if (!this.session) {
      this.queuePendingAudioChunk(base64PcmData);
      return;
    }

    this.sendAudioToActiveSession(base64PcmData);
  }

  private sendAudioToActiveSession(base64PcmData: string) {
    if (!this.session) {
      this.queuePendingAudioChunk(base64PcmData);
      return;
    }

    this.sentAudioChunkCount += 1;
    this.sentAudioApproxBytes += Math.floor((base64PcmData.length * 3) / 4);
    if (
      isDebugLoggingEnabled() &&
      this.sentAudioChunkCount >= this.lastAudioSendLogChunk + 25
    ) {
      debugLog(
        `Sent audio to Gemini: ${this.sentAudioChunkCount} chunks, ~${this.sentAudioApproxBytes} bytes`,
        "INFO"
      );
      this.lastAudioSendLogChunk = this.sentAudioChunkCount;
    }

    try {
      this.session.sendRealtimeInput({
        media: {
          data: base64PcmData,
          mimeType: "audio/pcm;rate=16000",
        },
      });
      this.droppedAudioChunkCount = 0;
      this.consecutiveSendFailures = 0;
    } catch (err) {
      this.consecutiveSendFailures += 1;
      console.error("Failed to send audio:", err);
      debugLog(
        `Failed to send audio to Gemini (consecutive=${this.consecutiveSendFailures}): ${String(err)}`,
        "ERROR"
      );

      if (
        this.consecutiveSendFailures >=
        GeminiTranscriber.SEND_FAILURE_ESCALATION_THRESHOLD
      ) {
        debugLog(
          `Send failure escalation: ${this.consecutiveSendFailures} consecutive failures, clearing session`,
          "ERROR"
        );
        this.session = null;
        this.consecutiveSendFailures = 0;
        this.onStatus?.("error", "Audio send failed repeatedly — connection lost");
      }
    }
  }

  private queuePendingAudioChunk(base64PcmData: string) {
    this.pendingAudioChunks.push(base64PcmData);
    this.queuedAudioApproxBytes += Math.floor((base64PcmData.length * 3) / 4);

    if (this.pendingAudioChunks.length > GeminiTranscriber.MAX_PENDING_AUDIO_CHUNKS) {
      const dropped = this.pendingAudioChunks.shift();
      if (dropped) {
        this.queuedAudioApproxBytes = Math.max(
          0,
          this.queuedAudioApproxBytes - Math.floor((dropped.length * 3) / 4)
        );
      }
      this.droppedQueuedAudioChunks += 1;
      this.droppedAudioChunkCount += 1;
    }

    if (
      isDebugLoggingEnabled() &&
      (this.pendingAudioChunks.length === 1 ||
        this.pendingAudioChunks.length % 100 === 0 ||
        this.droppedQueuedAudioChunks > 0)
    ) {
      debugLog(
        `Queueing audio while Gemini session is disconnected (queued=${this.pendingAudioChunks.length}, ~queuedBytes=${this.queuedAudioApproxBytes}, droppedQueued=${this.droppedQueuedAudioChunks})`,
        this.droppedQueuedAudioChunks > 0 ? "WARN" : "INFO"
      );
    }
  }

  private flushPendingAudioChunks() {
    if (!this.session || this.pendingAudioChunks.length === 0) {
      return;
    }

    const queued = this.pendingAudioChunks;
    this.pendingAudioChunks = [];
    this.queuedAudioApproxBytes = 0;

    debugLog(
      `Flushing queued audio into Gemini session (chunks=${queued.length}, droppedQueued=${this.droppedQueuedAudioChunks})`,
      "INFO"
    );

    for (const chunk of queued) {
      this.sendAudioToActiveSession(chunk);
    }
  }

  signalAudioStreamBoundary(reason = "periodic"): boolean {
    if (!this.session) {
      return false;
    }

    try {
      this.session.sendRealtimeInput({
        audioStreamEnd: true,
      });
      debugLog(
        `Sent Gemini audio stream boundary (reason='${reason}', sentAudioChunks=${this.sentAudioChunkCount}, transcriptChars=${this.computeFullTranscript().length})`,
        "INFO"
      );
      return true;
    } catch (err) {
      debugLog(
        `Failed to send Gemini audio stream boundary: ${String(err)}`,
        "ERROR"
      );
      return false;
    }
  }

  async reconnectForRecovery(): Promise<void> {
    debugLog(
      `Starting Gemini live recovery reconnect (queuedAudio=${this.pendingAudioChunks.length}, transcriptChars=${this.computeFullTranscript().length})`,
      "WARN"
    );
    await this.disconnect();
    await this.connect({ preserveTranscript: true });
    debugLog(
      `Gemini live recovery reconnect finished (connected=${this.isConnected()}, queuedAudio=${this.pendingAudioChunks.length})`,
      this.isConnected() ? "INFO" : "WARN"
    );
  }

  getTranscript(): string {
    return this.computeFullTranscript();
  }

  resetTranscript() {
    this.committedTranscript = "";
    this.pendingInputTranscription = "";
    this.pendingModelText = "";
    this.hasReceivedInputTranscription = false;
  }

  /**
   * Returns a promise that resolves when the current pending turn is committed
   * (via turnComplete or inputTranscription.finished), or when the timeout
   * expires — whichever comes first. If there is no pending text, resolves
   * immediately.
   */
  waitForPendingTurnSettle(timeoutMs = 1500): Promise<void> {
    const hasPending = this.pendingInputTranscription.trim().length > 0 ||
      this.pendingModelText.trim().length > 0;
    if (!hasPending || !this.session) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        const idx = this.turnSettleResolvers.indexOf(onSettle);
        if (idx !== -1) this.turnSettleResolvers.splice(idx, 1);
        resolve();
      };
      const onSettle = finish;
      this.turnSettleResolvers.push(onSettle);
      setTimeout(finish, timeoutMs);
    });
  }

  /**
   * Computes the full transcript from committed text + current pending turn.
   * Prefers inputTranscription over model text when available.
   */
  private computeFullTranscript(): string {
    const pending = this.hasReceivedInputTranscription
      ? this.pendingInputTranscription
      : this.pendingModelText;
    return joinTranscriptSegments(this.committedTranscript, pending);
  }

  /**
   * Commits the current pending turn text to the committed transcript
   * and resets the pending state for the next turn.
   */
  private commitPendingTurn() {
    const pending = this.hasReceivedInputTranscription
      ? this.pendingInputTranscription
      : this.pendingModelText;
    if (pending.trim()) {
      this.committedTranscript = joinTranscriptSegments(this.committedTranscript, pending);
    }
    this.pendingInputTranscription = "";
    this.pendingModelText = "";

    // Notify any waiters that the turn has settled
    const resolvers = this.turnSettleResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve();
    }
  }

  async disconnect(): Promise<void> {
    if (this.session) {
      try {
        this.signalAudioStreamBoundary("disconnect");
        this.session.close();
        debugLog("Gemini session close requested", "INFO");
      } catch {
        // Ignore close errors
      }
      this.session = null;
    }
    this.onStatus?.("disconnected");
  }

  isConnected(): boolean {
    return this.session !== null;
  }
}

export async function validateApiKey(apiKey: string): Promise<void> {
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  await fetchLiveModels(apiKey);
}

function extractGenerateContentText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) {
    return "";
  }

  const partsText: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") {
      continue;
    }

    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim().length > 0) {
        partsText.push(text.trim());
      }
    }
  }

  return partsText.join(" ").trim();
}

export async function transcribeWavBase64(
  apiKey: string,
  wavBase64: string,
  language: string = "auto",
  model: string = ""
): Promise<string> {
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  if (!wavBase64.trim()) {
    return "";
  }

  const selectedModel = assertModelSelected(model, "Gemini transcription");

  const languageInstruction =
    language === "auto"
      ? "Detect the spoken language automatically."
      : `The spoken language is ${language}.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${toModelResource(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are a speech transcription assistant. Transcribe this audio exactly. ${languageInstruction} Output only the spoken words, with no extra commentary or formatting.`,
              },
              {
                inline_data: {
                  mime_type: "audio/wav",
                  data: wavBase64,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `Failed to transcribe audio: ${extractApiErrorMessage(raw)} (HTTP ${response.status})`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "";
  }

  return extractGenerateContentText(parsed);
}

export async function transcribeWithLivePipeline(options: {
  apiKey: string;
  language?: string;
  preferredLiveModel?: string;
  fallbackLiveModels?: string[];
  pcmChunksBase64: string[];
  settleDelayMs?: number;
  chunkIntervalMs?: number;
}): Promise<string> {
  const {
    apiKey,
    language = "auto",
    preferredLiveModel = "",
    fallbackLiveModels = [],
    pcmChunksBase64,
    settleDelayMs = 1800,
    chunkIntervalMs = 20,
  } = options;

  if (!apiKey) {
    throw new Error("API key not configured");
  }

  if (pcmChunksBase64.length === 0) {
    return "";
  }

  const liveTranscriber = new GeminiTranscriber();
  let latestTranscript = "";
  let hadError = false;
  let statusMessage = "";
  let isConnected = false;

  let resolveConnected: (() => void) | null = null;
  let rejectConnected: ((error: Error) => void) | null = null;
  const connectedPromise = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  liveTranscriber.configure(apiKey, language, preferredLiveModel, fallbackLiveModels);
  liveTranscriber.setCallbacks(
    (text) => {
      latestTranscript = text;
    },
    (nextStatus, message) => {
      hadError = nextStatus === "error";
      statusMessage = message || "";
      isConnected = nextStatus === "connected";

      if (nextStatus === "connected") {
        resolveConnected?.();
      } else if (nextStatus === "error") {
        rejectConnected?.(new Error(statusMessage || "Live transcription failed"));
      }
    }
  );

  try {
    await liveTranscriber.connect();

    // Wait for connected status with a timeout.
    // Use a flag to prevent the timeout branch from throwing
    // an unhandled rejection after the race settles.
    let raceSettled = false;
    await Promise.race([
      connectedPromise.then(() => {
        raceSettled = true;
      }),
      sleep(2500).then(() => {
        if (raceSettled) {
          return; // connectedPromise already won the race
        }
        raceSettled = true;
        if (!isConnected) {
          throw new Error(statusMessage || "Live transcription connection timed out");
        }
      }),
    ]);

    for (const chunk of pcmChunksBase64) {
      liveTranscriber.sendAudio(chunk);
      await sleep(chunkIntervalMs);
    }

    await sleep(settleDelayMs);

    if (hadError) {
      throw new Error(statusMessage || "Live transcription failed");
    }

    return (latestTranscript || liveTranscriber.getTranscript()).trim();
  } finally {
    await liveTranscriber.disconnect();
  }
}

export const transcriber = new GeminiTranscriber();
