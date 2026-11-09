# Browser tests

Pages for the figure alone: no site and no backend. Every request a page makes
outside the test server is the test's to mock.

## Rig import

`pnpm test:browser rigImport.spec.ts` runs real PSD decoding and compilation in
a browser Worker with OffscreenCanvas. A shared synthetic PSD fixture checks
manifest and decoded PNG pixel parity with the page-side compiler, including
true high collars and independent necklaces. It also checks cancellation during
packing, successful retry, and the page's selected error language. It needs no
backend, login, existing assets, or UI manipulation. This verifies import parity,
not GPU motion quality or the accuracy of generated layer artwork.

The eye fixture also runs the production WebGL player through automatic blink,
deliberate one-/two-eye closure, crying and reopening. It checks the compiled
layer opacity choices and bounded rebound on actual player ticks. This is a
render-path regression using synthetic artwork, not a subjective appearance
review of a user's character.

The pixel eye replay uses diagnostic-colored synthetic artwork and the real
importer/player/WebGL shaders at fixed 30 and 60 fps, with autonomous motion
disabled. Every frame checks each iris against an independently rendered eye
white, including invisible whites during fades. Pixel counts distinguish ordinary
blink art, alternate deliberate closure and fallback on the other eye; reopening
must recover the original counts. The replay also covers special-expression
suppression, opposing head/gaze targets, finite vertices, monotonic eyelid motion
and ordinary-art coverage (within one 8-bit alpha level after expression release).
No screenshot baseline, business page, computer use or production debug API is
required. Diagnostic colors and isolated eyes intentionally do not claim coverage
of real artwork aesthetics, hair occlusion or collar/necklace deformation.

If another suite owns port 4189, run with `FIGURE_BROWSER_TEST_PORT=4190` (or another
free port). The harness starts the installed Vite directly without asking the
package manager to reinstall dependencies.

## Figure probes

`figureProbes.spec.ts` replays the player through its public surface only:
targets and `tick()` drive it, `inspect()` and the canvas pixels say what it
drew. The probes live in `fixture/probes.ts`, a typed module the type check
covers, so a renamed runtime member breaks `pnpm typecheck` instead of turning
a probe into a silent skip. (The earlier real-art replays reached into private
player fields from untyped `page.evaluate` strings; they had been skipping
since the 2026-10-01 player split without anyone noticing.)

Every probe runs on synthetic packages built in the page from the same PSD
fixture as the import tests, so CI exercises them. Real art runs where
`FIGURE_REAL_ASSETS` lists package directories, separated by the platform path
delimiter, each holding `manifest.json` and `atlas.png`:

```sh
FIGURE_REAL_ASSETS=/path/to/bust:/path/to/full-body pnpm test:browser figureProbes
```

No asset names are needed: a probe that a package cannot exercise (no exposed
shoulder, no high collar, no earrings, nothing on the canvas cut) is skipped
with that reason, read from what the package itself carries. No character
artwork is kept in this repository.

What the probes hold, and what they do not:

- Posture: body lift (to the reach the art's proportions allow) and pitch
  reach pixels, move the neck by exactly the lift, leave the canvas cut where
  it is, and keep triangle shapes; head nods recruit them. `inspect().draw` mirrors the vertex shader's body stage, and the first
  test holds that mirror to the GPU.
- Torso: an 18-frame head turn carries the torso at least 40% of its settled
  turn within the cue, and the torso returns to rest.
- Continuous turns at 30/60/120 fps: earrings stay on the ear's surface,
  sampled independently of the runtime's own attachment code (a clip on the
  back hair follows the head's turn rather than that mesh, so it is not held
  to it); no non-finite vertex; head surfaces stay oriented; and the face
  moves the same way at every frame rate.
- Corners of combined turns: visible face and hair triangles stay oriented.
  Real art only: the synthetic face is a flat block, and it folds at two
  corners; whether drawn art can fold the same way is not settled.
- Pose corrections: an authored correction (through `previewPoseCorrections`)
  changes only its combination pose, never the body, and releasing it restores
  every pixel.
- High collar: its aperture stays its own mesh, moves, and nothing around the
  neck or the sleeves is sewn to skin.
- Exposed shoulders: the arm and the torso stay together along the torso's
  drawn skin edge (found in the art, not in the binding) through body and arm
  motion; settled performance poses draw cleanly.
- Earrings: roots stay on the ear; they swing against the same replay without
  physics; their transforms do not collapse.
- Hair, each against the same replay with physics off (so only the
  follow-through differs): a nod lags both up and down and reaches pixels; a
  combined turn moves different strands' roots apart, keeps triangles oriented
  and edges under 1.5× the rigid hair's (the most stretched frame is
  attached); a body-only move makes it trail, and that follow-through comes to
  rest.
- Music to idle, thought to speech: no reset at the handover, no head jump
  (the face accelerates less than six times what the music's own beats made
  it), motion continues.
- Shared canvas cut: layers cut by the canvas edge with the torso stay on its
  edge, measured in each layer's own space before its transform (where the
  runtime joins them), without folds.

They do not reproduce the old ablations (drawing again with one mechanism
switched off inside the player): with no switch on the public surface, those
comparisons are covered by unit tests of the mechanism instead, for example
the shared facial surface in `secondaryDeformation.test.ts` and the crown band
in `renderer.test.ts`.

## Gesture arms

`armVariants.spec.ts` imports real busts with their gesture arms and plays them
on the production player. No artwork is kept here: it runs only where
`FIGURE_ARM_VARIANTS` names a directory of `variants/<tag>.png` and
`<tag>-pose.json` beside `../psd/<bust>.psd` and `.png`, and skips elsewhere.
With `portrait-pose/<bust>.json` there too, the arms are measured and played as
3D arms; without it they are raised flat.

- Imported flat, a bust with gesture arms draws what it draws without them until
  one is raised (one rounding step at most).
- Measured in 3D, the modelled arm hangs in the drawn one's place: under 0.8% of
  the picture off by more than a rounding while the figure stands upright,
  under 3% as it leans and turns.
- Every frame of each rise and fall covers the arm's box at least as well as
  resting or raised does, and no frame stands outside its neighbours in the
  box's drawn share or lightness by 0.03 or more (a frame that shows or drops
  something for itself alone; a moving arm, however fast, stays between them).

Both bounds were checked against a broken player: one frame in 37 left without
its 3D arm failed the flicker scan (0.29), and the hanging arm moved 6 document
pixels sideways failed the upright bound.
