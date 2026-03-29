import type { ProviderAuth, SttProvider } from "../settings";

export interface CorrectionRuntime {
  readonly id: SttProvider;
  readonly label: string;
  fetchModels(auth: ProviderAuth): Promise<string[]>;
  validateModel(auth: ProviderAuth, model: string): Promise<void>;
  correctText(
    auth: ProviderAuth,
    model: string,
    transcript: string,
    sourceLanguage?: string,
    targetLanguage?: string
  ): Promise<string>;
}
