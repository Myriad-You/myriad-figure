# Merope 2.5D motion system

This directory owns the site-wide upper-body character compile path. Live
playback is Anime2.5DRig in `../anime25drig`. There is no clip-stack driver.

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
`shared/merope_rig_contract.json`, the Rust compiler, TypeScript
validation, the PSD importer, and diagnostics. Do not add a frontend-only
semantic role.

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
[`docs/design/merope-25d-pipeline.md`](../../../../../docs/design/merope-25d-pipeline.md)
for the asset-builder boundary and third-party integration policy.

`anime25dImporter.ts` maps both Anime2.5DRig names and native See-through tags
such as `hairf`, `hairb`, `eyer`, and side-suffixed eye layers into stable
roles. Unknown decorative layers stay renderable but do not create new
semantic bones.

Myriad extends the upstream eye-diff path with `eye_dizzy`, `eye_squeeze`, and
`eye_cry` layers. Artist artwork is split per eye like `eye_close`; when it is
absent, import generates character-tinted spiral, inward-chevron, or
asymmetric chevron-and-tear eyes from the independent eye anchors. All three
presentation variants are compiled into the atlas and are never emulated by
warping the open eye.

Import also synthesizes optional `anger_mark` and `speechless_sweat` manga
accents from the face scale. They stay out of the neutral analysis reference;
runtime facial deformation remains the primary expression signal and stages
the accents after the brows, gaze, lids, and mouth have begun moving.

See-through's plain `mouth` is treated as the static closed portrait drawing,
not as a speaking phoneme. Import keeps that artwork and generates a small
character-tinted cel-style `mouth_open`, `mouth_wide`, `mouth_round`, and
`mouth_narrow` shapes plus independent `mouth_cry` and face-scaled
`mouth_maniac` glyphs.
The runtime morphs the speaking meshes through one continuous articulation
envelope. A lip-seal channel preserves short bilabial closures independently
from the slower jaw response. The two strongest visemes form a shared
dominance bridge, while a stateful selector draws exactly one ordinary mouth
texture at a time; crying replaces that mouth stack.
Import also records the six alpha silhouettes and their fifteen pairwise bridge
profiles. Jaw travel is then driven on a separate bounded spring: open and
round visemes use more mandible motion, wide and narrow visemes rely more on
the lip mesh, and short lip seals do not snap the jaw shut. Only the mouth
meshes and the face region below the mouth receive that motion.
Character asset contract v10 requires the independent variants, mouth profile,
and clothing-aware chest profile, so older packages must be reimported rather
than falling back at runtime.

Chest analysis is also import-time only. Its v2 profile records apparent size,
the garment-aware visible deformation ellipse, mechanical support, and how much
local soft-tissue response reaches the outer topwear. A structured or compressed
surface therefore follows the torso more tightly, while loose or rigid outer
layers suppress localized deformation without pretending the underlying size
changed. Male policy still disables this path authoritatively.

At runtime the imported chest centre is treated as an attachment base. A
two-axis relative-velocity spring follows that base, so motion starts in the
same direction as the torso; inertia can cross into the opposite direction only
after the torso slows or turns. Apparent size controls the base response,
support controls frequency and damping, and garment transmission controls the
bounded visible blend. The deformation weights are sampled in rest-mesh space,
preventing the active region from sliding across the clothing during a pose.

## Runtime flow

```text
active layered package
  -> RigCharacter.tsx
  -> Anime25DCharacter / Anime2.5DRig player
```

Agent reply speech enters through `speechEvents.ts`. The lifecycle controller
handles streamed chunks, complete replies, interruption, and proactive lines,
then drives the mounted `RigCharacter`. Real audio energy or phoneme events own
the mouth when present; otherwise the bounded local auto-prosody controller is
used. The bridge reuses fixed typed arrays; the jaw and chest paths use fixed
scalar state with constant-time spring arithmetic. Clothing analysis never runs
inside the render loop.

Without a live Anime2.5D package, `RigCharacter` draws the master portrait as a
still image. Manifests do not carry clip stacks. There is no separate global
face overlay.

## Module ownership

| Area                                     | Owner                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Shared limits and semantic IR            | `contract.ts`, `types.ts`, `semantics.ts`, `shared/merope_rig_contract.json` |
| PSD normalization and compilation source | `psdImporter.ts`, `anime25dImporter.ts`, `outfit.ts`                         |
| Asset transaction                        | `../assets/pipeline.ts`, `../assets/compiler.ts`                             |
| Live playback                            | `../anime25drig`                                                             |
| Quality gates                            | `diagnostics.ts`, `presentation.ts`                                          |

## Verification

```sh
cd frontend
pnpm exec tsx --test "src/features/merope/**/*.test.ts"
pnpm exec eslint src/features/merope
pnpm typecheck
```

Focused Anime2.5DRig behavior is documented in
[`ANIME25D_MAINLINE.md`](ANIME25D_MAINLINE.md).
