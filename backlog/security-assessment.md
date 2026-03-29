# Prompt Goblin Security Assessment

Date: 2026-03-28

## Executive Summary

Prompt Goblin has a relatively small application surface, but it handles high-sensitivity assets: microphone audio, typed transcript content, provider API keys, and experimental OpenAI OAuth tokens. The main security posture issue is not remote compromise today; it is local compromise and accidental exposure. The app currently stores provider credentials and OAuth refresh tokens in the Tauri store without OS-backed secret protection, and the worktree also contains a live OAuth token artifact under `oauth-poc/`.

The desktop trust boundary is also broad. The app disables CSP, exposes the Tauri API globally, and recently added a generic Rust HTTP proxy that can make arbitrary outbound requests on behalf of the frontend. That combination is not an immediate exploit by itself, but it materially increases blast radius if the renderer is ever compromised.

Overall posture: functional for a personal desktop tool, but not yet aligned with the privacy-oriented positioning in the README for wider distribution without tightening secret storage, debug data handling, and renderer-to-backend boundaries.

## Scope And Method

Reviewed representative app, Tauri, auth, workflow, and test files with targeted searches for auth, secret storage, network calls, desktop permissions, and debug/logging behavior.

## Threat Surface

- Provider credentials: Gemini API keys, OpenAI API keys, and experimental OpenAI OAuth access/refresh tokens in `src/settings.ts:21`, `src/settings.ts:37`, `src/settings.ts:492`.
- Sensitive user data: microphone audio capture and transcript typing in `src-tauri/src/audio.rs:390`, `src-tauri/src/keyboard.rs:76`.
- Network egress: direct calls to Google/OpenAI plus OpenAI auth endpoints in `src/stt/providers/openai.ts:20`, `src/openai/oauth.ts:3`, `src/correction/providers/codex.ts:6`.
- Desktop-native powers: global shortcut registration, always-on-top overlay, synthetic keyboard input, local file logging, and external URL opening in `src-tauri/src/lib.rs:15`, `src-tauri/src/lib.rs:28`, `src-tauri/src/keyboard.rs:76`, `src-tauri/src/debug_log.rs:127`.
- Renderer-to-backend bridge: Tauri API globally exposed and CSP disabled in `src-tauri/tauri.conf.json:13`, `src-tauri/tauri.conf.json:44`.
- Release/process surface: only CI and release workflows present; no repository-native secret scanning, dependency review, or signing/notarization steps in `.github/workflows/ci.yml:1`, `.github/workflows/release.yml:1`.

## Key Findings

| Severity | Finding |
| --- | --- |
| High | Credentials and OAuth refresh tokens are persisted in plaintext app settings |
| High | Live OAuth token artifact exists in the worktree under `oauth-poc/auth.json` |
| Medium | Renderer compromise would have high impact because CSP is disabled and Tauri is globally exposed |
| Medium | New generic Rust HTTP proxy permits arbitrary outbound requests from frontend code |
| Medium | Debug mode can persist full typed text and raw microphone audio locally |
| Medium | Release and CI process lacks security gates expected for a desktop app handling secrets |

## Detailed Findings

### 1. High - Credentials and OAuth refresh tokens are persisted in plaintext app settings

Evidence

- `src/settings.ts:177` loads `settings.json` through `@tauri-apps/plugin-store` with autosave.
- `src/settings.ts:495` writes the full `providers` object back to the store.
- `src/settings.ts:30` and `src/settings.ts:37` define persisted OpenAI API key and OAuth session fields, including `accessToken` and `refreshToken`.
- `src/main/settings-controller.ts:135` writes the API key from the UI into the settings model before save.

Why it matters

- Any local malware, hostile local user, backup leak, or filesystem disclosure can recover reusable provider credentials.
- The OpenAI refresh token is materially more sensitive than an access token because it enables session renewal and longer-lived account abuse.
- This weakens the README privacy positioning because protecting local secrets is part of privacy for a desktop app.

Likely exploit/impact narrative

- An infostealer or another local process reads the app data store, extracts provider API keys or the OpenAI refresh token, and uses them for account abuse, billable API use, or access to user-linked provider resources.

Recommended mitigation

