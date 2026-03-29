# Epic 03 - Recording Controls And Session Handling

Release target: `R0.2`
Priority: `P0`
Primary owner: Engineering
Supporting owners: Product, Design, TPM, QA
Status: Implemented

## Outcome

Users can choose a recording style that fits their environment and reduce accidental capture or stops.

## Scope

### Delivery slice 1 - Push-to-talk mode

- add hold-to-talk behavior separate from toggle recording

Acceptance criteria:

- user can choose hold-to-talk mode in settings
- recording starts on key-down and stops on key-up with predictable overlay behavior

### Delivery slice 2 - Explicit stop and cancel actions

- distinguish stop-and-type from cancel-and-discard

Acceptance criteria:

- user can cancel without typing
- cancel state is visible and does not feel like a failure

### Delivery slice 3 - Simpler silence auto-stop controls

- improve settings copy and defaults

Acceptance criteria:

- users understand the interaction between manual controls and silence auto-stop without external documentation

## Dependencies

- hotkey handling updates
- clear interaction design for overlay and settings

## Risks

- recording-state complexity can expand quickly if modes are not mutually understandable
- stop versus cancel behavior can create downstream typing ambiguity unless paired with trust-layer states

## Definition Of Done

- recording modes are understandable and configurable
- cancellation behaves intentionally and consistently
- settings copy reflects actual runtime behavior
