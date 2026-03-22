import type { Settings } from "../settings";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "untested";

export interface MainDom {
  sttProviderSelect: HTMLSelectElement;
  apiKeyInput: HTMLInputElement;
  hotkeyInput: HTMLInputElement;
  liveModelSelect: HTMLSelectElement;
  refreshModelsBtn: HTMLButtonElement;
  liveModelHint: HTMLElement;
  microphoneSelect: HTMLSelectElement;
  recordingLoudnessInput: HTMLInputElement;
  recordingLoudnessValue: HTMLElement;
  refreshMicrophonesBtn: HTMLButtonElement;
  micTestBtn: HTMLButtonElement;
  continuousMicTestBtn: HTMLButtonElement;
  waveStyleBtn: HTMLButtonElement;
  waveColorBtn: HTMLButtonElement;
  micTestStatus: HTMLElement;
  micTestTranscript: HTMLElement;
  micSignalIndicator: HTMLElement;
  micWaveCanvas: HTMLCanvasElement;
  debugLoggingCheckbox: HTMLInputElement;
  openDebugFolderBtn: HTMLButtonElement;
  debugLogPath: HTMLElement;
  toggleKeyBtn: HTMLButtonElement;
  apiKeyHelpBtn: HTMLButtonElement;
  apiKeyHelpModal: HTMLElement;
  closeApiKeyHelpBtn: HTMLButtonElement;
  connectionStatus: HTMLElement;
  testApiKeyBtn: HTMLButtonElement;
  typingModeRadios: NodeListOf<HTMLInputElement>;
  typingModeHint: HTMLElement;
  transcriptCorrectionCheckbox: HTMLInputElement;
  transcriptCorrectionHint: HTMLElement;
  transcriptCorrectionControls: HTMLElement;
  correctionModelSelect: HTMLSelectElement;
  refreshCorrectionModelsBtn: HTMLButtonElement;
  correctionModelHint: HTMLElement;
  autoStopCheckbox: HTMLInputElement;
  silenceTimeoutField: HTMLElement;
  silenceTimeoutInput: HTMLInputElement;
  languageSelect: HTMLSelectElement;
  targetLanguageSelect: HTMLSelectElement;
  lineBreakModeSelect: HTMLSelectElement;
  resetDefaultsBtn: HTMLButtonElement;
  appToast: HTMLElement;
  windowMinimizeBtn: HTMLButtonElement | null;
  windowCloseBtn: HTMLButtonElement;
}

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const element = doc.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
}

function byIdOptional<T extends HTMLElement>(doc: Document, id: string): T | null {
  const element = doc.getElementById(id);
  return element ? (element as T) : null;
}

