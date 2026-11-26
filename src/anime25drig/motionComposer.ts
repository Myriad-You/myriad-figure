import type { Anime25DClosedEyePresentation, Anime25DDriver, Anime25DIrisRebound, Anime25DMotionEnvelopeProfile, Anime25DPlayback } from '@myriad-you/figure-player'
import type { Anime25DBlinkState, Anime25DIdleSwayOffset } from '@myriad-you/figure-player/internals'
import type { MotionChannelPolicy } from '../motion/policy'
import type { MusicMotionSignal } from '../singing/musicSignal'
import type { AmbientPose } from './ambientMotion'
import type { IndependentBodyControl } from './directedPose'
import type { Anime25DStylizedTargets, IdleSwayPose } from './driverComposition'
import type { RandomActionFrame } from './randomAction'
import type { StylizedExpressionMotion } from './stylizedExpressionMotion'
import { IDENTITY_DRIVER } from '@myriad-you/figure-player'
import { applyAnime25DCryMouth, applyAnime25DStickerMouthShare, bodyKeyShare, GazeShiftBlink, headRidesBody, idleSwayOffset, isStandingFigure, PoseResponseController, prepareAnime25DWorkingTarget, projectAnime25DMotionEnvelope, smoothAnime25DUnit, STANDING_HEAD_ROLL, STANDING_IDLE_SHARE, standingWeightShift, stepAnime25DBlink, stepAnime25DDriverResponse } from '@myriad-you/figure-player/internals'
import { allowsPointerGaze } from '../motion/policy'
import { SingingGrooveController } from '../singing/singingGroove'
import { AmbientMotionController } from './ambientMotion'
import { Anime25DBehaviorMotionController } from './behaviorMotion'
import { BODY_CONTROL_DRIVERS, DirectedPoseController, INDEPENDENT_BODY_CONTROLS } from './directedPose'
import { applyAnime25DComposedPose, applyAnime25DSpeechExtras, applyAnime25DStylizedExpression, resolveAnime25DStylizedTargets } from './driverComposition'
import { expressiveEyeOpenOffset } from './expressiveMotionEnvelope'
import { monotonicControlTime } from './motionPrediction'
import { PerformanceExpressionController } from './performanceExpression'
import {
  applyBehaviorMotionGate,
  PoseGateController,
  resolvePoseGate,
} from './poseArbitration'
import { zeroOccupancyOffset } from './poseCompositor'
import { PoseOccupancyController } from './poseOccupancy'
import { resolvePoseResponseScale } from './poseResponse'
import {
  DIRECTED_BODY_BLOCK_LEVEL,
  RandomActionController,
} from './randomAction'
import { CoSpeechExpressionController } from './speechExpression'
import { AutoSpeechController } from './speechMotion'
import { STANDING_IDLE_ROLL_SHARE } from './standing'
import { StylizedExpressionMotionController } from './stylizedExpressionMotion'
import { ThinkingMotionController } from './thinkingMotion'

const POINTER_ATTACK_RATE = 16
const POINTER_RELEASE_RATE = 5.5

/** What the composer reads each step; the player refills one instance. */
export interface MotionComposerInput {
  time: number
  /** The authored target: workbench drivers, bearing and directed state. */
  target: Anime25DDriver
  policy: MotionChannelPolicy
  mouse: { x: number; y: number; inside: boolean }
  speechActive: boolean
  musicSignal: MusicMotionSignal | null
  motionEnvelopeProfile: Anime25DMotionEnvelopeProfile
}

/**
 * How often she blinks as a sentence ends and its pause begins. Blinks come
 * at speech pauses and turn ends more than within words (Nakano & Kitazawa
 * 2010); not every one, so it does not read as a tic.
 */
const PAUSE_BLINK_CHANCE = 0.6

/** What the motion needs of a package's figure, measured before the package is taken. */
export interface MotionFigure {
  standing: boolean
  headRidesBody: number
}

