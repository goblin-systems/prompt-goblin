# AGENT.md

## Purpose

Prompt Goblin is a Tauri desktop app for voice-to-text dictation with pluggable STT providers and optional transcript correction. Frontend code is vanilla TypeScript + Vite; native desktop/audio/typing code is Rust under `src-tauri`.

## Fast Orientation

- Frontend settings window entry: `index.html` -> `src/main.ts`
- Frontend overlay/HUD entry: `overlay.html` -> `src/overlay.ts`
- Recording/runtime orchestration: `src/app.ts`
- Shared live-session helper: `src/live-audio-session.ts`
- Settings schema + persistence: `src/settings.ts`
- Main-window orchestration: `src/main.ts`
- Main-window event wiring: `src/main/event-bindings.ts`
- Main-window API key/provider flow: `src/main/api-key-controller.ts`
- Main-window settings/autosave flow: `src/main/settings-controller.ts`
- Main-window mic test flow: `src/main/mic-test-controller.ts`
- Main-window model loading/cache refresh: `src/main/model-loader.ts`
- Main-window modal/window controls: `src/main/window-controls.ts`
- STT provider registry: `src/stt/service.ts`
- Transcript correction registry: `src/correction/service.ts`
- Native Tauri command registration: `src-tauri/src/lib.rs`
- Native audio capture: `src-tauri/src/audio.rs`
- Native keyboard injection: `src-tauri/src/keyboard.rs`

## Start Here By Task

- Want to understand the app lifecycle? Start with `src/main.ts`, then `src/main/event-bindings.ts`, then `src/app.ts`, then `src/overlay.ts`.
- Want to change recording start/stop or hotkey behavior? Start with `src/app.ts`; then check `src-tauri/src/lib.rs` and `src-tauri/src/audio.rs`.
- Want to change settings fields or persistence? Start with `src/settings.ts`; then update `src/main/settings-controller.ts`, `src/main.ts`, and `src/main/dom.ts`.
- Want to add or modify an STT provider? Start with `src/stt/service.ts`, then `src/stt/types.ts`, then `src/stt/providers/`.
- Want to change transcript correction? Start with `src/correction/service.ts`, then `src/correction/types.ts`, then `src/correction/providers/`.
- Want to change spoken commands like "new line" or punctuation? Start with `src/text-commands.ts` and `tests/text-commands.test.ts`.
- Want to change overlay UI/HUD state? Start with `src/overlay.ts`; then find emitters in `src/app.ts`.
- Want to change mic test behavior? Start with `src/main/mic-test-controller.ts` and `src/live-audio-session.ts`; then check `src/main.ts` and `src-tauri/src/audio.rs`.
- Want to change API key validation, provider switching, or model-refresh reactions? Start with `src/main/api-key-controller.ts`.
- Want to change settings-window event wiring? Start with `src/main/event-bindings.ts`.
- Want to change modal/window button behavior? Start with `src/main/window-controls.ts`.
- Want to change native typing into other apps? Start with `src-tauri/src/keyboard.rs` and search for `type_text` callsites in `src/app.ts` and `src/live-audio-session.ts`.
- Want to find relevant tests quickly? Use the Test Map section below before broad search.

## Directory Map

- `src/` - all TypeScript app code
- `src/main/` - settings-window modules: DOM helpers, event bindings, controllers, and utilities
- `src/stt/` - speech-to-text abstractions and provider implementations
- `src/correction/` - post-transcription correction abstractions and providers
- `src-tauri/` - Rust backend, Tauri config, native commands
- `tests/` - Bun unit/integration/e2e tests; helpers under `tests/helpers/`
- `public/` - static assets copied by Vite
- `dist/` - generated frontend build output; do not hand-edit

## How The App Is Wired

1. `src/main.ts` composes the settings window, loads persisted settings, wires controllers/helpers together, refreshes model lists/microphones, and calls `initApp()` from `src/app.ts`.
2. `src/main/event-bindings.ts` attaches DOM events to the main-window controllers and orchestration helpers.
3. `src/app.ts` owns the live dictation lifecycle: global shortcut registration, recording start/stop, provider configuration, transcript updates, incremental typing, silence auto-stop, correction pass, and overlay events.
4. `src/overlay.ts` listens for recording events and renders the floating status HUD/waveform.
5. Rust commands in `src-tauri/src/lib.rs` expose microphone, typing, and debug-log operations to the frontend via `invoke(...)`.

