#!/usr/bin/env node

import { setTimeout as sleep } from "node:timers/promises";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AUTH_BASE = "https://auth.openai.com";
const OPENAI_API_BASE = "https://api.openai.com";
const WHAM_BASE = "https://chatgpt.com/backend-api/wham";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const SCOPE = "openid profile email offline_access";
const BROWSER_REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEVICE_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;
const CODEX_CLIENT_VERSION = "0.116.0";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, "auth.json");

const command = process.argv[2] ?? "help";

async function main() {
  switch (command) {
    case "login":
      await loginWithDeviceFlow();
      return;
    case "models":
      await listModels();
      return;
    case "probe":
      await runProbe();
      return;
    case "help":
    case "-h":
    case "--help":
    default:
      printHelp();
  }
}

function printHelp() {
  console.log("OpenAI OAuth PoC (device flow)");
  console.log("");
  console.log("Usage:");
  console.log("  node oauth-poc/index.mjs login");
  console.log("  node oauth-poc/index.mjs models");
  console.log("  node oauth-poc/index.mjs probe");
  console.log("");
  console.log("Commands:");
  console.log("  login   Run device auth and save tokens to oauth-poc/auth.json");
  console.log("  models  Show model access with subscription token");
  console.log("  probe   Run broader endpoint compatibility probes");
}

async function loginWithDeviceFlow() {
  console.log("Requesting device code...");
  const userCode = await requestDeviceCode();

  console.log("");
  console.log("1) Open this URL in your browser:");
  console.log(`   ${AUTH_BASE}/codex/device`);
  console.log("2) Enter this one-time code:");
  console.log(`   ${userCode.user_code}`);
  console.log("");
  console.log("Polling for approval...");

  const codeData = await pollForAuthorizationCode(userCode);
  const tokenResponse = await exchangeAuthorizationCode(codeData);

  const authRecord = createAuthRecord(tokenResponse);
  await saveAuth(authRecord);

  console.log("\nLogin successful.");
  console.log(`Saved tokens to: ${AUTH_FILE}`);

  const accountId = getAccountId(authRecord);
  const plan = getPlan(authRecord);
  if (accountId) {
    console.log(`ChatGPT account id: ${accountId}`);
  }
  if (plan) {
    console.log(`Detected plan type: ${plan}`);
  }
}

async function requestDeviceCode() {
  const response = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "prompt-goblin-oauth-poc/0.1",
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Device code request failed (${response.status}): ${text}`);
  }

  const parsed = JSON.parse(text);
  return {
    device_auth_id: parsed.device_auth_id,
    user_code: parsed.user_code ?? parsed.usercode,
    interval: Number.parseInt(parsed.interval ?? "5", 10) || 5,
  };
}

async function pollForAuthorizationCode(deviceCode) {
  const startedAt = Date.now();
  const timeoutMs = 15 * 60 * 1000;

  while (true) {
    const response = await fetch(`${AUTH_BASE}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "prompt-goblin-oauth-poc/0.1",
      },
      body: JSON.stringify({
        device_auth_id: deviceCode.device_auth_id,
        user_code: deviceCode.user_code,
      }),
    });

    if (response.ok) {
      const parsed = await response.json();
      return {
        authorization_code: parsed.authorization_code,
        code_challenge: parsed.code_challenge,
        code_verifier: parsed.code_verifier,
      };
    }

    const retryable = response.status === 403 || response.status === 404;
    if (!retryable) {
      const text = await response.text();
      throw new Error(`Device poll failed (${response.status}): ${text}`);
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for device authorization.");
    }

    await sleep(deviceCode.interval * 1000);
  }
}

async function exchangeAuthorizationCode(codeData) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: codeData.authorization_code,
    client_id: CLIENT_ID,
    redirect_uri: DEVICE_REDIRECT_URI,
    code_verifier: codeData.code_verifier,
  });

  const response = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "prompt-goblin-oauth-poc/0.1",
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return JSON.parse(text);
}

