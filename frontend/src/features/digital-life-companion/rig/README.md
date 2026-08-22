# Digital Life 2.5D motion system

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
`shared/digital_life_rig_contract.json`, the Rust compiler, TypeScript
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
[`docs/design/digital-life-25d-pipeline.md`](../../../../../docs/design/digital-life-25d-pipeline.md)
for the asset-builder boundary and third-party integration policy.

`anime25dImporter.ts` maps both Anime2.5DRig names and native See-through tags
such as `hairf`, `hairb`, `eyer`, and side-suffixed eye layers into stable
roles. Unknown decorative layers stay renderable but do not create new
semantic bones.

## Runtime flow

```text
active layered package
  -> RigCharacter.tsx
  -> Anime25DCharacter / Anime2.5DRig player
```

Without a live Anime2.5D package, the overlay draws the master portrait as a
still image. Manifests do not carry clip stacks.

## Module ownership

| Area | Owner |
| --- | --- |
| Shared limits and semantic IR | `contract.ts`, `types.ts`, `semantics.ts`, `shared/digital_life_rig_contract.json` |
| PSD normalization and compilation source | `psdImporter.ts`, `anime25dImporter.ts`, `outfit.ts` |
| Asset transaction | `../assets/pipeline.ts`, `../assets/compiler.ts` |
| Live playback | `../anime25drig` |
| Quality gates | `diagnostics.ts`, `presentation.ts` |

## Verification

```sh
cd frontend
pnpm exec tsx --test "src/features/digital-life-companion/**/*.test.ts"
pnpm exec eslint src/features/digital-life-companion
pnpm typecheck
```

Focused Anime2.5DRig behavior is documented in
[`ANIME25D_MAINLINE.md`](ANIME25D_MAINLINE.md).
