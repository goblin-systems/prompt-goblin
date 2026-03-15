import {
  saveCorrectionProviderLastKnownGoodModel,
  saveCorrectionProviderModelCache,
  getDefaultSettings,
  getProviderApiKey as getProviderApiKeyFromSettings,
  getProviderLastKnownGoodModel,
  getProviderModelCache,
  getProviderSelectedModel,
  loadSettings,
  saveProviderLastKnownGoodModel,
  saveProviderModelCache,
  saveSettings,
  type SttProvider,
  type Settings,
} from "./settings";
import { initApp, reloadSettings } from "./app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  configureDebugLogging,
  debugLog,
  isDebugLoggingEnabled,
  openDebugLogFolder,
} from "./logger";
import {
  getProviderLabel,
  getProviderRuntime,
} from "./stt/service";
import {
  getCorrectionFallbackModels,
  getCorrectionLabel,
  getCorrectionRuntime,
  getCorrectionSelectedModel,
  isTranscriptionCorrectionEnabled,
} from "./correction/service";
import {
  populateCorrectionModelOptions as renderCorrectionModelOptions,
  getMainDom,
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
import { LiveAudioSession } from "./live-audio-session";
import {
  MODEL_CACHE_TTL_MS,
  isModelCacheFresh,
  selectPreferredModel,
} from "./main/model-cache";
import { base64ToBytes, fingerprintApiKey, normalizeHotkey } from "./main/utils";
import {
  createWaveProgressGradient,
  cycleWaveformColorScheme,
  cycleWaveformStyle,
  drawWaveform,
  getWaveformColorSchemeLabel,
  getWaveformStyleLabel,
} from "./waveform-styles";

// ── DOM Elements ────────────────────────────────────────────

let apiKeyInput: HTMLInputElement;
let sttProviderSelect: HTMLSelectElement;
let hotkeyInput: HTMLInputElement;
let liveModelSelect: HTMLSelectElement;
let refreshModelsBtn: HTMLButtonElement;
let liveModelHint: HTMLElement;
let microphoneSelect: HTMLSelectElement;
let recordingLoudnessInput: HTMLInputElement;
let recordingLoudnessValue: HTMLElement;
let refreshMicrophonesBtn: HTMLButtonElement;
let micTestBtn: HTMLButtonElement;
let continuousMicTestBtn: HTMLButtonElement;
let waveStyleBtn: HTMLButtonElement;
let waveColorBtn: HTMLButtonElement;
let micTestStatus: HTMLElement;
let micTestTranscript: HTMLElement;
let micSignalIndicator: HTMLElement;
let micWaveCanvas: HTMLCanvasElement;
let debugLoggingCheckbox: HTMLInputElement;
let openDebugFolderBtn: HTMLButtonElement;
let debugLogPath: HTMLElement;
let toggleKeyBtn: HTMLButtonElement;
let apiKeyHelpBtn: HTMLButtonElement;
let apiKeyHelpModal: HTMLElement;
let closeApiKeyHelpBtn: HTMLButtonElement;
let connectionStatus: HTMLElement;
let testApiKeyBtn: HTMLButtonElement;
let typingModeRadios: NodeListOf<HTMLInputElement>;
let typingModeHint: HTMLElement;
let transcriptCorrectionCheckbox: HTMLInputElement;
let transcriptCorrectionHint: HTMLElement;
let transcriptCorrectionControls: HTMLElement;
let correctionModelSelect: HTMLSelectElement;
let refreshCorrectionModelsBtn: HTMLButtonElement;
let correctionModelHint: HTMLElement;
let autoStopCheckbox: HTMLInputElement;
let silenceTimeoutField: HTMLElement;
let silenceTimeoutInput: HTMLInputElement;
let languageSelect: HTMLSelectElement;
let targetLanguageSelect: HTMLSelectElement;
let resetDefaultsBtn: HTMLButtonElement;
let appToast: HTMLElement;
let windowMinimizeBtn: HTMLButtonElement | null;
let windowCloseBtn: HTMLButtonElement;
let dom: MainDom;

let currentSettings: Settings;
let lastTestedApiKey = "";

interface InputDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

let micTestActive = false;
let micTestStartedAt = 0;
let micTestAutoStopTimer: number | null = null;
let micTestStopInProgress = false;
let currentMicTestMode: "timed" | "continuous" | null = null;
let micTestSession: LiveAudioSession<string | null> | null = null;
let targetMicLevel = 0;
let displayedMicLevel = 0;
let micPhase = 0;
let micWaveRaf = 0;
let micTestPlaybackActive = false;
let lastMicTestPlaybackUrl: string | null = null;
let lastMicTestAudio: HTMLAudioElement | null = null;
const MIC_ACTIVITY_RMS_THRESHOLD = 0.01;
const MIC_TEST_DURATION_MS = 5000;
const AUTOSAVE_DEBOUNCE_MS = 450;

function getActiveProvider(): SttProvider {
  return sttProviderSelect.value === "openai" ? "openai" : "gemini";
}

function getActiveProviderRuntime() {
  return getProviderRuntime(getActiveProvider());
}

function getActiveCorrectionRuntime() {
  return getCorrectionRuntime(getActiveProvider());
}

function getActiveProviderLabel(): string {
  return getProviderLabel(getActiveProvider());
}

function getActiveCorrectionLabel(): string {
  return getCorrectionLabel(getActiveProvider());
}

function updateApiKeyTextForProvider() {
  const provider = getActiveProvider();
  const keySectionTitle = document.querySelector(
    ".settings-section .section-heading-row h2"
  ) as HTMLElement | null;
  if (keySectionTitle) {
    keySectionTitle.textContent = `${getProviderLabel(provider).toUpperCase()} API KEY`;
  }
  apiKeyInput.placeholder = `Paste your ${getProviderLabel(provider)} API key...`;
}

let autosaveTimer: number | null = null;
let saveStatusTimer: number | null = null;
let saveInFlight = false;
let savePending = false;
let nextAutosaveStatus:
  | {
      message: string;
      durationMs?: number;
    }
  | null = null;

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  dom = getMainDom(document);
  ({
    apiKeyInput,
    sttProviderSelect,
    hotkeyInput,
    liveModelSelect,
    refreshModelsBtn,
    liveModelHint,
    microphoneSelect,
    recordingLoudnessInput,
    recordingLoudnessValue,
    refreshMicrophonesBtn,
    micTestBtn,
    continuousMicTestBtn,
    waveStyleBtn,
    waveColorBtn,
    micTestStatus,
    micTestTranscript,
    micSignalIndicator,
    micWaveCanvas,
    debugLoggingCheckbox,
    openDebugFolderBtn,
    debugLogPath,
    toggleKeyBtn,
    apiKeyHelpBtn,
    apiKeyHelpModal,
    closeApiKeyHelpBtn,
    connectionStatus,
    testApiKeyBtn,
    typingModeRadios,
    typingModeHint,
    transcriptCorrectionCheckbox,
    transcriptCorrectionHint,
    transcriptCorrectionControls,
    correctionModelSelect,
    refreshCorrectionModelsBtn,
    correctionModelHint,
    autoStopCheckbox,
    silenceTimeoutField,
    silenceTimeoutInput,
    languageSelect,
    targetLanguageSelect,
    resetDefaultsBtn,
    appToast,
    windowMinimizeBtn,
    windowCloseBtn,
  } = dom);

  // Load settings
  currentSettings = await loadSettings();
  populateUI(currentSettings);
  updateApiKeyTextForProvider();
  await refreshLiveModelList(false);
  await refreshCorrectionModelList(false);
  await refreshMicrophoneList(currentSettings.microphoneDeviceId);
  await configureDebugLogging(currentSettings.debugLoggingEnabled);
  updateDebugLogHint();
  setupMicWave();

  // Set up event listeners
  setupEventListeners();

  // Initialize the app (hotkey, audio listener, etc.)
  await initApp();

  // Update status based on API key
  updateConnectionStatus(
    getProviderApiKeyFromSettings(currentSettings, currentSettings.sttProvider)
      ? "untested"
      : "disconnected"
  );
  testApiKeyBtn.disabled = !getProviderApiKeyFromSettings(currentSettings, currentSettings.sttProvider);

  // Listen for status updates from the app
  await listen<{ status: string; message?: string; provider?: SttProvider }>(
    "stt-status",
    (event) => {
      updateConnectionStatus(
        event.payload.status as
          | "connected"
          | "disconnected"
          | "error"
          | "connecting",
        event.payload.message
      );
    }
  );

  await listen<{ rms: number }>("mic-level", (event) => {
    const rms = event.payload.rms;
    const receivingAudio = rms >= MIC_ACTIVITY_RMS_THRESHOLD;
    targetMicLevel = receivingAudio ? Math.min(1, rms * 14) : 0;
    if (micTestActive) {
      micTestStatus.textContent = receivingAudio
        ? "Receiving audio"
        : currentMicTestMode === "continuous"
          ? "Listening until stopped..."
          : "Listening...";
      setMicSignalState(receivingAudio, true);
    }
  });

  await listen<{ monitoring: boolean }>("mic-monitoring-status", (event) => {
    micTestActive = event.payload.monitoring;
    if (!micTestActive) {
      clearMicTestAutoStop();
      micTestStartedAt = 0;
      targetMicLevel = 0;
      if (!micTestStopInProgress) {
        currentMicTestMode = null;
        micTestStatus.textContent = "Idle";
      }
      setMicSignalState(false, false);
    } else {
      if (!micTestStartedAt) {
        micTestStartedAt = Date.now();
      }
      micTestStatus.textContent =
        currentMicTestMode === "continuous" ? "Listening until stopped..." : "Listening...";
      setMicSignalState(false, true);
    }
    updateMicTestButton();
  });

  window.addEventListener("beforeunload", () => {
    clearMicTestAutoStop();
    if (micWaveRaf) {
      cancelAnimationFrame(micWaveRaf);
    }
    cleanupMicTestPlayback();
    invoke("stop_mic_monitoring").catch(() => {
      // ignore cleanup failures
    });
  });
});

