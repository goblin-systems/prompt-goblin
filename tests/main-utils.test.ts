import { describe, expect, test } from "bun:test";
import {
  base64ToBytes,
  bytesToBase64,
  fingerprintApiKey,
  normalizeHotkey,
  resampleMono,
} from "../src/main/utils";

describe("main utils", () => {
  test("normalizeHotkey strips spaces and keeps value", () => {
    expect(normalizeHotkey(" Ctrl + Shift + K ")).toBe("Ctrl+Shift+K");
  });

  test("normalizeHotkey falls back when empty", () => {
    expect(normalizeHotkey("   ")).toBe("Alt+G");
  });

  test("fingerprintApiKey is deterministic", () => {
    const first = fingerprintApiKey("AIza-test-key");
    const second = fingerprintApiKey("AIza-test-key");
    const different = fingerprintApiKey("AIza-other-key");

    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });

  test("base64 and bytes round-trip", () => {
    const input = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const base64 = bytesToBase64(input);
    const output = base64ToBytes(base64);

    expect(Array.from(output)).toEqual(Array.from(input));
  });

  test("resampleMono returns same array for same rate", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const output = resampleMono(samples, 16000, 16000);
    expect(output).toBe(samples);
  });

  test("resampleMono downsamples with interpolation", () => {
    const samples = new Float32Array([0, 1, 0, -1]);
    const output = resampleMono(samples, 4, 2);
    expect(Array.from(output)).toEqual([0, 0]);
  });
});
