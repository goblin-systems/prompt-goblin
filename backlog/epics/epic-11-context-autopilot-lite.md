# Epic 11 - Context Autopilot Lite

Release target: `R0.4`
Priority: `P2`
Primary owner: Product
Supporting owners: Engineering, TPM, QA
Status: Planned

## Outcome

Prompt Goblin starts making narrow, reversible automatic choices based on app context and saved preferences.

## Scope

### Delivery slice 1 - Auto-apply profile defaults

- use active app and recent user choice patterns to suggest or apply defaults

Acceptance criteria:

- automatic changes are visible and reversible
- autopilot does not silently override explicit user settings mid-session

### Delivery slice 2 - Lightweight context inputs only

- active app
- selected text presence
- clipboard text presence

Acceptance criteria:

- first autopilot version does not require screenshot capture or opaque inference

## Dependencies

- per-app profiles
- personal memory v1

## Risks

- automation can erode trust if behavior is silent or hard to reverse
- context signals may be too weak unless profile quality is already solid

## Definition Of Done

- autopilot behavior is narrow, visible, and reversible
- context sources remain lightweight and privacy-aligned
- explicit user intent always wins over automatic behavior
