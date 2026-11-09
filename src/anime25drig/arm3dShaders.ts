// The modelled gesture arm's shaders (arm3dView.ts). Positions are on the playback canvas (uSize), depth
// toward the viewer; textures are straight (not premultiplied) and every output is premultiplied.

const PROJECT = `
vec4 project(vec3 p) {
  return vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, (uBack - p.z) / uDepth, 1.0);
}`

export const SLEEVE_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv; in vec2 aPic;
uniform vec2 uSize; uniform float uPush; uniform float uDepth; uniform float uBack; uniform float uFold;
out vec2 vUv; out vec3 vNrm; out float vV; out vec2 vPic; out vec2 vAt;
${PROJECT}
void main() {
  // The upper arm set back (in depth only) under a forearm folded over it, into the elbow.
  gl_Position = project(aPos + aNrm * uPush - vec3(0.0, 0.0, uFold * (1.0 - smoothstep(0.42, 0.5, aUv.y))));
  vUv = aUv; vNrm = aNrm; vV = aUv.y; vPic = aPic; vAt = (aPos + aNrm * uPush).xy;
}`

export const SLEEVE_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vNrm; in float vV; in vec2 vPic; in vec2 vAt;
uniform sampler2D uTex; uniform sampler2D uArmMask; uniform vec4 uMaskRect;
uniform float uRest; uniform vec4 uSolid; uniform float uFadeTop; uniform float uRestEnd; uniform vec3 uLine;
uniform float uUnlined; uniform float uOpen; uniform vec3 uBand; uniform sampler2D uLifted;
// Held, cut away over the drawing's own ground (uGround, on uGroundRect of the canvas as drawn; uToDrawn0/1 carry
// this frame's canvas back to it), by how near it is held (uGroundOn).
uniform sampler2D uGround; uniform vec4 uGroundRect; uniform vec3 uToDrawn0; uniform vec3 uToDrawn1; uniform float uGroundOn;
out vec4 o;
// A band the portrait wears by the elbow that every gesture draws at the wrist (uBand: its place, and whether
// there is one) is worn while the arm hangs; lifted, that stretch is the sleeve as the gestures draw it there
// (uLifted), and the drawn cuff comes up at the wrist alone. The plain sleeve above the band stretched down over
// it came out in streaks.
vec3 cloth(vec2 uv) {
  float off = uBand.z * (1.0 - smoothstep(0.55, 0.995, uRest))
    * smoothstep(uBand.x - 0.015, uBand.x, uv.y) * (1.0 - smoothstep(uBand.y, uBand.y + 0.015, uv.y));
  return mix(texture(uTex, uv).rgb, texture(uLifted, uv).rgb, off);
}
void main() {
  float nz = normalize(vNrm).z;
  // The one sleeve texture, worn the same all the way. Its outline off while it hangs (the portrait's lines
  // are the arm's there), nor its top a hard edge (the body's fill under it showed as a pale arc).
  float unlined = smoothstep(0.9, 0.995, uRest);
  // Nor for a moment as the hand first lifts (uUnlined): the round sleeve, short of a flared cuff's drawn mouth,
  // showed a step there whose line came out as a stroke across the body.
  unlined = max(unlined, uUnlined);
  // Solid on the upper sleeve's face toward the viewer, raised too: faded in at the shoulder, the body's fill
  // under the arm showed through as a grey band.
  float upperFace = smoothstep(0.2, 0.5, nz) * (1.0 - smoothstep(uRestEnd, uRestEnd + 0.02, vV));
  float inPicture = step(0.0, vPic.x) * step(vPic.x, 1.0) * step(0.0, vPic.y) * step(vPic.y, 1.0);
  float hang = smoothstep(0.985, 1.0, uRest);
  float a = max(smoothstep(0.0, uFadeTop, vV), max(smoothstep(0.2, 0.8, uRest), upperFace) * smoothstep(0.0, 0.03, vV))
    * mix(1.0, inPicture, hang);
  // Hanging, below the portrait's upper sleeve only where its arm layer has the arm: the round forearm ran on
  // past the drawn one.
  vec2 m = (vPic - uMaskRect.xy) / uMaskRect.zw;
  float inMask = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
  a *= mix(1.0, texture(uArmMask, m).a * inMask, hang * smoothstep(uRestEnd - 0.02, uRestEnd + 0.02, vV));
  float edge = 0.0;
  if (uGroundOn > 0.0) {
    vec2 g = (vec2(dot(uToDrawn0, vec3(vAt, 1.0)), dot(uToDrawn1, vec3(vAt, 1.0))) - uGroundRect.xy) / uGroundRect.zw;
    // A little past its box too, its edge carried on: the picture's foot can lie a little below the ground found.
    vec2 m = 24.0 / uGroundRect.zw;
    float inG = step(-m.x, g.x) * step(g.x, 1.0 + m.x) * step(-m.y, g.y) * step(g.y, 1.0 + m.y);
    vec2 cut = texture(uGround, g).rg * inG * uGroundOn;
    a *= 1.0 - cut.r;
    edge = cut.g;
  }
  // The outline takes the fabric's own colour, darkened, as the drawings line a white cuff in grey-brown.
  if (uSolid.a > 1.5) { float la = a * (1.0 - unlined); o = vec4(mix(uSolid.rgb, cloth(vUv) * 0.4, 0.75) * la, la); return; }
  // A mark (the upper arm's stencil): only where it is all but solid.
  if (uSolid.a > 0.0) { if (a < 0.5) discard; o = vec4(uSolid.rgb * a, a); return; }
  vec3 c = cloth(vUv);
  // Turned away from the viewer it darkens a little, as the drawings shade a round sleeve; not while it hangs
  // (the portrait's own shading is drawn in there).
  c *= mix(mix(0.82, 1.0, smoothstep(-0.2, 0.6, nz)), 1.0, smoothstep(0.9, 0.995, uRest));
  if (!gl_FrontFacing) {
    // Seen into the cuff (uOpen, where the sleeve opens: its end, or the elbow for one ending there): the rim's
    // own fabric, lit at the rim, darker going in, never the near black that reads as a hole. Never into the
    // shoulder's end, which the body closes.
    vec3 lo = vec3(1.0), avg = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      vec3 t = texture(uTex, vec2(float(i) / 8.0, uOpen - 0.035)).rgb;
      if (dot(t, vec3(1.0)) < dot(lo, vec3(1.0))) lo = t;
      avg += t / 8.0;
    }
    c = mix(lo, avg, 0.45) * mix(0.3, 0.68, smoothstep(uOpen - 0.07, uOpen, vV));
    a *= smoothstep(0.15, 0.3, vV);
  } else if (vV > 1.005) {
    // The cuff's end face: its cloth a little in from the edge, blurred, going into the opening's shadow.
    vec3 cloth = textureLod(uTex, vec2(vUv.x, 0.93), 3.0).rgb;
    c = vV < 1.02 ? mix(uLine, cloth * 0.4, 0.75) : cloth * mix(1.0, 0.62, smoothstep(1.025, 1.05, vV));
  }
  // Cut, it is outlined there as its own outline is.
  c = mix(c, mix(uLine, c * 0.4, 0.75), edge);
  o = vec4(c * a, a);
}`

