# Epic 02 - Trust Layer V1

Release target: `R0.2`
Priority: `P0`
Primary owner: Product
Supporting owners: Engineering, Design, TPM, QA
Status: Planned

## Outcome

Users can review or better understand what will be typed before Prompt Goblin inserts it into another app.

## Scope

### Delivery slice 1 - Optional hold-before-type mode

- add a review state for all-at-once flows
- allow confirm, cancel, or auto-type after timeout based on settings

Acceptance criteria:

- user can enable or disable this mode in settings
- final transcript remains visible long enough to review
- canceling prevents typing but preserves access to the transcript for that session

### Delivery slice 2 - Correction impact visibility

- highlight when a correction pass materially changes the raw transcript

Acceptance criteria:

- when correction changes output beyond a small threshold, the overlay indicates text was refined
- user can distinguish raw capture from final typed output in the review state

### Delivery slice 3 - Clear confidence and status language

- replace ambiguous processing states with user-centered wording

Acceptance criteria:

- users can tell whether the app is listening, transcribing, correcting, waiting for confirmation, or typing

## Dependencies

- overlay state model
- decision on transcript retention for canceled sessions

## Risks

- too much review friction can hurt speed for expert users
- unclear defaults can create disagreement over trust versus speed posture

## Definition Of Done

- users can choose a review-first mode without losing speed controls
- transcript refinement is visible when it matters
- state language supports support, onboarding, and release readiness
