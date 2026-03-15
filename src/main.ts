import { initApp } from "./app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  configureDebugLogging,
  debugLog,
  isDebugLoggingEnabled,
  openDebugLogFolder,
} from "./logger";
import { getCorrectionLabel, getCorrectionRuntime } from "./correction/service";
import {
  getMainDom,
  populateCorrectionModelOptions as renderCorrectionModelOptions,
  populateLiveModelOptions as renderLiveModelOptions,
  populateUI as renderUI,
  setCorrectionModelHint as renderCorrectionModelHint,
  setLiveModelHint as renderLiveModelHint,
  updateConnectionStatus as renderConnectionStatus,
  updateTranscriptCorrectionUI as renderTranscriptCorrectionUI,
  updateTypingModeHint as renderTypingModeHint,
  type ConnectionStatus,
  type MainDom,
} from "./main/dom";
import {
  correctionModelMessages,
  liveModelMessages,
  refreshModelList,
} from "./main/model-loader";
import { ApiKeyController } from "./main/api-key-controller";
import { setupMainEventBindings } from "./main/event-bindings";
import {
  getWaveToolButtonState,
  MicTestController,
  type InputDeviceInfo,
} from "./main/mic-test-controller";
import {
  formatRecordingLoudnessValue,
  getRecordingInputGain,
  SettingsController,
  type SettingsFormSnapshot,
} from "./main/settings-controller";
import {
  setupGlobalInteractionGuards,
  setupWindowAndModalControls,
} from "./main/window-controls";
import {
  getProviderModelCache,
  loadSettings,
  saveCorrectionProviderModelCache,
  saveProviderLastKnownGoodModel,
  saveProviderModelCache,
  type Settings,
  type SttProvider,
} from "./settings";
import { getProviderLabel, getProviderRuntime } from "./stt/service";
import {
  cycleWaveformColorScheme,
  cycleWaveformStyle,
  getWaveformColorSchemeLabel,
  getWaveformStyleLabel,
} from "./waveform-styles";

let currentSettings: Settings;
let saveStatusTimer: number | null = null;
let dom: MainDom;
let settingsController: SettingsController;
let micTestController: MicTestController;
let apiKeyController: ApiKeyController;

function getActiveProvider(): SttProvider {
  return dom.sttProviderSelect.value === "openai" ? "openai" : "gemini";
}

function getActiveProviderRuntime() {
  return getProviderRuntime(getActiveProvider());
}

function getActiveCorrectionRuntime() {
  return getCorrectionRuntime(getActiveProvider());
}

function getActiveCorrectionLabel(): string {
  return getCorrectionLabel(getActiveProvider());
}

function setCurrentSettings(settings: Settings) {
  currentSettings = settings;
  apiKeyController?.resetLastTestedApiKey();
}

function updateApiKeyTextForProvider() {
  const provider = getActiveProvider();
  const keySectionTitle = document.querySelector(
    ".settings-section .section-heading-row h2"
  ) as HTMLElement | null;
  if (keySectionTitle) {
    keySectionTitle.textContent = `${getProviderLabel(provider).toUpperCase()} API KEY`;
  }
  dom.apiKeyInput.placeholder = `Paste your ${getProviderLabel(provider)} API key...`;
}

function updateConnectionStatus(status: ConnectionStatus, message?: string) {
  renderConnectionStatus(dom, status, message);
}

function setLiveModelHint(text: string) {
  renderLiveModelHint(dom, text);
}

function populateLiveModelOptions(models: string[], preferredModel: string) {
  renderLiveModelOptions(dom, models, preferredModel);
}

function setCorrectionModelHint(text: string) {
  renderCorrectionModelHint(dom, text);
}

function populateCorrectionModelOptions(models: string[], preferredModel: string) {
  renderCorrectionModelOptions(dom, models, preferredModel);
}

function getSelectedTypingMode(): Settings["typingMode"] {
  return (
    Array.from(dom.typingModeRadios).find((radio) => radio.checked)?.value as
      | Settings["typingMode"]
      | undefined
  ) ?? "incremental";
}

function updateTranscriptCorrectionUI() {
  renderTranscriptCorrectionUI(
    dom,
    getSelectedTypingMode(),
    dom.transcriptCorrectionCheckbox.checked
  );
}

function updateTypingModeHint() {
  renderTypingModeHint(dom, getSelectedTypingMode());
}

function readFormSnapshot(): SettingsFormSnapshot {
  return {
    apiKey: dom.apiKeyInput.value,
    hotkey: dom.hotkeyInput.value,
    liveModel: dom.liveModelSelect.value,
    correctionModel: dom.correctionModelSelect.value,
    microphoneDeviceId: dom.microphoneSelect.value,
    recordingLoudnessPercent: dom.recordingLoudnessInput.value,
    debugLoggingEnabled: dom.debugLoggingCheckbox.checked,
    typingMode: getSelectedTypingMode(),
    transcriptCorrectionEnabled: dom.transcriptCorrectionCheckbox.checked,
    autoStopOnSilence: dom.autoStopCheckbox.checked,
    silenceTimeoutSeconds: dom.silenceTimeoutInput.value,
    language: dom.languageSelect.value,
    targetLanguage: dom.targetLanguageSelect.value,
  };
}