/** The sleeve laid out by its own (u, v), each texel coloured from a picture where that picture's pose puts it. */
export const BAKE_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv; in vec2 aPic;
out vec2 vSrc; out float vFace; out float vV;
void main() { vSrc = aPic; vFace = aNrm.z; vV = aUv.y; gl_Position = vec4(aUv.x * 2.0 - 1.0, aUv.y * 2.0 - 1.0, 0.0, 1.0); }`

export const BAKE_FS = `#version 300 es
precision highp float;
in vec2 vSrc; in float vFace; in float vV;
uniform sampler2D uSrc; uniform vec4 uRect; uniform float uMinFace; uniform float uMaskFrom; uniform float uVmax;
out vec4 o;
void main() {
  vec2 s = (vSrc - uRect.xy) / uRect.zw;
  float inside = step(0.0, s.x) * step(s.x, 1.0) * step(0.0, s.y) * step(s.y, 1.0)
    * step(0.0, vSrc.x) * step(vSrc.x, 1.0) * step(0.0, vSrc.y) * step(vSrc.y, 1.0);
  vec4 q = texture(uSrc, s);
  // The picture's arm only from uMaskFrom along it; as far round as uMinFace.
  float drew = vV < uMaskFrom ? 1.0 : step(0.5, q.a);
  if (vFace < uMinFace || drew < 0.5 || inside < 0.5 || vV > uVmax) discard;
  o = vec4(q.rgb, 1.0);
}`

export const HAND_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv; in vec2 aPic; in float aWt; in vec2 aHangPic; in float aHangWt; in float aAlong; in float aFace;
uniform vec2 uSize; uniform float uPush; uniform float uDepth; uniform float uBack; uniform float uFold;
out vec3 vNrm; out vec2 vUv; out vec2 vPic; out float vWt; out vec2 vHangPic; out float vHangWt; out float vAlong; out float vFace;
${PROJECT}
void main() {
  // Brought forward (in depth only) over the elbow a folded forearm lies across.
  gl_Position = project(aPos + aNrm * uPush + vec3(0.0, 0.0, uFold));
  vNrm = aNrm; vUv = aUv; vPic = aPic; vWt = aWt; vHangPic = aHangPic; vHangWt = aHangWt; vAlong = aAlong; vFace = aFace;
}`

