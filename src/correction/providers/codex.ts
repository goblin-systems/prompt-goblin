import type { ProviderAuth } from "../../settings";
import type { CorrectionRuntime } from "../types";
import { buildCorrectionPromptParts, buildCorrectionUserPrompt } from "../prompt";
import { proxyFetch } from "../../proxy-fetch";

const OPENAI_WHAM_BASE = "https://chatgpt.com/backend-api/wham";
const OPENAI_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const OPENAI_CODEX_CLIENT_VERSION = "0.116.0";

const CODEX_MODEL_PRIORITY = [
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex",
  "gpt-5-codex",
  "gpt-5.1-codex-mini",
  "gpt-5-codex-mini",
] as const;

function requireOAuth(auth: ProviderAuth): Extract<ProviderAuth, { type: "oauth" }> {
  if (auth.type !== "oauth") {
    throw new Error("Codex correction requires OAuth authentication");
  }
  if (auth.expiresAt <= Date.now()) {
    throw new Error("OpenAI Codex OAuth session expired. Please reconnect (experimental).");
  }
  return auth;
}

function toCodexHeaders(auth: Extract<ProviderAuth, { type: "oauth" }>): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    "Content-Type": "application/json",
    "ChatGPT-Account-Id": auth.accountId,
    "OpenAI-Intent": "conversation-agent",
    originator: "prompt-goblin",
    "User-Agent": "prompt-goblin/0.1",
  };
}

function extractApiErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Unknown API error";
  }

  const maybeError = (payload as { error?: { message?: string } }).error;
  if (maybeError?.message) {
    return maybeError.message;
  }

  const maybeDetail = (payload as { detail?: unknown }).detail;
  if (typeof maybeDetail === "string") {
    return maybeDetail;
  }

  return "Unknown API error";
}

function isSupportedCodexModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.endsWith("-mini") && !normalized.includes("codex")) {
    return false;
  }

  return normalized.includes("codex") || normalized === "gpt-5";
}

function compareCodexPriority(left: string, right: string): number {
  const score = (model: string) => {
    const normalized = model.toLowerCase();
    const index = CODEX_MODEL_PRIORITY.findIndex(
      (candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`)
    );
    return index === -1 ? CODEX_MODEL_PRIORITY.length : index;
  };

  return score(left) - score(right) || left.localeCompare(right);
}

async function fetchCodexModels(auth: ProviderAuth): Promise<string[]> {
  const oauthAuth = requireOAuth(auth);
  const headers = toCodexHeaders(oauthAuth);

  const proxyResponse = await proxyFetch(
    `${OPENAI_WHAM_BASE}/models?client_version=${encodeURIComponent(OPENAI_CODEX_CLIENT_VERSION)}`,
    { method: "GET", headers }
  );

  let payload: unknown = null;
  try {
    payload = JSON.parse(proxyResponse.body);
  } catch {
    // non-JSON response
  }

  if (proxyResponse.status < 200 || proxyResponse.status >= 300) {
    throw new Error(
      `Failed to list Codex correction models: ${extractApiErrorMessage(payload)} (HTTP ${proxyResponse.status})`
    );
  }

  const discovered = new Set<string>();
  const models = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown> | null)?.data)
      ? (payload as { data: Array<Record<string, unknown>> }).data
      : Array.isArray((payload as Record<string, unknown> | null)?.models)
        ? (payload as { models: Array<Record<string, unknown>> }).models
        : [];

  for (const model of models) {
    if (!model || typeof model !== "object") {
      continue;
    }
    const entry = model as { id?: string; slug?: string; name?: string };
    const id =
      typeof entry.id === "string"
        ? entry.id
        : typeof entry.slug === "string"
          ? entry.slug
          : typeof entry.name === "string"
            ? entry.name
            : "";
    if (isSupportedCodexModel(id)) {
      discovered.add(id);
    }
  }

  return Array.from(discovered).sort(compareCodexPriority);
}

async function validateCodexModel(auth: ProviderAuth, model: string): Promise<void> {
  const normalized = model.trim();
  if (!normalized) {
    throw new Error("No correction model selected");
  }

  const models = await fetchCodexModels(auth);
  if (!models.includes(normalized)) {
    throw new Error(`Model '${normalized}' is not available for Codex correction`);
  }
}

/**
 * Parse SSE event text returned as a single string from the Codex responses endpoint.
 * Accumulates `response.output_text.delta` events into the final output.
 * Handles both \n and \r\n line endings (normalizes \r\n → \n before parsing).
 */
function parseCodexOutputTextFromSSE(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let transcript = "";

  for (const block of normalized.split("\n\n")) {
    let eventName = "";
    let eventData = "";

    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        eventData += line.slice(5).trim();
      }
    }

    if (!eventName || !eventData) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(eventData);
    } catch {
      continue;
    }

    if (eventName === "response.output_text.delta") {
      const delta = (parsed as { delta?: unknown }).delta;
      if (typeof delta === "string") {
        transcript += delta;
      }
    }
  }

  return transcript.trim();
}

async function correctCodexText(
  auth: ProviderAuth,
  model: string,
  transcript: string,
  sourceLanguage = "auto",
  targetLanguage = ""
): Promise<string> {
  const normalized = model.trim();
  if (!normalized) {
    throw new Error("No correction model selected");
  }

  if (!transcript.trim()) {
    return "";
  }

  const oauthAuth = requireOAuth(auth);
  const headers = toCodexHeaders(oauthAuth);

  // Build both the structured prompt parts and the combined user prompt.
  // The Codex backend may or may not read the top-level `instructions` field,
  // so we put the full instructions there AND embed them in the user message
  // as a belt-and-suspenders approach to ensure translation directives reach
  // the model regardless of backend behavior.
  const prompt = buildCorrectionPromptParts(transcript, sourceLanguage, targetLanguage);
  const userPrompt = buildCorrectionUserPrompt(transcript, sourceLanguage, targetLanguage);

  const proxyResponse = await proxyFetch(OPENAI_CODEX_RESPONSES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: normalized,
      instructions: prompt.instructions,
      store: false,
      stream: true,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }],
        },
      ],
    }),
  });

  if (proxyResponse.status < 200 || proxyResponse.status >= 300) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(proxyResponse.body);
    } catch {
      // non-JSON error body
    }
    throw new Error(
      `Codex correction failed: ${extractApiErrorMessage(payload)} (HTTP ${proxyResponse.status})`
    );
  }

  return parseCodexOutputTextFromSSE(proxyResponse.body).trim();
}

export const codexCorrectionProvider: CorrectionRuntime = {
  id: "openai",
  label: "Codex",
  fetchModels(auth: ProviderAuth) {
    return fetchCodexModels(auth);
  },
  validateModel(auth: ProviderAuth, model: string) {
    return validateCodexModel(auth, model);
  },
  correctText(
    auth: ProviderAuth,
    model: string,
    transcript: string,
    sourceLanguage?: string,
    targetLanguage?: string
  ) {
    return correctCodexText(
      auth,
      model,
      transcript,
      sourceLanguage ?? "auto",
      targetLanguage ?? ""
    );
  },
};
