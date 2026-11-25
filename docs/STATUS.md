# Status

Last updated: 25 November 2026

## What exists

- Repository created with README, MIT licence, contribution guide, agent instructions, and planning documents.
- No extension code, dependencies, tests, or CI.

## What works

Nothing yet. There is no software to run.

## What was verified

Nothing. No type checks, tests, builds, or browser checks have been run because there is no code.

## Known problems

- All architecture and privacy documents describe intended behaviour, not implemented behaviour.
- The Figma design references have not been inspected by an implementer yet.

## Decisions pending

- Copyright line in LICENSE currently reads "Blob contributors"; the maintainer may want a named holder.
- Audience rules for sharing (see docs/ROADMAP.md) are proposals to confirm before Milestone 2.

## Exact next task

Implement Milestone 1, the local guest experience, as specified in [MILESTONE-1.md](MILESTONE-1.md):

1. Scaffold one WXT + React + TypeScript extension project (Manifest V3) with a committed lockfile.
2. Build activation, the draggable Blob and drawer, comment placement, threads and persistence, History, and anchoring with recovery.
3. Add focused tests and local fixture pages, a small CI workflow, and real commands in README, CONTRIBUTING, and AGENTS.md.
4. Update the architecture and privacy documents to match what was actually built, then update this file.

After Milestone 1, a separate review pass should check the guest journey, persistence, page identity, anchoring, permissions, draft recovery, and host-page interference before any sharing work begins.
