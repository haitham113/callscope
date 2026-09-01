import { describe, expect, it } from 'vitest'
import {
  PLAN_LIFETIME_MS,
  createRecoveryPlan,
  validatePlanForApplication,
} from '../../src/features/recovery/services/recoveryPlanService.js'
import {
  RECOVERY_TRANSITIONS,
  canTransitionRecovery,
} from '../../src/features/recovery/recoveryMachine.js'

function diagnosis() {
  return {
    id: 'diagnosis-1',
    session_id: 'session-1',
    session_epoch: 4,
    fault_revision: 2,
    snapshot_hash: 'hash-1',
    allowed_actions: ['enable_audio_track'],
  }
}

function approvedPlan() {
  const result = createRecoveryPlan({
    diagnosis: diagnosis(),
    reason: 'Synthetic reason',
    expectedResult: 'Synthetic result',
    now: () => 1_000,
    createId: () => 'plan-1',
  })
  result.plan.status = 'approved'
  return result.plan
}

const validContext = {
  sessionId: 'session-1',
  sessionEpoch: 4,
  faultRevision: 2,
  snapshotHash: 'hash-1',
  actualAudio: { ready_state: 'live', enabled: false, attached: true },
  connection: { outbound: 'connected', inbound: 'connected' },
  now: 2_000,
}

describe('recovery plan application guard', () => {
  it('requires approval before all other application checks', () => {
    const plan = approvedPlan()
    plan.status = 'staged'
    expect(validatePlanForApplication({ plan, ...validContext }).error.code).toBe('PLAN_NOT_APPROVED')
  })

  it('rejects expired, stale, and used plans', () => {
    const expired = approvedPlan()
    expect(
      validatePlanForApplication({ plan: expired, ...validContext, now: 100_000 }).error.code,
    ).toBe('PLAN_EXPIRED')
    expect(
      validatePlanForApplication({ plan: approvedPlan(), ...validContext, snapshotHash: 'changed' }).error.code,
    ).toBe('DIAGNOSIS_STALE')
    const used = approvedPlan()
    used.status = 'verified'
    expect(validatePlanForApplication({ plan: used, ...validContext }).error.code).toBe('PLAN_ALREADY_USED')
  })

  it('accepts only the live attached disabled audio state', () => {
    expect(validatePlanForApplication({ plan: approvedPlan(), ...validContext })).toEqual({ ok: true })
    expect(
      validatePlanForApplication({
        plan: approvedPlan(),
        ...validContext,
        actualAudio: { ...validContext.actualAudio, enabled: true },
      }).error.code,
    ).toBe('DIAGNOSIS_STALE')
  })

  it('uses an explicit immutable recovery transition table', () => {
    expect(RECOVERY_TRANSITIONS).toEqual({
      draft: ['staged'],
      staged: ['approved', 'rejected', 'expired'],
      approved: ['applied', 'expired'],
      rejected: [],
      expired: [],
      applied: ['verified'],
      verified: [],
    })
    expect(canTransitionRecovery('approved', 'applied')).toBe(true)
    expect(canTransitionRecovery('rejected', 'applied')).toBe(false)
    expect(Object.isFrozen(RECOVERY_TRANSITIONS.approved)).toBe(true)
  })

  it('binds a plan and expires it at exactly ninety seconds', () => {
    const plan = createRecoveryPlan({
      diagnosis: diagnosis(),
      action: 'enable_audio_track',
      reason: 'Synthetic reason',
      expectedResult: 'Synthetic result',
      now: () => 1_000,
      createId: () => 'plan-bound',
    }).plan

    expect(Date.parse(plan.expires_at) - Date.parse(plan.created_at)).toBe(PLAN_LIFETIME_MS)
    expect(plan).toMatchObject({
      session_id: 'session-1',
      session_epoch: 4,
      fault_revision: 2,
      diagnosis_id: 'diagnosis-1',
      snapshot_hash: 'hash-1',
    })
  })

  it('accepts a confirmed constrained-video plan only while the sender readback still matches', () => {
    const videoDiagnosis = {
      ...diagnosis(),
      allowed_actions: ['restore_video_bitrate'],
    }
    const plan = createRecoveryPlan({
      diagnosis: videoDiagnosis,
      action: 'restore_video_bitrate',
      reason: 'Restore known-good encodings',
      expectedResult: 'Remove the confirmed cap',
      now: () => 1_000,
      createId: () => 'plan-video',
    }).plan
    plan.status = 'approved'
    const actualVideo = {
      attached: true,
      max_bitrate_bps: 80_000,
      bitrate_limited: true,
      readback_confirmed: true,
    }

    expect(validatePlanForApplication({
      plan,
      ...validContext,
      actualVideo,
    })).toEqual({ ok: true })
    expect(validatePlanForApplication({
      plan,
      ...validContext,
      actualVideo: { ...actualVideo, bitrate_limited: false },
    }).error.code).toBe('DIAGNOSIS_STALE')
  })

  it.each([
    ['rejected', 'PLAN_NOT_APPROVED'],
    ['expired', 'PLAN_EXPIRED'],
    ['applied', 'PLAN_ALREADY_USED'],
    ['verified', 'PLAN_ALREADY_USED'],
  ])('rejects %s plan state without changing it', (status, code) => {
    const plan = approvedPlan()
    plan.status = status
    const before = structuredClone(plan)
    expect(validatePlanForApplication({ plan, ...validContext }).error.code).toBe(code)
    expect(plan).toEqual(before)
  })

  it('rejects mismatched sessions and incompatible actions without mutation', () => {
    const mismatched = approvedPlan()
    expect(
      validatePlanForApplication({ plan: mismatched, ...validContext, sessionEpoch: 5 }).error.code,
    ).toBe('SESSION_MISMATCH')
    const incompatible = approvedPlan()
    incompatible.action = 'restore_video_bitrate'
    const before = structuredClone(incompatible)
    expect(validatePlanForApplication({ plan: incompatible, ...validContext }).error.code).toBe('ACTION_NOT_ALLOWED')
    expect(incompatible).toEqual(before)
  })
})
