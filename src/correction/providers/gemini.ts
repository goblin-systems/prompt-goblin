import type { CorrectionRuntime } from "../types";

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

function buildCorrectionPrompt(
  transcript: string,
  sourceLanguage: string,
  targetLanguage: string
): string {
  const sourceLanguageInstruction =
    !sourceLanguage || sourceLanguage === "auto"
      ? "The source language may vary, so infer it from the transcript."
      : `The source language is ${sourceLanguage}.`;
  const shouldTranslate = !!targetLanguage.trim();
  const outputLanguageInstruction = shouldTranslate
    ? `Translate the corrected transcript into ${targetLanguage.trim()}. Your final output must be entirely in ${targetLanguage.trim()}.`
    : "Keep the corrected transcript in the original language.";

  return [
    "You are cleaning up speech-to-text output before it is typed into another app.",
    "Correct obvious transcription mistakes, casing, and word boundaries.",
    shouldTranslate
      ? "If the user dictated text in another language, first understand the intended meaning, then produce a natural translation in the target language."
      : "Do not translate unless explicitly instructed.",
    "Do not add commentary, quotes, markdown, or explanations.",
    "Preserve the user's wording and meaning as closely as possible.",
    "Very important: preserve spoken command phrases exactly when they appear to be intentional dictation commands, such as comma, period, full stop, question mark, exclamation mark, colon, semicolon, quote, open quote, close quote, apostrophe, new line, new paragraph, tab, open bracket, close bracket, open parenthesis, close parenthesis, open brace, close brace, slash, backslash, dash, underscore, plus, equals.",
    "Do not convert those command phrases into punctuation. Leave them as words so a later text-command pass can handle them.",
    sourceLanguageInstruction,
    outputLanguageInstruction,
    "Return only the final corrected transcript text.",
    "",
    transcript,
  ].join("\n");
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
            parts: [{ text: buildCorrectionPrompt(transcript, sourceLanguage, targetLanguage) }],
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
  fetchModels(apiKey: string) {
    return fetchGeminiCorrectionModels(apiKey);
  },
  validateModel(apiKey: string, model: string) {
    return validateGeminiCorrectionModel(apiKey, model);
  },
  correctText(
    apiKey: string,
    model: string,
    transcript: string,
    sourceLanguage?: string,
    targetLanguage?: string
  ) {
    return correctGeminiText(
      apiKey,
      model,
      transcript,
      sourceLanguage ?? "auto",
      targetLanguage ?? ""
    );
  },
};
