# Epic 08 - Session History V1

Release target: `R0.3`
Priority: `P1`
Primary owner: Engineering
Supporting owners: Product, TPM, QA, Security
Status: Planned

## Outcome

Users can recover recent dictated text without depending on external apps or clipboard history.

## Scope

### Delivery slice 1 - Encrypted local session history

- store transcript, final output, timestamp, and optional provider or model metadata

Acceptance criteria:

- user can view recent sessions locally
- user can re-copy or re-type a previous session
- history respects privacy mode and retention settings

### Delivery slice 2 - History retention controls

Acceptance criteria:

- user can disable history or limit retention duration or count

## Dependencies

- local storage architecture
- privacy mode shipped first or in parallel

## Risks

- history defaults can undermine trust if not clearly disclosed
- re-type flows can reintroduce typing reliability issues unless integrated with Epic 01 patterns

## Definition Of Done

- session recovery is local and user-controlled
- retention is configurable
- privacy mode behavior is consistent across capture, memory, and history
