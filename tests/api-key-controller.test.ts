import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ApiKeyController } from "../src/main/api-key-controller";
import { getDefaultSettings, type Settings } from "../src/settings";
import type { MainDom } from "../src/main/dom";
import type { SttProviderRuntime } from "../src/stt/types";

function createDomStub() {
  return {
    apiKeyInput: { value: "", type: "password" },
    testApiKeyBtn: { disabled: false },
    liveModelSelect: { disabled: false, value: "" },
    correctionModelSelect: { value: "" },
  } as unknown as MainDom;
}

function createRuntimeStub(overrides: Partial<SttProviderRuntime> = {}): SttProviderRuntime {
  return {
    id: "gemini",
    label: "Gemini",
    createLiveTranscriber: () => {
      throw new Error("unused");
    },
    fetchModels: async () => [],
    validateApiKey: async () => {},
    validateModel: async () => {},
    probeModelForTranscription: async () => {},
    transcribeWavBase64: async () => "",
    transcribeWithLivePipeline: async () => "",
    ...overrides,
  };
}

describe("api key controller", () => {
  let settings: Settings;
  let dom: MainDom;

  beforeEach(() => {
    settings = getDefaultSettings();
    dom = createDomStub();
  });

  test("handleProviderChange swaps provider UI and triggers refreshes", async () => {
    settings.providers.openai.apiKey = "openai-key";
    const refreshLiveModelList = mock(async () => {});
    const refreshCorrectionModelList = mock(async () => {});
    const updateConnectionStatus = mock(() => {});
    const updateApiKeyTextForProvider = mock(() => {});
    const updateTranscriptCorrectionUI = mock(() => {});
    const scheduleAutosave = mock(() => {});

    const controller = new ApiKeyController({
      dom,
      getCurrentSettings: () => settings,
      getActiveProvider: () => "openai",
      getActiveProviderRuntime: () => createRuntimeStub(),
      refreshLiveModelList,
      refreshCorrectionModelList,
      updateApiKeyTextForProvider,
      updateConnectionStatus,
      updateTranscriptCorrectionUI,
      setLiveModelHint: () => {},
      setCorrectionModelHint: () => {},
      populateLiveModelOptions: () => {},
      populateCorrectionModelOptions: () => {},
      scheduleAutosave,
      debugLog: () => {},
      saveLastKnownGoodModel: async () => {},
    });

    await controller.handleProviderChange();

    expect(settings.sttProvider).toBe("openai");
    expect(dom.apiKeyInput.value).toBe("openai-key");
    expect(updateApiKeyTextForProvider).toHaveBeenCalled();
    expect(updateConnectionStatus).toHaveBeenCalledWith("untested");
    expect(refreshLiveModelList).toHaveBeenCalledWith(false);
    expect(refreshCorrectionModelList).toHaveBeenCalledWith(false);
    expect(updateTranscriptCorrectionUI).toHaveBeenCalled();
    expect(scheduleAutosave).toHaveBeenCalledWith(0);
  });

  test("handleApiKeyInput clears state when api key becomes empty", () => {
    dom.apiKeyInput.value = "   ";
    const updateConnectionStatus = mock(() => {});
    const populateLiveModelOptions = mock(() => {});
    const populateCorrectionModelOptions = mock(() => {});
    const setLiveModelHint = mock(() => {});
    const setCorrectionModelHint = mock(() => {});
    const updateTranscriptCorrectionUI = mock(() => {});
    const scheduleAutosave = mock(() => {});

    const controller = new ApiKeyController({
      dom,
      getCurrentSettings: () => settings,
      getActiveProvider: () => "gemini",
      getActiveProviderRuntime: () => createRuntimeStub(),
      refreshLiveModelList: async () => {},
      refreshCorrectionModelList: async () => {},
      updateApiKeyTextForProvider: () => {},
      updateConnectionStatus,
      updateTranscriptCorrectionUI,
      setLiveModelHint,
      setCorrectionModelHint,
      populateLiveModelOptions,
      populateCorrectionModelOptions,
      scheduleAutosave,
      debugLog: () => {},
      saveLastKnownGoodModel: async () => {},
    });

    controller.handleApiKeyInput();

    expect(dom.testApiKeyBtn.disabled).toBe(true);
    expect(updateConnectionStatus).toHaveBeenCalledWith("disconnected");
    expect(populateLiveModelOptions).toHaveBeenCalledWith([], "");
    expect(populateCorrectionModelOptions).toHaveBeenCalledWith([], "");
    expect(setLiveModelHint).toHaveBeenCalledWith("Enter API key to fetch models.");
    expect(setCorrectionModelHint).toHaveBeenCalledWith("Enter API key to fetch correction models.");
    expect(updateTranscriptCorrectionUI).toHaveBeenCalled();
    expect(scheduleAutosave).toHaveBeenCalled();
  });

  test("handleApiKeyTest validates selected model and saves success state", async () => {
    settings.providers.gemini.apiKey = "gemini-key";
    dom.apiKeyInput.value = "gemini-key";
    dom.liveModelSelect.value = "gemini-live";
    const updateConnectionStatus = mock(() => {});
    const setLiveModelHint = mock(() => {});
    const debugLog = mock(() => {});
    const saveLastKnownGoodModel = mock(async () => {});
    const runtime = createRuntimeStub({
      validateModel: async () => {},
      probeModelForTranscription: async () => {},
    });

    const controller = new ApiKeyController({
      dom,
      getCurrentSettings: () => settings,
      getActiveProvider: () => "gemini",
      getActiveProviderRuntime: () => runtime,
      refreshLiveModelList: async () => {},
      refreshCorrectionModelList: async () => {},
      updateApiKeyTextForProvider: () => {},
      updateConnectionStatus,
      updateTranscriptCorrectionUI: () => {},
      setLiveModelHint,
      setCorrectionModelHint: () => {},
      populateLiveModelOptions: () => {},
      populateCorrectionModelOptions: () => {},
      scheduleAutosave: () => {},
      debugLog,
      saveLastKnownGoodModel,
    });

    await controller.handleApiKeyTest();

    expect(settings.providers.gemini.lastKnownGoodModel).toBe("gemini-live");
    expect(updateConnectionStatus).toHaveBeenCalledWith("connecting");
    expect(updateConnectionStatus).toHaveBeenCalledWith("connected");
    expect(setLiveModelHint).toHaveBeenCalledWith("Model 'gemini-live' validated successfully.");
    expect(saveLastKnownGoodModel).toHaveBeenCalledWith("gemini", "gemini-live");
    expect(dom.testApiKeyBtn.disabled).toBe(false);
  });

  test("handleApiKeyTest reports validation failures", async () => {
    settings.providers.gemini.apiKey = "gemini-key";
    dom.apiKeyInput.value = "gemini-key";
    dom.liveModelSelect.value = "bad-model";
    const updateConnectionStatus = mock(() => {});
    const debugLog = mock(() => {});

    const controller = new ApiKeyController({
      dom,
      getCurrentSettings: () => settings,
      getActiveProvider: () => "gemini",
      getActiveProviderRuntime: () =>
        createRuntimeStub({
          validateModel: async () => {
            throw new Error("validation failed");
          },
        }),
      refreshLiveModelList: async () => {},
      refreshCorrectionModelList: async () => {},
      updateApiKeyTextForProvider: () => {},
      updateConnectionStatus,
      updateTranscriptCorrectionUI: () => {},
      setLiveModelHint: () => {},
      setCorrectionModelHint: () => {},
      populateLiveModelOptions: () => {},
      populateCorrectionModelOptions: () => {},
      scheduleAutosave: () => {},
      debugLog,
      saveLastKnownGoodModel: async () => {},
    });

    await controller.handleApiKeyTest();

    expect(updateConnectionStatus).toHaveBeenCalledWith("error", "validation failed");
    expect(debugLog).toHaveBeenCalledWith("API/model test failed: validation failed", "ERROR");
    expect(dom.testApiKeyBtn.disabled).toBe(false);
  });
});
