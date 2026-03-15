import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openaiProvider } from "../src/stt/providers/openai";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readonly protocols: string[];
  readyState = MockWebSocket.CONNECTING;
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(event?: any) => void>>();

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = String(url);
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event?: any) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", {});
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", {});
  }

  emitMessage(payload: unknown) {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  emitError(message = "socket error") {
    this.emit("error", { message });
  }

  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function lastSocket(): MockWebSocket {
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (!socket) {
    throw new Error("Expected a WebSocket instance");
  }
  return socket;
}

describe("openai provider", () => {
  let requestedTranscriptionModels: string[] = [];

  beforeEach(() => {
    requestedTranscriptionModels = [];
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o-mini-transcribe" },
              { id: "gpt-4o-transcribe" },
              { id: "whisper-1" },
              { id: "gpt-4o-mini" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.endsWith("/realtime/transcription_sessions")) {
        return new Response(
          JSON.stringify({
            client_secret: { value: "client-secret-123" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.endsWith("/audio/transcriptions")) {
        const form = init?.body;
        if (form instanceof FormData) {
          const modelValue = form.get("model");
          if (typeof modelValue === "string") {
            requestedTranscriptionModels.push(modelValue);
          }
        }

        return new Response(JSON.stringify({ text: "hello goblin" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: { message: "not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  });

  test("fetchModels keeps supported transcription models in priority order", async () => {
    const models = await openaiProvider.fetchModels("test-key");
    expect(models).toEqual(["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"]);
  });

  test("transcribeWavBase64 returns transcript text", async () => {
    const transcript = await openaiProvider.transcribeWavBase64(
      "test-key",
      "AAAA",
      "en",
      "gpt-4o-mini-transcribe"
    );
    expect(transcript).toBe("hello goblin");
    expect(requestedTranscriptionModels).toEqual(["gpt-4o-mini-transcribe"]);
  });

  test("realtime connect falls back when the preferred model errors", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/realtime/transcription_sessions")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { input_audio_transcription?: { model?: string } };
        if (body.input_audio_transcription?.model === "missing-transcribe") {
          return new Response(JSON.stringify({ error: { message: "model not available" } }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ client_secret: { value: "client-secret-123" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o-mini-transcribe" },
              { id: "gpt-4o-transcribe" },
              { id: "whisper-1" },
              { id: "gpt-4o-mini" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.endsWith("/audio/transcriptions")) {
        return new Response(JSON.stringify({ text: "hello goblin" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: { message: "not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const transcriber = openaiProvider.createLiveTranscriber();
    transcriber.configure({ apiKey: "test-key", preferredModel: "missing-transcribe", fallbackModels: ["gpt-4o-mini-transcribe"] });
    transcriber.setCallbacks(() => {}, () => {});

    const connectPromise = transcriber.connect();
    await nextTick();
    const secondSocket = lastSocket();
    secondSocket.emitOpen();
    secondSocket.emitMessage({
      type: "transcription_session.created",
      session: {
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      },
    });

    await connectPromise;
    expect(transcriber.getActiveModel()).toBe("gpt-4o-mini-transcribe");
  });

  test("waitForPendingTurnSettle commits audio and waits for completed item", async () => {
    const transcripts: Array<{ text: string; isFinal: boolean }> = [];
    const transcriber = openaiProvider.createLiveTranscriber();
    transcriber.configure({
      apiKey: "test-key",
      preferredModel: "gpt-4o-mini-transcribe",
    });
    transcriber.setCallbacks((text, isFinal) => {
      transcripts.push({ text, isFinal });
    }, () => {});

    const connectPromise = transcriber.connect();
    await nextTick();
    const socket = lastSocket();
    socket.emitOpen();
    socket.emitMessage({
      type: "transcription_session.created",
      session: {
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      },
    });
    await connectPromise;

    transcriber.sendAudio("AAAA");
    const settlePromise = transcriber.waitForPendingTurnSettle(1000);

    expect(socket.sent.some((event) => (event as { type?: string }).type === "input_audio_buffer.append")).toBe(true);
    expect(socket.sent.some((event) => (event as { type?: string }).type === "input_audio_buffer.commit")).toBe(true);

    socket.emitMessage({
      type: "input_audio_buffer.committed",
      item_id: "item-1",
      previous_item_id: null,
    });
    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-1",
      delta: "Hello ",
    });
    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-1",
      delta: "world",
    });
    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-1",
      transcript: "Hello world",
    });

    await settlePromise;
    expect(transcriber.getTranscript()).toBe("Hello world");
    expect(transcripts[transcripts.length - 1]).toEqual({ text: "Hello world", isFinal: true });
  });

  test("realtime transcript preserves commit order even if completed events arrive later", async () => {
    const transcriber = openaiProvider.createLiveTranscriber();
    transcriber.configure({
      apiKey: "test-key",
      preferredModel: "gpt-4o-mini-transcribe",
    });
    transcriber.setCallbacks(() => {}, () => {});

    const connectPromise = transcriber.connect();
    await nextTick();
    const socket = lastSocket();
    socket.emitOpen();
    socket.emitMessage({
      type: "transcription_session.created",
      session: {
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      },
    });
    await connectPromise;

    transcriber.sendAudio("AAAA");
    transcriber.signalAudioStreamBoundary("first");
    socket.emitMessage({
      type: "input_audio_buffer.committed",
      item_id: "item-1",
      previous_item_id: null,
    });

    transcriber.sendAudio("BBBB");
    transcriber.signalAudioStreamBoundary("second");
    socket.emitMessage({
      type: "input_audio_buffer.committed",
      item_id: "item-2",
      previous_item_id: "item-1",
    });

    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-2",
      transcript: "second sentence",
    });
    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-1",
      transcript: "first sentence",
    });

    expect(transcriber.getTranscript()).toBe("first sentence second sentence");
  });

  test("duplicate completed items are not appended twice", async () => {
    const transcriber = openaiProvider.createLiveTranscriber();
    transcriber.configure({
      apiKey: "test-key",
      preferredModel: "gpt-4o-mini-transcribe",
    });
    transcriber.setCallbacks(() => {}, () => {});

    const connectPromise = transcriber.connect();
    await nextTick();
    const socket = lastSocket();
    socket.emitOpen();
    socket.emitMessage({
      type: "transcription_session.created",
      session: {
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      },
    });
    await connectPromise;

    socket.emitMessage({
      type: "input_audio_buffer.committed",
      item_id: "item-1",
      previous_item_id: null,
    });
    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-1",
      transcript: "Red fox jumps over the lazy dog.",
    });

    socket.emitMessage({
      type: "input_audio_buffer.committed",
      item_id: "item-2",
      previous_item_id: "item-1",
    });
    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-2",
      transcript: "Red fox jumps over the lazy dog.",
    });

    expect(transcriber.getTranscript()).toBe("Red fox jumps over the lazy dog.");
  });

  test("transcribeWithLivePipeline streams PCM over realtime and returns joined transcript", async () => {
    const pipelinePromise = openaiProvider.transcribeWithLivePipeline({
      apiKey: "test-key",
      preferredModel: "gpt-4o-mini-transcribe",
      pcmChunksBase64: ["AAAA", "BBBB"],
      settleDelayMs: 0,
      chunkIntervalMs: 0,
    });

    await nextTick();
    const socket = lastSocket();
    socket.emitOpen();
    socket.emitMessage({
      type: "transcription_session.created",
      session: {
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      },
    });

    await Promise.resolve();
    socket.emitMessage({
      type: "input_audio_buffer.committed",
      item_id: "item-1",
      previous_item_id: null,
    });
    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-1",
      transcript: "hello goblin",
    });

    await expect(pipelinePromise).resolves.toBe("hello goblin");
    expect(socket.sent.filter((event) => (event as { type?: string }).type === "input_audio_buffer.append")).toHaveLength(2);
  });

  test("live pipeline fails when model is missing", async () => {
    await expect(
      openaiProvider.transcribeWithLivePipeline({
        apiKey: "test-key",
        pcmChunksBase64: ["AAAA"],
        settleDelayMs: 0,
        chunkIntervalMs: 0,
      })
    ).rejects.toThrow("No model selected");
  });
});