function populateUI(settings: Settings) {
  renderUI(dom, settings);
  updateRecordingLoudnessValue();
  updateWaveToolButtons();
  updateTranscriptCorrectionUI();
}

function updateWaveToolButtons() {
  const unlocked = currentSettings.waveformEasterEggUnlocked;
  waveStyleBtn.hidden = !unlocked;
  waveColorBtn.hidden = !unlocked;
  waveStyleBtn.title = `Wave style: ${getWaveformStyleLabel(currentSettings.waveformStyle)}`;
  waveStyleBtn.setAttribute("aria-label", waveStyleBtn.title);
  waveColorBtn.title = `Wave colors: ${getWaveformColorSchemeLabel(currentSettings.waveformColorScheme)}`;
  waveColorBtn.setAttribute("aria-label", waveColorBtn.title);
}

function setupEventListeners() {
  // Toggle API key visibility
  toggleKeyBtn.addEventListener("click", () => {
    const isPassword = apiKeyInput.type === "password";
    apiKeyInput.type = isPassword ? "text" : "password";
  });

  apiKeyHelpBtn.addEventListener("click", () => {
    openApiKeyHelpModal();
  });

  closeApiKeyHelpBtn.addEventListener("click", () => {
    closeApiKeyHelpModal();
  });

  if (windowMinimizeBtn) {
    windowMinimizeBtn.addEventListener("click", async () => {
      try {
        await getCurrentWindow().minimize();
      } catch (err) {
        console.error("Failed to minimize window:", err);
      }
    });
  }

  windowCloseBtn.addEventListener("click", async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error("Failed to close window:", err);
    }
  });

  apiKeyHelpModal.addEventListener("click", (event) => {
    if (event.target === apiKeyHelpModal) {
      closeApiKeyHelpModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !apiKeyHelpModal.hasAttribute("hidden")) {
      closeApiKeyHelpModal();
    }
  });

  sttProviderSelect.addEventListener("change", async () => {
    currentSettings.sttProvider = getActiveProvider();
    const providerSettings = currentSettings.providers[currentSettings.sttProvider];
    apiKeyInput.value = providerSettings.apiKey;
    updateApiKeyTextForProvider();
    updateConnectionStatus(providerSettings.apiKey ? "untested" : "disconnected");
    testApiKeyBtn.disabled = !providerSettings.apiKey;
    await refreshLiveModelList(false);
    await refreshCorrectionModelList(false);
    updateTranscriptCorrectionUI();
    scheduleAutosave(0);
  });

  // Typing mode change
  typingModeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      updateTypingModeHint(radio.value);
      updateTranscriptCorrectionUI();
      scheduleAutosave(0);
    });
  });

  transcriptCorrectionCheckbox.addEventListener("change", () => {
    updateTranscriptCorrectionUI();
    scheduleAutosave(0);
  });

  // Auto-stop toggle
  autoStopCheckbox.addEventListener("change", () => {
    silenceTimeoutField.style.display = autoStopCheckbox.checked
      ? "flex"
      : "none";
    scheduleAutosave(0);
  });

  resetDefaultsBtn.addEventListener("click", async () => {
    await handleResetToDefaults();
  });

  testApiKeyBtn.addEventListener("click", async () => {
    await handleApiKeyTest();
  });

  refreshModelsBtn.addEventListener("click", async () => {
    await refreshLiveModelList(true);
  });

  refreshCorrectionModelsBtn.addEventListener("click", async () => {
    await refreshCorrectionModelList(true);
  });

  liveModelSelect.addEventListener("change", () => {
    if (apiKeyInput.value.trim() !== lastTestedApiKey) {
      updateConnectionStatus("untested");
    }
    scheduleAutosave(0);
  });

  correctionModelSelect.addEventListener("change", () => {
    scheduleAutosave(0);
  });

  apiKeyInput.addEventListener("input", () => {
    const provider = getActiveProvider();
    const apiKey = apiKeyInput.value.trim();
    testApiKeyBtn.disabled = !apiKey;

    if (!apiKey) {
      lastTestedApiKey = "";
      updateConnectionStatus("disconnected");
      populateLiveModelOptions([], "");
      setLiveModelHint("Enter API key to fetch models.");
      populateCorrectionModelOptions([], "");
      setCorrectionModelHint("Enter API key to fetch correction models.");
      updateTranscriptCorrectionUI();
      scheduleAutosave();
      return;
    }

    if (apiKey !== lastTestedApiKey) {
      updateConnectionStatus("untested");
    }

    const cache = currentSettings.providers[provider].modelCache;
    const fingerprint = fingerprintApiKey(apiKey);
    const cacheMatches =
      cache &&
      cache.apiKeyFingerprint === fingerprint &&
      Array.isArray(cache.models) &&
      cache.models.length > 0;

    if (!cacheMatches) {
      setLiveModelHint("Model list may be outdated. Click Refresh.");
    }

    const correctionCache = currentSettings.transcriptionCorrection.providers[provider].modelCache;
    const correctionCacheMatches =
      correctionCache &&
      correctionCache.apiKeyFingerprint === fingerprint &&
      Array.isArray(correctionCache.models) &&
      correctionCache.models.length > 0;

    if (!correctionCacheMatches) {
      setCorrectionModelHint("Correction model list may be outdated. Click Refresh.");
    }

    updateTranscriptCorrectionUI();

    scheduleAutosave();
  });

  hotkeyInput.addEventListener("input", () => {
    scheduleAutosave();
  });

  silenceTimeoutInput.addEventListener("input", () => {
    scheduleAutosave();
  });

  languageSelect.addEventListener("change", () => {
    scheduleAutosave(0);
  });

  targetLanguageSelect.addEventListener("change", () => {
    scheduleAutosave(0);
  });

  refreshMicrophonesBtn.addEventListener("click", async () => {
    await refreshMicrophoneList(microphoneSelect.value || "default");
  });

  recordingLoudnessInput.addEventListener("input", () => {
    updateRecordingLoudnessValue();
    scheduleAutosave();
  });

  micTestBtn.addEventListener("click", async () => {
    if (micTestActive && currentMicTestMode === "timed") {
      await stopMicTest();
      return;
    }

    if (!micTestActive) {
      await startMicTest("timed");
    }
  });

  continuousMicTestBtn.addEventListener("click", async () => {
    if (micTestActive && currentMicTestMode === "continuous") {
      await stopMicTest();
      return;
    }

    if (!micTestActive) {
      await startMicTest("continuous");
    }
  });

  micWaveCanvas.addEventListener("click", () => {
    const isFirstUnlock = !currentSettings.waveformEasterEggUnlocked;
    if (isFirstUnlock) {
      currentSettings.waveformEasterEggUnlocked = true;
      nextAutosaveStatus = {
        message: "Goblin: Well look at that—clever little snooper!",
        durationMs: 2600,
      };
      updateWaveToolButtons();
    }
    currentSettings.waveformStyle = cycleWaveformStyle(currentSettings.waveformStyle);
    updateWaveToolButtons();
    scheduleAutosave(0);
  });

  waveStyleBtn.addEventListener("click", () => {
    currentSettings.waveformStyle = cycleWaveformStyle(currentSettings.waveformStyle);
    updateWaveToolButtons();
    scheduleAutosave(0);
  });

  waveColorBtn.addEventListener("click", () => {
    currentSettings.waveformColorScheme = cycleWaveformColorScheme(
      currentSettings.waveformColorScheme
    );
    updateWaveToolButtons();
    scheduleAutosave(0);
  });

  microphoneSelect.addEventListener("change", async () => {
    if (micTestActive) {
      const activeMode = currentMicTestMode;
      await stopMicTest();
      if (activeMode) {
        await startMicTest(activeMode);
      }
    }
    scheduleAutosave(0);
  });

  debugLoggingCheckbox.addEventListener("change", () => {
    scheduleAutosave(0);
  });

  openDebugFolderBtn.addEventListener("click", async () => {
    try {
      await openDebugLogFolder();
    } catch (err) {
      console.error("Failed to open debug logs folder:", err);
      debugLog(`Failed to open debug logs folder: ${String(err)}`, "ERROR");
      debugLogPath.textContent = "Could not open debug logs folder.";
    }
  });
}