export function measureMotionFigure(playback: Pick<Anime25DPlayback, 'anchors' | 'bodyTurnKeyforms' | 'turnKeyforms'>): MotionFigure {
  return { standing: isStandingFigure(playback.anchors), headRidesBody: headRidesBody(bodyKeyShare(playback), Boolean(playback.turnKeyforms)) }
}

/**
 * Everything she does, composed into one driver. Speech, song, directed
 * performances, sticker faces, idle and random motion each propose an
 * offset; occupancy and the pose gate decide who owns which channel; the
 * envelope keeps the result drawable; and the response smoothing writes it
 * into `current`. Rendering reads `current` and the few outputs below.
 */
export class Anime25DMotionComposer {
  readonly directedPose = new DirectedPoseController()
  readonly performanceExpression = new PerformanceExpressionController()
  readonly behaviorMotion = new Anime25DBehaviorMotionController()
  readonly speechMotion = new AutoSpeechController()
  readonly speechExpression = new CoSpeechExpressionController()
  readonly singingGroove = new SingingGrooveController()
  readonly motionEnvelopeResult = {
    clippedEnergy: 0,
    transferredEnergy: 0,
  }

  /** The sticker faces' own motion, which the head and mouth deformers read. */
  stickerFaceMotion: Readonly<StylizedExpressionMotion> | null = null
  /** How much of the sticker faces' head pulse the gate lets through. */
  stickerFaceHeadShare = 1
  /** How far a sticker face owns the mouth once she stops talking. */
  stickerMouthShare = 1
  /** Speech's brow accent, which the jaw follows. */
  jawBoost = 0

  private readonly workingTarget: Anime25DDriver = { ...IDENTITY_DRIVER }
  private readonly expressionTarget: Anime25DDriver = { ...IDENTITY_DRIVER }
  private readonly poseResponse = new PoseResponseController()
  // Geometry mixes its automatic posture with already-weighted drivers. Its
  // remaining automatic share must follow the same response, not raw ownership.
  private readonly directedAuthority = { ...IDENTITY_DRIVER }
  private readonly directedAuthorityTarget = { ...IDENTITY_DRIVER }
  private readonly directedAuthorityResponse = new PoseResponseController()
  private unblinkedEyeOpenL = 1
  private unblinkedEyeOpenR = 1
  private readonly blinkState: Anime25DBlinkState = {
    activeSeconds: -1,
    nextAtSeconds: 1.8,
  }

  private readonly ambientMotion = new AmbientMotionController()
  /** A long look takes a blink with it. */
  private readonly gazeBlink = new GazeShiftBlink()
  private responseScale = 1
  private controlTime = 0
  private readonly occupancy = new PoseOccupancyController()
  private readonly poseGate = new PoseGateController()
  private readonly randomAction = new RandomActionController()
  private readonly thinkingMotion = new ThinkingMotionController()
  private readonly stylizedExpression = new StylizedExpressionMotionController()
  private readonly stylizedTargets: Anime25DStylizedTargets = {
    anger: 0,
    speechless: 0,
    maniac: 0,
    silly: 0,
    lovestruck: 0,
  }

  /** Reused so the per-frame pose composition never allocates. */
  private readonly composedPose = zeroOccupancyOffset()
  /** Breath and voice, kept apart to ride on what the director holds. */
  private readonly ridingPose = zeroOccupancyOffset()
  private readonly sway: Anime25DIdleSwayOffset = { headYaw: 0, headPitch: 0, headRoll: 0, bodyLean: 0 }
  /** The idle sway as a pose source, in its keys. */
  private readonly idleSwayPose: IdleSwayPose = { angleX: 0, angleY: 0, angleZ: 0, body: 0 }
  private readonly idleAmbient: AmbientPose = { angleX: 0, angleY: 0, angleZ: 0, body: 0, eyeX: 0, eyeY: 0 }
  private readonly idleRandom = {} as RandomActionFrame
  private standing = false
  private headRidesBody = 0
  private readonly cryMouth = {
    jaw: 0,
    lipCurve: 0,
    mouthCY: 0,
    mouthScale: 0,
  }

  private pointerAuthority = 0

