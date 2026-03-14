import { load, Store } from "@tauri-apps/plugin-store";

export interface Settings {
  geminiApiKey: string;
  hotkey: string;
  microphoneDeviceId: string;
  selectedLiveModel: string;
  lastKnownGoodLiveModel: string;
  modelCache: {
    apiKeyFingerprint: string;
    fetchedAt: number;
    models: string[];
  } | null;
  debugLoggingEnabled: boolean;
  typingMode: "all_at_once" | "incremental";
  autoStopOnSilence: boolean;
  autoStopSilenceMs: number;
  language: string;
}

const DEFAULTS: Settings = {
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

export function getDefaultSettings(): Settings {
  return { ...DEFAULTS };
}

const LEGACY_DEFAULT_HOTKEY = "Alt+Super+G";

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("settings.json", { autoSave: true, defaults: {} });
  }
  return store;
}

export async function loadSettings(): Promise<Settings> {
  const s = await getStore();
  const settings: Settings = getDefaultSettings();

  const apiKey = await s.get<string>("geminiApiKey");
  if (apiKey !== undefined && apiKey !== null) settings.geminiApiKey = apiKey;

  const hotkey = await s.get<string>("hotkey");
  if (hotkey !== undefined && hotkey !== null) settings.hotkey = hotkey;

  const microphoneDeviceId = await s.get<string>("microphoneDeviceId");
  if (microphoneDeviceId !== undefined && microphoneDeviceId !== null) {
    settings.microphoneDeviceId = microphoneDeviceId;
  }

  const debugLoggingEnabled = await s.get<boolean>("debugLoggingEnabled");
  if (debugLoggingEnabled !== undefined && debugLoggingEnabled !== null) {
    settings.debugLoggingEnabled = debugLoggingEnabled;
  }

  const selectedLiveModel = await s.get<string>("selectedLiveModel");
  if (selectedLiveModel !== undefined && selectedLiveModel !== null) {
    settings.selectedLiveModel = selectedLiveModel;
  }

  const lastKnownGoodLiveModel = await s.get<string>("lastKnownGoodLiveModel");
  if (
    lastKnownGoodLiveModel !== undefined &&
    lastKnownGoodLiveModel !== null
  ) {
    settings.lastKnownGoodLiveModel = lastKnownGoodLiveModel;
  }

  const modelCache = await s.get<Settings["modelCache"]>("modelCache");
  if (
    modelCache &&
    typeof modelCache === "object" &&
    typeof modelCache.apiKeyFingerprint === "string" &&
    typeof modelCache.fetchedAt === "number" &&
    Array.isArray(modelCache.models)
  ) {
    settings.modelCache = {
      apiKeyFingerprint: modelCache.apiKeyFingerprint,
      fetchedAt: modelCache.fetchedAt,
      models: modelCache.models.filter((m): m is string => typeof m === "string"),
    };
  }

  if (settings.hotkey === LEGACY_DEFAULT_HOTKEY) {
    settings.hotkey = DEFAULTS.hotkey;
    await s.set("hotkey", settings.hotkey);
    await s.save();
  }

  const typingMode = await s.get<string>("typingMode");
  if (typingMode === "all_at_once" || typingMode === "incremental") {
    settings.typingMode = typingMode;
  }

  const autoStop = await s.get<boolean>("autoStopOnSilence");
  if (autoStop !== undefined && autoStop !== null)
    settings.autoStopOnSilence = autoStop;

  const silenceMs = await s.get<number>("autoStopSilenceMs");
  if (silenceMs !== undefined && silenceMs !== null)
    settings.autoStopSilenceMs = silenceMs;

  const language = await s.get<string>("language");
  if (language !== undefined && language !== null) settings.language = language;

  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await getStore();
  await s.set("geminiApiKey", settings.geminiApiKey);
  await s.set("hotkey", settings.hotkey);
  await s.set("microphoneDeviceId", settings.microphoneDeviceId);
  await s.set("selectedLiveModel", settings.selectedLiveModel);
  await s.set("lastKnownGoodLiveModel", settings.lastKnownGoodLiveModel);
  await s.set("modelCache", settings.modelCache);
  await s.set("debugLoggingEnabled", settings.debugLoggingEnabled);
  await s.set("typingMode", settings.typingMode);
  await s.set("autoStopOnSilence", settings.autoStopOnSilence);
  await s.set("autoStopSilenceMs", settings.autoStopSilenceMs);
  await s.set("language", settings.language);
  await s.save();
}

export async function saveModelCache(cache: Settings["modelCache"]): Promise<void> {
  const s = await getStore();
  await s.set("modelCache", cache);
  await s.save();
}

export async function saveLastKnownGoodLiveModel(model: string): Promise<void> {
  const s = await getStore();
  await s.set("lastKnownGoodLiveModel", model);
  await s.save();
}