export const HAND_FS = `#version 300 es
precision highp float;
in vec3 vNrm; in vec2 vUv; in vec2 vPic; in float vWt; in vec2 vHangPic; in float vHangWt; in float vAlong; in float vFace;
uniform sampler2D uHand; uniform sampler2D uHang; uniform float uHanging; uniform float uRestNear; uniform vec3 uLit; uniform vec3 uShade; uniform vec4 uSolid; uniform float uAlpha;
uniform vec3 uWristTone; uniform float uExact; uniform float uNear; uniform sampler2D uDrawn;
uniform sampler2D uFull; uniform vec4 uFullMap; uniform float uHasFull;
out vec4 o;
void main() {
  float al = uAlpha;
  // Held as drawn, none of the hand where the gesture drew no hand (the wrist aside, which the picture fades out
  // below): fingers found running on over bare skin stood past the drawn tips as outlined ghosts. The drawn hand
  // is where the cut-out has it or the gesture differs from the portrait (the cut-out misses a palm's shadow).
  float differs = textureLod(uDrawn, vPic, 2.0).a;
  float drawnHere = max(smoothstep(0.03, 0.25, textureLod(uHand, vPic, 2.0).a) * smoothstep(0.03, 0.2, differs), smoothstep(0.5, 0.9, differs));
  // With the whole drawn hand kept, held as drawn the model wears it wherever it is: past the drawn hand it shows
  // what the drawing has there, so nothing need fade.
  vec2 fp = vPic * uFullMap.zw + uFullMap.xy;
  vec2 edge = min(fp, 1.0 - fp);
  float fin = uHasFull * smoothstep(0.0, 0.04, min(edge.x, edge.y));
  vec4 full = texture(uFull, fp);
  float held = uExact * fin * full.a;
  if (vUv.y >= -1.5) al *= mix(1.0, drawnHere, uExact * (1.0 - fin));
  // Except the drawing's empty ground: a finger modelled a little wider than drawn wore the canvas about its tip.
  al *= mix(1.0, full.a, uExact * fin);
  if (uSolid.a > 0.0) {
    // Held in the drawn pose, a part's outline inside the drawn hand is not on the drawing (a hidden thumb's
    // stood as a pale stick by the wrist, a curled finger's doubled its drawn lines): the drawing there.
    vec4 s = texture(uHand, vPic);
    float under = uExact * smoothstep(0.85, 0.98, textureLod(uHand, vPic, 2.0).a) * s.a;
    o = vec4(mix(mix(uSolid.rgb, s.rgb, under), full.rgb, held) * al, al);
    return;
  }
  vec3 n = normalize(vNrm);
  float d = dot(n, normalize(vec3(-0.45, -0.55, 0.7)));
  // The drawings shade a hand lightly, a warm half-tone only where it turns well away; lit, the skin the
  // drawing has most of, not its lightest.
  vec3 lit = mix(uLit, uShade, 0.3);
  vec3 shade = mix(uShade, lit, 0.45);
  vec3 toon = mix(shade, lit, smoothstep(-0.3, -0.05, d));
  // On a finger a full shade down the side turned from the light, wider than on the palm.
  float onF = step(0.001, vAlong);
  toon = mix(toon, mix(mix(uShade, lit, 0.15), lit, smoothstep(-0.2, 0.15, d)), onF);
  // A warm darker band inside a finger's edges, as drawn; not where it points at the viewer (a dark ring
  // round every folded tip).
  float rim = 1.0 - smoothstep(0.3, 0.92, abs(n.z));
  float endOn = smoothstep(0.45, 0.8, vFace);
  toon = mix(toon, uShade * vec3(0.96, 0.86, 0.86) * vec3(0.9, 0.79, 0.79), rim * onF * 0.95 * (1.0 - 0.8 * endOn));
  // The drawing where it saw this part of the hand, eased out toward its edge (a seam crossed the palm there).
  vec4 t = texture(uHand, vPic);
  float lod = mix(3.0, 1.5, onF);
  float e = smoothstep(0.4, 0.95, textureLod(uHand, vPic, lod).a);
  // On a finger its ink lines only where the finger faces the viewer: turned away, the model's outline is
  // the edge, and the drawing's, a pixel off it, ran inside as a ghost; and only as near as the hand is to
  // the drawn shape.
  float sideOn = 1.0 - smoothstep(0.35, 0.75, abs(n.z));
  float ink = 1.0 - smoothstep(0.05, 0.2, dot(t.rgb - uShade * 0.85, vec3(0.3, 0.59, 0.11)));
  float drop = onF * (0.35 + 0.65 * sideOn);
  float w = t.a * e * vWt * (1.0 - ink * max(drop, 1.0 - uNear));
  // Held in the drawn pose, the drawing sits exactly on the hand: all of it within the drawn hand, its lines
  // between fingers drawn together too (left out, the fingers ran together), and a part's side turned away
  // (the model's shading there drew a finger the drawing curls out of sight).
  float inside = smoothstep(0.85, 0.98, textureLod(uHand, vPic, 2.0).a);
  // Out to the drawn hand's own edge: its outline ink lies in the band the blurred test leaves out, and the
  // model's shading there drew a pale rim where the drawing has its line.
  w = max(w, uExact * max(inside, smoothstep(0.5, 0.95, t.a)) * t.a);
  if (vUv.y < -1.5) {
    // The wrist: the drawing's own skin by its wrist, its sides a little darker as a round forearm is shaded,
    // in the cuff's shadow (u) where it leaves the sleeve, one even skin into the heel of the palm.
    float side = 1.0 - smoothstep(0.15, 0.7, abs(n.z));
    toon = mix(uWristTone, mix(uShade, uWristTone, 0.45), 1.0 - smoothstep(-0.3, -0.05, d));
    toon = mix(toon, uShade * vec3(0.93, 0.85, 0.84), max(vUv.x * 0.85, side * 0.32));
    toon = mix(toon, uWristTone, smoothstep(0.45, 0.8, -2.0 - vUv.y));
    // A bare forearm as drawn: the gesture's skin raised, the portrait's hanging, each as far as the arm is
    // there; the shading above only where neither saw it.
    vec4 h = texture(uHang, vHangPic);
    // The portrait's only near where it hangs: its picture there has what lies over the arm too (a white shirt),
    // which turned with the arm as white streaks on the forearm.
    float hw = h.a * smoothstep(0.4, 0.95, textureLod(uHang, vHangPic, 3.0).a) * vHangWt * uRestNear;
    hw *= step(0.0, vHangPic.x) * step(vHangPic.x, 1.0) * step(0.0, vHangPic.y) * step(vHangPic.y, 1.0);
    float rw = w * (1.0 - uHanging);
    w = rw + hw * (1.0 - rw);
    t.rgb = w > 0.0 ? (t.rgb * rw + h.rgb * hw * (1.0 - rw)) / w : t.rgb;
  }
  // A fingertip flushed pink; a short crease at each finger joint on the side toward the viewer.
  toon = mix(toon, toon * vec3(1.0, 0.86, 0.84), smoothstep(0.72, 0.97, vAlong) * 0.75);
  float joint = max(1.0 - smoothstep(0.004, 0.02, abs(vAlong - 0.3333)), 0.7 * (1.0 - smoothstep(0.004, 0.018, abs(vAlong - 0.6667))));
  toon = mix(toon, uShade * vec3(0.82, 0.68, 0.66), joint * smoothstep(0.45, 0.8, n.z) * step(0.01, vAlong) * 0.35);
  o = vec4(mix(mix(toon, t.rgb, w), full.rgb, held) * al, al);
}`

