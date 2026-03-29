# Prompt Goblin Quality Assessment

Date: 2026-03-28
Reviewer: Quality assessment lead
Scope: Repository-level assessment of test strategy, coverage shape, release readiness, platform risk, and maintainability/testability signals for the existing Tauri + TypeScript desktop app.

## Executive Summary

Prompt Goblin has a real testing foundation, not just placeholder coverage. The repository includes unit, integration, and app-like end-to-end tests; multi-OS CI builds; and an automated release workflow. On the evidence reviewed, the product is in a reasonable state for continued Windows-first development and controlled Windows releases.

Release confidence drops materially outside that lane. The biggest quality risks are not an absence of tests, but gaps in how the critical paths are gated:

- CI and release flows do not run the end-to-end suites.
- CI integration coverage is partial and secret-dependent, so provider coverage is uneven.
- The native bridge and audio/typing path are critical to product value but are only lightly covered by automated tests.
- Cross-platform maturity is behind the release packaging story; Windows is explicitly the primary tested platform, Linux typing is stubbed, and non-Windows behavior is not proven at the same depth.
- The scripted unit suite misses some checked-in unit tests, which weakens trust in the default signal.

Bottom line: good engineering momentum, medium confidence for Windows-only release with focused smoke testing, low confidence for broad cross-platform release without additional hardening.

## Strengths

- Layered test strategy exists in-repo: unit tests in `tests/*.test.ts`, real-provider integration tests in `tests/gemini.integration.test.ts` and `tests/openai.integration.test.ts`, and app-like streaming/e2e flows in `tests/gemini.e2e.test.ts` and `tests/openai.e2e.test.ts`.
- Critical TypeScript logic is decomposed into testable modules instead of being trapped in UI code: examples include `src/main/model-loader.ts`, `src/main/settings-controller.ts`, `src/text-commands.ts`, `src/incremental-typing.ts`, `src/stt/service.ts`, and `src/correction/service.ts`.
- CI builds on Windows, macOS, and Ubuntu in `.github/workflows/ci.yml`, which is stronger than the current documented platform maturity and gives at least compile/build-level detection.
- Release automation is present in `.github/workflows/release.yml`, including versioning, multi-OS builds, and artifact publication.
- Local validation is healthy on the reviewed worktree: `bun run test:unit` passed and `bun run build` passed.
- TypeScript strict mode is enabled in `tsconfig.json`, which helps prevent a class of defects before runtime.

## Coverage Shape

### What is covered well

- Provider/service selection and model fallback logic: `tests/stt-service.test.ts`, `tests/correction-service.test.ts`, `tests/main-model-cache.test.ts`, `tests/main-model-loader.test.ts`.
- Main-window controller behavior and event wiring: `tests/api-key-controller.test.ts`, `tests/event-bindings.test.ts`, `tests/main-dom.test.ts`, `tests/main-settings-controller.test.ts`.
- Transcript post-processing logic: `tests/text-commands.test.ts`, `tests/incremental-typing.test.ts`, `tests/string-utils.test.ts`.
- Provider runtime behavior and streaming assembly: `tests/gemini.test.ts`, `tests/openai-provider.test.ts`.
- Real external dependency behavior: `tests/gemini.integration.test.ts`, `tests/openai.integration.test.ts`.
- App-like live transcription flows with representative sample audio: `tests/gemini.e2e.test.ts`, `tests/openai.e2e.test.ts`, `tests/helpers/stt-e2e.ts`, `tests/helpers/audio-sample.ts`.

### What is only weakly covered

- Native Rust audio capture, Tauri commands, tray/window lifecycle, and OS typing behavior in `src-tauri/src/audio.rs`, `src-tauri/src/lib.rs`, and most of `src-tauri/src/keyboard.rs`.
- Browser audio decoding and WAV chunking in `src/main/audio.ts`; no direct automated tests were found for `wavToPcmChunksBase64`.
- Full desktop interaction through an actual packaged Tauri app; current e2e tests simulate app-like flow through shared TypeScript helpers rather than driving the desktop shell.
- Cross-platform behavior differences, especially permissions, keyboard injection, device enumeration, and window-management behavior.

### Structural issues in the test strategy

- `package.json` hardcodes the `test:unit` file list. That list omits checked-in unit tests such as `tests/incremental-typing.test.ts` and `tests/string-utils.test.ts`, so the default unit command is not the full unit suite.
- No coverage tooling or thresholds were found in `package.json`, CI, or repository config, so coverage shape must be inferred manually.
- Integration tests depend on live secrets and live providers. This is valuable for release confidence, but it also makes signal availability uneven and can create cost/flakiness pressure.