function openApiKeyHelpModal() {
  apiKeyHelpModal.removeAttribute("hidden");
  document.body.classList.add("modal-open");
}

function closeApiKeyHelpModal() {
  apiKeyHelpModal.setAttribute("hidden", "");
  document.body.classList.remove("modal-open");
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

function updateTranscriptCorrectionUI() {
  const selectedMode = Array.from(typingModeRadios).find((radio) => radio.checked)?.value;
  renderTranscriptCorrectionUI(
    dom,
    (selectedMode as Settings["typingMode"]) || "incremental",
    transcriptCorrectionCheckbox.checked
  );
}

async function refreshLiveModelList(forceApiRefresh: boolean) {
  const provider = getActiveProvider();
  const providerLabel = getActiveProviderLabel();
  const providerRuntime = getActiveProviderRuntime();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    populateLiveModelOptions([], "");
    setLiveModelHint("Enter API key to fetch models.");
    return;
  }

  const now = Date.now();
  const fingerprint = fingerprintApiKey(apiKey);
  const cache = currentSettings.providers[provider].modelCache;
  const cacheIsFresh = isModelCacheFresh(cache, fingerprint, now, MODEL_CACHE_TTL_MS);

  if (!forceApiRefresh && cacheIsFresh && cache) {
    const preferred = selectPreferredModel(
      cache.models,
      currentSettings.providers[provider].selectedModel,
      currentSettings.providers[provider].lastKnownGoodModel
    );
    populateLiveModelOptions(cache.models, preferred);
    setLiveModelHint(`Loaded ${cache.models.length} models from cache.`);
    debugLog(`Using cached ${providerLabel} models (count=${cache.models.length})`, "INFO");
    return;
  }

  try {
    refreshModelsBtn.disabled = true;
    setLiveModelHint(`Fetching models from ${providerLabel} API...`);
    debugLog(`Fetching model list from ${providerLabel} API`, "INFO");
    const models = await providerRuntime.fetchModels(apiKey);

    if (models.length === 0) {
      throw new Error(`No ${providerLabel} transcription models returned by API`);
    }

    const preferred = selectPreferredModel(
      models,
      currentSettings.providers[provider].selectedModel,
      currentSettings.providers[provider].lastKnownGoodModel
    );
    populateLiveModelOptions(models, preferred);

    currentSettings.providers[provider].modelCache = {
      apiKeyFingerprint: fingerprint,
      fetchedAt: Date.now(),
      models,
    };
    await saveProviderModelCache(provider, currentSettings.providers[provider].modelCache);

    if (!models.includes(currentSettings.providers[provider].selectedModel)) {
      currentSettings.providers[provider].selectedModel = selectPreferredModel(
        models,
        currentSettings.providers[provider].selectedModel,
        currentSettings.providers[provider].lastKnownGoodModel
      );
      liveModelSelect.value = currentSettings.providers[provider].selectedModel;
    }

    setLiveModelHint(`Loaded ${models.length} models from API.`);
    debugLog(`Loaded ${providerLabel} models from API (count=${models.length})`, "INFO");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setLiveModelHint(`Failed to load models: ${message}`);
    debugLog(`Failed to load model list: ${message}`, "ERROR");
  } finally {
    refreshModelsBtn.disabled = false;
  }
}

