import type { ProviderModelCache, SttProvider } from "../settings";
import { MODEL_CACHE_TTL_MS, isModelCacheFresh, selectPreferredModel } from "./model-cache";
import { fingerprintApiKey } from "./utils";

type LogLevel = "INFO" | "WARN" | "ERROR";

export interface RefreshModelListMessages {
  emptyApiKey: string;
  fetching: (providerLabel: string) => string;
  emptyResult: (providerLabel: string) => string;
  loadedFromCache: (count: number) => string;
  loadedFromApi: (count: number) => string;
  failed: (message: string) => string;
  cacheLog: (providerLabel: string, count: number) => string;
  fetchLog: (providerLabel: string) => string;
  successLog: (providerLabel: string, count: number) => string;
  failureLog: (message: string) => string;
}

export interface RefreshModelListOptions {
  provider: SttProvider;
  providerLabel: string;
  apiKey: string;
  forceApiRefresh: boolean;
  fetchModels: (apiKey: string) => Promise<string[]>;
  getCache: () => ProviderModelCache | null;
  getSelectedModel: () => string;
  getLastKnownGoodModel: () => string;
  setSelectedModel: (model: string) => void;
  saveCache: (provider: SttProvider, cache: ProviderModelCache | null) => Promise<void>;
  populateOptions: (models: string[], preferredModel: string) => void;
  setHint: (text: string) => void;
  setRefreshDisabled: (disabled: boolean) => void;
  onAfterUpdate?: () => void;
  log: (message: string, level: LogLevel) => void;
  messages: RefreshModelListMessages;
  now?: () => number;
  ttlMs?: number;
}

export async function refreshModelList(options: RefreshModelListOptions): Promise<void> {
  const {
    provider,
    providerLabel,
    apiKey,
    forceApiRefresh,
    fetchModels,
    getCache,
    getSelectedModel,
    getLastKnownGoodModel,
    setSelectedModel,
    saveCache,
    populateOptions,
    setHint,
    setRefreshDisabled,
    onAfterUpdate,
    log,
    messages,
    now = () => Date.now(),
    ttlMs = MODEL_CACHE_TTL_MS,
  } = options;

  if (!apiKey) {
    populateOptions([], "");
    setHint(messages.emptyApiKey);
    onAfterUpdate?.();
    return;
  }

  const currentTime = now();
  const fingerprint = fingerprintApiKey(apiKey);
  const cache = getCache();
  const cacheIsFresh = isModelCacheFresh(cache, fingerprint, currentTime, ttlMs);

  if (!forceApiRefresh && cacheIsFresh && cache) {
    const preferred = selectPreferredModel(
      cache.models,
      getSelectedModel(),
      getLastKnownGoodModel()
    );
    populateOptions(cache.models, preferred);
    setHint(messages.loadedFromCache(cache.models.length));
    onAfterUpdate?.();
    log(messages.cacheLog(providerLabel, cache.models.length), "INFO");
    return;
  }

  try {
    setRefreshDisabled(true);
    setHint(messages.fetching(providerLabel));
    log(messages.fetchLog(providerLabel), "INFO");

    const models = await fetchModels(apiKey);
    if (models.length === 0) {
      throw new Error(messages.emptyResult(providerLabel));
    }

    const preferred = selectPreferredModel(models, getSelectedModel(), getLastKnownGoodModel());
    populateOptions(models, preferred);

    const nextCache: ProviderModelCache = {
      apiKeyFingerprint: fingerprint,
      fetchedAt: currentTime,
      models,
    };
    await saveCache(provider, nextCache);

    if (!models.includes(getSelectedModel())) {
      setSelectedModel(preferred);
    }

    setHint(messages.loadedFromApi(models.length));
    log(messages.successLog(providerLabel, models.length), "INFO");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setHint(messages.failed(message));
    log(messages.failureLog(message), "ERROR");
  } finally {
    setRefreshDisabled(false);
    onAfterUpdate?.();
  }
}

export const liveModelMessages: RefreshModelListMessages = {
  emptyApiKey: "Enter API key to fetch models.",
  fetching: (providerLabel) => `Fetching models from ${providerLabel} API...`,
  emptyResult: (providerLabel) => `No ${providerLabel} transcription models returned by API`,
  loadedFromCache: (count) => `Loaded ${count} models from cache.`,
  loadedFromApi: (count) => `Loaded ${count} models from API.`,
  failed: (message) => `Failed to load models: ${message}`,
  cacheLog: (providerLabel, count) => `Using cached ${providerLabel} models (count=${count})`,
  fetchLog: (providerLabel) => `Fetching model list from ${providerLabel} API`,
  successLog: (providerLabel, count) =>
    `Loaded ${providerLabel} models from API (count=${count})`,
  failureLog: (message) => `Failed to load model list: ${message}`,
};

export const correctionModelMessages: RefreshModelListMessages = {
  emptyApiKey: "Enter API key to fetch correction models.",
  fetching: (providerLabel) => `Fetching correction models from ${providerLabel} API...`,
  emptyResult: (providerLabel) => `No ${providerLabel} correction models returned by API`,
  loadedFromCache: (count) => `Loaded ${count} correction models from cache.`,
  loadedFromApi: (count) => `Loaded ${count} correction models from API.`,
  failed: (message) => `Failed to load correction models: ${message}`,
  cacheLog: (providerLabel, count) =>
    `Using cached ${providerLabel} correction models (count=${count})`,
  fetchLog: (providerLabel) => `Fetching correction model list from ${providerLabel} API`,
  successLog: (providerLabel, count) =>
    `Loaded ${providerLabel} correction models from API (count=${count})`,
  failureLog: (message) => `Failed to load correction model list: ${message}`,
};
