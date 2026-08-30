import { AUDIO_RECOVERY_ACTION } from '../../diagnostics/services/diagnosticRules.js'
import { errorResult } from '../../../shared/errors/serviceErrors.js'

export const PLAN_LIFETIME_MS = 90_000

export function createRecoveryPlan({
  diagnosis,
  reason,
  expectedResult,
  action = AUDIO_RECOVERY_ACTION,
  now = () => Date.now(),
  createId = () => crypto.randomUUID(),
}) {
  if (action !== AUDIO_RECOVERY_ACTION || !diagnosis.allowed_actions.includes(action)) {
    return errorResult('ACTION_NOT_ALLOWED')
  }
  const createdAt = now()
  return {
    ok: true,
    plan: {
      id: createId(),
      session_id: diagnosis.session_id,
      session_epoch: diagnosis.session_epoch,
      fault_revision: diagnosis.fault_revision,
      diagnosis_id: diagnosis.id,
      snapshot_hash: diagnosis.snapshot_hash,
      action,
      reason,
      expected_result: expectedResult,
      risk: 'low',
      reversible: true,
      status: 'staged',
      created_at: new Date(createdAt).toISOString(),
      approved_at: null,
      rejected_at: null,
      expires_at: new Date(createdAt + PLAN_LIFETIME_MS).toISOString(),
      applied_at: null,
      verified_at: null,
    },
  }
}

export { errorResult }

export function validatePlanForApplication({
  plan,
  sessionId,
  sessionEpoch,
  faultRevision,
  snapshotHash,
  actualAudio,
  connection,
  now = Date.now(),
}) {
  if (!plan) {
    return errorResult('PLAN_NOT_FOUND')
  }
  if (plan.status === 'applied' || plan.status === 'verified') {
    return errorResult('PLAN_ALREADY_USED')
  }
  if (plan.status === 'expired') {
    return errorResult('PLAN_EXPIRED')
  }
  if (plan.status !== 'approved') {
    return errorResult('PLAN_NOT_APPROVED')
  }
  if (Date.parse(plan.expires_at) <= now) {
    return errorResult('PLAN_EXPIRED')
  }
  if (plan.session_id !== sessionId || plan.session_epoch !== sessionEpoch) {
    return errorResult('SESSION_MISMATCH')
  }
  if (plan.fault_revision !== faultRevision || plan.snapshot_hash !== snapshotHash) {
    return errorResult('DIAGNOSIS_STALE')
  }
  if (plan.action !== AUDIO_RECOVERY_ACTION) {
    return errorResult('ACTION_NOT_ALLOWED')
  }
  if (
    actualAudio?.enabled !== false ||
    actualAudio?.ready_state !== 'live' ||
    actualAudio?.attached !== true
  ) {
    return errorResult('DIAGNOSIS_STALE')
  }
  if (connection?.outbound !== 'connected' || connection?.inbound !== 'connected') {
    return errorResult('RECOVERY_FAILED')
  }
  return { ok: true }
}