async function refreshCorrectionModelList(forceApiRefresh: boolean) {
  const provider = getActiveProvider();
  const providerLabel = getActiveCorrectionLabel();
  const providerRuntime = getActiveCorrectionRuntime();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    populateCorrectionModelOptions([], "");
    setCorrectionModelHint("Enter API key to fetch correction models.");
    updateTranscriptCorrectionUI();
    return;
  }

  const now = Date.now();
  const fingerprint = fingerprintApiKey(apiKey);
  const cache = currentSettings.transcriptionCorrection.providers[provider].modelCache;
  const cacheIsFresh = isModelCacheFresh(cache, fingerprint, now, MODEL_CACHE_TTL_MS);

  if (!forceApiRefresh && cacheIsFresh && cache) {
    const preferred = selectPreferredModel(
      cache.models,
      currentSettings.transcriptionCorrection.providers[provider].selectedModel,
      currentSettings.transcriptionCorrection.providers[provider].lastKnownGoodModel
    );
    populateCorrectionModelOptions(cache.models, preferred);
    setCorrectionModelHint(`Loaded ${cache.models.length} correction models from cache.`);
    updateTranscriptCorrectionUI();
    debugLog(`Using cached ${providerLabel} correction models (count=${cache.models.length})`, "INFO");
    return;
  }

  try {
    refreshCorrectionModelsBtn.disabled = true;
    setCorrectionModelHint(`Fetching correction models from ${providerLabel} API...`);
    debugLog(`Fetching correction model list from ${providerLabel} API`, "INFO");
    const models = await providerRuntime.fetchModels(apiKey);

    if (models.length === 0) {
      throw new Error(`No ${providerLabel} correction models returned by API`);
    }

    const preferred = selectPreferredModel(
      models,
      currentSettings.transcriptionCorrection.providers[provider].selectedModel,
      currentSettings.transcriptionCorrection.providers[provider].lastKnownGoodModel
    );
    populateCorrectionModelOptions(models, preferred);

    currentSettings.transcriptionCorrection.providers[provider].modelCache = {
      apiKeyFingerprint: fingerprint,
      fetchedAt: Date.now(),
      models,
    };
    await saveCorrectionProviderModelCache(
      provider,
      currentSettings.transcriptionCorrection.providers[provider].modelCache
    );

    if (!models.includes(currentSettings.transcriptionCorrection.providers[provider].selectedModel)) {
      currentSettings.transcriptionCorrection.providers[provider].selectedModel = selectPreferredModel(
        models,
        currentSettings.transcriptionCorrection.providers[provider].selectedModel,
        currentSettings.transcriptionCorrection.providers[provider].lastKnownGoodModel
      );
      correctionModelSelect.value =
        currentSettings.transcriptionCorrection.providers[provider].selectedModel;
    }

    setCorrectionModelHint(`Loaded ${models.length} correction models from API.`);
    debugLog(`Loaded ${providerLabel} correction models from API (count=${models.length})`, "INFO");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setCorrectionModelHint(`Failed to load correction models: ${message}`);
    debugLog(`Failed to load correction model list: ${message}`, "ERROR");
  } finally {
    updateTranscriptCorrectionUI();
    refreshCorrectionModelsBtn.disabled = false;
  }
}

