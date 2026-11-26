import type { Anime25DArmAim, Anime25DArmSide, Anime25DDriver, Anime25DDriving, Anime25DInspection, Anime25DMotionEnvelopeProfile, Anime25DPlayback, Anime25DPose, MeropeRigManifest, Anime25DDebugSnapshot as StageDebugSnapshot, VisibleTouchHit } from '@myriad-you/figure-player'

import type { PoseCorrection, PoseCorrectionStageSource } from '@myriad-you/figure-player/workbench'
import type { PresentedTouchReaction } from '../interaction/touchReaction'

import type { MotionChannelPolicy } from '../motion/policy'
import type { PerformanceBaseline } from '../performance/types'
import type { MusicMotionSignal } from '../singing/musicSignal'
import type { SpeechProsodyPlan } from '../speech/prosody'
import type { FigureTrace } from '../trace'
import type { Anime25DMotionUnit } from './behaviorMotion'
import type { MotionComposerInput, MotionFigure } from './motionComposer'
import { Anime25DClosedEyePresentation, Anime25DIrisRebound, Anime25DStage, IDENTITY_DRIVER } from '@myriad-you/figure-player'

import { sanitizeDriverPatch } from '@myriad-you/figure-player/internals'
import { IDLE_MOTION_POLICY } from '../motion/policy'
import { boundRigCapabilities } from '../motion/rigStateSummary'

import { NO_TRACE } from '../trace'

import { ThinkingExpressionOwnership } from './expressionPresets'

import { Anime25DMotionComposer, measureMotionFigure } from './motionComposer'
import {
  bearingDriverPatch,
} from './performanceExpression'
import { baselineDriverPatch, restEnergyDriverPatch } from './performanceMotion'

/** The stage's snapshot (Anime25DStage.debugSnapshot), with what her motion envelope moved between channels. */
export interface Anime25DDebugSnapshot extends StageDebugSnapshot {
  motionEnvelope: StageDebugSnapshot['motionEnvelope'] & { transferredEnergy: number }
}
export type { Anime25DInspection, Anime25DLayerView, Anime25DPoint } from '@myriad-you/figure-player'

/** The stage (Anime25DStage from @myriad-you/figure-player) driven by her performance: speech, song, directed poses, behaviors and touch. */
export class Anime25DPlayer {
  private readonly stage: Anime25DStage<MotionFigure>
  private motionCapabilities: readonly string[] = []
  private readonly current: Anime25DDriver = { ...IDENTITY_DRIVER }
  private readonly target: Anime25DDriver = { ...IDENTITY_DRIVER }

  private readonly irisRebound = new Anime25DIrisRebound()
  private readonly closedEyes = new Anime25DClosedEyePresentation()
  private readonly motion = new Anime25DMotionComposer(
    this.current,
    this.closedEyes,
    this.irisRebound,
  )

  private readonly thinkingExpression = new ThinkingExpressionOwnership()
  private musicSignal: MusicMotionSignal | null = null
  private presentedTouch: PresentedTouchReaction | null = null

  getPresentedTouch(): PresentedTouchReaction | null {
    return this.presentedTouch
  }

  private speechActive = false
  private motionEnvelopeProfile!: Anime25DMotionEnvelopeProfile
  private readonly mouse = { x: 0, y: 0, inside: false }
  private policy: MotionChannelPolicy = { ...IDLE_MOTION_POLICY }

  private readonly motionInput: MotionComposerInput = {
    time: 0,
    target: this.target,
    policy: this.policy,
    mouse: this.mouse,
    speechActive: false,
    musicSignal: null,
    motionEnvelopeProfile: undefined!,
  }

  constructor(
    canvas: HTMLCanvasElement,
    playback: Anime25DPlayback,
    rigManifest?: MeropeRigManifest,
    private readonly trace: FigureTrace = NO_TRACE,
  ) {
    const motion = this.motion
    const driving: Anime25DDriving<MotionFigure> = {
      directedBodyWeight: control => motion.directedBodyWeight(control),
      get jawBoost() { return motion.jawBoost },
      get stickerFaceMotion() { return motion.stickerFaceMotion },
      get stickerFaceHeadShare() { return motion.stickerFaceHeadShare },
      get stickerMouthShare() { return motion.stickerMouthShare },
      step: (dt, time) => this.stepMotion(dt, time),
      spinnerLevel: () => this.thinkingLevel(),
      drawn: () => this.sampleTouch(),
      frame: sample => this.trace.frame(sample),
      measure: measureMotionFigure,
      bind: (figure, motionEnvelopeProfile) => this.bindFigure(figure, motionEnvelopeProfile),
      measureCapabilities: boundRigCapabilities,
      bindCapabilities: (capabilities) => {
        this.motionCapabilities = capabilities
        motion.directedPose.setCapabilities(capabilities)
      },
    }
    this.stage = new Anime25DStage(canvas, playback, rigManifest, driving, {
      current: this.current,
      closedEyes: this.closedEyes,
      irisRebound: this.irisRebound,
    })
  }

