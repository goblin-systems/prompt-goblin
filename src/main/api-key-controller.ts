import type { ConnectionStatus, MainDom } from "./dom";
import { fingerprintApiKey } from "./utils";
import {
  getProviderModelCache,
  saveProviderLastKnownGoodModel,
  type Settings,
  type SttProvider,
} from "../settings";
import { getProviderLabel } from "../stt/service";
import type { SttProviderRuntime } from "../stt/types";

type LogLevel = "INFO" | "WARN" | "ERROR";

export interface ApiKeyControllerOptions {
  dom: MainDom;
  getCurrentSettings: () => Settings;
  getActiveProvider: () => SttProvider;
  getActiveProviderRuntime: () => SttProviderRuntime;
  refreshLiveModelList: (forceApiRefresh: boolean) => Promise<void>;
  refreshCorrectionModelList: (forceApiRefresh: boolean) => Promise<void>;
  updateApiKeyTextForProvider: () => void;
  updateConnectionStatus: (status: ConnectionStatus, message?: string) => void;
  updateTranscriptCorrectionUI: () => void;
  setLiveModelHint: (text: string) => void;
  setCorrectionModelHint: (text: string) => void;
  populateLiveModelOptions: (models: string[], preferredModel: string) => void;
  populateCorrectionModelOptions: (models: string[], preferredModel: string) => void;
  scheduleAutosave: (delayMs?: number) => void;
  debugLog: (message: string, level: LogLevel) => void;
  saveLastKnownGoodModel?: (provider: SttProvider, model: string) => Promise<void>;
}

export class ApiKeyController {
  private lastTestedApiKey = "";
  private readonly saveLastKnownGoodModel;

  constructor(private readonly options: ApiKeyControllerOptions) {
    this.saveLastKnownGoodModel = options.saveLastKnownGoodModel ?? saveProviderLastKnownGoodModel;
  }

  resetLastTestedApiKey() {
    this.lastTestedApiKey = "";
  }

  async handleProviderChange() {
    const settings = this.options.getCurrentSettings();
    settings.sttProvider = this.options.getActiveProvider();

    const providerSettings = settings.providers[settings.sttProvider];
    this.options.dom.apiKeyInput.value = providerSettings.apiKey;
    this.options.updateApiKeyTextForProvider();
    this.options.updateConnectionStatus(providerSettings.apiKey ? "untested" : "disconnected");
    this.options.dom.testApiKeyBtn.disabled = !providerSettings.apiKey;

    await this.options.refreshLiveModelList(false);
    await this.options.refreshCorrectionModelList(false);
    this.options.updateTranscriptCorrectionUI();
    this.options.scheduleAutosave(0);
  }

  handleLiveModelChange() {
    if (this.options.dom.apiKeyInput.value.trim() !== this.lastTestedApiKey) {
      this.options.updateConnectionStatus("untested");
    }
    this.options.scheduleAutosave(0);
  }

  handleCorrectionModelChange() {
    this.options.scheduleAutosave(0);
  }

  handleApiKeyInput() {
    const provider = this.options.getActiveProvider();
    const apiKey = this.options.dom.apiKeyInput.value.trim();
    this.options.dom.testApiKeyBtn.disabled = !apiKey;

    if (!apiKey) {
      this.lastTestedApiKey = "";
      this.options.updateConnectionStatus("disconnected");
      this.options.populateLiveModelOptions([], "");
      this.options.populateCorrectionModelOptions([], "");
      this.options.setLiveModelHint("Enter API key to fetch models.");
      this.options.setCorrectionModelHint("Enter API key to fetch correction models.");
      this.options.updateTranscriptCorrectionUI();
      this.options.scheduleAutosave();
      return;
    }

    if (apiKey !== this.lastTestedApiKey) {
      this.options.updateConnectionStatus("untested");
    }

    this.updateModelHintsForApiKey(provider, apiKey);
    this.options.updateTranscriptCorrectionUI();
    this.options.scheduleAutosave();
  }

  async handleApiKeyTest() {
    const provider = this.options.getActiveProvider();
    const providerLabel = getProviderLabel(provider);
    const apiKey = this.options.dom.apiKeyInput.value.trim();
    if (!apiKey) {
      this.options.updateConnectionStatus("disconnected");
      return;
    }

    this.options.dom.testApiKeyBtn.disabled = true;
    this.options.updateConnectionStatus("connecting");

    try {
      if (this.options.dom.liveModelSelect.disabled || !this.options.dom.liveModelSelect.value) {
        await this.options.refreshLiveModelList(true);
      }

      const selectedModel = this.options.dom.liveModelSelect.value;
      if (!selectedModel) {
        throw new Error("No model selected");
      }

      this.options.debugLog(
        `Testing ${providerLabel} API key with selected model '${selectedModel}'`,
        "INFO"
      );

      const runtime = this.options.getActiveProviderRuntime();
      await runtime.validateModel(apiKey, selectedModel);
      await runtime.probeModelForTranscription(apiKey, selectedModel);

      this.lastTestedApiKey = apiKey;
      this.options.getCurrentSettings().providers[provider].lastKnownGoodModel = selectedModel;
      await this.saveLastKnownGoodModel(provider, selectedModel);
      this.options.updateConnectionStatus("connected");
      this.options.setLiveModelHint(`Model '${selectedModel}' validated successfully.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid API key";
      this.options.updateConnectionStatus("error", message);
      this.options.debugLog(`API/model test failed: ${message}`, "ERROR");
    } finally {
      this.options.dom.testApiKeyBtn.disabled = !this.options.dom.apiKeyInput.value.trim();
    }
  }

  syncConnectionStatusFromSettings() {
    const settings = this.options.getCurrentSettings();
    const providerApiKey = settings.providers[settings.sttProvider].apiKey;
    this.options.updateConnectionStatus(providerApiKey ? "untested" : "disconnected");
    this.options.dom.testApiKeyBtn.disabled = !providerApiKey;
  }

  private updateModelHintsForApiKey(provider: SttProvider, apiKey: string) {
    const settings = this.options.getCurrentSettings();
    const fingerprint = fingerprintApiKey(apiKey);
    const liveCache = getProviderModelCache(settings, provider);
    const liveCacheMatches =
      liveCache &&
      liveCache.apiKeyFingerprint === fingerprint &&
      Array.isArray(liveCache.models) &&
      liveCache.models.length > 0;
    if (!liveCacheMatches) {
      this.options.setLiveModelHint("Model list may be outdated. Click Refresh.");
    }

    const correctionCache = settings.transcriptionCorrection.providers[provider].modelCache;
    const correctionCacheMatches =
      correctionCache &&
      correctionCache.apiKeyFingerprint === fingerprint &&
      Array.isArray(correctionCache.models) &&
      correctionCache.models.length > 0;
    if (!correctionCacheMatches) {
      this.options.setCorrectionModelHint("Correction model list may be outdated. Click Refresh.");
    }
  }
}