function updateMicTestButton() {
  const timedActive = micTestActive && currentMicTestMode === "timed";
  const continuousActive = micTestActive && currentMicTestMode === "continuous";

  micTestBtn.textContent = timedActive ? "Stop 5s test" : "Start 5s test";
  continuousMicTestBtn.textContent = continuousActive
    ? "Stop continuous test"
    : "Start continuous test";
  micTestBtn.disabled = continuousActive || micTestStopInProgress;
  continuousMicTestBtn.disabled = timedActive || micTestStopInProgress;
}

function clearMicTestAutoStop() {
  if (micTestAutoStopTimer !== null) {
    window.clearTimeout(micTestAutoStopTimer);
    micTestAutoStopTimer = null;
  }
}

function setMicSignalState(isSignalDetected: boolean, isListening: boolean) {
  const statusText = micSignalIndicator.querySelector(".status-text") as HTMLElement;
  micSignalIndicator.className = "status-indicator";

  if (!isListening) {
    micSignalIndicator.classList.add("disconnected");
    statusText.textContent = "No signal";
    return;
  }

  if (isSignalDetected) {
    micSignalIndicator.classList.add("connected");
    statusText.textContent = "Signal detected";
  } else {
    micSignalIndicator.classList.add("disconnected");
    statusText.textContent = "Listening";
  }
}