/**
 * The gesture's own drawing of its upper arm and elbow, laid over the modelled sleeve while the arm is held
 * there (before the hand, which may lie in front of it): the round sleeve wears the portrait's hanging upper
 * sleeve, which some portraits draw cuffed by the elbow (a second cuff there, under a gesture cuffed at the
 * wrist).
 */
export const HELD_VS = `#version 300 es
in vec2 aPos; in vec2 aUv;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`

export const HELD_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHeld; uniform float uAlpha;
out vec4 o;
void main() {
  vec4 c = texture(uHeld, vUv);
  float a = c.a * uAlpha;
  o = vec4(c.rgb * a, a);
}`

/**
 * The whole drawn hand where it was drawn, carried with the hand as it is now (uRow0/1: this frame's place to the
 * drawn one), within the drawn hand's own outline (uHand) and only held as drawn (uExact): laid where the modelled
 * hand is not, it fills what the model falls short of (a crack between a finger's root and the next knuckle, a
 * palm's edge drawn wider). uSolid: only whether it lies there, for the cover the gap pass reads.
 */
export const WHOLE_FS = `#version 300 es
precision highp float;
uniform sampler2D uHand; uniform sampler2D uFull; uniform vec4 uFullMap; uniform vec4 uPicMap;
uniform vec2 uToView; uniform float uRows; uniform vec3 uRow0; uniform vec3 uRow1; uniform float uExact; uniform float uSolid;
uniform vec4 uAxis;
out vec4 o;
void main() {
  vec3 p = vec3(vec2(gl_FragCoord.x, uRows - gl_FragCoord.y) * uToView, 1.0);
  vec2 q = vec2(dot(uRow0, p), dot(uRow1, p));
  vec2 uv = (q - uPicMap.xy) * uPicMap.zw;
  // The hand from its wrist on (uAxis: the drawn wrist, and on to the middle knuckle): the drawn forearm,
  // carried with the hand, stood at the drawn angle off the modelled one while the hand rose.
  float along = smoothstep(-0.12, 0.0, dot(q - uAxis.xy, uAxis.zw) / dot(uAxis.zw, uAxis.zw));
  vec2 fp = uv * uFullMap.zw + uFullMap.xy;
  vec2 edge = min(fp, 1.0 - fp);
  vec4 c = texture(uFull, fp);
  float a = uExact * along * smoothstep(0.0, 0.04, min(edge.x, edge.y)) * smoothstep(0.5, 0.9, texture(uHand, uv).a) * c.a;
  if (uSolid > 0.0) {
    if (a < 0.5) discard;
    o = vec4(1.0);
    return;
  }
  o = vec4(c.rgb * a, a);
}`

/** A full-screen triangle. */
export const FULL_VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`

