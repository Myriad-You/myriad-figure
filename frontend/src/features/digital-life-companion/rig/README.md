# Digital Life 2.5D motion system

This directory owns the site-wide upper-body character runtime. The current
production profile is a layered FaceRig; it is not a reduced full-body
humanoid.

## Hard boundary

Rig IR v4 exposes only these semantic roles:

```text
root, torso, head, face, left-eye, right-eye, mouth, handwear
```

There are no shoulder, elbow, wrist, leg, foot, contact-IK, locomotion, or hand
pose chains. `handwear` is the shared semantic parent; optional
`a25d-handwear-left/right` children hold the two rigid sleeve/partial-forearm/
hand drawings. They may lag or swing within ±15 degrees but never deform into
an articulated limb.

This boundary is shared by
`shared/digital_life_rig_contract.json`, the Rust compiler, TypeScript
validation, the PSD importer, diagnostics, and the renderer. Do not add a
frontend-only semantic role.

## Asset flow

```text
portrait source
  -> owner-triggered remote See-through API or artist-authored layered PSD
  -> ephemeral PSD download (never activated directly)
  -> ag-psd validation and Anime2.5D name normalization
  -> alpha cleanup, eye-side split, atlas packing, anchors and mesh weights
  -> authenticated backend preview / migration / diagnosis
  -> capability-regression gate
  -> explicit commit of the exact preflighted source and atlas
  -> active immutable rig asset
```

The Myriad backend never launches the decomposition model. The owner may store
a write-only Hugging Face token and explicitly send the current cached master
portrait to `24yearsold/see-through-demo`; the browser never receives the
token or an upstream download URL. The returned PSD is ephemeral and enters
the exact same preflight as a manually selected file. No candidate is
activated directly. See
[`docs/design/digital-life-25d-pipeline.md`](../../../../../docs/design/digital-life-25d-pipeline.md)
for the asset-builder boundary and third-party integration policy.

`anime25dImporter.ts` maps both Anime2.5DRig names and native See-through tags
such as `hairf`, `hairb`, `eyer`, and side-suffixed eye layers into stable
FaceRig roles. Unknown decorative layers stay renderable but do not create new
semantic bones.

## Runtime flow

```text
message / UI intent
  -> planner.ts / director.ts
  -> real clip or performance sequence
  -> performancePlayer.ts monotonic playback
  -> RigCharacter.tsx
  -> CompanionRigRenderer
  -> authored sampling
  -> transition/continuity handoff
  -> procedural gaze, blink, speech, breath and secondary motion
  -> outfit limits and bounded whole-layer handwear follow
  -> WebGL mesh skinning, depth parallax and presentation crossfades
```

Expressions are asset-backed. Eye open/closed and mouth open/closed drawings
crossfade through stable slots; iris motion is clipped to the eye white. Head
mesh deformation may add subtle depth turn, but it is not a replacement for
split facial drawings. Missing close drawings may be synthesized only as an
explicit bounded fallback during import.

Hair and clothing secondary motion is derived from actual layer meshes. Front
and back hair can receive root/tip strand chains; topwear receives restrained
chest/breath weighting. Outfit profiles reduce torso twist and secondary
amplitude for broad or rigid silhouettes without inventing costume-specific
action clips.

## Module ownership

| Area | Owner |
| --- | --- |
| Shared limits and semantic IR | `contract.ts`, `types.ts`, `semantics.ts`, `shared/digital_life_rig_contract.json` |
| PSD normalization and compilation source | `psdImporter.ts`, `anime25dImporter.ts`, `outfit.ts` |
| Asset transaction | `../assets/pipeline.ts`, `../assets/compiler.ts` |
| Action selection | `actionCatalog.ts`, `director.ts`, `planner.ts` |
| Performance authoring and clock | `performanceCatalog.ts`, `performanceTimeline.ts`, `performancePlayer.ts` |
| Pose and natural motion | `animation.ts`, `motion.ts`, `generation.ts`, `transitions.ts`, `poseContinuity.ts` |
| Layered portrait behavior | `anime25dRuntime.ts`, `presentation.ts` |
| Rendering | `renderer.ts`, `webgl.ts`, `matrices.ts`, `runtimeIndex.ts` |
| Quality gates and tools | `diagnostics.ts`, `regression.ts`, `MotionWorkbench.tsx` |

## Adding motion

1. Add or generate a real clip in the manifest. A workbench label without a
   clip is not an action.
2. Author only semantic root/torso/head/face/eye/mouth targets. A gesture that
   requires an articulated arm does not belong in this profile.
3. Put expression and mouth choices in presentation slots; do not emulate a
   new expression by stretching the whole head.
4. Keep anticipation, action, hold, and settle inside one monotonic timeline.
   Rapid retargeting must preserve a bounded incoming pose and velocity.
5. Add a deterministic test for the transition and a generated-variation test
   when randomness changes.

Ordinary replies use short intent cues. Multi-beat performances are reserved
for high-confidence semantics such as greeting, celebration, apology,
farewell, discovery, or playful interaction. When a requested scene is not
available from the current real clips, the runtime falls back to lightweight
upper-body cues.

## Invariants

- Scene time uses a monotonic clock; stop/replay cancels the previous playback
  generation.
- Cross-channel actions start atomically and release through bounded handoffs.
- Blink, viseme, gaze, breath, head turn, hair, and handwear have separate
  phase/weight ownership so their peaks do not stack mechanically.
- Expanded and collapsed rendering preserve pose continuity across visibility
  changes; a delayed timer cannot become one large physics step.
- A portrait fallback verifies only degraded rendering. It cannot pass layered
  expression, secondary-motion, or real-material acceptance.
- Final visual QA uses the real generated atlas and multiple action blends on
  each representative outfit.

## Verification

```sh
cd frontend
pnpm exec tsx --test "src/features/digital-life-companion/**/*.test.ts"
pnpm exec eslint src/features/digital-life-companion
pnpm typecheck
```

Focused architecture history and Anime2.5DRig behavior are documented in
[`ANIME25D_MAINLINE.md`](ANIME25D_MAINLINE.md). That comparison explains why
the former articulated humanoid gates are intentionally absent; it is not an
alternate runtime specification.
