# Prompt Goblin Planning Index

This directory is the source of truth for product direction, release sequencing, and epic-level execution planning.

## Start Here

- [Product strategy and roadmap](./product-strategy-roadmap.md)
- [Release sequence](./release-sequence.md)
- [Epic index](./epics/README.md)
- [Quality assessment](./quality-assessment.md)
- [Security assessment](./security-assessment.md)
- [Execution overview](./backlog.md)

## How To Use This Area

- Product and leadership should start with the strategy and roadmap.
- Engineering and delivery leads should use the release sequence for planning and dependency management.
- Day-to-day backlog refinement should happen in the individual epic files under `epics/`.
- Quality and security assessments remain reference inputs for sequencing, risk, and release readiness.

## Planning Hygiene Rules

- Do not add new execution detail to a single monolithic backlog document.
- Create one markdown file per epic under `epics/`.
- Use the `epic-01` through `epic-11` filenames as the canonical epic naming convention.
- Keep release-level sequencing in `release-sequence.md`.
- Keep product direction in `product-strategy-roadmap.md`.
- Add cross-cutting findings to the assessment files, not to epic scopes.

## Current Planning Structure

```text
backlog/
  README.md
  backlog.md
  release-sequence.md
  product-strategy-roadmap.md
  quality-assessment.md
  security-assessment.md
  epics/
    README.md
    epic-01-typing-reliability-and-fallback-delivery.md
    epic-02-trust-layer-v1.md
    epic-03-recording-controls-and-session-handling.md
    epic-04-privacy-and-release-basics.md
    epic-05-per-app-behavior.md
    epic-06-post-processing-profiles.md
    epic-07-personal-voice-memory-v1.md
    epic-08-session-history-v1.md
    epic-09-hybrid-speed-quality-pipeline.md
    epic-10-selection-rewrite-copilot.md
    epic-11-context-autopilot-lite.md
```
