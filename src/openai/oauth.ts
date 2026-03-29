import type { OpenAIOAuthSession } from "../settings";

const OPENAI_AUTH_BASE = "https://auth.openai.com";
const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_DEVICE_REDIRECT_URI = `${OPENAI_AUTH_BASE}/deviceauth/callback`;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface AuthClaims {
  chatgpt_account_id?: string;
  chatgpt_plan_type?: string;
  [key: string]: unknown;
}

function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    return {};
  }

  const payload = parts[1]
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");

  try {
    const json = atob(payload);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractAuthClaims(idToken: string | undefined, accessToken: string): AuthClaims {
  const idClaims = idToken ? decodeJwtClaims(idToken) : {};
  const accessClaims = decodeJwtClaims(accessToken);

  const idAuth = idClaims["https://api.openai.com/auth"];
  if (idAuth && typeof idAuth === "object") {
    return idAuth as AuthClaims;
  }

  const accessAuth = accessClaims["https://api.openai.com/auth"];
  if (accessAuth && typeof accessAuth === "object") {
    return accessAuth as AuthClaims;
  }

  return {
    chatgpt_account_id:
      (idClaims.chatgpt_account_id as string | undefined) ??
      (accessClaims.chatgpt_account_id as string | undefined),
    chatgpt_plan_type:
      (idClaims.chatgpt_plan_type as string | undefined) ??
      (accessClaims.chatgpt_plan_type as string | undefined),
  };
}

function buildSession(tokens: TokenResponse, fallbackRefreshToken?: string): OpenAIOAuthSession {
  const authClaims = extractAuthClaims(tokens.id_token, tokens.access_token);
  const accountId = authClaims.chatgpt_account_id;
  if (!accountId) {
    throw new Error("OpenAI Codex OAuth token did not include chatgpt_account_id");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? fallbackRefreshToken ?? "",
    expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in ?? 3600)) * 1000,
    accountId,
    planType: authClaims.chatgpt_plan_type ?? "unknown",
  };
}

export interface OpenAIDeviceCodeStartResult {
  verificationUrl: string;
  userCode: string;
  intervalSeconds: number;
  deviceAuthId: string;
}

export async function startOpenAIDeviceAuth(): Promise<OpenAIDeviceCodeStartResult> {
  const response = await fetch(`${OPENAI_AUTH_BASE}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "prompt-goblin/0.1",
    },
    body: JSON.stringify({
      client_id: OPENAI_OAUTH_CLIENT_ID,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        device_auth_id?: string;
        user_code?: string;
        usercode?: string;
        interval?: string | number;
      }
    | null;

  if (!response.ok || !payload?.device_auth_id || !(payload.user_code || payload.usercode)) {
    throw new Error("Failed to start OpenAI device authentication");
  }

  return {
    verificationUrl: `${OPENAI_AUTH_BASE}/codex/device`,
    userCode: payload.user_code ?? payload.usercode ?? "",
    intervalSeconds: Math.max(1, Number(payload.interval ?? 5) || 5),
    deviceAuthId: payload.device_auth_id,
  };
}

export async function pollOpenAIDeviceAuth(
  deviceAuthId: string,
  userCode: string,
  intervalSeconds: number,
  timeoutMs = 15 * 60 * 1000
): Promise<OpenAIOAuthSession> {
  const startedAt = Date.now();

  while (true) {
    const pollResponse = await fetch(`${OPENAI_AUTH_BASE}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "prompt-goblin/0.1",
      },
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode,
      }),
    });

    if (pollResponse.ok) {
      const codeData = (await pollResponse.json()) as {
        authorization_code?: string;
        code_verifier?: string;
      };

      if (!codeData.authorization_code || !codeData.code_verifier) {
        throw new Error("Device authorization returned an invalid response");
      }

      const tokenResponse = await fetch(`${OPENAI_AUTH_BASE}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "prompt-goblin/0.1",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: codeData.authorization_code,
          redirect_uri: OPENAI_DEVICE_REDIRECT_URI,
          client_id: OPENAI_OAUTH_CLIENT_ID,
          code_verifier: codeData.code_verifier,
        }),
      });

      const tokenPayload = (await tokenResponse.json().catch(() => null)) as TokenResponse | null;
      if (!tokenResponse.ok || !tokenPayload?.access_token) {
        throw new Error("OpenAI Codex OAuth token exchange failed");
      }

      return buildSession(tokenPayload);
    }

    if (pollResponse.status !== 403 && pollResponse.status !== 404) {
      throw new Error("OpenAI device authentication failed");
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("OpenAI device authentication timed out");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000 + 250));
  }
}

export async function refreshOpenAIOAuthSession(
  session: OpenAIOAuthSession
): Promise<OpenAIOAuthSession> {
  const response = await fetch(`${OPENAI_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "prompt-goblin/0.1",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: OPENAI_OAUTH_CLIENT_ID,
    }),
  });

  const payload = (await response.json().catch(() => null)) as TokenResponse | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error("OpenAI Codex OAuth refresh failed");
  }

  return buildSession(payload, session.refreshToken);
}
