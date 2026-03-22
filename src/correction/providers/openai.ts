import type { CorrectionRuntime } from "../types";
import { buildCorrectionPromptParts } from "../prompt";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const OPENAI_CORRECTION_MODEL_PRIORITY = [
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4o",
  "gpt-5-mini",
  "gpt-5",
] as const;

function normalizeModelName(model: string): string {
  return model.trim();
}

function toAuthHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function extractApiErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Unknown API error";
  }

  const maybeError = (payload as { error?: { message?: string } }).error;
  return maybeError?.message || "Unknown API error";
}

function isSupportedOpenAICorrectionModel(model: string): boolean {
  const normalized = normalizeModelName(model).toLowerCase();
  if (!normalized) {
    return false;
  }

  return OPENAI_CORRECTION_MODEL_PRIORITY.some(
    (candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`)
  );
}

function compareOpenAICorrectionPriority(left: string, right: string): number {
  const score = (model: string) => {
    const normalized = model.toLowerCase();
    const index = OPENAI_CORRECTION_MODEL_PRIORITY.findIndex(
      (candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`)
    );
    return index === -1 ? OPENAI_CORRECTION_MODEL_PRIORITY.length : index;
  };

  return score(left) - score(right) || left.localeCompare(right);
}

async function fetchOpenAICorrectionModels(apiKey: string): Promise<string[]> {
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  const response = await fetch(`${OPENAI_API_BASE}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: Array<{ id?: string }>; error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(
      `Failed to list OpenAI correction models: ${extractApiErrorMessage(payload)} (HTTP ${response.status})`
    );
  }

  const discovered = new Set<string>();
  for (const model of payload?.data ?? []) {
    const id = typeof model.id === "string" ? model.id : "";
    if (isSupportedOpenAICorrectionModel(id)) {
      discovered.add(id);
    }
  }

  return Array.from(discovered).sort(compareOpenAICorrectionPriority);
}

async function validateOpenAICorrectionModel(apiKey: string, model: string): Promise<void> {
  const normalized = normalizeModelName(model);
  if (!normalized) {
    throw new Error("No correction model selected");
  }

  const models = await fetchOpenAICorrectionModels(apiKey);
  if (!models.includes(normalized)) {
    throw new Error(`Model '${normalized}' is not available for correction`);
  }
}

function extractOpenAIResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string") {
    return direct.trim();
  }

  const output = (payload as {
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
  }).output;

  return (
    output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text" || typeof item.text === "string")
      .map((item) => item.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

async function correctOpenAIText(
  apiKey: string,
  model: string,
  transcript: string,
  sourceLanguage = "auto",
  targetLanguage = ""
): Promise<string> {
  const normalized = normalizeModelName(model);
  if (!normalized) {
    throw new Error("No correction model selected");
  }

  if (!transcript.trim()) {
    return "";
  }

  const prompt = buildCorrectionPromptParts(transcript, sourceLanguage, targetLanguage);

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: toAuthHeaders(apiKey),
    body: JSON.stringify({
      model: normalized,
      instructions: prompt.instructions,
      input: prompt.input,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `OpenAI correction failed: ${extractApiErrorMessage(payload)} (HTTP ${response.status})`
    );
  }

  return extractOpenAIResponseText(payload);
}

export const openAICorrectionProvider: CorrectionRuntime = {
  id: "openai",
  label: "OpenAI",
  fetchModels(apiKey: string) {
    return fetchOpenAICorrectionModels(apiKey);
  },
  validateModel(apiKey: string, model: string) {
    return validateOpenAICorrectionModel(apiKey, model);
  },
  correctText(
    apiKey: string,
    model: string,
    transcript: string,
    sourceLanguage?: string,
    targetLanguage?: string
  ) {
    return correctOpenAIText(
      apiKey,
      model,
      transcript,
      sourceLanguage ?? "auto",
      targetLanguage ?? ""
    );
  },
};
