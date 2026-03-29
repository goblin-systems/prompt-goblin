# Epic 06 - Post-Processing Profiles

Release target: `R0.3`
Priority: `P1`
Primary owner: Product
Supporting owners: Engineering, TPM, QA
Status: Planned

## Outcome

Users can tailor cleanup rules to the target context without managing prompts manually.

## Scope

### Delivery slice 1 - Post-processing profile types

- support plain dictation, chat and message cleanup, email polish, code and comment safe cleanup, and translation-focused cleanup

Acceptance criteria:

- user can assign a cleanup profile globally or per app
- cleanup profile visibly affects only final output behavior, not raw capture

### Delivery slice 2 - Profile-specific text command packs

Acceptance criteria:

- profile can enable different command defaults without breaking existing custom commands

## Dependencies

- correction pipeline configuration model
- per-app profile system is preferred first

## Risks

- users may confuse cleanup profiles with transcription accuracy settings
- command-pack changes can create regressions if profile precedence is unclear

## Definition Of Done

- cleanup behavior is context-aware and explainable
- raw capture and final refinement remain distinct concepts
- profile configuration does not break existing command customizations
