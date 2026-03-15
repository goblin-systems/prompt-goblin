import { describe, expect, test } from "bun:test";
import { getDefaultSettings } from "../src/settings";
import {
  buildSettingsFromForm,
  formatRecordingLoudnessValue,
  getRecordingInputGain,
  type SettingsFormSnapshot,
} from "../src/main/settings-controller";

function createForm(overrides: Partial<SettingsFormSnapshot> = {}): SettingsFormSnapshot {
  return {
    apiKey: "  new-key  ",
    hotkey: " Ctrl + Shift + K ",
    liveModel: "live-next",
    correctionModel: "correct-next",
    microphoneDeviceId: "mic-2",
    recordingLoudnessPercent: "175",
    debugLoggingEnabled: true,
    typingMode: "all_at_once",
    transcriptCorrectionEnabled: true,
    autoStopOnSilence: false,
    silenceTimeoutSeconds: "5.5",
    language: "en",
    targetLanguage: "de",
    ...overrides,
  };
}

describe("settings controller helpers", () => {
  test("buildSettingsFromForm updates active provider settings and preserves others", () => {
    const currentSettings = getDefaultSettings();
    currentSettings.sttProvider = "gemini";
    currentSettings.providers.openai.apiKey = "keep-openai";
    currentSettings.providers.gemini.selectedModel = "live-old";
    currentSettings.transcriptionCorrection.providers.gemini.selectedModel = "correct-old";

    const nextSettings = buildSettingsFromForm(currentSettings, "gemini", createForm());

    expect(nextSettings.hotkey).toBe("Ctrl+Shift+K");
    expect(nextSettings.providers.gemini.apiKey).toBe("new-key");
    expect(nextSettings.providers.gemini.selectedModel).toBe("live-next");
    expect(nextSettings.transcriptionCorrection.providers.gemini.selectedModel).toBe(
      "correct-next"
    );
    expect(nextSettings.providers.openai.apiKey).toBe("keep-openai");
    expect(nextSettings.recordingLoudness).toBe(175);
    expect(nextSettings.autoStopSilenceMs).toBe(5500);
  });

  test("buildSettingsFromForm falls back to current values for invalid numeric input", () => {
    const currentSettings = getDefaultSettings();
    currentSettings.recordingLoudness = 140;
    currentSettings.autoStopSilenceMs = 3200;

    const nextSettings = buildSettingsFromForm(
      currentSettings,
      "gemini",
      createForm({ recordingLoudnessPercent: "999", silenceTimeoutSeconds: "0" })
    );

    expect(nextSettings.recordingLoudness).toBe(140);
    expect(nextSettings.autoStopSilenceMs).toBe(3200);
  });

  test("formatRecordingLoudnessValue and getRecordingInputGain normalize display and gain", () => {
    expect(formatRecordingLoudnessValue("149.6")).toBe("150%");
    expect(formatRecordingLoudnessValue("not-a-number")).toBe("100%");
    expect(getRecordingInputGain("250")).toBe(2.5);
    expect(getRecordingInputGain("999")).toBe(3);
    expect(getRecordingInputGain("1")).toBe(0.25);
    expect(getRecordingInputGain("bad")).toBe(1);
  });
});
