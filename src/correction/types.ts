import type { SttProvider } from "../settings";

export interface CorrectionRuntime {
  readonly id: SttProvider;
  readonly label: string;
  fetchModels(apiKey: string): Promise<string[]>;
  validateModel(apiKey: string, model: string): Promise<void>;
  correctText(
    apiKey: string,
    model: string,
    transcript: string,
    sourceLanguage?: string,
    targetLanguage?: string
  ): Promise<string>;
}
