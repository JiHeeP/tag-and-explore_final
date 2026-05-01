# Tag & Explore Design Direction

Tag & Explore is a teacher-first interactive learning builder. The student's image, panorama, or 3D model is the hero; the interface should stay quiet, paper-like, and useful.

## Principles

- The learning material is the main visual object. UI should support it, not compete with it.
- Use paper-tone surfaces, soft rules, and clear ink hierarchy before decorative effects.
- Keep Korean labels readable with `word-break: keep-all` and buttons that never wrap one character at a time.
- Use violet as the primary brand accent, but reserve strong color for primary actions and hotspots.
- Hotspots should feel alive: circular markers, white rim, subtle pulse, and clear selected state.
- Creator screens should be dense but calm: left hotspot list, central canvas, right inspector.
- Student shared views should feel like exploration: large canvas, read-only state, and focused detail sheet.

## Current Tokens

- Background: `oklch(0.985 0.003 280)`
- Secondary surface: `oklch(0.965 0.005 280)`
- Rule: `oklch(0.88 0.010 280)`
- Ink: `oklch(0.19 0.035 280)`
- Muted ink: `oklch(0.46 0.025 280)`
- Brand violet: `oklch(0.50 0.20 295)`
- Brand tint: `oklch(0.965 0.022 295)`
- Radius: 8px base, 14px panels, 20px empty/upload zones

## Implementation Notes

- The app currently uses React/Vite in `source-restored/` and deploys static bundles through `recovered-deploy/`.
- Before UI work, compare the change against this file and the longer user-authored design note in `/Users/jiheepark/Downloads/design.md` when available.
- Prefer improving the working product in small steps over replacing the whole layout at once.
