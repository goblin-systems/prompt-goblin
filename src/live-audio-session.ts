import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Settings, SttProvider } from "./settings";
import { createLiveTranscriber } from "./stt/service";
import type { StatusCallback } from "./stt/types";
import { applyTextCommands, getCommandTailGuardChars } from "./text-commands";

export interface LiveAudioSessionTranscriptUpdate {
  rawText: string;
  displayText: string;
  isFinal: boolean;
}

export interface LiveAudioSessionOptions<TStopResult = unknown> {
  provider: SttProvider;
  apiKey: string;
  language: string;
  preferredModel: string;
  fallbackModels: string[];
  typingMode: Settings["typingMode"];
  enableTyping: boolean;
  textCommandSettings: Settings;
  audioEventName: string;
  startCommand: string;
  startPayload: Record<string, unknown>;
  stopCommand: string;
  settleDelayMs?: number;
  onTranscript?: (update: LiveAudioSessionTranscriptUpdate) => void;
  onStatus?: StatusCallback;
  onAudioChunk?: (payload: { data: string; rms: number }) => void;
}

export interface LiveAudioSessionStopResult<TStopResult = unknown> {
  rawText: string;
  finalText: string;
  captureResult: TStopResult;
}

export class LiveAudioSession<TStopResult = unknown> {
  private readonly transcriber;
  private readonly settleDelayMs: number;
  private readonly commandTailGuardChars = getCommandTailGuardChars();
  private readonly periodicAudioTurnBoundaryMs: number;
  private unlistenAudio: UnlistenFn | null = null;
  private active = false;
  private latestRawTranscript = "";
  private lastTypedLength = 0;
  private incrementalTailFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private recordingChunkCount = 0;
  private lastAudioTurnBoundaryAt = 0;

  constructor(private readonly options: LiveAudioSessionOptions<TStopResult>) {
    this.transcriber = createLiveTranscriber(options.provider);
    this.settleDelayMs = options.settleDelayMs ?? 1500;
    this.periodicAudioTurnBoundaryMs = options.provider === "openai" ? 2500 : 12000;
    this.transcriber.setCallbacks(this.handleTranscript, this.handleStatus);
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }

    this.latestRawTranscript = "";
    this.lastTypedLength = 0;
    this.recordingChunkCount = 0;
    this.lastAudioTurnBoundaryAt = Date.now();
    this.clearIncrementalTailFlush();

    this.transcriber.resetTranscript();
    this.transcriber.configure({
      apiKey: this.options.apiKey,
      language: this.options.language,
      preferredModel: this.options.preferredModel,
      fallbackModels: this.options.fallbackModels,
    });

    this.unlistenAudio = await listen<{ data: string; rms: number }>(
      this.options.audioEventName,
      (event) => {
        if (!this.active) {
          return;
        }

        const { data, rms } = event.payload;
        this.options.onAudioChunk?.({ data, rms });
        this.recordingChunkCount += 1;
        this.transcriber.sendAudio(data);

        if (
          this.active &&
          this.options.typingMode === "incremental" &&
          this.transcriber.isConnected() &&
          this.recordingChunkCount >= 200
        ) {
          const now = Date.now();
          if (now - this.lastAudioTurnBoundaryAt >= this.periodicAudioTurnBoundaryMs) {
            if (this.transcriber.signalAudioStreamBoundary("periodic")) {
              this.lastAudioTurnBoundaryAt = now;
            }
          }
        }
      }
    );