## Top Risks

1. **Release gates miss the closest thing to true product validation.** CI and release workflows run unit tests, optional integration tests, and builds, but not `test:e2e`. The highest-value streaming behavior is therefore not part of the default ship/no-ship gate.
2. **Cross-platform release confidence is overstated relative to actual maturity.** README states Windows is the primary tested platform; `src-tauri/src/keyboard.rs` explicitly stubs unsupported non-Windows typing for Linux; release workflow still packages macOS and Linux bundles.
3. **The native bridge is under-tested relative to business criticality.** The product promise depends on recording, streaming, and typing into external apps, but automated coverage is concentrated in TypeScript modules, not in the Rust/Tauri boundary where platform defects are most likely.
4. **Default test signal is incomplete.** Some unit tests exist but are not executed by the scripted unit command, which can let regressions slip even when local/CI unit status is green.
5. **Operational and security hardening lag feature growth.** OAuth is marked experimental, Tauri CSP is disabled (`"csp": null`), and provider credentials/tokens are persisted in settings structures. This is not an immediate functionality blocker, but it is a release-quality concern.

## Risk Register

| ID | Risk | Severity | Confidence | Evidence | Likely Impact |
| --- | --- | --- | --- | --- | --- |
| R1 | E2E coverage not enforced in CI/release | High | High | `.github/workflows/ci.yml` and `.github/workflows/release.yml` run unit/integration/build but not `bun run test:e2e`; e2e suites exist in `tests/gemini.e2e.test.ts` and `tests/openai.e2e.test.ts` | Regressions in live streaming, transcript assembly, or typing flow can ship undetected |
| R2 | Cross-platform support weaker than packaging story | High | High | `README.md` says Windows is primary tested platform; `src-tauri/src/keyboard.rs` returns "not implemented" for non-Windows/non-macOS typing; release builds publish macOS and Linux bundles | Shipping broken or degraded non-Windows bundles, especially for core typing behavior |
| R3 | Native audio/Tauri command path has low automated proof | High | High | Minimal Rust tests found; only parser-style tests in `src-tauri/src/keyboard.rs`; no repo tests found for `src-tauri/src/audio.rs` or Tauri invoke contracts | Mic capture, device handling, permission, or typing failures surface late and are platform-specific |
| R4 | Scripted unit suite is incomplete | Medium | High | `package.json` `test:unit` omits `tests/incremental-typing.test.ts` and `tests/string-utils.test.ts` even though those files exist | False confidence from green unit status; regressions in transcript cleanup logic can be missed |
| R5 | Integration coverage is uneven and secret-gated | Medium | High | CI only runs integration when `GEMINI_API_KEY` exists; workflow does not expose `OPENAI_API_KEY`; integration tests are live-provider dependent | Provider-specific breakage may only be found manually or after release |
| R6 | Security/operability posture needs hardening | Medium | Medium | `src-tauri/tauri.conf.json` sets `"csp": null`; experimental OAuth appears in `src/main.ts` and `src/settings.ts`; settings structures contain persisted tokens | Increased risk around desktop webview exposure, token handling, and supportability |
| R7 | Performance/startup footprint is growing | Low | Medium | `bun run build` reported a 713.97 kB minified chunk warning in `dist/assets/index-*.js` | Slower startup or UI responsiveness over time, harder to diagnose regressions |
| R8 | Test/documentation hygiene is inconsistent | Low | High | `testing.md` is placeholder content, not usable guidance; test selection is manual in scripts | Slower onboarding and higher risk of running the wrong validation set |

## Maintainability And Testability Signals

### Positive signals

- Business logic is mostly split into plain functions and controllers, which is why the repository already supports meaningful unit tests.
- Shared helpers such as `tests/helpers/stt-e2e.ts` reduce duplication and create a reusable pattern for app-like streaming validation.
- The repository has a clear test map in `AGENT.md`, which helped correlate modules to tests quickly.

### Negative signals

- Large orchestration files such as `src/app.ts` and `src/main.ts` hold a lot of state and side effects. They are understandable, but they raise change risk because timing, event, and provider behavior are co-located.
- Native functionality is harder to test than the TypeScript side and currently has much less automated evidence.
- Manual test file enumeration in `package.json` is brittle and easy to drift out of sync with the repository.
- Current test strategy leans heavily on live-provider integration/e2e checks for confidence in some areas that could be partially covered with more deterministic contract or fixture-driven tests.