  /**
   * The last outfit keeps drawing until the next one is ready, and stays exactly as it was if the next one fails
   * (Anime25DStage.replaceLivePackage).
   */
  replaceLivePackage(
    playback: Anime25DPlayback,
    rigManifest: MeropeRigManifest | undefined,
    atlasUrl: string,
  ): Promise<void> {
    return this.stage.replaceLivePackage(playback, rigManifest, atlasUrl)
  }

  loadAtlas(url: string): Promise<void> {
    return this.stage.loadAtlas(url)
  }

  /** Workbench-only override. Never changes the immutable playback package. */
  previewPoseCorrections(corrections: readonly PoseCorrection[] | null): void {
    this.stage.previewPoseCorrections(corrections)
  }

  /** Workbench-only: what correction picking reads of the live frame; null once disposed. */
  poseStage(): PoseCorrectionStageSource | null {
    return this.stage.poseStage()
  }

  hitTestTouch(clientX: number, clientY: number): VisibleTouchHit | null {
    return this.stage.hitTestTouch(clientX, clientY)
  }

  /** Takes the motion's measure of a package as the stage takes the package. */
  private bindFigure(figure: MotionFigure, motionEnvelopeProfile: Anime25DMotionEnvelopeProfile): void {
    this.motionEnvelopeProfile = motionEnvelopeProfile
    this.motion.singingGroove.setArmMotion(
      motionEnvelopeProfile.armMotion && motionEnvelopeProfile.rigidArm.limit > 0,
    )
    this.motion.bindFigure(figure)
  }

  getMotionCapabilities(): readonly string[] { return this.motionCapabilities }

  setTarget(partial: Partial<Anime25DDriver>): void {
    const patch = sanitizeDriverPatch(partial)
    this.thinkingExpression.apply(this.target, patch, this.speechActive || (patch.talking ?? this.target.talking))
  }

  replaceTarget(driver: Anime25DDriver): void {
    this.thinkingExpression.clear()
    Object.assign(this.target, IDENTITY_DRIVER)
    // A full workbench replacement owns its authored state, including flags.
    this.thinkingExpression.apply(this.target, sanitizeDriverPatch(driver), false)
  }

  getTarget(): Anime25DDriver {
    return { ...this.target }
  }

  getCurrent(): Anime25DDriver {
    return { ...this.current }
  }

  playFace(face: string | null, shift: string | null, via?: readonly string[]): void { this.motion.directedPose.preview(face, shift, this.stage.animationTime(), via) }

  blinkNow(): void {
    this.motion.blinkNow(this.stage.animationTime())
  }

  setMouse(x: number, y: number, inside: boolean): void {
    this.mouse.inside = inside
    if (!inside) return
    this.mouse.x = x
    this.mouse.y = y
  }

  setMotionPolicy(policy: MotionChannelPolicy): void {
    this.policy = policy
  }

  getMotionPolicy(): MotionChannelPolicy {
    return this.policy
  }

  setSpeechActive(active: boolean): void {
    this.speechActive = active
    if (active) this.thinkingExpression.release(this.target)
  }

  setSinging(active: boolean): void {
    this.target.singing = active
  }

  setSingingTrack(trackId: string | null): void {
    this.motion.singingGroove.setTrack(trackId)
  }

  setMusicSignal(drive: MusicMotionSignal | null): void {
    this.musicSignal = drive
  }

  setScore(score: import('../motion/scoreTimeline').ResolvedScore | null, nowMs: number): void { if (score) this.motion.directedPose.setScore(score, this.stage.animationTime(), nowMs) }

  setSpeechProsody(plan: SpeechProsodyPlan | null): void {
    this.motion.speechExpression.setProsody(plan, this.stage.animationTime())
  }

  enqueueSpeechText(text: string, locale?: string): void {
    this.motion.speechMotion.enqueueText(text, locale)
  }

