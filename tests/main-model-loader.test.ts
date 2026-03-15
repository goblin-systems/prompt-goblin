import { describe, expect, test } from "bun:test";
import {
  liveModelMessages,
  refreshModelList,
  type RefreshModelListOptions,
} from "../src/main/model-loader";
import type { ProviderModelCache } from "../src/settings";
import { fingerprintApiKey } from "../src/main/utils";

function createOptions(overrides: Partial<RefreshModelListOptions> = {}): RefreshModelListOptions {
  let cache: ProviderModelCache | null = {
    apiKeyFingerprint: fingerprintApiKey("test-key"),
    fetchedAt: 1_000,
    models: ["cached-model"],
  };
  let selectedModel = "missing-model";
  const hints: string[] = [];
  const optionsHistory: Array<{ models: string[]; preferredModel: string }> = [];
  const disabledStates: boolean[] = [];
  const logs: Array<{ message: string; level: string }> = [];

  return {
    provider: "gemini",
    providerLabel: "Gemini",
    apiKey: "test-key",
    forceApiRefresh: false,
    fetchModels: async () => ["api-model", "backup-model"],
    getCache: () => cache,
    getSelectedModel: () => selectedModel,
    getLastKnownGoodModel: () => "backup-model",
    setSelectedModel: (model) => {
      selectedModel = model;
    },
    saveCache: async (_provider, nextCache) => {
      cache = nextCache;
    },
    populateOptions: (models, preferredModel) => {
      optionsHistory.push({ models, preferredModel });
    },
    setHint: (text) => {
      hints.push(text);
    },
    setRefreshDisabled: (disabled) => {
      disabledStates.push(disabled);
    },
    log: (message, level) => {
      logs.push({ message, level });
    },
    messages: liveModelMessages,
    now: () => 2_000,
    ttlMs: 10_000,
    ...overrides,
  };
}

describe("model loader", () => {
  test("uses fresh cache without fetching", async () => {
    const fetchCalls: string[] = [];
    const hints: string[] = [];
    const optionsHistory: Array<{ models: string[]; preferredModel: string }> = [];

    await refreshModelList(
      createOptions({
        fetchModels: async (apiKey) => {
          fetchCalls.push(apiKey);
          return ["api-model"];
        },
        setHint: (text) => {
          hints.push(text);
        },
        populateOptions: (models, preferredModel) => {
          optionsHistory.push({ models, preferredModel });
        },
      })
    );

    expect(fetchCalls).toEqual([]);
    expect(optionsHistory).toEqual([{ models: ["cached-model"], preferredModel: "cached-model" }]);
    expect(hints).toEqual(["Loaded 1 models from cache."]);
  });

  test("fetches models, saves cache, and updates selected model when needed", async () => {
    let savedCache: ProviderModelCache | null = null;
    let selectedModel = "old-model";
    const optionsHistory: Array<{ models: string[]; preferredModel: string }> = [];
    const disabledStates: boolean[] = [];

    await refreshModelList(
      createOptions({
        getCache: () => null,
        getSelectedModel: () => selectedModel,
        setSelectedModel: (model) => {
          selectedModel = model;
        },
        saveCache: async (_provider, cache) => {
          savedCache = cache;
        },
        populateOptions: (models, preferredModel) => {
          optionsHistory.push({ models, preferredModel });
        },
        setRefreshDisabled: (disabled) => {
          disabledStates.push(disabled);
        },
      })
    );

    expect(optionsHistory).toEqual([
      { models: ["api-model", "backup-model"], preferredModel: "api-model" },
    ]);
    expect(selectedModel).toBe("api-model");
    expect(savedCache?.models).toEqual(["api-model", "backup-model"]);
    expect(disabledStates).toEqual([true, false]);
  });

  test("reports fetch failures and restores refresh button state", async () => {
    const hints: string[] = [];
    const disabledStates: boolean[] = [];

    await refreshModelList(
      createOptions({
        getCache: () => null,
        fetchModels: async () => {
          throw new Error("boom");
        },
        setHint: (text) => {
          hints.push(text);
        },
        setRefreshDisabled: (disabled) => {
          disabledStates.push(disabled);
        },
      })
    );

    expect(hints.at(-1)).toBe("Failed to load models: boom");
    expect(disabledStates).toEqual([true, false]);
  });
});
