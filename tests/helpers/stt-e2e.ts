import { applyTextCommands, getCommandTailGuardChars } from "../../src/text-commands";
import { getDefaultSettings, type Settings, type SttProvider } from "../../src/settings";
import { createLiveTranscriber } from "../../src/stt/service";

const GEMINI_PERIODIC_AUDIO_TURN_BOUNDARY_MS = 12000;
const OPENAI_PERIODIC_AUDIO_TURN_BOUNDARY_MS = 2500;

type LiveE2ERunOptions = {
  provider: SttProvider;
  apiKey: string;
  language?: string;
  typingMode?: Settings["typingMode"];
  preferredModel: string;
  fallbackModels?: string[];
  pcmChunksBase64: string[];
  chunkIntervalMs?: number;
  settleTimeoutMs?: number;
};

export type LiveE2ERunResult = {
  finalText: string;
  typedText: string;
  transcriptEvents: Array<{ text: string; isFinal: boolean }>;
  statuses: string[];
  turnBoundaryCount: number;
};

export async function runLiveTranscriberE2E(options: LiveE2ERunOptions): Promise<LiveE2ERunResult> {
  const settings = createTestSettings(
    options.provider,
    options.language ?? "en",
    options.typingMode ?? "incremental"
  );
  const transcriber = createLiveTranscriber(options.provider);
  const transcriptEvents: Array<{ text: string; isFinal: boolean }> = [];
  const statuses: string[] = [];
  const guardChars = getCommandTailGuardChars();

  let latestRawTranscript = "";
  let lastTypedLength = 0;
  let typedText = "";
  let turnBoundaryCount = 0;
  let lastAudioTurnBoundaryAt = 0;

  const processIncrementalTranscriptForTyping = (text: string, isFinal: boolean): string => {
    const stableRawText = isFinal ? text : text.slice(0, Math.max(0, text.length - guardChars));
    const processedStableText = applyTextCommands(stableRawText, settings);
    const newText = processedStableText.slice(lastTypedLength);
    lastTypedLength = processedStableText.length;
    latestRawTranscript = text;
    return newText;
  };

  transcriber.configure({
    apiKey: options.apiKey,
    language: settings.language,
    preferredModel: options.preferredModel,
    fallbackModels: options.fallbackModels ?? [],
  });

  transcriber.setCallbacks(
    (text, isFinal) => {
      transcriptEvents.push({ text, isFinal });
      if (settings.typingMode !== "incremental") {
        return;
      }
      const nextText = processIncrementalTranscriptForTyping(text, isFinal);
      if (nextText) {
        typedText += nextText;
      }
    },
    (status, message) => {
      statuses.push(message ? `${status}:${message}` : status);
    }
  );

  await transcriber.connect();

  const chunkIntervalMs = options.chunkIntervalMs ?? 20;
  const periodicBoundaryMs =
    options.provider === "openai"
      ? OPENAI_PERIODIC_AUDIO_TURN_BOUNDARY_MS
      : GEMINI_PERIODIC_AUDIO_TURN_BOUNDARY_MS;

  try {
    for (let index = 0; index < options.pcmChunksBase64.length; index += 1) {
      transcriber.sendAudio(options.pcmChunksBase64[index]);
      const elapsedMs = (index + 1) * chunkIntervalMs;

      if (
        transcriber.isConnected() &&
        index + 1 >= 200 &&
        elapsedMs - lastAudioTurnBoundaryAt >= periodicBoundaryMs
      ) {
        if (transcriber.signalAudioStreamBoundary("periodic-test")) {
          turnBoundaryCount += 1;
          lastAudioTurnBoundaryAt = elapsedMs;
        }
      }

      if (chunkIntervalMs > 0) {
        await sleep(chunkIntervalMs);
      }
    }

    await transcriber.waitForPendingTurnSettle(options.settleTimeoutMs ?? 2500);
    const finalText = applyTextCommands(transcriber.getTranscript().trim(), settings).trim();
    if (settings.typingMode === "incremental") {
      const finalTailText = processIncrementalTranscriptForTyping(latestRawTranscript, true);
      if (finalTailText) {
        typedText += finalTailText;
      }
    } else {
      typedText = finalText;
    }

    return {
      finalText,
      typedText,
      transcriptEvents,
      statuses,
      turnBoundaryCount,
    };
  } finally {
    await transcriber.disconnect();
  }
}

function createTestSettings(
  provider: SttProvider,
  language: string,
  typingMode: Settings["typingMode"]
): Settings {
  const settings = getDefaultSettings();
  settings.sttProvider = provider;
  settings.language = language;
  settings.typingMode = typingMode;
  settings.textCommandsEnabled = true;
  settings.customTextCommands = [];
  settings.autoStopOnSilence = true;
  settings.autoStopSilenceMs = 4000;
  return settings;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
