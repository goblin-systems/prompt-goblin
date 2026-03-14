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
