# Epic 04 - Privacy And Release Basics

Release target: `R0.2`
Priority: `P1`
Primary owner: Engineering
Supporting owners: Product, TPM, QA, Security
Status: Implemented

## Outcome

The app's privacy promise is more explicit and operationally safer.

## Scope

### Delivery slice 1 - Privacy mode

- disable transcript storage
- minimize retained session artifacts

Acceptance criteria:

- privacy mode can be toggled in settings
- product behavior is explicit about what is and is not retained

### Delivery slice 2 - Latest version check

Acceptance criteria:

- user can see when a newer version exists without forced update behavior

### Delivery slice 3 - Local diagnostics UX

- improve access to debug logs and support-ready information

Acceptance criteria:

- user can find local diagnostic output from settings without terminal use

## Dependencies

- product decision on update source and copy
- alignment with quality and security assessment findings

## Risks

- privacy claims can be weakened if diagnostics behavior is not disclosed clearly
- release basics can sprawl into platform-wide packaging work without a clear Windows-first bar

## Definition Of Done

- privacy-sensitive storage behavior is user-visible and controllable
- operational basics exist to support controlled releases and troubleshooting
- release readiness language stays aligned with actual platform support