function updateRecordingLoudnessValue() {
  dom.recordingLoudnessValue.textContent = formatRecordingLoudnessValue(
    dom.recordingLoudnessInput.value
  );
}

function updateWaveToolButtons() {
  const state = getWaveToolButtonState(
    currentSettings.waveformEasterEggUnlocked,
    currentSettings.waveformStyle,
    currentSettings.waveformColorScheme,
    getWaveformStyleLabel,
    getWaveformColorSchemeLabel
  );
  dom.waveStyleBtn.hidden = state.waveStyleHidden;
  dom.waveColorBtn.hidden = state.waveColorHidden;
  dom.waveStyleBtn.title = state.waveStyleTitle;
  dom.waveStyleBtn.setAttribute("aria-label", state.waveStyleTitle);
  dom.waveColorBtn.title = state.waveColorTitle;
  dom.waveColorBtn.setAttribute("aria-label", state.waveColorTitle);
}

function populateUI(settings: Settings) {
  renderUI(dom, settings);
  updateRecordingLoudnessValue();
  updateTypingModeHint();
  updateWaveToolButtons();
  updateTranscriptCorrectionUI();
}

function updateDebugLogHint() {
  if (!isDebugLoggingEnabled()) {
    dom.debugLogPath.textContent = "Debug logs are disabled.";
    dom.openDebugFolderBtn.disabled = true;
    return;
  }

  dom.debugLogPath.textContent = "Debug logs are enabled.";
  dom.openDebugFolderBtn.disabled = false;
}

function showSaveStatus(message: string, isError = false, durationMs?: number) {
  if (saveStatusTimer !== null) {
    window.clearTimeout(saveStatusTimer);
  }

  dom.appToast.textContent = message;
  dom.appToast.classList.remove("error", "success");
  dom.appToast.classList.add(isError ? "error" : "success", "visible");

  saveStatusTimer = window.setTimeout(() => {
    dom.appToast.classList.remove("visible", "error", "success");
    saveStatusTimer = null;
  }, durationMs ?? (isError ? 3000 : 1500));
}

async function refreshLiveModelList(forceApiRefresh: boolean) {
  const provider = getActiveProvider();
  await refreshModelList({
    provider,
    providerLabel: getProviderLabel(provider),
    apiKey: dom.apiKeyInput.value.trim(),
    forceApiRefresh,
    fetchModels: (apiKey) => getActiveProviderRuntime().fetchModels(apiKey),
    getCache: () => getProviderModelCache(currentSettings, provider),
    getSelectedModel: () => currentSettings.providers[provider].selectedModel,
    getLastKnownGoodModel: () => currentSettings.providers[provider].lastKnownGoodModel,
    setSelectedModel: (model) => {
      currentSettings.providers[provider].selectedModel = model;
      dom.liveModelSelect.value = model;
    },
    saveCache: async (nextProvider, cache) => {
      currentSettings.providers[nextProvider].modelCache = cache;
      await saveProviderModelCache(nextProvider, cache);
    },
    populateOptions: populateLiveModelOptions,
    setHint: setLiveModelHint,
    setRefreshDisabled: (disabled) => {
      dom.refreshModelsBtn.disabled = disabled;
    },
    log: debugLog,
    messages: liveModelMessages,
  });
}

async function refreshCorrectionModelList(forceApiRefresh: boolean) {
  const provider = getActiveProvider();
  await refreshModelList({
    provider,
    providerLabel: getActiveCorrectionLabel(),
    apiKey: dom.apiKeyInput.value.trim(),
    forceApiRefresh,
    fetchModels: (apiKey) => getActiveCorrectionRuntime().fetchModels(apiKey),
    getCache: () => currentSettings.transcriptionCorrection.providers[provider].modelCache,
    getSelectedModel: () => currentSettings.transcriptionCorrection.providers[provider].selectedModel,
    getLastKnownGoodModel: () =>
      currentSettings.transcriptionCorrection.providers[provider].lastKnownGoodModel,
    setSelectedModel: (model) => {
      currentSettings.transcriptionCorrection.providers[provider].selectedModel = model;
      dom.correctionModelSelect.value = model;
    },
    saveCache: async (nextProvider, cache) => {
      currentSettings.transcriptionCorrection.providers[nextProvider].modelCache = cache;
      await saveCorrectionProviderModelCache(nextProvider, cache);
    },
    populateOptions: populateCorrectionModelOptions,
    setHint: setCorrectionModelHint,
    setRefreshDisabled: (disabled) => {
      dom.refreshCorrectionModelsBtn.disabled = disabled;
    },
    onAfterUpdate: updateTranscriptCorrectionUI,
    log: debugLog,
    messages: correctionModelMessages,
  });
}