  constructor(
    /** The driver rendering reads; the composer is its only writer. */
    private readonly current: Anime25DDriver,
    private readonly closedEyes: Anime25DClosedEyePresentation,
    private readonly irisRebound: Anime25DIrisRebound,
  ) {}

  /** A standing figure's ambient pose: the torso a look recruits, and its head roll, take their idle shares. */
  private standingAmbient(ambient: Readonly<AmbientPose>): Readonly<AmbientPose> {
    Object.assign(this.idleAmbient, ambient)
    this.idleAmbient.body = ambient.body * STANDING_IDLE_SHARE
    this.idleAmbient.angleZ = ambient.angleZ * STANDING_IDLE_ROLL_SHARE
    return this.idleAmbient
  }

  /** ...and a standing figure's random actions: the lean and the roll they bring, too, are idle. */
  private standingRandom(action: Readonly<RandomActionFrame>): Readonly<RandomActionFrame> {
    Object.assign(this.idleRandom, action)
    this.idleRandom.body = action.body * STANDING_IDLE_SHARE
    this.idleRandom.angleZ = action.angleZ * STANDING_IDLE_ROLL_SHARE
    return this.idleRandom
  }

  /**
   * A standing figure also shifts its weight from leg to leg while idle; one
   * with a keyed body turn carries its head round with a directed torso turn
   * (headRidesBody).
   */
  setFigure(playback: Pick<Anime25DPlayback, 'anchors' | 'bodyTurnKeyforms' | 'turnKeyforms'>): void {
    this.bindFigure(measureMotionFigure(playback))
  }

  /** Takes a figure measured with measureMotionFigure. */
  bindFigure(figure: Readonly<MotionFigure>): void {
    this.standing = figure.standing
    this.directedPose.setStanding(this.standing)
    this.headRidesBody = figure.headRidesBody
  }

  directedBodyWeight(control: IndependentBodyControl): number {
    return this.directedAuthority[BODY_CONTROL_DRIVERS[control]]
  }

  /** Blink soon, then resume the natural rhythm. */
  blinkNow(time: number): void {
    this.blinkState.activeSeconds = 0
    this.blinkState.nextAtSeconds = time + 1.6 + Math.random() * 3.8
  }

