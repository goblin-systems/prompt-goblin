# Prompt Goblin Release Sequence

This file is the release-level execution view. Detailed scope lives in the linked epic files.

## Release Sequence

### `R0.2` - Daily-driver reliability

Objective:

- make Prompt Goblin dependable enough for daily Windows use
- improve confidence in what gets typed and when
- reduce core capture and delivery failure modes before expanding feature surface

Included epics:

- [Epic 01 - Typing reliability and fallback delivery](./epics/epic-01-typing-reliability-and-fallback-delivery.md)
- [Epic 02 - Trust layer v1](./epics/epic-02-trust-layer-v1.md)
- [Epic 03 - Recording controls and session handling](./epics/epic-03-recording-controls-and-session-handling.md)
- [Epic 04 - Privacy and release basics](./epics/epic-04-privacy-and-release-basics.md)

Exit criteria:

- users can recover from typing-path failures without losing dictated text
- users can choose safer confirmation and recording-control modes
- privacy-sensitive defaults and release basics are explicit enough for wider use
- release evidence supports a Windows-first quality bar

Primary dependencies:

- overlay and status state model
- hotkey handling updates
- target-app detection or failure detection strategy
- session outcome instrumentation

### `R0.3` - Personalized desktop dictation

Objective:

- reduce repeated settings work across apps
- improve output quality through profile-driven behavior
- add local memory and history without breaking the privacy promise

Included epics:

- [Epic 05 - Per-app behavior](./epics/epic-05-per-app-behavior.md)
- [Epic 06 - Post-processing profiles](./epics/epic-06-post-processing-profiles.md)
- [Epic 07 - Personal voice memory v1](./epics/epic-07-personal-voice-memory-v1.md)
- [Epic 08 - Session history v1](./epics/epic-08-session-history-v1.md)

Exit criteria:

- users can configure app-aware defaults without excessive setup friction
- cleanup behavior can vary by context without hiding raw capture behavior
- local memory and history respect privacy mode and retention controls

Primary dependencies:

- active-app detection
- settings model extension
- local storage and encryption design
- privacy mode rules from `R0.2`

### `R0.4` - Context-aware editing workflows

Objective:

- expand from dictation into adjacent editing workflows
- keep intelligence narrow, visible, and reversible
- avoid feature sprawl until the core dictation loop is stable

Included epics:

- [Epic 09 - Hybrid speed + quality pipeline](./epics/epic-09-hybrid-speed-quality-pipeline.md)
- [Epic 10 - Selection rewrite copilot](./epics/epic-10-selection-rewrite-copilot.md)
- [Epic 11 - Context autopilot lite](./epics/epic-11-context-autopilot-lite.md)

Exit criteria:

- live and final output flows feel coherent rather than conflicting
- selected-text editing is previewable and reversible
- auto-applied context behavior remains transparent and user-controlled

Primary dependencies:

- trust layer patterns from `R0.2`
- per-app profiles and memory foundation from `R0.3`
- selected-text capture and patch-safe typing behavior

## Cross-Release Dependency Map

- `R0.2` establishes typing fallback, trust, recording control, and privacy baseline
- `R0.3` depends on stable app detection, storage design, and privacy rules
- `R0.4` depends on profile and memory foundations being usable and trusted

## MVP Cut Line

If capacity is constrained, the minimum high-value sequence is:

1. Epic 01 - Typing reliability and fallback delivery
2. Epic 03 - Recording controls and session handling
3. Epic 02 - Trust layer v1
4. Epic 04 - Privacy and release basics
5. Epic 05 - Per-app behavior
6. Epic 06 - Post-processing profiles
7. Epic 07 - Personal voice memory v1

## Open Questions To Resolve In Planning

- should hold-before-type be off by default for speed or on by default for trust
- what default history retention best fits the privacy position
- should per-app behavior launch as manual setup first or with suggested presets
- which adjacent workflow is the first bet after core dictation: selection rewrite or meeting capture

## Risks To Track Across Releases

- typing into third-party apps may remain the hardest reliability problem
- per-app logic can become difficult to manage without a clean settings model
- local memory and history can undermine trust if defaults are not explicit
- roadmap expansion pressure can dilute the Windows-first daily-driver focus
