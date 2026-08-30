import { AUDIO_RECOVERY_ACTION } from '../../diagnostics/services/diagnosticRules.js'

export const PLAN_LIFETIME_MS = 90_000

export function createRecoveryPlan({
  diagnosis,
  reason,
  expectedResult,
  now = () => Date.now(),
  createId = () => crypto.randomUUID(),
}) {
  if (!diagnosis.allowed_actions.includes(AUDIO_RECOVERY_ACTION)) {
    return errorResult(
      'ACTION_NOT_ALLOWED',
      'The diagnosis does not allow the requested recovery action.',
      'Capture a fresh diagnosis for the active fault.',
    )
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
      action: AUDIO_RECOVERY_ACTION,
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

export function errorResult(code, message, suggestedNextStep, recoverable = true) {
  return {
    ok: false,
    error: {
      code,
      message,
      recoverable,
      suggested_next_step: suggestedNextStep,
    },
  }
}

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
    return errorResult('PLAN_NOT_FOUND', 'No recovery plan is staged.', 'Stage a compatible recovery plan first.')
  }
  if (plan.status === 'applied' || plan.status === 'verified') {
    return errorResult('PLAN_ALREADY_USED', 'This recovery plan has already been used.', 'Diagnose the current state again if another repair is needed.')
  }
  if (plan.status !== 'approved') {
    return errorResult('PLAN_NOT_APPROVED', 'The recovery plan requires explicit user approval.', 'Ask the user to approve or reject the staged plan.')
  }
  if (Date.parse(plan.expires_at) <= now) {
    return errorResult('PLAN_EXPIRED', 'The recovery plan has expired.', 'Capture a fresh diagnosis and stage a new plan.')
  }
  if (plan.session_id !== sessionId || plan.session_epoch !== sessionEpoch) {
    return errorResult('SESSION_MISMATCH', 'The recovery plan belongs to a different lab session.', 'Stage a plan for the active session.')
  }
  if (plan.fault_revision !== faultRevision || plan.snapshot_hash !== snapshotHash) {
    return errorResult('DIAGNOSIS_STALE', 'The live fault state no longer matches the staged plan.', 'Run diagnostics again against a fresh snapshot.')
  }
  if (plan.action !== AUDIO_RECOVERY_ACTION) {
    return errorResult('ACTION_NOT_ALLOWED', 'The recovery action is not allowlisted for this milestone.', 'Use enable_audio_track for a confirmed disabled-audio diagnosis.')
  }
  if (
    actualAudio?.enabled !== false ||
    actualAudio?.ready_state !== 'live' ||
    actualAudio?.attached !== true
  ) {
    return errorResult('DIAGNOSIS_STALE', 'The outbound audio track no longer matches the diagnosed fault.', 'Inspect and diagnose the current call state again.')
  }
  if (connection?.outbound !== 'connected' || connection?.inbound !== 'connected') {
    return errorResult('RECOVERY_FAILED', 'Both peer connections must be connected before audio recovery.', 'Reset the scenario or restart the lab.', false)
  }
  return { ok: true }
}
