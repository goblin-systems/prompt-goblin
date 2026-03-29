import type { CorrectionRuntime } from "../types";
import { buildCorrectionUserPrompt } from "../prompt";
import type { ProviderAuth } from "../../settings";

type ModelListResponse = {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
};

function normalizeModelName(model: string): string {
  return model.replace(/^models\//, "").trim();
}

function toModelResource(model: string): string {
  return `models/${normalizeModelName(model)}`;
}

function extractApiErrorMessage(body: string): string {
  if (!body) {
    return "No error details returned";
  }

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string };
    };
    if (parsed.error?.message) {
      return parsed.error.status
        ? `${parsed.error.message} (${parsed.error.status})`
        : parsed.error.message;
    }
  } catch {
    // fall through
  }

  return body;
}

function isSupportedGeminiCorrectionModel(modelName: string, methods: string[]): boolean {
  const normalized = normalizeModelName(modelName).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (!methods.includes("generatecontent")) {
    return false;
  }

  if (
    normalized.includes("embedding") ||
    normalized.includes("aqa") ||
    normalized.includes("image") ||
    normalized.includes("tts") ||
    normalized.includes("transcribe") ||
    normalized.includes("live") ||
    normalized.includes("native-audio")
  ) {
    return false;
  }

  return normalized.startsWith("gemini");
}

function compareGeminiCorrectionPriority(left: string, right: string): number {
  const score = (model: string) => {
    const normalized = normalizeModelName(model).toLowerCase();
    if (normalized.includes("2.5-flash-lite")) return 0;
    if (normalized.includes("2.5-flash")) return 1;
    if (normalized.includes("2.0-flash")) return 2;
    if (normalized.includes("flash")) return 3;
    if (normalized.includes("pro")) return 4;
    return 5;
  };

  return score(left) - score(right) || left.localeCompare(right);
}

async function fetchGeminiCorrectionModels(apiKey: string): Promise<string[]> {
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Failed to list Gemini correction models: ${extractApiErrorMessage(body)} (HTTP ${response.status})`
    );
  }

  const parsed = JSON.parse(body) as ModelListResponse;
  const models = new Set<string>();

  for (const model of parsed.models ?? []) {
    if (!model.name) {
      continue;
    }

    const methods = (model.supportedGenerationMethods ?? []).map((method) => method.toLowerCase());
    if (!isSupportedGeminiCorrectionModel(model.name, methods)) {
      continue;
    }

    models.add(normalizeModelName(model.name));
  }

  return Array.from(models).sort(compareGeminiCorrectionPriority);
}

function requireGeminiApiKey(auth: ProviderAuth): string {
  if (auth.type !== "api_key") {
    throw new Error("Gemini correction requires API key authentication");
  }
  return auth.token;
}

async function validateGeminiCorrectionModel(apiKey: string, model: string): Promise<void> {
  const normalized = normalizeModelName(model);
  if (!normalized) {
    throw new Error("No correction model selected");
  }

  const models = await fetchGeminiCorrectionModels(apiKey);
  if (!models.includes(normalized)) {
    throw new Error(`Model '${normalized}' is not available for correction`);
  }
}

function extractGenerateContentText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidates = (payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  }).candidates;

  const text = candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  return text ?? "";
}

async function correctGeminiText(
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${toModelResource(normalized)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildCorrectionUserPrompt(transcript, sourceLanguage, targetLanguage) }],
          },
        ],
      }),
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `Gemini correction failed: ${extractApiErrorMessage(raw)} (HTTP ${response.status})`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "";
  }

  return extractGenerateContentText(parsed).trim();
}

export const geminiCorrectionProvider: CorrectionRuntime = {
  id: "gemini",
  label: "Gemini",
  fetchModels(auth: ProviderAuth) {
    return fetchGeminiCorrectionModels(requireGeminiApiKey(auth));
  },
  validateModel(auth: ProviderAuth, model: string) {
    return validateGeminiCorrectionModel(requireGeminiApiKey(auth), model);
  },
  correctText(
    auth: ProviderAuth,
    model: string,
    transcript: string,
    sourceLanguage?: string,
    targetLanguage?: string
  ) {
    const apiKey = requireGeminiApiKey(auth);
    return correctGeminiText(
      apiKey,
      model,
      transcript,
      sourceLanguage ?? "auto",
      targetLanguage ?? ""
    );
  },
};
