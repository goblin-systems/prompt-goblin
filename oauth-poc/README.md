# OpenAI OAuth PoC

This folder contains a minimal CLI probe to test ChatGPT subscription OAuth access and model availability.

It is intentionally separate from the app runtime and only used for derisking.

## What it tests

- Custom OpenAI device auth flow at `auth.openai.com`
- Token refresh
- Model-list probes on:
  - `https://chatgpt.com/backend-api/wham/models`
  - `https://chatgpt.com/backend-api/wham/v1/models`
  - `https://api.openai.com/v1/models`
- Optional endpoint compatibility probes (`responses`, `audio/transcriptions`)

## Usage

From repo root:

```bash
node oauth-poc/index.mjs login
node oauth-poc/index.mjs models
node oauth-poc/index.mjs probe
```

## Notes

- Tokens are saved to `oauth-poc/auth.json`.
- `auth.json` contains live credentials and is gitignored.
- Device auth must be enabled in the ChatGPT account/workspace settings.
- This is a probe script, not production auth code.
