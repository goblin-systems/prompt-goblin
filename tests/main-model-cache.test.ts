import { describe, expect, test } from "bun:test";
import { isModelCacheFresh, selectPreferredModel } from "../src/main/model-cache";
import type { Settings } from "../src/settings";

function createSettings(): Settings {
  return {
    geminiApiKey: "",
    hotkey: "Alt+G",
    microphoneDeviceId: "default",
    selectedLiveModel: "",
    lastKnownGoodLiveModel: "",
    modelCache: null,
    debugLoggingEnabled: false,
    typingMode: "incremental",
    autoStopOnSilence: true,
    autoStopSilenceMs: 4000,
    language: "auto",
  };
}

describe("model cache helpers", () => {
  test("isModelCacheFresh returns false when cache is missing", () => {
    const settings = createSettings();
    expect(isModelCacheFresh(settings, "abc", 1_000_000)).toBe(false);
  });

  test("isModelCacheFresh checks fingerprint and ttl", () => {
    const settings = createSettings();
    settings.modelCache = {
      apiKeyFingerprint: "fp-1",
      fetchedAt: 1_000,
      models: ["gemini-live-1"],
    };

    expect(isModelCacheFresh(settings, "fp-1", 2_000, 10_000)).toBe(true);
    expect(isModelCacheFresh(settings, "fp-2", 2_000, 10_000)).toBe(false);
    expect(isModelCacheFresh(settings, "fp-1", 20_000, 10_000)).toBe(false);
  });

  test("selectPreferredModel prefers selected model first", () => {
    const models = ["a", "b", "c"];
    expect(selectPreferredModel(models, "b", "c")).toBe("b");
  });

  test("selectPreferredModel falls back to last known good model", () => {
    const models = ["a", "b", "c"];
    expect(selectPreferredModel(models, "", "c")).toBe("c");
  });

  test("selectPreferredModel falls back to first model", () => {
    const models = ["a", "b", "c"];
    expect(selectPreferredModel(models, "x", "y")).toBe("a");
  });
});