async function startMicTest(mode: "timed" | "continuous") {
  const provider = getActiveProvider();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    micTestStatus.textContent = `${getActiveProviderLabel()} API key required`;
    micTestTranscript.textContent = "Transcript: -";
    setMicSignalState(false, false);
    return;
  }

  const effectiveTypingMode = mode === "timed" ? "all_at_once" : "incremental";
  const micTestSettings: Settings = {
    ...currentSettings,
    typingMode: effectiveTypingMode,
    sttProvider: provider,
  };

  const session = new LiveAudioSession<string | null>({
    provider,
    apiKey,
    language: languageSelect.value || "auto",
    preferredModel: liveModelSelect.value || currentSettings.providers[provider].selectedModel,
    fallbackModels: currentSettings.providers[provider].modelCache?.models ?? [],
    typingMode: effectiveTypingMode,
    enableTyping: false,
    textCommandSettings: micTestSettings,
    audioEventName: "mic-test-audio-chunk",
    startCommand: "start_mic_monitoring",
    startPayload: {
      deviceId: microphoneSelect.value || "default",
      inputGain: getRecordingInputGain(),
      captureLimitSeconds: mode === "timed" ? MIC_TEST_DURATION_MS / 1000 : null,
    },
    stopCommand: "stop_mic_monitoring_with_recording",
    onTranscript: ({ displayText, isFinal }) => {
      if (mode === "timed" && !isFinal) {
        return;
      }

      if (displayText) {
        micTestTranscript.textContent = `Transcript: ${displayText}`;
      } else if (isFinal) {
        micTestTranscript.textContent = "Transcript: (No speech detected)";
      }
    },
    onStatus: (status, message) => {
      if (!micTestActive || micTestStopInProgress) {
        return;
      }

      if (status === "connecting") {
        micTestStatus.textContent = "Connecting...";
      } else if (status === "connected") {
        micTestStatus.textContent =
          currentMicTestMode === "continuous" ? "Listening until stopped..." : "Listening...";
      } else if (status === "error") {
        micTestStatus.textContent = message ? `Error: ${message}` : "Transcription error";
      } else if (status === "disconnected") {
        micTestStatus.textContent = message ? `Disconnected: ${message}` : "Disconnected";
      }
    },
  });

  try {
    clearMicTestAutoStop();
    cleanupMicTestPlayback();
    micTestActive = true;
    currentMicTestMode = mode;
    micTestSession = session;
    micTestStartedAt = Date.now();
    micTestStatus.textContent = "Connecting...";
    micTestTranscript.textContent =
      mode === "timed"
        ? "Transcript: Waiting for final transcript..."
        : "Transcript: Listening for live transcript...";
    setMicSignalState(false, true);
    updateMicTestButton();

    await session.start();
    debugLog(
      `Mic test started with ${getProviderLabel(provider)} model '${session.getActiveModel()}' in ${effectiveTypingMode} mode`,
      "INFO"
    );

    if (mode === "timed") {
      micTestAutoStopTimer = window.setTimeout(() => {
        if (micTestActive && currentMicTestMode === "timed") {
          void stopMicTest();
        }
      }, MIC_TEST_DURATION_MS);
    }
  } catch (err) {
    console.error("Failed to start mic test:", err);
    micTestSession = null;
    micTestActive = false;
    currentMicTestMode = null;
    micTestStatus.textContent = "Mic test failed";
    micTestTranscript.textContent = "Transcript: -";
    setMicSignalState(false, false);
    updateMicTestButton();
  }
}

async function stopMicTest() {
  if (micTestStopInProgress) {
    return;
  }

  micTestStopInProgress = true;
  clearMicTestAutoStop();

  const session = micTestSession;
  let recordedWavBase64: string | null = null;
  let finalTranscript = "";
  try {
    if (session) {
      micTestStatus.textContent = "Finalizing transcript...";
      const result = await session.stop();
      recordedWavBase64 = result.captureResult;
      finalTranscript = result.finalText;
    }
  } catch (err) {
    console.error("Failed to stop mic test:", err);
  } finally {
    micTestSession = null;
    micTestActive = false;
    currentMicTestMode = null;
    micTestStartedAt = 0;
    targetMicLevel = 0;
    micTestStatus.textContent = "Idle";
    setMicSignalState(false, false);
    micTestStopInProgress = false;
    updateMicTestButton();
  }

  if (!recordedWavBase64) {
    micTestStatus.textContent = "No audio captured";
    micTestTranscript.textContent = finalTranscript
      ? `Transcript: ${finalTranscript}`
      : "Transcript: No audio captured";
    return;
  }

  if (finalTranscript) {
    debugLog(
      `Mic test transcript preview: "${finalTranscript.slice(0, 140)}${finalTranscript.length > 140 ? "..." : ""}"`,
      "INFO"
    );
    micTestTranscript.textContent = `Transcript: ${finalTranscript}`;
  } else {
    debugLog("Mic test transcript is empty", "WARN");
    micTestTranscript.textContent = "Transcript: (No speech detected)";
  }

  micTestStatus.textContent = "Playing back...";
  const played = await playMicTestRecording(recordedWavBase64);
  micTestStatus.textContent = played ? "Playback complete" : "Playback failed";
}

