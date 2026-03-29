# Epic 10 - Selection Rewrite Copilot

Release target: `R0.4`
Priority: `P1`
Primary owner: Product
Supporting owners: Engineering, Design, TPM, QA
Status: Planned

## Outcome

Prompt Goblin expands from dictation into a focused adjacent workflow: editing selected text with voice.

## Scope

### Delivery slice 1 - Selected-text voice actions

- support shorten, expand, translate, polish, convert to bullets, and reframe for email or task update

Acceptance criteria:

- user can trigger an action on currently selected text
- output is previewed before replacement by default
- original selected text can be restored in session

### Delivery slice 2 - Action presets by app or profile

Acceptance criteria:

- user can configure which actions appear for a given context

## Dependencies

- selected-text capture or access approach
- trust layer review pattern

## Risks

- selected-text access may differ sharply by app
- replacing content without safe preview would damage trust quickly

## Definition Of Done

- selected-text actions are reversible and preview-first
- context-specific action menus are configurable
- workflow feels adjacent to dictation rather than a disconnected feature branch
