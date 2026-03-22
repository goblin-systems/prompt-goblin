import { describe, expect, test } from "bun:test";
import { processIncrementalTranscriptUpdate } from "../src/incremental-typing";
import { getDefaultSettings } from "../src/settings";
import { getCommandTailGuardChars } from "../src/text-commands";

describe("processIncrementalTranscriptUpdate", () => {
  test("does not re-type a prior-turn suffix when the next non-final update is shorter due to guard trimming", () => {
    const settings = getDefaultSettings();
    const guardChars = getCommandTailGuardChars();

    let state = {
      lastTypedLength: 0,
      latestRawTranscript: "",
    };
    let typedText = "";

    const applyUpdate = (text: string, isFinal: boolean) => {
      const update = processIncrementalTranscriptUpdate(text, isFinal, settings, guardChars, state);
      state = {
        lastTypedLength: update.lastTypedLength,
        latestRawTranscript: update.latestRawTranscript,
      };
      typedText += update.newText;
    };

    const turnOne = "alice was beginning to get very tired of sitting by her sister on the bank and having nothing to do.";
    applyUpdate(turnOne, true);

    const turnTwoPartial = `${turnOne} once or twice she peeps into the book`;
    applyUpdate(turnTwoPartial, false);

    expect(typedText).toBe(`${turnOne} o`);
    expect(state.lastTypedLength).toBe(typedText.length);
    expect(state.lastTypedLength).toBeGreaterThanOrEqual(turnOne.length);
    expect(countOccurrences(typedText, "he bank and having nothing to do")).toBe(1);
  });
});

function countOccurrences(text: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = 0;

  while (true) {
    const nextIndex = text.indexOf(needle, index);
    if (nextIndex === -1) {
      return count;
    }
    count += 1;
    index = nextIndex + needle.length;
  }
}