function createAuthRecord(tokenResponse) {
  const now = Date.now();
  const expiresInSeconds = Number(tokenResponse.expires_in ?? 0);
  const expiresAtMs = now + expiresInSeconds * 1000;

  return {
    created_at: now,
    expires_at: expiresAtMs,
    client_id: CLIENT_ID,
    redirect_uri: DEVICE_REDIRECT_URI,
    browser_redirect_uri: BROWSER_REDIRECT_URI,
    scope: SCOPE,
    tokens: {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      id_token: tokenResponse.id_token,
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in,
    },
  };
}

async function saveAuth(authRecord) {
  await writeFile(AUTH_FILE, `${JSON.stringify(authRecord, null, 2)}\n`, "utf8");
}

async function loadAuth() {
  if (!existsSync(AUTH_FILE)) {
    throw new Error("No auth.json found. Run `node oauth-poc/index.mjs login` first.");
  }

  const text = await readFile(AUTH_FILE, "utf8");
  return JSON.parse(text);
}

async function refreshIfNeeded(authRecord) {
  const refreshToken = authRecord?.tokens?.refresh_token;
  const expiresAt = Number(authRecord?.expires_at ?? 0);
  const expiringSoon = Date.now() > expiresAt - 60_000;

  if (!refreshToken || !expiringSoon) {
    return authRecord;
  }

  console.log("Access token expired/expiring soon, refreshing...");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const response = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "prompt-goblin-oauth-poc/0.1",
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Refresh failed (${response.status}): ${text}`);
  }

  const refreshed = JSON.parse(text);
  const now = Date.now();
  const expiresAtMs = now + Number(refreshed.expires_in ?? 0) * 1000;

  const next = {
    ...authRecord,
    expires_at: expiresAtMs,
    tokens: {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? refreshToken,
      id_token: refreshed.id_token ?? authRecord.tokens.id_token,
      token_type: refreshed.token_type,
      expires_in: refreshed.expires_in,
    },
  };

  await saveAuth(next);
  return next;
}

async function listModels() {
  let auth = await loadAuth();
  auth = await refreshIfNeeded(auth);

  const accountId = getAccountId(auth);
  if (!accountId) {
    throw new Error("Could not extract chatgpt_account_id from token claims.");
  }

  console.log(`Using ChatGPT account id: ${accountId}`);
  console.log("");

  await probeModelsEndpoint(
    "WHAM /models",
    `${WHAM_BASE}/models?client_version=${encodeURIComponent(CODEX_CLIENT_VERSION)}`,
    auth,
    accountId,
  );
  await probeModelsEndpoint("WHAM /v1/models", `${WHAM_BASE}/v1/models`, auth, accountId);
  await probeModelsEndpoint("OpenAI /v1/models", `${OPENAI_API_BASE}/v1/models`, auth, accountId);
}

async function runProbe() {
  let auth = await loadAuth();
  auth = await refreshIfNeeded(auth);

  const accountId = getAccountId(auth);
  if (!accountId) {
    throw new Error("Could not extract chatgpt_account_id from token claims.");
  }

  console.log(`Using ChatGPT account id: ${accountId}`);
  const plan = getPlan(auth);
  if (plan) {
    console.log(`Detected plan type: ${plan}`);
  }

  console.log("\n== Model endpoints ==");
  await probeModelsEndpoint(
    "WHAM /models",
    `${WHAM_BASE}/models?client_version=${encodeURIComponent(CODEX_CLIENT_VERSION)}`,
    auth,
    accountId,
  );
  await probeModelsEndpoint("WHAM /v1/models", `${WHAM_BASE}/v1/models`, auth, accountId);
  await probeModelsEndpoint("OpenAI /v1/models", `${OPENAI_API_BASE}/v1/models`, auth, accountId);

  console.log("\n== Responses endpoint ==");
  await probeJsonEndpoint("WHAM /responses", `${WHAM_BASE}/responses`, auth, accountId, {
    model: "gpt-5-mini",
    input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
    max_output_tokens: 32,
  });

  await probeWhamModelCandidates(auth, accountId);

  await probeJsonEndpoint("OpenAI /v1/responses", `${OPENAI_API_BASE}/v1/responses`, auth, accountId, {
    model: "gpt-5-mini",
    input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
    max_output_tokens: 32,
  });

  console.log("\n== Audio transcription endpoint ==");
  await probeAudioEndpoint("OpenAI /v1/audio/transcriptions", `${OPENAI_API_BASE}/v1/audio/transcriptions`, auth, accountId);
  await probeAudioModelCandidates(auth, accountId);
  await probeRealtimeTranscriptionSession(auth, accountId);
  await probeAudioEndpoint("WHAM /audio/transcriptions", `${WHAM_BASE}/audio/transcriptions`, auth, accountId);
}

async function probeModelsEndpoint(label, url, auth, accountId) {
  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(auth.tokens.access_token, accountId),
  });

  const text = await response.text();
  if (!response.ok) {
    console.log(`${label}: FAIL (${response.status})`);
    printBodySnippet(text);
    return;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`${label}: OK (${response.status}) but non-JSON response`);
    printBodySnippet(text);
    return;
  }

  const modelIds = extractModelIds(json);
  console.log(`${label}: OK (${response.status})`);
  if (modelIds.length === 0) {
    console.log("  No model IDs found in response shape.");
    return;
  }

  console.log(`  Models (${modelIds.length}):`);
  for (const modelId of modelIds.slice(0, 30)) {
    console.log(`    - ${modelId}`);
  }
  if (modelIds.length > 30) {
    console.log(`    ... and ${modelIds.length - 30} more`);
  }
}

async function probeJsonEndpoint(label, url, auth, accountId, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(auth.tokens.access_token, accountId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    console.log(`${label}: FAIL (${response.status})`);
    printBodySnippet(text);
    return;
  }

  console.log(`${label}: OK (${response.status})`);
  printBodySnippet(text);
}

async function probeAudioEndpoint(label, url, auth, accountId) {
  const form = new FormData();
  form.set("model", "gpt-4o-transcribe");
  form.set("response_format", "json");

  const wavBytes = createSilentWavBytes(16000, 120);
  const blob = new Blob([wavBytes], { type: "audio/wav" });
  form.set("file", blob, "silence.wav");

  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(auth.tokens.access_token, accountId),
    body: form,
  });

  const text = await response.text();
  if (!response.ok) {
    console.log(`${label}: FAIL (${response.status})`);
    printBodySnippet(text);
    return;
  }

  console.log(`${label}: OK (${response.status})`);
  printBodySnippet(text);
}

async function probeAudioModelCandidates(auth, accountId) {
  const candidates = [
    "gpt-4o-transcribe",
    "gpt-4o-mini-transcribe",
    "gpt-4o-transcribe-diarize",
    "whisper-1",
  ];

  console.log("\nOpenAI transcription model candidates:");
  for (const model of candidates) {
    const form = new FormData();
    form.set("model", model);
    form.set("response_format", "json");

    const wavBytes = createSilentWavBytes(16000, 120);
    const blob = new Blob([wavBytes], { type: "audio/wav" });
    form.set("file", blob, "silence.wav");

    const response = await fetch(`${OPENAI_API_BASE}/v1/audio/transcriptions`, {
      method: "POST",
      headers: authHeaders(auth.tokens.access_token, accountId),
      body: form,
    });

    const text = await response.text();
    if (response.ok) {
      console.log(`  ${model}: OK (${response.status})`);
      continue;
    }

    const compact = String(text).replace(/\s+/g, " ").trim();
    const note = compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
    console.log(`  ${model}: FAIL (${response.status}) - ${note}`);
  }
}

async function probeRealtimeTranscriptionSession(auth, accountId) {
  const payload = {
    input_audio_format: "pcm16",
    input_audio_transcription: {
      model: "gpt-4o-transcribe",
    },
  };

  const response = await fetch(`${OPENAI_API_BASE}/v1/realtime/transcription_sessions`, {
    method: "POST",
    headers: {
      ...authHeaders(auth.tokens.access_token, accountId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    console.log(`OpenAI /v1/realtime/transcription_sessions: FAIL (${response.status})`);
    printBodySnippet(text);
    return;
  }

  console.log(`OpenAI /v1/realtime/transcription_sessions: OK (${response.status})`);
  printBodySnippet(text);
}

async function probeWhamModelCandidates(auth, accountId) {
  const candidates = [
    "gpt-5-codex",
    "gpt-5.3-codex",
    "gpt-5.4-codex",
    "gpt-5",
    "gpt-5-mini",
    "gpt-4.1",
  ];

  console.log("\nWHAM candidate models (/responses):");
  for (const model of candidates) {
    const response = await fetch(`${WHAM_BASE}/responses`, {
      method: "POST",
      headers: {
        ...authHeaders(auth.tokens.access_token, accountId),
        "Content-Type": "application/json",
        "OpenAI-Intent": "conversation-agent",
      },
      body: JSON.stringify({
        model,
        instructions: "You are a concise assistant.",
        store: false,
        stream: true,
        input: [{ role: "user", content: [{ type: "input_text", text: "Reply with just ok" }] }],
        max_output_tokens: 16,
      }),
    });

    const text = await response.text();
    if (response.ok) {
      console.log(`  ${model}: OK (${response.status})`);
      continue;
    }

    const compact = String(text).replace(/\s+/g, " ").trim();
    const note = compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
    console.log(`  ${model}: FAIL (${response.status}) - ${note}`);
  }
}

function authHeaders(accessToken, accountId) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "ChatGPT-Account-Id": accountId,
    "User-Agent": "prompt-goblin-oauth-poc/0.1",
    Accept: "application/json",
  };
}

function extractModelIds(json) {
  if (Array.isArray(json?.data)) {
    return json.data.map((entry) => entry?.id).filter(Boolean);
  }
  if (Array.isArray(json?.models)) {
    return json.models
      .map((entry) => entry?.id ?? entry?.slug ?? entry?.name)
      .filter(Boolean);
  }
  if (Array.isArray(json)) {
    return json
      .map((entry) => entry?.id ?? entry?.slug ?? entry?.name)
      .filter(Boolean);
  }
  return [];
}

function decodeJwtPayload(jwt) {
  if (!jwt || typeof jwt !== "string") {
    return null;
  }
  const parts = jwt.split(".");
  if (parts.length < 2) {
    return null;
  }

  const payload = parts[1]
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");

  try {
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getAccountId(authRecord) {
  const idClaims = decodeJwtPayload(authRecord?.tokens?.id_token) ?? {};
  const accessClaims = decodeJwtPayload(authRecord?.tokens?.access_token) ?? {};
  const authClaims = idClaims["https://api.openai.com/auth"] ?? accessClaims["https://api.openai.com/auth"] ?? {};

  return (
    idClaims.chatgpt_account_id ??
    accessClaims.chatgpt_account_id ??
    authClaims.chatgpt_account_id ??
    authClaims.account_id ??
    null
  );
}

function getPlan(authRecord) {
  const idClaims = decodeJwtPayload(authRecord?.tokens?.id_token) ?? {};
  const accessClaims = decodeJwtPayload(authRecord?.tokens?.access_token) ?? {};
  const authClaims = idClaims["https://api.openai.com/auth"] ?? accessClaims["https://api.openai.com/auth"] ?? {};

  return authClaims.chatgpt_plan_type ?? idClaims.chatgpt_plan_type ?? accessClaims.chatgpt_plan_type ?? null;
}

function printBodySnippet(body) {
  const compact = String(body).replace(/\s+/g, " ").trim();
  if (compact.length === 0) {
    console.log("  (empty response body)");
    return;
  }

  const max = 320;
  if (compact.length <= max) {
    console.log(`  ${compact}`);
    return;
  }

  console.log(`  ${compact.slice(0, max)}...`);
}

function createSilentWavBytes(sampleRate, durationMs) {
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
