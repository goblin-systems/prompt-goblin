# Prompt Goblin Product Strategy and Roadmap

## Problem and outcome

### Product vision

Prompt Goblin should become the fastest trustworthy way for a privacy-conscious desktop user to turn speech into usable text anywhere on their computer, with enough context and guardrails to feel reliable in real work.

### Current product reality

Repository evidence shows Prompt Goblin is already a usable desktop dictation product, not a concept:

- Tauri desktop app with Rust + TypeScript and Windows-first packaging (`README.md`, `src-tauri/tauri.conf.json`)
- Global hotkey recording, overlay window, and tray behavior (`README.md`, `src-tauri/src/lib.rs`)
- Gemini and OpenAI STT providers with provider/model selection and model caching (`src/stt/service.ts`, `src/main/model-loader.ts`, `src/settings.ts`)
- Incremental typing and all-at-once typing (`README.md`, `src/app.ts`, `src/main/dom.ts`)
- Silence auto-stop, microphone device selection, recording loudness, and mic test flows (`README.md`, `src/main/settings-controller.ts`, `src/main/mic-test-controller.ts`)
- Transcript correction and translation flows, currently gated to all-at-once mode (`src/app.ts`, `src/main/dom.ts`, `src/correction/service.ts`)
- Custom text commands for punctuation, structure, timestamps, and macros (`src/text-commands.ts`, `tests/text-commands.test.ts`)

### Core problem to solve next

The product has a strong foundation, but today it is still closer to a powerful enthusiast tool than a dependable daily driver for professionals. The biggest gap is not more AI ideas; it is trust and workflow fit:

- users need dictation to work reliably in any target app
- users need confidence about what will be typed and when
- users need less manual switching of provider, mode, and cleanup behavior
- the product needs a sharper wedge than "desktop speech-to-text with multiple providers"

### Intended outcome for the next 6-12 months

Make Prompt Goblin credibly great for solo professionals on Windows who dictate across many apps and care about privacy, speed, and control. The goal is to move from "feature-rich beta" to "trusted daily desktop dictation tool."

## Target user or stakeholder

### Primary target user

Privacy-conscious individual professionals on Windows who write across many desktop apps and want low-friction voice input:

- engineers and technical operators
- product managers and founders
- writers and heavy note-takers
- bilingual users who frequently clean up or translate dictated text

### Secondary target user

Power users who want reusable spoken macros and app-specific behavior, but do not want cloud lock-in or a heavyweight meeting assistant.

### Not the primary target yet

- full enterprise team administration
- offline-first regulated deployments
- cross-platform parity buyers
- meeting intelligence buyers expecting Otter/Fireflies-style end-to-end meeting workflows

## Recommended scope or priority

### Positioning recommendation

Position Prompt Goblin as:

**A privacy-oriented desktop dictation control layer for real work across apps.**

This is stronger than competing head-on as a generic transcription app. The product already has the ingredients for this angle:

- system-wide activation via global hotkey
- text insertion into any app
- overlay feedback during capture
- provider choice instead of single-model lock-in
- user-owned API keys and no Prompt Goblin server dependency
- text commands, correction, and translation on top of raw transcription

### Competitive/positioning angle

Prompt Goblin should not try to win on the broadest AI assistant promise first. It should win on a narrower claim:

- more private than cloud-managed dictation products
- more controllable than single-provider speech tools
- lighter and faster than full meeting copilots
- more desktop-native than browser-based voice assistants

### Product principles

1. Trust before autonomy.
   If the product is going to type into other apps, users must understand and control what happens.

2. Windows-first quality before platform breadth.
   The repo explicitly says Windows is the primary tested platform. Keep roadmap honest.

3. Reduce mode-switching before adding ambitious AI surface area.
   Per-app behavior and post-processing will create more daily value than several speculative big bets.

4. Privacy is a product behavior, not just a brand claim.
   Local storage, clear provider boundaries, and explicit controls matter.

5. Build toward context carefully.
   Use lightweight context inputs first: active app, selected text, clipboard, local personal terms.

## Strategic pillars

### 1. Reliable capture and typing

Make recording, recovery, final text insertion, and app compatibility feel dependable enough for daily use.

Why now:

- current app already handles recording lifecycle, silence auto-stop, incremental typing, and recovery-like logic in `src/app.ts`
- TODO already calls out clipboard-safe fallback typing and push-to-talk
- this is the most direct path to retention

### 2. Trustable output refinement

Turn raw transcripts into usable text with visible guardrails rather than hidden magic.

Why now:

- correction already exists, but is labeled beta and limited to all-at-once mode in `src/main/dom.ts`
- overlay HUD already exposes latency/confidence scaffolding in `src/overlay.ts` and `src/app.ts`
- TODO ideas like Trust Layer / Ghost Mode and Hybrid Speed + Quality Pipeline naturally extend current architecture

### 3. Personal and app-aware adaptation

Reduce repeated setup and cleanup by letting Prompt Goblin remember user preferences and adapt by app.

Why now:

- current settings are global only, despite clear hooks for provider/model/mode selection
- TODO already includes per-app behavior, post-processing profiles, context autopilot, and personal voice memory
- this is the best medium-term differentiator after reliability

### 4. Privacy and local ownership

Strengthen the product's privacy promise with explicit storage, retention, and local-control behaviors.

Why now:

- privacy is central in `README.md`
- session history and privacy mode are already on the idea list
- without clear controls, future memory/history features could undermine the brand promise

## Requirements and acceptance criteria

### Strategy-level requirements