/**
 * The shadow the drawings lay in the narrow gap between fingers drawn close: where the hand is not but all
 * round it is. And a small hole the hand closes all round, which is skin the drawing has there. What the hand
 * covers from uCov (the hand and wrist alone), its colours from uSrc. uPixel is a texel of the arm's own target,
 * uStep one pixel as the trial drew it (540 wide).
 */
export const GAP_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform sampler2D uCov; uniform vec2 uPixel; uniform vec2 uStep; uniform float uSigma; uniform vec3 uHoleTone; uniform vec3 uSkin; uniform float uReach;
out vec4 o;
vec3 fill(vec2 uv) {
  vec3 s = vec3(0.0); float w = 0.0;
  for (int a = 0; a < 16; a++) {
    float th = float(a) * 0.392699;
    vec2 dir = vec2(cos(th), sin(th));
    for (int i = 1; i <= 28; i++) {
      float d = uReach * float(i) / 28.0;
      if (texture(uCov, uv + dir * d * uStep).a < 0.5) continue;
      vec4 c = texture(uSrc, uv + dir * (d + 3.0) * uStep);
      if (c.a > 0.9) {
        vec3 col = c.rgb / c.a, e = col - uSkin;
        float k = exp(-dot(e, e) * 12.0) / d;
        s += col * k; w += k;
      }
      break;
    }
  }
  return w > 1e-4 ? mix(uHoleTone, s / w, 0.85) : uHoleTone;
}
void main() {
  vec2 uv = gl_FragCoord.xy * uPixel;
  float own = texture(uCov, uv).a, s = 0.0, w = 0.0;
  for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
    vec2 d = vec2(float(x), float(y)) * uSigma * 0.7;
    float g = exp(-dot(d, d) / (2.0 * uSigma * uSigma));
    s += texture(uCov, uv + d * uStep).a * g; w += g;
  }
  float k = clamp((s / w - 0.6) / 0.2, 0.0, 1.0) * (1.0 - own) * 0.85;
  bool wide = own < 0.5;
  for (int y = -3; y <= 3 && wide; y++) for (int x = -3; x <= 3 && wide; x++)
    if (x * x + y * y <= 10) wide = texture(uCov, uv + vec2(float(x), float(y)) * uStep).a < 0.5;
  if (own < 0.5) {
    int open = 0;
    for (int a = 0; a < 16 && open <= 6 && (open == 0 || !wide); a++) {
      float th = float(a) * 0.392699;
      vec2 dir = vec2(cos(th), sin(th));
      bool hit = false;
      for (int i = 1; i <= 14 && !hit; i++) hit = texture(uCov, uv + dir * uReach * float(i) / 14.0 * uStep).a > 0.5;
      if (!hit) open++;
    }
    if (open == 0 && wide) { vec3 c = fill(uv); o = vec4(c.r, 1.0, c.g, c.b); return; }
    if (open <= 6 && !wide) { o = vec4(k, 0.4, own, 1.0); return; }
  }
  o = vec4(k, 0.0, own, 1.0);
}`

/** Laid over the arm: the gap's shadow, a hole's skin, and that skin over the hand's own outline round it. */
export const GAP2_FS = `#version 300 es
precision highp float;
uniform sampler2D uMask; uniform vec2 uPixel; uniform vec2 uStep; uniform vec3 uTone; uniform vec3 uHoleTone;
out vec4 o;
const int MIN_CORE = 18;
int coresAt(vec2 c) {
  int n = 0;
  for (int y = -9; y <= 9; y++) for (int x = -9; x <= 9; x++)
    if (x * x + y * y <= 81 && texture(uMask, c + vec2(float(x), float(y)) * uStep).g > 0.7) n++;
  return n;
}
void main() {
  vec2 uv = gl_FragCoord.xy * uPixel;
  vec4 m = texture(uMask, uv);
  int best = 99; vec3 col = uHoleTone; vec2 at0 = vec2(0.0);
  for (int y = -6; y <= 6; y++) for (int x = -6; x <= 6; x++) {
    int r = x * x + y * y;
    if (r > 36 || r >= best) continue;
    vec4 n = texture(uMask, uv + vec2(float(x), float(y)) * uStep);
    if (n.g > 0.7) { best = r; col = vec3(n.r, n.b, n.a); at0 = vec2(float(x), float(y)) * uStep; }
  }
  // A core of a few pixels is a slit's wider spot, not a hole: filled, a lone pale fleck in a dark gap.
  if (best < 99 && coresAt(uv + at0) < MIN_CORE && coresAt(uv) < MIN_CORE) {
    if (m.g > 0.7) { o = vec4(uTone * 0.85, 0.85); return; }
    best = 99;
  }
  if (m.g > 0.7) { o = vec4(m.r, m.b, m.a, 1.0); return; }
  if (best <= 10 && m.b < 0.5) { o = vec4(col, 1.0); return; }
  if (best < 99 && m.b < 0.5) {
    bool clear = true;
    for (int t = 1; t < 6 && clear; t++) clear = texture(uMask, uv + at0 * float(t) / 6.0).b < 0.5;
    if (clear) { o = vec4(col, 1.0); return; }
  }
  if (best < 99 && m.b >= 0.5) { float a = mix(1.0, 0.6, clamp(float(best - 25) / 11.0, 0.0, 1.0)); o = vec4(col * a, a); return; }
  if (m.g > 0.2) {
    vec2 at = vec2(0.0);
    for (int y = -8; y <= 8; y++) for (int x = -8; x <= 8; x++) {
      int r = x * x + y * y;
      if (r > 64) continue;
      vec2 d = vec2(float(x), float(y)) * uStep;
      vec4 n = texture(uMask, uv + d);
      if (n.g < 0.7) continue;
      bool clear = true;
      for (int t = 1; t < 8 && clear; t++) clear = texture(uMask, uv + d * float(t) / 8.0).b < 0.5;
      if (clear && r < best) { best = r; col = vec3(n.r, n.b, n.a); at = d; }
    }
    if (best < 99 && (coresAt(uv + at) >= MIN_CORE || coresAt(uv) >= MIN_CORE)) { o = vec4(col, 1.0); return; }
  }
  o = vec4(uTone * m.r, m.r);
}`

/** The arm's target laid on the figure, nothing below the picture's foot (uFoot: x, y pairs left to right) nor past its cut sides. */
export const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uArm; uniform vec2 uPixel; uniform vec2 uToView; uniform vec2 uFoot[16]; uniform int uFeet; uniform vec2 uSides; uniform float uAlpha;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * uPixel;
  vec2 p = vec2(gl_FragCoord.x, 1.0 / uPixel.y - gl_FragCoord.y) * uToView;
  if (uFeet >= 2) {
    float foot = uFoot[0].y;
    for (int i = 1; i < 16; i++) {
      if (i >= uFeet) break;
      vec2 a = uFoot[i - 1], b = uFoot[i];
      if (p.x >= a.x) foot = p.x <= b.x ? mix(a.y, b.y, (p.x - a.x) / max(1e-4, b.x - a.x)) : b.y;
    }
    if (p.y > foot) discard;
  }
  // One pixel's slack: the edge pixel itself, half the figure's, keeps the arm's half too.
  if (p.x < uSides.x - uToView.x || p.x > uSides.y + uToView.x) discard;
  o = texture(uArm, uv) * uAlpha;
}`
