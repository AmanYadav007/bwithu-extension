# BwithU — Character Artwork Spec (layered SVG)

This is the asset contract for `SvgCompanion` (Milestone 1 of the living-SVG
companion plan). The controller never draws or edits artwork — it only
addresses named layers and toggles visibility/CSS classes. Artwork quality is
therefore the artist's responsibility, and code cannot substitute for it.

## Asset inventory (as of the v2 refresh)

- `apps/chrome-extension/public/model.glb` — 14.6 MB glTF/GLB with a full
  humanoid rig (Hips/Spine/Neck/Head/LeftEye/RightEye) and one skin. No
  animation clips; idle/listen/think/talk motion is procedural in
  `GLBCharacter`. This is the default v2 character.
- Legacy assets (bear sprites, unrigged `result.glb`, pixel rigs, geometric
  orb) were removed in the v2 refresh.
- **No layered 2D human artwork exists in the repo.** This file is the plan to
  obtain it.

## Procurement options (pick one)

1. **Commission** (recommended for a premium result): brief an illustrator for
   one waist-up male character in the style described in the product plan
   (natural proportions, detailed hair, expressive eyes, soft shading, modern
   casual clothing). Ask for the layered source (Figma/Illustrator/Affinity)
   plus an SVG export where each animatable part is a named layer/group.
   Typical deliverable: ~$150–$600, 1–2 weeks.
2. **Licensed character-constructor pack** (fastest compliant route):
   Envato Elements / Adobe Stock sell layered "character builder" vectors.
   Must verify the license covers commercial use in an app and modification
   (layers get named + split for animation). Quality varies; pick a
   semi-realistic, premium-looking set, not flat icons.
3. **AI generation + artist cleanup** (fast but lowest fidelity): generate a
   portrait, then have an artist redraw it into the layered groups below.
   Useful for concept/mood-board approval before commissioning.

Record the author + license page for the About screen, whatever the route.

## Artwork file contract

- Format: single SVG file (no external images/fonts; convert text to outlines).
- Location: `apps/chrome-extension/public/characters/male/character.svg`
  (the default `characterArtworkUrl`; overridable in Settings).
- Size: ≤ 300 KB uncompressed. ViewBox: portrait, e.g. `0 0 500 640`
  (waist-up, character centered, ~12% padding so no feature gets clipped by
  breathing/nod transforms). The side panel renders it at ~320×320 with
  `preserveAspectRatio="xMidYMid meet"`.
- Layers: the animation controller addresses groups by
  `data-bwithu-part="<part>"` **or** `id="bwithu-<part>"` (Illustrator exports
  layer names as ids — name layers `bwithu-head`, `bwithu-eyes`, …).

### Required groups

| Layer | Purpose |
|---|---|
| `head` | head + face base; nod/sway rotates this group |
| `eyes` | both open eyes; blink scales this group |
| `mouth-idle` | neutral closed mouth (default visible) |

### Strongly recommended groups

| Layer | Purpose |
|---|---|
| `mouth-open` | speaking "ah" shape |
| `mouth-half` | speaking intermediate shape |
| `mouth-smile` | greeting / positive reaction |
| `torso` | breathing translate |
| `brows`, `hair` | future expression work (kept static for M1) |

If `mouth-open`/`mouth-half`/`mouth-smile` are missing, the character degrades
gracefully (neutral mouth during speech). Everything else stays static.

## Verify before handing over

Open the SVG in a browser; the character must look good at ~320 px wide (the
side-panel size). Then in the extension: Settings → Body → Illustrated, and
the character renders inside the panel. A static screenshot does not count as
done; the file must load through the real renderer.

## Known limitation (documented, not faked)

The current TTS pipeline (`api/speak`, xAI audio) returns **no viseme or word
timing data** — verified by source audit. Milestone 3 will therefore use
timing-based mouth cycles (already implemented) driven by playback start/stop,
and will be labeled "approximate lip motion", not phoneme-accurate lip-sync,
until the provider exposes timing data.
