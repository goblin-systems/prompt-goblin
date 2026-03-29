# Epic 07 - Personal Voice Memory V1

Release target: `R0.3`
Priority: `P1`
Primary owner: Product
Supporting owners: Engineering, TPM, QA, Security
Status: Planned

## Outcome

Prompt Goblin gets better at a user's names, acronyms, and repeated corrections without cloud training.

## Scope

### Delivery slice 1 - Local custom dictionary

- support names, acronyms, product terms, and pronunciation or replacement hints where useful

Acceptance criteria:

- user can add, edit, and delete terms from settings
- dictation output respects stored terms in repeat sessions where feasible

### Delivery slice 2 - Correction-to-memory suggestions

- detect repeated manual or AI correction patterns and suggest saving them

Acceptance criteria:

- suggestions are opt-in and local only
- user can dismiss or save without leaving the current workflow

### Delivery slice 3 - Import and export

Acceptance criteria:

- user can back up or move memory data locally

## Dependencies

- local storage design
- privacy mode rules

## Risks

- memory features can conflict with privacy expectations unless storage rules are explicit
- suggestion quality needs to be conservative to avoid noise

## Definition Of Done

- personal memory is local, editable, and understandable
- suggestion flows are optional and reversible
- backup and transfer are possible without cloud dependency