  step(dt: number, input: MotionComposerInput): void {
    const t = input.time
    this.directedPose.setPolicy(input.policy)
    this.directedPose.setTouchShare(this.performanceExpression.getTouchShare())
    const target = input.target
    const pointer =
      target.followPointer && allowsPointerGaze(input.policy.gaze)
        ? input.mouse
        : { x: 0, y: 0, inside: false }
    const pointerWanted = pointer.inside ? 1 : 0
    this.pointerAuthority +=
      (pointerWanted - this.pointerAuthority) *
      (1 -
        Math.exp(
          -(pointerWanted > this.pointerAuthority
            ? POINTER_ATTACK_RATE
            : POINTER_RELEASE_RATE) * dt,
        ))
    const tgt = prepareAnime25DWorkingTarget(
      this.workingTarget,
      target,
      pointer,
      this.pointerAuthority,
    )
    const controlTime = monotonicControlTime(
      this.controlTime,
      t,
      this.responseScale,
    )
    this.controlTime = controlTime
    const behaviorMotion = this.behaviorMotion.sample(controlTime)
    const speaking = input.speechActive || target.talking
    const singing = target.singing
    const vocalizing = speaking || (singing && (behaviorMotion.musicMode === 'sing' || behaviorMotion.musicMode === 'hum'))
    // Her standing acting gives way to speaking by itself, as she is taken up.
    this.directedPose.setSpeaking(vocalizing)
    this.directedPose.step(dt, t, tgt)
    const expressionTarget = Object.assign(this.expressionTarget, tgt)
    this.directedPose.write(expressionTarget, vocalizing)
    const semanticExpression = this.performanceExpression.sample(
      controlTime,
      expressionTarget,
      input.speechActive || target.talking,
    )
    this.directedPose.setTransientMotion(semanticExpression, this.performanceExpression.getActiveLevel())
    const stylizedTargets = resolveAnime25DStylizedTargets(
      this.stylizedTargets,
      expressionTarget,
      semanticExpression,
    )
    const stylized = this.stylizedExpression.sample(
      controlTime,
      stylizedTargets.anger,
      stylizedTargets.speechless,
      stylizedTargets.maniac,
      stylizedTargets.silly,
      stylizedTargets.lovestruck,
    )
    this.stickerFaceMotion = stylized
    const performanceMotionScale =
      this.performanceExpression.getAmbientMotionScale()
    const pointerDriven = target.followPointer && pointer.inside
    const speech = this.speechMotion.sample(controlTime, target.talking)
    this.jawBoost = speech.browAccent
    const speechExpression = this.speechExpression.sample(
      controlTime,
      speaking,
      input.speechActive && !target.talking ? tgt.jaw : null,
      speech.phraseActivity,
      speech.browAccent,
      speech.headAccent,
      behaviorMotion.coSpeechQuality,
      behaviorMotion.coSpeechGesture,
    )
    const groove = this.singingGroove.sample(
      t,
      singing,
      input.musicSignal,
      behaviorMotion.musicQuality,
      behaviorMotion.musicMode,
    )
    // A sticker face only takes the mouth once the character has stopped talking
    this.stickerMouthShare +=
      ((vocalizing ? 0 : 1) - this.stickerMouthShare) * (1 - Math.exp(-7 * dt))
    const sticker = Math.max(
      stylizedTargets.anger,
      stylizedTargets.speechless,
      stylizedTargets.maniac,
      stylizedTargets.silly,
      stylizedTargets.lovestruck,
    )
    const occupancy = this.occupancy.sample(dt, {
      speaking,
      singing,
      thinking: target.thinking,
      pointerDriven,
      automation: target.idleSway,
      sticker,
    })
    const randomAction = this.randomAction.sample(
      t,
      target.idleSway,
      this.performanceExpression.getActiveLevel() >= DIRECTED_BODY_BLOCK_LEVEL,
    )
    const ambient = this.ambientMotion.sample(t, target.idleSway, speaking)
    const thinking = this.thinkingMotion.sample(t, target.thinking && !speaking, tgt)
    const sway = idleSwayOffset(t, this.sway)
    const idleSway = this.idleSwayPose
    idleSway.angleX = sway.headYaw
    idleSway.angleY = sway.headPitch
    idleSway.angleZ = sway.headRoll
    idleSway.body = sway.bodyLean
    if (this.standing) {
      const weight = standingWeightShift(t) * STANDING_IDLE_SHARE
      idleSway.body = idleSway.body * STANDING_IDLE_SHARE + weight
      // The head tips further the way the body leans, as a standing idle's does.
      idleSway.angleZ += weight * STANDING_HEAD_ROLL
    }
    const gate = this.poseGate.sample(
      dt,
      applyBehaviorMotionGate(
        resolvePoseGate(input.policy, occupancy, {
          performance: performanceMotionScale,
          stylized: stylized.ambientScale,
          randomAmbient: randomAction.ambientScale,
          touch: this.performanceExpression.getTouchShare(),
        }),
        behaviorMotion,
      ),
    )
    this.stickerFaceHeadShare = gate.stylized.headBody
    applyAnime25DComposedPose(
      tgt,
      gate,
      {
        ambient: this.standing ? this.standingAmbient(ambient) : ambient,
        randomAction: this.standing ? this.standingRandom(randomAction) : randomAction,
        groove,
        thinking,
        idleSway,
        performance: semanticExpression,
        stylized,
        coSpeech: speechExpression,
      },
      this.composedPose,
      this.ridingPose,
    )
    applyAnime25DStylizedExpression(
      tgt,
      semanticExpression,
      stylized,
      this.stickerMouthShare,
      gate.performance.expression,
      gate.stylized.expression,
    )
    applyAnime25DCryMouth(tgt, this.current.eyeCry, t, dt, this.cryMouth)
    const gatedSpeechExpression = {
      brow: speechExpression.brow * gate.coSpeech.expression,
      eyeOpen: speechExpression.eyeOpen * gate.coSpeech.expression,
      angleY: speechExpression.angleY * gate.coSpeech.headBody,
    }
    gatedSpeechExpression.eyeOpen += expressiveEyeOpenOffset(
      gatedSpeechExpression,
    )
    applyAnime25DSpeechExtras(tgt, speech, gatedSpeechExpression)
    applyAnime25DStickerMouthShare(
      tgt,
      smoothAnime25DUnit(stylizedTargets.silly) * this.stickerMouthShare,
    )
    this.directedPose.setTouchShare(this.performanceExpression.getTouchShare())
    this.directedPose.write(tgt, vocalizing, this.ridingPose)
    tgt.headYaw += tgt.torsoTurn * this.headRidesBody
    projectAnime25DMotionEnvelope(
      tgt,
      input.motionEnvelopeProfile,
      this.motionEnvelopeResult,
    )
    this.closedEyes.step(tgt, dt)
    this.responseScale = resolvePoseResponseScale([
      {
        weight:
          this.performanceExpression.getActiveLevel() *
          gate.performance.headBody,
        quality: this.performanceExpression.getActiveQuality(),
      },
      {
        weight: behaviorMotion.coSpeech * gate.coSpeech.headBody,
        quality: behaviorMotion.coSpeechQuality,
      },
      {
        weight: behaviorMotion.music * gate.groove.headBody,
        quality: behaviorMotion.musicQuality,
      },
    ])
    // The smoothing works on the eyes as they would be without the blink;
    // the blink is laid over what it gives, at its own quick pace.
    this.current.lidL = this.unblinkedEyeOpenL
    this.current.lidR = this.unblinkedEyeOpenR
    stepAnime25DDriverResponse(
      this.current,
      target,
      tgt,
      this.poseResponse,
      dt,
      this.responseScale,
    )
    for (const control of INDEPENDENT_BODY_CONTROLS) {
      this.directedAuthorityTarget[BODY_CONTROL_DRIVERS[control]] = this.directedPose.weight(control)
    }
    this.directedAuthorityResponse.step(
      this.directedAuthority, this.directedAuthorityTarget, dt, this.responseScale,
    )
    this.unblinkedEyeOpenL = this.current.lidL
    this.unblinkedEyeOpenR = this.current.lidR
    const blinkSuppressed = stylizedTargets.maniac > 0.03 || stylizedTargets.silly > 0.03 || this.directedPose.lidsMoving()
    if (
      this.gazeBlink.step(
        this.current.headYaw,
        this.current.headPitch,
        this.current.gazeX,
        this.current.gazeY,
        dt,
        this.blinkState.activeSeconds >= 0,
        Math.random,
      ) &&
      target.autoBlink &&
      !blinkSuppressed &&
      this.blinkState.activeSeconds < 0
    ) {
      this.blinkNow(t)
    } else if (
      // A speaker blinks in the pause between sentences more than within one.
      this.speechMotion.takePause() &&
      Math.random() < PAUSE_BLINK_CHANCE &&
      target.autoBlink &&
      !blinkSuppressed &&
      this.blinkState.activeSeconds < 0
    ) {
      this.blinkNow(t)
    }
    stepAnime25DBlink(
      this.current,
      this.blinkState,
      t,
      dt,
      target.autoBlink,
      blinkSuppressed,
    )
    this.irisRebound.step(
      dt,
      Math.max(this.current.lidL, this.current.lidR),
      this.current.eyeWide,
      this.current.gazeX,
      this.current.gazeY,
      Math.max(
        stylizedTargets.maniac,
        stylizedTargets.silly,
        stylizedTargets.lovestruck,
        this.current.maniac,
        this.current.silly,
        this.current.lovestruck,
        tgt.eyeCry,
        tgt.eyeDizzy,
        tgt.eyeSqueeze,
        this.current.eyeCry,
        this.current.eyeDizzy,
        this.current.eyeSqueeze,
      ) > 0.03,
    )
  }
}