## Where To Edit

- Provider/model selection, API key handling, UI controls: `src/main/api-key-controller.ts`, `src/main/event-bindings.ts`, `src/main/dom.ts`, `src/settings.ts`
- Recording behavior, hotkey flow, silence detection, overlay event emission: `src/app.ts`
- Mic test behavior reused from runtime: `src/live-audio-session.ts`, `src/main/mic-test-controller.ts`, `src/main.ts`
- Spoken punctuation/macros/custom replacements: `src/text-commands.ts`
- STT provider registration and selection: `src/stt/service.ts`
- Gemini/OpenAI STT specifics: `src/stt/providers/`
- Transcript correction enablement/model selection: `src/correction/service.ts`, `src/correction/providers/`
- Waveform styles/colors: `src/waveform-styles.ts`, `src/overlay.ts`, `src/main.ts`, `src/main/mic-test-controller.ts`
- Native audio capture or emitted audio events: `src-tauri/src/audio.rs`
- Native typing behavior: `src-tauri/src/keyboard.rs`
- Debug logging persistence/open-folder behavior: `src/logger.ts`, `src/main/window-controls.ts`, `src-tauri/src/debug_log.rs`

## High-Value Search Anchors

- Recording commands: `start_recording`, `stop_recording`, `recording-started`, `recording-stopped`
- Overlay flow: `recording-ready`, `recording-phase`, `recording-hud-update`
- Typing flow: `type_text`, `typingMode`, `incremental`, `all_at_once`
- Settings/caching: `loadSettings`, `saveSettings`, `modelCache`, `lastKnownGoodModel`
- Text command logic: `applyTextCommands`, `getCommandTailGuardChars`
- Provider wiring: `createLiveTranscriber`, `getProviderRuntime`, `getCorrectionRuntime`
- Mic test flow: `mic-test-audio-chunk`, `start_mic_monitoring`, `stop_mic_monitoring`
- Main-window wiring: `setupMainEventBindings`, `ApiKeyController`, `SettingsController`

## Event And Command Map

- Tauri commands registered in `src-tauri/src/lib.rs`:
  - audio: `list_input_devices`, `start_mic_monitoring`, `stop_mic_monitoring`, `stop_mic_monitoring_with_recording`, `start_recording`, `stop_recording`
  - debug log: `set_debug_logging_enabled`, `write_debug_log`, `open_debug_log_folder`
  - keyboard: `type_text`, `type_text_incremental`
- Overlay events emitted mostly from `src/app.ts` and consumed in `src/overlay.ts`:
  - `recording-started`
  - `recording-ready`
  - `recording-phase`
  - `recording-hud-update`
  - `recording-stopped`
- Other useful app events/search terms in `src/app.ts`:
  - `transcript-update`
  - `stt-status`
  - `gemini-status`

## If You Change X, Also Check Y

- Settings shape -> update defaults, load/hydrate logic, save logic in `src/settings.ts`, then UI population in `src/main.ts`, `src/main/settings-controller.ts`, and `src/main/dom.ts`.
- Recording/audio event names -> verify both frontend invoke/listen code and Rust registration in `src-tauri/src/lib.rs` / `src-tauri/src/audio.rs`.
- Typing mode behavior -> check `src/app.ts`, `src/live-audio-session.ts`, `src/main/dom.ts`, and related hint text.
- Provider model selection/caching -> check `src/settings.ts`, `src/main/model-cache.ts`, `src/stt/service.ts`, and provider implementations.
- Transcript correction -> keep provider symmetry across `src/correction/service.ts` and both files in `src/correction/providers/`.
- Overlay visuals or state labels -> update both event payloads in `src/app.ts` and render logic in `src/overlay.ts`.

## Key Architectural Patterns