- Move API keys and OAuth refresh tokens to OS-backed secret storage (`keyring`, Windows Credential Manager, macOS Keychain, libsecret).
- Keep only non-sensitive metadata in the Tauri store, such as selected provider, model, and token expiry.
- Treat refresh tokens as higher sensitivity than API keys and minimize retention.
- Add migration logic to remove legacy plaintext secrets from existing settings files after successful import.

### 2. High - Live OAuth token artifact exists in the worktree under `oauth-poc/auth.json`

Evidence

- `oauth-poc/README.md:29` states tokens are saved to `oauth-poc/auth.json`.
- `oauth-poc/index.mjs:199` writes the auth record, including access, refresh, and ID tokens, to disk.
- `oauth-poc/auth.json:1` currently contains live OAuth material and account metadata.
- `oauth-poc/.gitignore:1` ignores the file, and `git check-ignore -v "oauth-poc/auth.json"` confirms that ignore rule is active.

Why it matters

- Even though the file is ignored, it is present inside the repository directory where accidental packaging, manual sharing, screen sharing, backup sync, or future force-add mistakes are plausible.
- The artifact contains enough material for account/session abuse and personal metadata exposure.

Likely exploit/impact narrative

- A contributor zips the repo, uploads a support bundle, or force-adds the file during future work; the token artifact then escapes local control and enables unauthorized provider access.

Recommended mitigation

- Remove the live token artifact from the working tree immediately and rotate the affected session/refresh token.
- Do not keep test auth artifacts inside the main repository tree; use a location outside the repo or OS secret storage.
- Add a root-level ignore rule and pre-commit secret scanning to reduce accidental inclusion.

### 3. Medium - Renderer compromise would have high impact because CSP is disabled and Tauri is globally exposed

Evidence

- `src-tauri/tauri.conf.json:13` sets `withGlobalTauri` to `true`.
- `src-tauri/tauri.conf.json:44` sets `csp` to `null`.
- `src-tauri/src/lib.rs:17` exposes powerful commands including `http_fetch`, `type_text`, file-backed debug logging, and mic capture control.
- `src-tauri/capabilities/default.json:7` grants the default capability set to both windows.

Why it matters

- Current code review did not find an obvious renderer injection sink of equivalent severity, but the defensive posture is weak.
- If future UI work introduces XSS, malicious content would not just affect the DOM; it could invoke privileged native commands and exfiltrate data.

Likely exploit/impact narrative

- A future DOM injection bug or compromised dependency executes in the renderer, calls Tauri commands, reads sensitive responses, types arbitrary text into other apps, or makes arbitrary outbound requests through the backend proxy.

Recommended mitigation

- Re-enable a restrictive CSP for packaged content.
- Turn off `withGlobalTauri` and use the scoped API import pattern only where required.
- Narrow capabilities and exposed commands per window, especially for the overlay.
- Treat new renderer sinks (`innerHTML`, remote content, markdown rendering) as security-sensitive review points.

### 4. Medium - New generic Rust HTTP proxy permits arbitrary outbound requests from frontend code

Evidence

- `src-tauri/src/http_proxy.rs:20` exposes a Tauri command that accepts arbitrary `url`, `method`, `headers`, and `body`.
- `src/proxy-fetch.ts:12` wraps that command for general frontend use.
- `src/correction/providers/codex.ts:87` and `src/correction/providers/codex.ts:217` use the proxy to reach `chatgpt.com` endpoints and send bearer credentials.

Why it matters

- The proxy bypasses browser-origin protections by design.
- There is no destination allowlist, scheme restriction, header filtering, size limit, or response-type restriction in the Rust handler.
- On desktop this is closer to an arbitrary outbound request primitive than a narrow CORS workaround.

Likely exploit/impact narrative

- Malicious renderer code uses the proxy to send stored credentials to attacker-controlled infrastructure or to probe internal network services reachable from the host.

Recommended mitigation

- Replace the generic proxy with a narrow allowlist for exact hostnames and paths actually needed.
- Reject non-HTTPS destinations, unexpected headers, and large response bodies.
- Keep Codex-specific proxying isolated in a dedicated command instead of a reusable generic transport.
- Log proxy target metadata defensively without logging secrets.

### 5. Medium - Debug mode can persist full typed text and raw microphone audio locally

Evidence