  clearSpeechText(): void {
    this.motion.speechMotion.clear(this.stage.animationTime())
  }

  setBehaviorMotionUnits(
    units: readonly Anime25DMotionUnit[],
    nowMs: number,
  ): void {
    const time = this.stage.animationTime()
    this.motion.behaviorMotion.replace(units, nowMs, time)
    this.motion.performanceExpression.playBehaviorUnits(units, time, nowMs)
  }

  clearBehaviorMotionUnits(): void {
    const time = this.stage.animationTime()
    this.motion.behaviorMotion.clear(time)
    this.motion.performanceExpression.stopBehaviors(time)
  }

  setBearing(bearing: PerformanceBaseline | null): void {
    this.motion.directedPose.set(bearing?.pose, this.stage.animationTime(), bearing?.face ?? null, bearing?.shift ?? null, bearing?.via ?? null)
    this.motion.performanceExpression.setBearingAttention(bearing?.attention ?? null)
    this.setTarget({
      ...(bearing ? baselineDriverPatch(bearing) : restEnergyDriverPatch()),
      ...bearingDriverPatch(bearing),
    })
  }

  /** The gesture arms each side of the picture was drawn with. */
  armVariantGestures(): Record<Anime25DArmSide, string[]> {
    return this.stage.armVariantGestures()
  }

  /** The gesture each side is raising or holding now. */
  raisedArmVariants(): Record<Anime25DArmSide, string | null> {
    return this.stage.raisedArmVariants()
  }

  /**
   * Put a side's hand where `aim` says (from its shoulder, in arm lengths), from wherever the arm is and whatever
   * the drivers ask; null lets it follow them again. Led a little each frame the hand is there at once; moved
   * far at once the arm goes there. Only a modelled gesture arm of a bound figure can.
   */
  aimArm(side: Anime25DArmSide, aim: Anime25DArmAim | null): void {
    this.stage.aimArm(side, aim)
  }

  /** The aim that holds a side's arm as its `gesture` is drawn: a place to start an aim from. */
  armGestureAim(side: Anime25DArmSide, gesture: string): Anime25DArmAim | null {
    return this.stage.armGestureAim(side, gesture)
  }

  /** What was drawn this frame, copied out for tests and inspectors. */
  inspect(): Anime25DInspection {
    return this.stage.inspect()
  }

  debugSnapshot(): Anime25DDebugSnapshot {
    const snapshot = this.stage.debugSnapshot()
    return { ...snapshot, motionEnvelope: { ...snapshot.motionEnvelope, transferredEnergy: this.motion.motionEnvelopeResult.transferredEnergy } }
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.stage.resize(cssWidth, cssHeight, devicePixelRatio)
  }

  /**
   * Her own frame drawn last, as data (an Anime25DPose: poseToJSON and poseFromJSON write and read it), also while
   * another is shown: drawn again it is the same picture to the pixel. Null until one is drawn, and for another outfit
   * until its own.
   */
  getPose(): Anime25DPose | null {
    return this.stage.getPose()
  }

  /**
   * Draws a pose in place of the figure, which does not move by it: the next tick goes on from where it was. False,
   * and nothing drawn, for a pose that is not of this outfit. Meanwhile nothing is touched (hitTestTouch) or
   * corrected; inspect() is of her own frame.
   */
  renderPose(pose: Readonly<Anime25DPose>): boolean {
    return this.stage.renderPose(pose)
  }

  tick(deltaSeconds: number): void {
    this.stage.tick(deltaSeconds)
  }

  dispose(): void {
    this.stage.dispose()
  }

  /** How strongly the thinking sticker shows: none while she talks. */
  private thinkingLevel(): number {
    return this.speechActive || this.target.talking ? 0 : this.target.thinking ? 1 : this.motion.performanceExpression.getThinkingLevel()
  }

  /** The motion's substep, which writes `current` for the stage. */
  private stepMotion(dt: number, time: number): void {
    const input = this.motionInput
    input.time = time
    input.policy = this.policy
    input.speechActive = this.speechActive
    input.musicSignal = this.musicSignal
    input.motionEnvelopeProfile = this.motionEnvelopeProfile
    this.motion.step(dt, input)
  }

  /** The touch response the frame just drawn shows, stamped as it was drawn. */
  private sampleTouch(): void {
    const sampled = this.motion.performanceExpression.getSampledTouch()
    this.presentedTouch = sampled
      ? { ...sampled, atMs: performance.now() }
      : null
  }
}