    try {
      await invoke(this.options.startCommand, this.options.startPayload);
      this.active = true;
      await this.transcriber.connect();
    } catch (err) {
      this.active = false;
      await invoke(this.options.stopCommand).catch(() => {
        // best-effort capture cleanup
      });
      await this.cleanupAfterStop();
      throw err;
    }
  }

  async stop(): Promise<LiveAudioSessionStopResult<TStopResult>> {
    this.active = false;
    this.clearIncrementalTailFlush();

    let captureResult: TStopResult;
    try {
      captureResult = await invoke<TStopResult>(this.options.stopCommand);
    } catch (err) {
      await this.cleanupAfterStop();
      throw err;
    }

    await this.transcriber.waitForPendingTurnSettle(this.settleDelayMs);

    const rawText = this.transcriber.getTranscript().trim();
    const finalText = this.processFinalTranscript(rawText);

    if (this.options.enableTyping) {
      if (this.options.typingMode === "all_at_once") {
        if (finalText) {
          await this.typeText(finalText);
        }
      } else {
        const tailText = this.processIncrementalTranscriptForTyping(this.latestRawTranscript, true);
        if (tailText) {
          await this.typeText(tailText);
        }
      }
    }

    this.options.onTranscript?.({
      rawText,
      displayText: finalText,
      isFinal: true,
    });

    await this.cleanupAfterStop();

    return {
      rawText,
      finalText,
      captureResult,
    };
  }

  getActiveModel(): string {
    return this.transcriber.getActiveModel();
  }

  isConnected(): boolean {
    return this.transcriber.isConnected();
  }

  private readonly handleTranscript = (text: string, isFinal: boolean) => {
    this.latestRawTranscript = text;

    if (this.options.typingMode === "incremental") {
      const displayText = this.getIncrementalDisplayText(text, isFinal, false);
      this.options.onTranscript?.({ rawText: text, displayText, isFinal });

      if (this.options.enableTyping && this.active) {
        const newText = this.processIncrementalTranscriptForTyping(text, isFinal);
        if (newText.length > 0) {
          this.typeText(newText).catch((err) => {
            console.error("Incremental type failed:", err);
          });
        }
      }

      if (!isFinal) {
        this.clearIncrementalTailFlush();
        this.incrementalTailFlushTimer = setTimeout(() => {
          this.incrementalTailFlushTimer = null;
          this.flushIncrementalTail();
        }, 800);
      } else {
        this.clearIncrementalTailFlush();
      }
      return;
    }

    this.options.onTranscript?.({
      rawText: text,
      displayText: isFinal ? this.processFinalTranscript(text) : text,
      isFinal,
    });
  };

  private readonly handleStatus: StatusCallback = (status, message) => {
    this.options.onStatus?.(status, message);
  };

  private typeText(text: string) {
    return invoke("type_text", {
      text,
      lineBreakMode: this.options.textCommandSettings.lineBreakMode,
    });
  }

  private processFinalTranscript(text: string): string {
    return applyTextCommands(text, this.options.textCommandSettings).trim();
  }

  private processIncrementalTranscriptForTyping(text: string, isFinal: boolean): string {
    const stableRawText = isFinal
      ? text
      : text.slice(0, Math.max(0, text.length - this.commandTailGuardChars));

    const processedStableText = applyTextCommands(
      stableRawText,
      this.options.textCommandSettings
    );
    const newText = processedStableText.slice(this.lastTypedLength);
    this.lastTypedLength = processedStableText.length;
    return newText;
  }

  private getIncrementalDisplayText(text: string, isFinal: boolean, flushTail: boolean): string {
    const stableRawText = isFinal || flushTail
      ? text
      : text.slice(0, Math.max(0, text.length - this.commandTailGuardChars));
    return applyTextCommands(stableRawText, this.options.textCommandSettings).trim();
  }

  private flushIncrementalTail() {
    if (!this.latestRawTranscript) {
      return;
    }

    this.options.onTranscript?.({
      rawText: this.latestRawTranscript,
      displayText: this.getIncrementalDisplayText(this.latestRawTranscript, false, true),
      isFinal: false,
    });

    if (!this.options.enableTyping || !this.active || this.options.typingMode !== "incremental") {
      return;
    }

    const tailText = this.processIncrementalTranscriptForTyping(this.latestRawTranscript, true);
    if (!tailText) {
      return;
    }

    this.typeText(tailText).catch((err) => {
      console.error("Incremental tail flush type failed:", err);
    });
  }

  private clearIncrementalTailFlush() {
    if (this.incrementalTailFlushTimer) {
      clearTimeout(this.incrementalTailFlushTimer);
      this.incrementalTailFlushTimer = null;
    }
  }

  private async cleanupAfterStop() {
    this.clearIncrementalTailFlush();
    await this.transcriber.disconnect().catch(() => {
      // best-effort disconnect
    });
    if (this.unlistenAudio) {
      this.unlistenAudio();
      this.unlistenAudio = null;
    }
  }
}