- `src-tauri/src/keyboard.rs:40` logs `text="..."` when typing actions are invoked.
- `src-tauri/src/debug_log.rs:183` appends raw log messages to a local file.
- `src-tauri/src/audio.rs:826` creates debug audio recordings on disk when debug logging is enabled.
- `src/main/settings-controller.ts:208` persists and enables debug logging from normal settings flow.
- `README.md:32` makes a strong privacy claim that users may reasonably interpret broadly.

Why it matters

- Debug mode is opt-in, which reduces severity, but once enabled it captures exactly the kinds of sensitive data users are likely dictating: secrets, proprietary text, personal data, or regulated content.
- The data is stored locally without redaction, encryption, or explicit retention messaging beyond count-based pruning.

Likely exploit/impact narrative

- A user enables debug logging for troubleshooting, dictates sensitive content, and later shares the log directory or loses the device; transcripts and WAV files become recoverable.

Recommended mitigation

- Default to metadata-only debug logs; never store full transcript text unless the user explicitly enables a second, clearly labeled "include content" mode.
- Do not capture raw audio for routine debugging; gate it behind a short-lived support toggle with a visible warning.
- Add a UI disclosure describing exactly what debug mode stores and where.
- Provide one-click secure deletion of debug artifacts.

### 6. Medium - Release and CI process lacks security gates expected for a desktop app handling secrets

Evidence

- Only `ci.yml` and `release.yml` are present under `.github/workflows/`.
- `.github/workflows/ci.yml:52` installs dependencies and builds, but there is no secret scanning, dependency scanning, SBOM, or signed artifact verification.
- `.github/workflows/release.yml:196` builds and publishes bundles, but there are no code-signing, notarization, checksum publication, or provenance steps.

Why it matters

- Desktop users are expected to trust binaries with microphone access and text injection powers.
- The current process does not provide strong assurance against dependency compromise or tampered release artifacts.

Likely exploit/impact narrative

- A compromised dependency or release environment ships a malicious desktop binary, and users have little way to verify authenticity beyond GitHub release trust.

Recommended mitigation

- Add secret scanning and dependency review to CI.
- Generate an SBOM and publish checksums for release assets.
- Add platform signing/notarization before wider distribution.
- Minimize CI secret exposure scope; only expose provider test secrets to the exact test steps that need them.

## Notes On Auth, Privacy, And Boundaries

- There is no app-level multi-user authentication, which is acceptable for a local desktop utility; the real auth boundary is provider credential handling.
- The app appears to send audio/transcript data directly to configured providers rather than project-owned servers, consistent with `README.md:32`.
- That privacy claim is directionally true for network egress, but local secret storage and debug artifact retention weaken the overall privacy story.

## Prioritized Action Plan

1. Move API keys and OAuth refresh tokens out of the Tauri store and into OS-backed secret storage; migrate and purge legacy plaintext settings.
2. Remove `oauth-poc/auth.json` from the working tree, rotate the exposed session, and prevent future repo-local token artifacts.
3. Replace the generic `http_fetch` command with a narrow allowlisted proxy for the exact Codex endpoints needed.
4. Re-enable CSP, stop exposing Tauri globally, and reduce command/capability scope by window.
5. Redesign debug logging so transcript text and raw audio are excluded by default and clearly disclosed when enabled.
6. Add security workflow controls: secret scanning, dependency review, SBOM/checksums, and release signing/notarization.

## Files Reviewed

- `README.md`
- `package.json`
- `.gitignore`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `src/settings.ts`
- `src/main.ts`
- `src/main/settings-controller.ts`
- `src/main/api-key-controller.ts`
- `src/openai/oauth.ts`
- `src/proxy-fetch.ts`
- `src/stt/providers/openai.ts`
- `src/correction/providers/codex.ts`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/src/http_proxy.rs`
- `src-tauri/src/debug_log.rs`
- `src-tauri/src/keyboard.rs`
- `src-tauri/src/audio.rs`
- `oauth-poc/README.md`
- `oauth-poc/index.mjs`
- `oauth-poc/.gitignore`
- `oauth-poc/auth.json`
- `tests/helpers/gemini-test-config.ts`
- `tests/helpers/openai-test-config.ts`

## Validation Commands Used

```bash
git status --short
git ls-files "oauth-poc/auth.json"
git check-ignore -v "oauth-poc/auth.json"
```

Additional validation used targeted repository searches for auth, token, logging, proxy, and Tauri capability references via the review tooling.
