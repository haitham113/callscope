import { describe, expect, it } from 'vitest'
import {
  createRecoveryPlan,
  validatePlanForApplication,
} from '../../src/features/recovery/services/recoveryPlanService.js'

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
})
