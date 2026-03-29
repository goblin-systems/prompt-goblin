# Epic 05 - Per-App Behavior

Release target: `R0.3`
Priority: `P0`
Primary owner: Product
Supporting owners: Engineering, Design, TPM, QA
Status: Planned

## Outcome

Prompt Goblin adapts to the user's active app so users stop manually switching settings throughout the day.

## Scope

### Delivery slice 1 - Per-app profile mapping

- support provider, live model, correction model, typing mode, silence behavior, and line-break behavior where applicable

Acceptance criteria:

- user can save a profile for a detected app
- switching to that app applies the profile automatically for new sessions
- global defaults remain available as fallback

### Delivery slice 2 - App profile presets

- provide starter presets for IDE, docs, chat, and terminal use cases

Acceptance criteria:

- new users can enable a preset without manually configuring every field

### Delivery slice 3 - Active-profile indicator

Acceptance criteria:

- user can see which profile is active before recording begins

## Dependencies

- active-app detection
- settings model extension

## Risks

- profile sprawl can make settings harder rather than easier
- active-app detection accuracy will directly affect trust in automation

## Definition Of Done

- profile switching works predictably for the target Windows apps
- defaults and overrides are clear
- users can understand active behavior before they dictate