export function getMainDom(doc: Document): MainDom {
  return {
    apiKeyInput: byId<HTMLInputElement>(doc, "api-key-input"),
    sttProviderSelect: byId<HTMLSelectElement>(doc, "stt-provider-select"),
    hotkeyInput: byId<HTMLInputElement>(doc, "hotkey-input"),
    liveModelSelect: byId<HTMLSelectElement>(doc, "live-model-select"),
    refreshModelsBtn: byId<HTMLButtonElement>(doc, "refresh-models-btn"),
    liveModelHint: byId<HTMLElement>(doc, "live-model-hint"),
    microphoneSelect: byId<HTMLSelectElement>(doc, "microphone-select"),
    recordingLoudnessInput: byId<HTMLInputElement>(doc, "recording-loudness"),
    recordingLoudnessValue: byId<HTMLElement>(doc, "recording-loudness-value"),
    refreshMicrophonesBtn: byId<HTMLButtonElement>(doc, "refresh-microphones-btn"),
    micTestBtn: byId<HTMLButtonElement>(doc, "mic-test-btn"),
    continuousMicTestBtn: byId<HTMLButtonElement>(doc, "continuous-mic-test-btn"),
    waveStyleBtn: byId<HTMLButtonElement>(doc, "wave-style-btn"),
    waveColorBtn: byId<HTMLButtonElement>(doc, "wave-color-btn"),
    micTestStatus: byId<HTMLElement>(doc, "mic-test-status"),
    micTestTranscript: byId<HTMLElement>(doc, "mic-test-transcript"),
    micSignalIndicator: byId<HTMLElement>(doc, "mic-signal-indicator"),
    micWaveCanvas: byId<HTMLCanvasElement>(doc, "mic-wave-canvas"),
    debugLoggingCheckbox: byId<HTMLInputElement>(doc, "debug-logging-checkbox"),
    openDebugFolderBtn: byId<HTMLButtonElement>(doc, "open-debug-folder-btn"),
    debugLogPath: byId<HTMLElement>(doc, "debug-log-path"),
    toggleKeyBtn: byId<HTMLButtonElement>(doc, "toggle-key-visibility"),
    apiKeyHelpBtn: byId<HTMLButtonElement>(doc, "api-key-help-btn"),
    apiKeyHelpModal: byId<HTMLElement>(doc, "api-key-help-modal"),
    closeApiKeyHelpBtn: byId<HTMLButtonElement>(doc, "close-api-key-help-btn"),
    connectionStatus: byId<HTMLElement>(doc, "connection-status"),
    testApiKeyBtn: byId<HTMLButtonElement>(doc, "test-api-key-btn"),
    typingModeRadios: doc.querySelectorAll(
      'input[name="typing-mode"]'
    ) as NodeListOf<HTMLInputElement>,
    typingModeHint: byId<HTMLElement>(doc, "typing-mode-hint"),
    transcriptCorrectionCheckbox: byId<HTMLInputElement>(doc, "transcript-correction-checkbox"),
    transcriptCorrectionHint: byId<HTMLElement>(doc, "transcript-correction-hint"),
    transcriptCorrectionControls: byId<HTMLElement>(doc, "transcript-correction-controls"),
    correctionModelSelect: byId<HTMLSelectElement>(doc, "correction-model-select"),
    refreshCorrectionModelsBtn: byId<HTMLButtonElement>(doc, "refresh-correction-models-btn"),
    correctionModelHint: byId<HTMLElement>(doc, "correction-model-hint"),
    autoStopCheckbox: byId<HTMLInputElement>(doc, "auto-stop-checkbox"),
    silenceTimeoutField: byId<HTMLElement>(doc, "silence-timeout-field"),
    silenceTimeoutInput: byId<HTMLInputElement>(doc, "silence-timeout"),
    languageSelect: byId<HTMLSelectElement>(doc, "language-select"),
    targetLanguageSelect: byId<HTMLSelectElement>(doc, "target-language-select"),
    lineBreakModeSelect: byId<HTMLSelectElement>(doc, "line-break-mode-select"),
    resetDefaultsBtn: byId<HTMLButtonElement>(doc, "reset-defaults-btn"),
    appToast: byId<HTMLElement>(doc, "app-toast"),
    windowMinimizeBtn: byIdOptional<HTMLButtonElement>(doc, "window-minimize-btn"),
    windowCloseBtn: byId<HTMLButtonElement>(doc, "window-close-btn"),
  };
}

export function populateUI(dom: MainDom, settings: Settings) {
  dom.sttProviderSelect.value = settings.sttProvider;
  dom.apiKeyInput.value = settings.providers[settings.sttProvider].apiKey;
  dom.hotkeyInput.value = settings.hotkey;
  dom.debugLoggingCheckbox.checked = settings.debugLoggingEnabled;

  const cachedModels = settings.providers[settings.sttProvider].modelCache?.models ?? [];
  populateLiveModelOptions(dom, cachedModels, settings.providers[settings.sttProvider].selectedModel);
  if (cachedModels.length === 0) {
    setLiveModelHint(dom, "No cached models yet. Click Refresh to load from API.");
  }

  dom.typingModeRadios.forEach((radio) => {
    radio.checked = radio.value === settings.typingMode;
  });
  updateTypingModeHint(dom, settings.typingMode);

  dom.transcriptCorrectionCheckbox.checked = settings.transcriptionCorrection.enabled;
  const correctionModels =
    settings.transcriptionCorrection.providers[settings.sttProvider].modelCache?.models ?? [];
  populateCorrectionModelOptions(
    dom,
    correctionModels,
    settings.transcriptionCorrection.providers[settings.sttProvider].selectedModel
  );
  if (correctionModels.length === 0) {
    setCorrectionModelHint(dom, "No cached correction models yet. Click Refresh to load from API.");
  }
  updateTranscriptCorrectionUI(
    dom,
    settings.typingMode,
    settings.transcriptionCorrection.enabled
  );

  dom.autoStopCheckbox.checked = settings.autoStopOnSilence;
  dom.silenceTimeoutField.style.display = settings.autoStopOnSilence ? "flex" : "none";
  dom.silenceTimeoutInput.value = String(settings.autoStopSilenceMs / 1000);
  dom.languageSelect.value = settings.language;
  dom.targetLanguageSelect.value = settings.targetLanguage;
  dom.lineBreakModeSelect.value = settings.lineBreakMode;
  dom.recordingLoudnessInput.value = String(settings.recordingLoudness);
  dom.recordingLoudnessValue.textContent = `${Math.round(settings.recordingLoudness)}%`;
}