- Provider abstractions are registry-based. Prefer extending `src/stt/service.ts` or `src/correction/service.ts` instead of branching logic throughout the app.
- Settings are the source of truth and are persisted via `@tauri-apps/plugin-store` in `src/settings.ts`.
- Main-window UI DOM lookup/render helpers are intentionally isolated in `src/main/dom.ts`; keep DOM plumbing there when practical.
- Main-window feature logic is split by concern: API/provider flow, settings persistence, mic test lifecycle, and event wiring each live in dedicated `src/main/` modules.
- Overlay communication is event-driven. `src/app.ts` emits Tauri/webview events; `src/overlay.ts` listens and renders.
- Incremental typing and mic-test flows share logic with `LiveAudioSession`; check it before duplicating recording pipeline code.
- Model caching and last-known-good fallback are first-class behavior. Look at `src/main/model-cache.ts` and the provider-specific settings fields before changing selection logic.

## Commands

- Install deps: `bun install`
- Frontend dev server only: `bun run dev`
- Full desktop dev app: `bun run tauri dev`
- Frontend build: `bun run build`
- Desktop bundle: `bun run tauri build`
- Unit tests: `bun run test:unit`
- Integration tests: `bun run test:integration`
- E2E tests: `bun run test:e2e`

## Test Map

- Core provider registry: `tests/stt-service.test.ts`
- Correction registry/settings reads: `tests/correction-service.test.ts`
- Text command behavior: `tests/text-commands.test.ts`
- Main-window utility/model helpers: `tests/main-utils.test.ts`, `tests/main-model-cache.test.ts`, `tests/main-model-loader.test.ts`, `tests/main-settings-controller.test.ts`
- Main-window API/provider flow: `tests/api-key-controller.test.ts`
- Main-window event wiring: `tests/event-bindings.test.ts`
- Main-window DOM rules/rendering: `tests/main-dom.test.ts`
- Gemini live-transcriber behavior: `tests/gemini.test.ts`
- OpenAI provider runtime behavior: `tests/openai-provider.test.ts`
- Real API integration: `tests/gemini.integration.test.ts`, `tests/openai.integration.test.ts`
- End-to-end audio/transcription flows: `tests/gemini.e2e.test.ts`, `tests/openai.e2e.test.ts`
- Test helpers and shared fixtures: `tests/helpers/stt-e2e.ts`, `tests/helpers/audio-sample.ts`

## Test Notes

- Test runner is Bun.
- Unit tests cover provider registries, text commands, main-window controllers/helpers/DOM wiring, model-cache behavior, and correction service.
- Integration/E2E tests hit real provider APIs and need secrets:
  - `GEMINI_API_KEY`
  - `OPENAI_API_KEY`
  - optional `OPENAI_TEST_MODEL`
- Good helper entry points: `tests/helpers/gemini-test-config.ts`, `tests/helpers/openai-test-config.ts`, `tests/helpers/stt-e2e.ts`

## Native / Platform Notes

- Windows is the primary tested platform.
- Keyboard simulation is only implemented on Windows in `src-tauri/src/keyboard.rs`; non-Windows builds stub this out.
- CI builds on Windows, macOS, and Ubuntu; Linux installs extra WebKit/AppIndicator/audio packages in `.github/workflows/ci.yml`.

## Config Files Worth Checking

- `package.json` - scripts and JS dependencies
- `vite.config.ts` - dual-entry Vite build for main + overlay windows
- `tsconfig.json` - strict TS config in bundler mode
- `src-tauri/tauri.conf.json` - window definitions, build hooks, bundle targets
- `src-tauri/Cargo.toml` - Rust/native dependencies
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` - what CI/release expect to pass

## Repo Conventions For Agents

- Do not edit `dist/` or `node_modules/`; they are generated/dependency directories.
- Avoid introducing new frameworks or state layers; the codebase is intentionally plain TypeScript plus Tauri APIs.
- Preserve provider symmetry where possible: if changing Gemini/OpenAI selection, caching, or correction, check both implementations.
- When changing runtime dictation behavior, usually inspect both `src/app.ts` and `src/overlay.ts` for event/UI implications.
- When changing settings shape, update defaults, load/save logic, and any UI population code together.
- If a change touches recording or audio transport, verify the matching Rust command/event names in `src-tauri/src/lib.rs` and `src-tauri/src/audio.rs`.
- Use this file as a narrowing index first; then use `glob`/`grep` on the search anchors above to verify exact callsites.
