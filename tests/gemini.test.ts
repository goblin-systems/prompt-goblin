import { describe, expect, test } from "bun:test";
import { GeminiTranscriber } from "../src/gemini";

describe("GeminiTranscriber session lifecycle", () => {
  test("stops forwarding audio after socket close", () => {
    const transcriber = new GeminiTranscriber();
    const statuses: string[] = [];
    let sendCount = 0;

    transcriber.setCallbacks(() => {}, (status) => {
      statuses.push(status);
    });

    (transcriber as any).session = {
      sendRealtimeInput: () => {
        sendCount += 1;
      },
      close: () => {},
    };

    transcriber.sendAudio("AAAA");
    expect(sendCount).toBe(1);

    (transcriber as any).handleSocketClose();
    expect(transcriber.isConnected()).toBe(false);
    expect(statuses).toContain("disconnected");

    transcriber.sendAudio("BBBB");
    expect(sendCount).toBe(1);
  });

  test("clears session on socket error", () => {
    const transcriber = new GeminiTranscriber();
    let sendCount = 0;

    (transcriber as any).session = {
      sendRealtimeInput: () => {
        sendCount += 1;
      },
      close: () => {},
    };

    transcriber.sendAudio("AAAA");
    expect(sendCount).toBe(1);

    const errorEvent = new Event("error") as ErrorEvent;
    (errorEvent as any).message = "socket died";
    (transcriber as any).handleSocketError(errorEvent);
    expect(transcriber.isConnected()).toBe(false);

    transcriber.sendAudio("BBBB");
    expect(sendCount).toBe(1);
  });
});

describe("GeminiTranscriber per-turn transcript state machine", () => {
  function emitInputTranscription(
    transcriber: GeminiTranscriber,
    text: string,
    finished = false
  ) {
    (transcriber as any).handleMessage({
      serverContent: {
        inputTranscription: { text, finished },
      },
    });
  }

  function emitTurnComplete(transcriber: GeminiTranscriber) {
    (transcriber as any).handleMessage({
      serverContent: { turnComplete: true },
    });
  }

  function emitModelText(transcriber: GeminiTranscriber, text: string) {
    const msg = {
      serverContent: {
        modelTurn: {
          parts: [{ text }],
        },
      },
      get text() {
        return text;
      },
    };
    (transcriber as any).handleMessage(msg);
  }

  test("inputTranscription BPE fragments concatenate directly (no extra spaces)", () => {
    const transcriber = new GeminiTranscriber();

    // Simulates real Gemini native-audio inputTranscription chunks
    // Leading spaces in chunks mark word boundaries
    emitInputTranscription(transcriber, " Sound");
    emitInputTranscription(transcriber, "che");
    emitInputTranscription(transcriber, "ck,");
    emitInputTranscription(transcriber, " te");
    emitInputTranscription(transcriber, "sting");
    emitInputTranscription(transcriber, " the");
    emitInputTranscription(transcriber, " new");
    emitInputTranscription(transcriber, " Ge");
    emitInputTranscription(transcriber, "mini");
    emitInputTranscription(transcriber, " mode.");

    expect(transcriber.getTranscript()).toBe(
      "Soundcheck, testing the new Gemini mode."
    );
  });

  test("word-level inputTranscription chunks concatenate correctly", () => {
    const transcriber = new GeminiTranscriber();

    emitInputTranscription(transcriber, "Hello ");
    emitInputTranscription(transcriber, "world ");
    emitInputTranscription(transcriber, "how are you");

    expect(transcriber.getTranscript()).toBe("Hello world how are you");
  });

  test("turnComplete commits pending and starts fresh turn", () => {
    const transcriber = new GeminiTranscriber();

    emitInputTranscription(transcriber, " first");
    emitInputTranscription(transcriber, " sentence");
    emitTurnComplete(transcriber);

    expect(transcriber.getTranscript()).toBe("first sentence");

    // New turn with new text
    emitInputTranscription(transcriber, " second");
    emitInputTranscription(transcriber, " sentence");
    expect(transcriber.getTranscript()).toBe("first sentence second sentence");
  });

  test("multiple turns accumulate correctly", () => {
    const transcriber = new GeminiTranscriber();

    // Turn 1
    emitInputTranscription(transcriber, " Hello");
    emitInputTranscription(transcriber, " world");
    emitTurnComplete(transcriber);

    // Turn 2
    emitInputTranscription(transcriber, " How");
    emitInputTranscription(transcriber, " are");
    emitInputTranscription(transcriber, " you");
    emitTurnComplete(transcriber);

    expect(transcriber.getTranscript()).toBe("Hello world How are you");
  });

  test("finished flag on inputTranscription commits the turn", () => {
    const transcriber = new GeminiTranscriber();

    emitInputTranscription(transcriber, " first");
    emitInputTranscription(transcriber, " utterance", true);
    // After finished=true, the text is committed

    emitInputTranscription(transcriber, " second");
    emitInputTranscription(transcriber, " utterance");
    expect(transcriber.getTranscript()).toBe("first utterance second utterance");
  });

  test("model text is used as fallback when inputTranscription is absent", () => {
    const transcriber = new GeminiTranscriber();

    // No inputTranscription received — model text should be used
    emitModelText(transcriber, "Hello ");
    emitModelText(transcriber, "world");

    // Model text is concatenated directly (no space insertion)
    expect(transcriber.getTranscript()).toBe("Hello world");
  });

  test("model text is ignored once inputTranscription has been received", () => {
    const transcriber = new GeminiTranscriber();

    emitInputTranscription(transcriber, "Hello from ASR");
    emitModelText(transcriber, "This should be ignored");

    expect(transcriber.getTranscript()).toBe("Hello from ASR");
  });

  test("resetTranscript clears all state", () => {
    const transcriber = new GeminiTranscriber();

    emitInputTranscription(transcriber, " some text");
    emitTurnComplete(transcriber);
    emitInputTranscription(transcriber, " more text");

    transcriber.resetTranscript();
    expect(transcriber.getTranscript()).toBe("");
  });

  test("callbacks receive the full transcript on each update", () => {
    const transcriber = new GeminiTranscriber();
    const transcripts: Array<{ text: string; isFinal: boolean }> = [];

    transcriber.setCallbacks(
      (text, isFinal) => {
        transcripts.push({ text, isFinal });
      },
      () => {}
    );

    emitInputTranscription(transcriber, " Hello");
    emitInputTranscription(transcriber, " world");
    emitTurnComplete(transcriber);

    expect(transcripts).toEqual([
      { text: "Hello", isFinal: false },
      { text: "Hello world", isFinal: false },
      { text: "Hello world", isFinal: true },
    ]);
  });

  test("subword model text tokens concatenate without spaces (fallback path)", () => {
    const transcriber = new GeminiTranscriber();

    // Simulate BPE token-level chunks that the old code would break
    emitModelText(transcriber, "Let");
    emitModelText(transcriber, "'s");
    emitModelText(transcriber, " re");
    emitModelText(transcriber, "view");
    emitModelText(transcriber, " this");

    expect(transcriber.getTranscript()).toBe("Let's review this");
  });

  test("empty inputTranscription chunks are ignored", () => {
    const transcriber = new GeminiTranscriber();

    emitInputTranscription(transcriber, " Hello");
    emitInputTranscription(transcriber, "");
    emitInputTranscription(transcriber, " world");

    expect(transcriber.getTranscript()).toBe("Hello world");
  });
});