## Release Assessment

### Current posture

- **Windows-only controlled release:** Medium confidence.
- **Windows general release:** Medium-low confidence unless manual smoke testing covers hotkey, mic selection, recording, live typing, all-at-once typing, settings persistence, and both providers used in the release.
- **macOS/Linux release:** Low confidence.

### Why

- The repo shows real engineering discipline, and the TypeScript layer is better tested than many early desktop apps.
- The gap is in last-mile product confidence: packaging, OS permissions, native audio, keyboard injection, and true end-to-end desktop behavior are not proportionally protected.
- The workflows would likely catch many build breaks, but they are not yet strong enough to prove "this release works for users" across supported platforms.

## Recommended Next Actions

| Priority | Action | Severity Addressed | Confidence | Rationale |
| --- | --- | --- | --- | --- |
| P0 | Make the default unit command discover tests automatically, or explicitly include every checked-in unit test file | Medium | High | Fixes the immediate trust gap in the most-used validation command |
| P0 | Add at least one release-gating e2e job for the primary supported lane (Windows + representative provider path) | High | High | Moves the highest-value product behavior into the ship gate |
| P1 | Decide and document the supported-platform policy for this release train; if Linux/macOS are not truly supported, stop presenting them as equal release targets | High | High | Aligns release story with actual quality posture and reduces avoidable support risk |
| P1 | Add targeted tests around the native boundary: audio device enumeration, recording command lifecycle, and typing command contract | High | High | Raises confidence in the product's most failure-prone path without requiring full UI automation |
| P1 | Add provider coverage policy in CI: either wire both provider secrets for scheduled/release checks or split smoke vs live-provider gates clearly | Medium | High | Prevents provider asymmetry from becoming a hidden release risk |
| P2 | Add a small Windows packaged-app smoke checklist or automated packaged smoke test for release workflow verification | High | Medium | Catches issues that source-level tests and build steps will miss |
| P2 | Harden security/operability basics: review `csp`, token persistence, and debug/log exposure for release readiness | Medium | Medium | Reduces avoidable desktop-app risk as the app moves beyond experimental usage |
| P3 | Replace `testing.md` with real test/runbook guidance and document required release evidence | Low | High | Improves handoff efficiency for new leads and makes release decisions reproducible |

## Suggested Quality Gates

For the next Windows-focused release, the minimum practical gate should be:

1. Full unit suite passes.
2. Frontend build passes.
3. At least one provider integration smoke passes in CI/release context.
4. At least one Windows e2e streaming test passes in CI or in a required pre-release manual/automated check.
5. Manual smoke confirms hotkey capture, mic selection, transcript typing, and settings persistence on the packaged app.

For cross-platform release, add platform-specific exit criteria for macOS accessibility/permissions and Linux typing behavior before claiming parity.

## Files Reviewed

- `package.json`
- `README.md`
- `AGENT.md`
- `testing.md`
- `TODO.md`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `tsconfig.json`
- `vite.config.ts`
- `src/app.ts`
- `src/main.ts`
- `src/main/audio.ts`
- `src/settings.ts`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/src/audio.rs`
- `src-tauri/src/keyboard.rs`
- `tests/helpers/stt-e2e.ts`
- `tests/api-key-controller.test.ts`
- `tests/event-bindings.test.ts`
- `tests/main-dom.test.ts`
- `tests/main-model-loader.test.ts`
- `tests/main-settings-controller.test.ts`
- `tests/stt-service.test.ts`
- `tests/gemini.test.ts`
- `tests/openai-provider.test.ts`
- `tests/gemini.integration.test.ts`
- `tests/openai.integration.test.ts`
- `tests/gemini.e2e.test.ts`
- `tests/openai.e2e.test.ts`

## Validation Commands Run

```bash
git status --short
bun run test:unit
bun run build
```

### Results

- `git status --short`: repository has unrelated in-flight changes; assessment changes were isolated to `backlog/quality-assessment.md`.
- `bun run test:unit`: passed, 64 tests across 12 files.
- `bun run build`: passed; Vite reported a chunk-size warning for the main web bundle.

## Final Assessment

Prompt Goblin is not starting from zero; it already has enough structure to improve confidence quickly. The most important next move is to close the gap between the repository's strongest tests and the actual release gates. After that, focus on the Windows native path first, and avoid implying cross-platform readiness until the native typing and packaged-app behavior are proven on each platform.
