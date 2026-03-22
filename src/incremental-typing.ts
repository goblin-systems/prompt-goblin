import { applyTextCommands } from "./text-commands";
import type { Settings } from "./settings";

export type IncrementalTypingState = {
  lastTypedLength: number;
  latestRawTranscript: string;
};

export type IncrementalTypingUpdate = IncrementalTypingState & {
  newText: string;
};

export function processIncrementalTranscriptUpdate(
  text: string,
  isFinal: boolean,
  settings: Settings,
  commandTailGuardChars: number,
  state: IncrementalTypingState
): IncrementalTypingUpdate {
  const stableRawText = isFinal
    ? text
    : text.slice(0, Math.max(0, text.length - commandTailGuardChars));

  const processedStableText = applyTextCommands(stableRawText, settings);
  const newText = processedStableText.slice(state.lastTypedLength);

  return {
    newText,
    lastTypedLength: Math.max(state.lastTypedLength, processedStableText.length),
    latestRawTranscript: text,
  };
}