export function setLiveModelHint(dom: MainDom, text: string) {
  dom.liveModelHint.textContent = text;
}

export function populateLiveModelOptions(
  dom: MainDom,
  models: string[],
  preferredModel: string
) {
  populateSelectOptions(dom.liveModelSelect, models, preferredModel);
}

export function setCorrectionModelHint(dom: MainDom, text: string) {
  dom.correctionModelHint.textContent = text;
}

export function populateCorrectionModelOptions(
  dom: MainDom,
  models: string[],
  preferredModel: string
) {
  populateSelectOptions(dom.correctionModelSelect, models, preferredModel);
}

function populateSelectOptions(
  select: HTMLSelectElement,
  models: string[],
  preferredModel: string
) {
  select.innerHTML = "";

  if (models.length === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No models available";
    select.appendChild(emptyOption);
    select.value = "";
    select.disabled = true;
    return;
  }

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  }

  select.disabled = false;
  const selected = models.includes(preferredModel) ? preferredModel : models[0];
  select.value = selected;
}

export function updateTypingModeHint(dom: MainDom, mode: string) {
  if (mode === "all_at_once") {
    dom.typingModeHint.textContent = "Text is typed after you stop recording.";
  } else {
    dom.typingModeHint.textContent =
      "Text appears as you speak. May cause issues in some apps.";
  }
}

export function updateTranscriptCorrectionUI(
  dom: MainDom,
  typingMode: Settings["typingMode"],
  enabled: boolean
) {
  const available = typingMode === "all_at_once";
  const controlsEnabled = available && enabled;

  dom.transcriptCorrectionCheckbox.disabled = !available;
  dom.correctionModelSelect.disabled = !controlsEnabled || dom.correctionModelSelect.options.length === 0;
  dom.refreshCorrectionModelsBtn.disabled = !controlsEnabled;
  dom.transcriptCorrectionControls.classList.toggle("is-disabled", !controlsEnabled);

  if (!available) {
    dom.transcriptCorrectionHint.textContent =
      "AI transcript correction is available only in Type all at once mode.";
  } else if (!enabled) {
    dom.transcriptCorrectionHint.textContent =
      "Beta feature. Enable it to clean up the final transcript before typing.";
  } else {
    dom.transcriptCorrectionHint.textContent =
      "Cleans up the final transcript with a language model before typing. Spoken command words are preserved.";
  }
}

export function updateConnectionStatus(
  dom: MainDom,
  status: ConnectionStatus,
  message?: string
) {
  const statusText = dom.connectionStatus.querySelector(".status-text") as HTMLElement;

  dom.connectionStatus.className = "status-indicator";

  switch (status) {
    case "connected":
      dom.connectionStatus.classList.add("connected");
      statusText.textContent = "Ready";
      break;
    case "connecting":
      dom.connectionStatus.classList.add("disconnected");
      statusText.textContent = "Testing...";
      break;
    case "untested":
      dom.connectionStatus.classList.add("untested");
      statusText.textContent = "Not tested";
      break;
    case "error":
      dom.connectionStatus.classList.add("error");
      statusText.textContent = message || "Error";
      break;
    default:
      dom.connectionStatus.classList.add("disconnected");
      statusText.textContent = "Not configured";
  }
}