- The next two releases should prioritize daily-use reliability and trust over broad AI expansion.
- New workflow intelligence should start with app-aware configuration and lightweight memory, not fully autonomous agent behavior.
- Windows remains the reference platform for quality and release readiness until platform test coverage materially improves.
- Privacy-sensitive features must ship with explicit on/off controls, local storage defaults, and clear user-visible behavior.

### Acceptance criteria for this strategy

- Roadmap focuses on a limited set of high-confidence bets grounded in existing code and TODO direction.
- MVP scope for each phase can be started by engineering without requiring product redefinition.
- Nice-to-have ideas remain visible but are not treated as equal priority to trust and reliability work.

## Now / Next / Later roadmap

## Now (0-3 months): make it dependable enough to recommend

### Goals

- Improve trust in what gets typed
- Reduce failure cases in target apps
- Sharpen Windows daily-driver experience

### Priority initiatives

1. Typing reliability and fallback paths
   - clipboard-safe fallback typing path
   - explicit app compatibility handling for incremental typing failures
   - clearer error and recovery states in overlay/settings

2. Trust layer v1
   - optional hold-before-type mode in overlay
   - clearer final transcript preview for all-at-once flows
   - visible confidence/diff indicators where correction changes text materially

3. Push-to-talk and recording controls
   - hold-to-talk and toggle modes
   - cleaner stop/cancel behavior
   - settings clarity around silence auto-stop vs manual control

4. Privacy and operational basics
   - privacy mode for no transcript storage
   - latest version check
   - lightweight usage diagnostics limited to local logs

### Why this is the right "now"

This phase turns the current product into something users can trust in more apps without changing the product category.

## Next (3-6 months): reduce user setup and cleanup work

### Goals

- make the app feel personalized
- reduce repetitive settings changes by context
- improve final text quality without extra effort

### Priority initiatives

1. Per-app behavior
   - provider/model/typing mode by active app
   - per-app post-processing profiles
   - app presets for common tools like IDE, chat, docs, terminals

2. Personal voice memory v1
   - local dictionary for names, acronyms, products, and repeated corrections
   - quick add/edit flows from correction outcomes
   - local-only storage and reset controls

3. Hybrid speed + quality pipeline
   - keep fast live transcript where helpful
   - apply smarter final cleanup pass only at stop
   - minimize visual churn by patching only changed text when feasible

4. Session history v1
   - local encrypted history of recent sessions
   - re-copy/re-type previous outputs
   - disabled or minimized when privacy mode is on

### Why this is the right "next"

This phase creates the first durable differentiation beyond "record and transcribe" while staying close to current architecture.

## Later (6-12 months): selective intelligence, not feature sprawl

### Goals

- extend from dictation into context-aware editing workflows
- test one or two ambitious bets without fragmenting the product

### Priority initiatives

1. Selection rewrite copilot
   - voice actions on selected text: shorten, expand, translate, polish, reframe
   - first strong adjacent workflow to dictation

2. Context autopilot lite
   - combine active app + profile + personal memory for automatic defaults
   - keep actions narrow and reversible

3. Meeting mode exploration
   - only if reliability, history, and trust layer are already solid
   - start with lightweight long-form capture and export, not full meeting intelligence stack

### Explicitly deferred for now

- full offline/local model stack as a primary roadmap bet
- team packs as a major product line
- wake phrase as a major investment
- full screen-aware screenshot-driven AI actions

These may become important later, but they are too broad relative to current maturity.

## Success metrics

### Product health

- weekly active dictation users
- median dictation sessions per active user per day
- 30-day returning user rate

### Reliability and trust

- successful session completion rate
- percent of sessions ending in typed output vs cancellation/failure
- incremental typing fallback rate
- correction acceptance proxy: percent of corrected outputs not immediately overwritten by user shortcuts or manual retry flows

### Workflow efficiency

- share of sessions using per-app profiles once shipped
- share of sessions using text commands, correction, or translation
- reduction in settings changes per active user after per-app behavior ships

### Privacy and quality perception

- percent of active users enabling privacy mode or history controls
- support/issues volume related to mistrust, wrong typing target, and app compatibility

## Risks, dependencies, and open questions

### Risks

- Cross-app typing reliability may vary more than expected, especially outside Windows.
- More autonomous features could erode trust if preview/confirm patterns are weak.
- Personal memory and history can conflict with the privacy brand if storage behavior is not explicit.
- Provider variability and model churn remain a product risk despite current model cache safeguards.

### Dependencies

- Better instrumentation of session outcomes and typing failures
- Clear storage design for local memory/history/privacy mode
- Stable active-app detection for per-app behavior
- Continued provider/model management resilience

### Open questions

- What is the desired default trust posture: type immediately, preview first, or app-specific?
- How often do users dictate into apps where incremental typing is unreliable today?
- Which user segment is strongest already: coding, general productivity, or bilingual translation?
- Does OpenAI OAuth meaningfully expand adoption, or is API-key setup still the dominant path?

## MVP recommendation and suggested next steps

### Recommended 2-release MVP focus

If the team can only do a focused 6-month plan, prioritize:

1. Release A: typing reliability, fallback path, push-to-talk, trust layer v1, privacy mode
2. Release B: per-app behavior, post-processing profiles, personal voice memory v1, session history v1

### Why this MVP path

- It compounds on existing strengths already visible in the repo
- It sharpens differentiation without overcommitting to speculative assistant features
- It protects the privacy brand while adding stickier user value

### Suggested next steps

- Turn this roadmap into release-scoped engineering epics and stories
- Define 5-7 core user journeys to validate priority ordering
- Add lightweight product telemetry or local diagnostic counters before major UX changes so roadmap impact can be measured
