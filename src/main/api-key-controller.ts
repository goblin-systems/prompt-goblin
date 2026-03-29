import type { ConnectionStatus, MainDom } from "./dom";
import { fingerprintApiKey } from "./utils";
import {
  getProviderAuth,
  getProviderAuthIdentity,
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
  private lastTestedAuthIdentity = "";
  private readonly saveLastKnownGoodModel;

  constructor(private readonly options: ApiKeyControllerOptions) {
    this.saveLastKnownGoodModel = options.saveLastKnownGoodModel ?? saveProviderLastKnownGoodModel;
  }

  resetLastTestedApiKey() {
    this.lastTestedAuthIdentity = "";
  }

  async handleProviderChange() {
    const settings = this.options.getCurrentSettings();
    settings.sttProvider = this.options.getActiveProvider();
    const selectedProviderValue = this.options.dom.sttProviderSelect?.value;
    if (selectedProviderValue === "openai_oauth") {
      settings.providers.openai.authMode = "oauth_experimental";
    } else if (selectedProviderValue === "openai") {
      settings.providers.openai.authMode = "api_key";
    }

    const providerSettings = settings.providers[settings.sttProvider];
    this.options.dom.apiKeyInput.value = providerSettings.apiKey;
    this.options.updateApiKeyTextForProvider();
    const auth = getProviderAuth(settings, settings.sttProvider);
    this.options.updateConnectionStatus(auth ? "untested" : "disconnected");
    this.options.dom.testApiKeyBtn.disabled = !auth;

    await this.options.refreshLiveModelList(false);
    await this.options.refreshCorrectionModelList(false);
    this.options.updateTranscriptCorrectionUI();
    this.options.scheduleAutosave(0);
  }

  handleLiveModelChange() {
    const authIdentity = getProviderAuthIdentity(
      this.options.getCurrentSettings(),
      this.options.getActiveProvider()
    );
    if (authIdentity !== this.lastTestedAuthIdentity) {
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

    const settings = this.options.getCurrentSettings();
    if (provider === "openai" && settings.providers.openai.authMode === "oauth_experimental") {
      this.options.dom.testApiKeyBtn.disabled = false;
      this.options.updateConnectionStatus("untested");
      this.options.scheduleAutosave();
      return;
    }

    if (!apiKey) {
      this.lastTestedAuthIdentity = "";
      this.options.updateConnectionStatus("disconnected");
      this.options.populateLiveModelOptions([], "");
      this.options.populateCorrectionModelOptions([], "");
      this.options.setLiveModelHint("Enter API key to fetch models.");
      this.options.setCorrectionModelHint("Enter API key to fetch correction models.");
      this.options.updateTranscriptCorrectionUI();
      this.options.scheduleAutosave();
      return;
    }

    const authIdentity = getProviderAuthIdentity(settings, provider);
    if (authIdentity !== this.lastTestedAuthIdentity) {
      this.options.updateConnectionStatus("untested");
    }

    this.updateModelHintsForApiKey(provider, apiKey);
    this.options.updateTranscriptCorrectionUI();
    this.options.scheduleAutosave();
  }

  async handleApiKeyTest() {
    const provider = this.options.getActiveProvider();
    const providerLabel = getProviderLabel(provider);
    const settings = this.options.getCurrentSettings();
    const auth = getProviderAuth(settings, provider);
    if (!auth) {
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
      await runtime.validateModel(auth, selectedModel);
      await runtime.probeModelForTranscription(auth, selectedModel);

      this.lastTestedAuthIdentity = getProviderAuthIdentity(settings, provider);
      this.options.getCurrentSettings().providers[provider].lastKnownGoodModel = selectedModel;
      await this.saveLastKnownGoodModel(provider, selectedModel);
      this.options.updateConnectionStatus("connected");
      this.options.setLiveModelHint(`Model '${selectedModel}' validated successfully.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid API key";
      this.options.updateConnectionStatus("error", message);
      this.options.debugLog(`API/model test failed: ${message}`, "ERROR");
    } finally {
      const settings = this.options.getCurrentSettings();
      const provider = this.options.getActiveProvider();
      const auth = getProviderAuth(settings, provider);
      this.options.dom.testApiKeyBtn.disabled = !auth;
    }
  }

  syncConnectionStatusFromSettings() {
    const settings = this.options.getCurrentSettings();
    const auth = getProviderAuth(settings, settings.sttProvider);
    this.options.updateConnectionStatus(auth ? "untested" : "disconnected");
    this.options.dom.testApiKeyBtn.disabled = !auth;
  }

  private updateModelHintsForApiKey(provider: SttProvider, apiKey: string) {
    const settings = this.options.getCurrentSettings();
    const identity = getProviderAuthIdentity(settings, provider) || apiKey;
    const fingerprint = fingerprintApiKey(identity);
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