async function refreshMicrophoneList(preferredDeviceId: string) {
  try {
    const devices = await invoke<InputDeviceInfo[]>("list_input_devices");
    micTestController.populateMicrophoneOptions(devices, preferredDeviceId);
  } catch (err) {
    console.error("Failed to list input devices:", err);
    micTestController.populateDefaultMicrophoneOption();
  }
}

async function openDebugFolder() {
  try {
    await openDebugLogFolder();
  } catch (err) {
    console.error("Failed to open debug logs folder:", err);
    debugLog(`Failed to open debug logs folder: ${String(err)}`, "ERROR");
    dom.debugLogPath.textContent = "Could not open debug logs folder.";
  }
}

function unlockWaveformEasterEgg(): boolean {
  const firstUnlock = !currentSettings.waveformEasterEggUnlocked;
  if (firstUnlock) {
    currentSettings.waveformEasterEggUnlocked = true;
    settingsController.setNextAutosaveStatus({
      message: "Goblin: Well look at that -- clever little snooper!",
      durationMs: 2600,
    });
  }
  return firstUnlock;
}

function cycleCurrentWaveformStyle() {
  currentSettings.waveformStyle = cycleWaveformStyle(currentSettings.waveformStyle);
}

function cycleCurrentWaveformColorScheme() {
  currentSettings.waveformColorScheme = cycleWaveformColorScheme(
    currentSettings.waveformColorScheme
  );
}

async function restartMicTestIfNeeded() {
  if (!micTestController.isActive()) {
    return;
  }

  const activeMode = micTestController.getMode();
  if (activeMode) {
    await micTestController.restartWithMode(activeMode);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  dom = getMainDom(document);
  micTestController = new MicTestController({
    dom,
    getCurrentSettings: () => currentSettings,
    getActiveProvider,
    getRecordingInputGain: () => getRecordingInputGain(dom.recordingLoudnessInput.value),
    debugLog,
  });
  settingsController = new SettingsController({
    getCurrentSettings: () => currentSettings,
    setCurrentSettings,
    getActiveProvider,
    readForm: readFormSnapshot,
    applySettingsToUI: populateUI,
    updateApiKeyTextForProvider,
    setLiveModelHint,
    setCorrectionModelHint,
    updateConnectionStatus: (status) => updateConnectionStatus(status),
    setTestApiKeyEnabled: (enabled) => {
      dom.testApiKeyBtn.disabled = !enabled;
    },
    configureDebugLogging,
    updateDebugLogHint,
    showSaveStatus,
  });
  apiKeyController = new ApiKeyController({
    dom,
    getCurrentSettings: () => currentSettings,
    getActiveProvider,
    getActiveProviderRuntime,
    refreshLiveModelList,
    refreshCorrectionModelList,
    updateApiKeyTextForProvider,
    updateConnectionStatus,
    updateTranscriptCorrectionUI,
    setLiveModelHint,
    setCorrectionModelHint,
    populateLiveModelOptions,
    populateCorrectionModelOptions,
    scheduleAutosave: (delayMs) => settingsController.scheduleAutosave(delayMs),
    debugLog,
    saveLastKnownGoodModel: saveProviderLastKnownGoodModel,
  });

  setCurrentSettings(await loadSettings());
  populateUI(currentSettings);
  updateApiKeyTextForProvider();
  await refreshLiveModelList(false);
  await refreshCorrectionModelList(false);
  await refreshMicrophoneList(currentSettings.microphoneDeviceId);
  await configureDebugLogging(currentSettings.debugLoggingEnabled);
  updateDebugLogHint();
  micTestController.setupWave();
  setupGlobalInteractionGuards();
  setupWindowAndModalControls({
    dom,
    onBeforeUnload: () => {
      settingsController.cancelAutosave();
      micTestController.cleanup();
      invoke("stop_mic_monitoring").catch(() => {
        // ignore cleanup failures
      });
    },
  });
  setupMainEventBindings({
    dom,
    apiKeyController,
    micTestController,
    settingsController,
    updateTypingModeHint,
    updateTranscriptCorrectionUI,
    updateRecordingLoudnessValue,
    updateWaveToolButtons,
    refreshLiveModelList,
    refreshCorrectionModelList,
    refreshMicrophoneList,
    handleResetDefaults: async () => settingsController.resetToDefaults(),
    handleOpenDebugFolder: openDebugFolder,
    cycleWaveformStyle: cycleCurrentWaveformStyle,
    cycleWaveformColorScheme: cycleCurrentWaveformColorScheme,
    unlockWaveformEasterEgg,
    restartMicTestIfNeeded,
  });
  await initApp();

  apiKeyController.syncConnectionStatusFromSettings();

  await listen<{ status: ConnectionStatus; message?: string }>("stt-status", (event) => {
    updateConnectionStatus(event.payload.status, event.payload.message);
  });

  await listen<{ rms: number }>("mic-level", (event) => {
    micTestController.handleMicLevel(event.payload.rms);
  });

  await listen<{ monitoring: boolean }>("mic-monitoring-status", (event) => {
    micTestController.handleMonitoringStatus(event.payload.monitoring);
  });
});