async function playMicTestRecording(wavBase64: string): Promise<boolean> {
  try {
    cleanupMicTestPlayback();

    const wavBytes = base64ToBytes(wavBase64);
    const blob = new Blob([wavBytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    lastMicTestPlaybackUrl = url;

    const audio = new Audio(url);
    lastMicTestAudio = audio;
    micTestPlaybackActive = true;
    await audio.play();

    const completed = await new Promise<boolean>((resolve) => {
      audio.addEventListener(
        "ended",
        () => {
          micTestPlaybackActive = false;
          targetMicLevel = 0;
          resolve(true);
        },
        { once: true }
      );
      audio.addEventListener(
        "error",
        () => {
          micTestPlaybackActive = false;
          targetMicLevel = 0;
          resolve(false);
        },
        { once: true }
      );
    });

    return completed;
  } catch (err) {
    micTestPlaybackActive = false;
    targetMicLevel = 0;
    console.error("Failed to play mic test recording:", err);
    return false;
  }
}

function cleanupMicTestPlayback() {
  micTestPlaybackActive = false;
  targetMicLevel = 0;
  if (lastMicTestAudio) {
    lastMicTestAudio.pause();
    lastMicTestAudio.src = "";
    lastMicTestAudio = null;
  }

  if (lastMicTestPlaybackUrl) {
    URL.revokeObjectURL(lastMicTestPlaybackUrl);
    lastMicTestPlaybackUrl = null;
  }
}

function updateDebugLogHint() {
  if (!isDebugLoggingEnabled()) {
    debugLogPath.textContent = "Debug logs are disabled.";
    openDebugFolderBtn.disabled = true;
    return;
  }

  debugLogPath.textContent = "Debug logs are enabled.";
  openDebugFolderBtn.disabled = false;
}

function setupMicWave() {
  const ctx = micWaveCanvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = micWaveCanvas.clientWidth;
    const cssHeight = micWaveCanvas.clientHeight || 64;
    micWaveCanvas.width = Math.floor(cssWidth * ratio);
    micWaveCanvas.height = Math.floor(cssHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const draw = () => {
    const width = micWaveCanvas.clientWidth;
    const height = micWaveCanvas.clientHeight || 64;
    const playbackActive =
      micTestPlaybackActive && lastMicTestAudio !== null && !lastMicTestAudio.paused;
    const waveActive = micTestActive || playbackActive;
    const testProgress =
      micTestActive && micTestStartedAt > 0
        ? Math.min(1, (Date.now() - micTestStartedAt) / MIC_TEST_DURATION_MS)
        : 0;

    if (playbackActive && lastMicTestAudio) {
      const duration =
        Number.isFinite(lastMicTestAudio.duration) && lastMicTestAudio.duration > 0
          ? lastMicTestAudio.duration
          : 2.5;
      const progress = Math.min(1, lastMicTestAudio.currentTime / duration);
      const envelope = Math.sin(progress * Math.PI);
      const pulse =
        (Math.sin(lastMicTestAudio.currentTime * 14) +
          Math.sin(lastMicTestAudio.currentTime * 22 + 0.8) * 0.45 +
          Math.sin(lastMicTestAudio.currentTime * 31 + 1.7) * 0.2 +
          1.65) /
        2.3;
      targetMicLevel = Math.max(0.08, Math.min(1, envelope * (0.28 + pulse * 0.72)));
    }

    displayedMicLevel += (targetMicLevel - displayedMicLevel) * 0.15;
    if (!waveActive) {
      targetMicLevel = 0;
      displayedMicLevel *= 0.92;
    } else if (displayedMicLevel > 0.002) {
      micPhase += 0.12 + displayedMicLevel * 0.2;
    }

    ctx.clearRect(0, 0, width, height);

    const amplitude = waveActive ? displayedMicLevel * 20 : 0;

    drawWaveform(currentSettings.waveformStyle, {
      ctx,
      width,
      height,
      amplitude,
      phase: micPhase,
      active: waveActive,
      colorScheme: currentSettings.waveformColorScheme,
    });

    if (micTestActive) {
      const progressX = Math.min(width - 1, Math.max(0, Math.floor(width * testProgress)));
      const sliderGradient = createWaveProgressGradient(
        ctx,
        height,
        currentSettings.waveformColorScheme
      );

      ctx.lineWidth = 2;
      ctx.strokeStyle = sliderGradient;
      ctx.beginPath();
      ctx.moveTo(progressX, 0);
      ctx.lineTo(progressX, height);
      ctx.stroke();
    }

    micWaveRaf = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener("resize", resize);
  updateMicTestButton();
  setMicSignalState(false, false);
  micWaveRaf = requestAnimationFrame(draw);
}

async function refreshMicrophoneList(preferredDeviceId: string) {
  try {
    const devices = await invoke<InputDeviceInfo[]>("list_input_devices");
    const options: InputDeviceInfo[] = [
      {
        id: "default",
        name: "System default",
        isDefault: false,
      },
      ...devices,
    ];

    microphoneSelect.innerHTML = "";
    for (const device of options) {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = device.isDefault
        ? `${device.name} (default)`
        : device.name;
      microphoneSelect.appendChild(option);
    }

    const preferredExists = options.some((d) => d.id === preferredDeviceId);
    microphoneSelect.value = preferredExists ? preferredDeviceId : "default";
  } catch (err) {
    console.error("Failed to list input devices:", err);
    microphoneSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "default";
    option.textContent = "System default";
    microphoneSelect.appendChild(option);
    microphoneSelect.value = "default";
  }
}

function updateTypingModeHint(mode: string) {
  renderTypingModeHint(dom, mode);
}

function updateConnectionStatus(
  status: ConnectionStatus,
  message?: string
) {
  renderConnectionStatus(dom, status, message);
}

async function handleApiKeyTest() {
  const provider = getActiveProvider();
  const providerRuntime = getActiveProviderRuntime();
  const providerLabel = getActiveProviderLabel();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    updateConnectionStatus("disconnected");
    return;
  }

  testApiKeyBtn.disabled = true;
  updateConnectionStatus("connecting");

  try {
    if (liveModelSelect.disabled || !liveModelSelect.value) {
      await refreshLiveModelList(true);
    }

    const selectedModel = liveModelSelect.value;
    if (!selectedModel) {
      throw new Error("No model selected");
    }

    debugLog(
      `Testing ${providerLabel} API key with selected model '${selectedModel}'`,
      "INFO"
    );
    await providerRuntime.validateModel(apiKey, selectedModel);
    await providerRuntime.probeModelForTranscription(apiKey, selectedModel);

    lastTestedApiKey = apiKey;
    currentSettings.providers[provider].lastKnownGoodModel = selectedModel;
    await saveProviderLastKnownGoodModel(provider, selectedModel);
    updateConnectionStatus("connected");
    setLiveModelHint(`Model '${selectedModel}' validated successfully.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid API key";
    updateConnectionStatus("error", message);
    debugLog(`API/model test failed: ${message}`, "ERROR");
  } finally {
    testApiKeyBtn.disabled = !apiKeyInput.value.trim();
  }
}

function showSaveStatus(message: string, isError = false, durationMs?: number) {
  if (saveStatusTimer !== null) {
    window.clearTimeout(saveStatusTimer);
  }

  appToast.textContent = message;
  appToast.classList.remove("error", "success");
  appToast.classList.add(isError ? "error" : "success", "visible");

  saveStatusTimer = window.setTimeout(
    () => {
      appToast.classList.remove("visible", "error", "success");
      saveStatusTimer = null;
    },
    durationMs ?? (isError ? 3000 : 1500)
  );
}

function collectSettingsFromUI(): Settings {
  const provider = getActiveProvider();
  const selectedMode = Array.from(typingModeRadios).find(
    (r) => r.checked
  )?.value;

  const silenceSeconds = Number.parseFloat(silenceTimeoutInput.value);
  const autoStopSilenceMs =
    Number.isFinite(silenceSeconds) && silenceSeconds > 0
      ? silenceSeconds * 1000
      : currentSettings.autoStopSilenceMs;

  const recordingLoudnessPercent = Number.parseFloat(recordingLoudnessInput.value);
  const recordingLoudness =
    Number.isFinite(recordingLoudnessPercent) &&
    recordingLoudnessPercent >= 25 &&
    recordingLoudnessPercent <= 300
      ? recordingLoudnessPercent
      : currentSettings.recordingLoudness;

  const nextSettings: Settings = {
    ...currentSettings,
    sttProvider: provider,
    providers: {
      gemini: { ...currentSettings.providers.gemini },
      openai: { ...currentSettings.providers.openai },
    },
    transcriptionCorrection: {
      enabled: transcriptCorrectionCheckbox.checked,
      providers: {
        gemini: { ...currentSettings.transcriptionCorrection.providers.gemini },
        openai: { ...currentSettings.transcriptionCorrection.providers.openai },
      },
    },
    hotkey: normalizeHotkey(hotkeyInput.value),
    microphoneDeviceId: microphoneSelect.value || "default",
    recordingLoudness,
    waveformStyle: currentSettings.waveformStyle,
    waveformColorScheme: currentSettings.waveformColorScheme,
    debugLoggingEnabled: debugLoggingCheckbox.checked,
    typingMode: (selectedMode as Settings["typingMode"]) || "incremental",
    autoStopOnSilence: autoStopCheckbox.checked,
    autoStopSilenceMs,
    language: languageSelect.value,
    targetLanguage: targetLanguageSelect.value,
  };

  nextSettings.providers[provider].apiKey = apiKeyInput.value.trim();
  nextSettings.providers[provider].selectedModel =
    liveModelSelect.value || currentSettings.providers[provider].selectedModel;
  nextSettings.transcriptionCorrection.providers[provider].selectedModel =
    correctionModelSelect.value || currentSettings.transcriptionCorrection.providers[provider].selectedModel;

  return nextSettings;
}

function updateRecordingLoudnessValue() {
  const percent = Number.parseFloat(recordingLoudnessInput.value);
  if (!Number.isFinite(percent)) {
    recordingLoudnessValue.textContent = "100%";
    return;
  }
  recordingLoudnessValue.textContent = `${Math.round(percent)}%`;
}

function getRecordingInputGain() {
  const percent = Number.parseFloat(recordingLoudnessInput.value);
  if (!Number.isFinite(percent)) {
    return 1;
  }
  return Math.min(3, Math.max(0.25, percent / 100));
}

function scheduleAutosave(delayMs = AUTOSAVE_DEBOUNCE_MS) {
  if (autosaveTimer !== null) {
    window.clearTimeout(autosaveTimer);
  }

  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    const status = nextAutosaveStatus;
    nextAutosaveStatus = null;
    void persistSettingsFromUI(status?.message ?? "Saved", status?.durationMs);
  }, delayMs);
}

async function persistSettingsFromUI(successMessage: string, successDurationMs?: number) {
  if (saveInFlight) {
    savePending = true;
    return;
  }

  saveInFlight = true;
  const newSettings = collectSettingsFromUI();

  try {
    await saveSettings(newSettings);
    currentSettings = newSettings;
    await configureDebugLogging(newSettings.debugLoggingEnabled);
    updateDebugLogHint();
    reloadSettings(newSettings);

    // Update status
    lastTestedApiKey = "";
    const providerApiKey = getProviderApiKeyFromSettings(newSettings, newSettings.sttProvider);
    updateConnectionStatus(providerApiKey ? "untested" : "disconnected");
    testApiKeyBtn.disabled = !providerApiKey;

    showSaveStatus(successMessage, false, successDurationMs);
  } catch (err) {
    console.error("Failed to save settings:", err);
    showSaveStatus("Save failed", true);
  } finally {
    saveInFlight = false;
    if (savePending) {
      savePending = false;
      await persistSettingsFromUI("Saved");
    }
  }
}

async function handleResetToDefaults() {
  if (autosaveTimer !== null) {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  currentSettings = getDefaultSettings();
  populateUI(currentSettings);
  updateApiKeyTextForProvider();
  setLiveModelHint("Enter API key to fetch models.");
  setCorrectionModelHint("Enter API key to fetch correction models.");
  updateConnectionStatus("disconnected");
  testApiKeyBtn.disabled = true;

  await persistSettingsFromUI("Defaults restored");
}
