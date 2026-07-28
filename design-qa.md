# Setup wizard design QA

## Evidence

- Source visual truth: `docs/design/setup-review-reference.png`
- Normalized source: `docs/design/setup-review-reference-1440x1024.png`
- Browser-rendered implementation: `docs/design/setup-review-implementation.png`
- Full-view side-by-side comparison: `docs/design/setup-review-comparison.png`
- Responsive dark-mode evidence: `docs/design/setup-review-mobile-dark.png`
- Route and state: `/?preview=review`, detected source, Codex ready, Claude Code ready
- Desktop viewport and CSS size: 1440×1024 at `deviceScaleFactor: 1`
- Source pixels: 1487×1058, normalized to 1440×1024
- Implementation pixels: 1440×1024
- Comparison pixels: 2880×1024
- Mobile viewport: 390×844 at `deviceScaleFactor: 1`; the full-page capture is
  390×1102

The normalized source and implementation have the same pixel dimensions and
density. The 2880×1024 comparison places them side by side without scaling.

## Full-view comparison

- The centered brand, three-step progress, headline, two verification groups,
  local-data reassurance, and primary connection action preserve the selected
  composition and hierarchy.
- The implementation uses the selected warm neutral surface, restrained indigo
  accent, hairline dividers, green validation state, system typography, and
  Phosphor icons.
- The implementation intentionally adds one collapsed `Advanced` disclosure
  required by the product specification. It stays subordinate to the primary
  action.
- The production page has no horizontal or vertical viewport overflow at
  1440×1024.

No focused crop was needed: all typography, icons, rules, controls, and state
labels are legible at 1:1 in the full-view comparison.

## Required fidelity surfaces

- Fonts and typography: system UI family, hierarchy, weights, line height,
  wrapping, and optical density match the selected direction.
- Spacing and layout rhythm: frame width, section gaps, row heights, padding,
  dividers, alignment, and control placement are consistent with the source.
- Colors and visual tokens: neutral background, ink, indigo action, green
  validation, and subdued borders maintain source contrast and balance.
- Image and icon fidelity: the screen contains no bespoke raster imagery.
  Phosphor icons replace all UI symbols; no handcrafted SVG, CSS art, emoji, or
  placeholder asset is used.
- Copy and content: the source's readiness message and local-data reassurance
  are preserved, with only the required `Advanced` recovery copy added.

## Responsive, interaction, and accessibility evidence

- A 390×844 dark-mode viewport preserves information order and has no
  horizontal overflow.
- Detecting, single-source review, multiple-source choice, missing source,
  connecting, partial failure, error, success, conflict, and already-connected
  states are covered.
- Primary interactions tested: source selection, folder-change path, conflict
  approval, connect, retry, and Done/close.
- Focus order on the review screen is privacy link → Advanced → change folder
  → primary connect action.
- Ready clients require no extra decision. Only an existing conflicting
  connection exposes an explicit replacement checkbox.
- axe at 1440×1024: 0 violations in light mode and 0 in dark mode.
- Keyboard-only source selection and primary actions are covered.
- Browser console errors: 0.

## Comparison history

- Pass 1: the normalized 1440×1024 source and browser capture showed no P0,
  P1, or P2 differences. No visual fix iteration was required.

## Findings

- P0: none
- P1: none
- P2: none

No blocking visual or interaction gap remains. Minor rendering differences from
platform font antialiasing are acceptable.

final result: passed
