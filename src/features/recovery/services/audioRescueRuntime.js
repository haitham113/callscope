import { diagnoseDisabledAudio } from '../../diagnostics/services/diagnosticRules.js'
import { createIncidentReport } from '../../reports/services/reportService.js'
import {
  createRecoveryPlan,
  errorResult,
  validatePlanForApplication,
} from './recoveryPlanService.js'
import { verifyDisabledAudioRecovery } from './recoveryVerification.js'

export function createAudioRescueRuntime({
  store,
  captureSnapshot,
  readAudioState,
  setAudioEnabled,
  now = () => Date.now(),
}) {
  async function breakAudioTrack() {
    if (store.state !== 'healthy' || store.activeFault) {
      const result = errorResult(
        'INVALID_STATE_TRANSITION',
        'The audio fault can be introduced only from a healthy scenario.',
        'Reset the scenario to healthy first.',
      )
      store.recordOperationError(result, 'Audio fault rejected')
      return result
    }
    const before = readAudioState()
    if (before.ready_state !== 'live' || !before.attached) {
      const result = errorResult(
        'FAULT_MUTATION_FAILED',
        'The intended outbound audio track is not live and attached.',
        'Restart the lab before introducing the fault.',
        false,
      )
      store.recordOperationError(result, 'Audio fault rejected')
      return result
    }

    setAudioEnabled(false)
    const after = readAudioState()
    if (after.enabled !== false) {
      const result = errorResult(
        'FAULT_MUTATION_FAILED',
        'The browser did not confirm enabled=false on the outbound audio track.',
        'Reset or restart the lab.',
        false,
      )
      store.recordOperationError(result, 'Audio fault failed')
      return result
    }
    store.beginAudioFault()
    const snapshot = await captureSnapshot({ stabilize: true })
    store.captureFailureBaseline(snapshot)
    return { ok: true, previous_state: before, new_state: after, failure_snapshot: snapshot }
  }

  async function resetScenario() {
    if (!store.activeFault && store.state === 'healthy') return { ok: true, snapshot: store.latestSnapshot }
    if (!['critical', 'diagnosing', 'awaiting_approval', 'degraded'].includes(store.state)) {
      const result = errorResult(
        'INVALID_STATE_TRANSITION',
        'The current lab state cannot be reset as an active scenario.',
        'Wait for the current operation or restart the lab.',
      )
      store.recordOperationError(result, 'Scenario reset rejected')
      return result
    }
    setAudioEnabled(true)
    store.beginScenarioReset()
    const snapshot = await captureSnapshot({ stabilize: true })
    store.completeScenarioReset(snapshot)
    return { ok: snapshot.health.status === 'healthy', snapshot }
  }

  async function diagnoseAndStageRecovery() {
    if (store.state !== 'critical' || store.activeFault !== 'disabled_audio') {
      const result = errorResult(
        'INVALID_STATE_TRANSITION',
        'Disabled-audio diagnostics require the active critical audio scenario.',
        'Introduce the audio fault first.',
      )
      store.recordOperationError(result, 'Diagnosis rejected')
      return result
    }
    store.beginDiagnosis()
    const snapshot = await captureSnapshot({ stabilize: true })
    const diagnosis = diagnoseDisabledAudio(snapshot)
    store.completeDiagnosis(diagnosis, snapshot)
    if (diagnosis.allowed_actions.length === 0) {
      const result = errorResult(
        'ACTION_NOT_ALLOWED',
        'The sampled evidence did not confirm the disabled-audio recovery action.',
        'Reset and introduce the audio fault again.',
      )
      store.recordOperationError(result, 'Recovery staging rejected')
      return result
    }
    const planResult = createRecoveryPlan({
      diagnosis,
      reason: 'The live outbound audio track is disabled while remaining live and attached to its intended sender.',
      expectedResult: 'Re-enable audio transmission while keeping both peer connections and the existing sender intact.',
      now,
    })
    if (!planResult.ok) {
      store.recordOperationError(planResult, 'Recovery staging rejected')
      return planResult
    }
    store.stageRecoveryPlan(planResult.plan)
    return { ok: true, diagnosis, plan: planResult.plan }
  }

  function approvePlan(planId = store.recoveryPlan?.id) {
    const before = readAudioState()
    const approved = store.approvePlan(planId)
    const after = readAudioState()
    if (!approved) {
      const result = errorResult(
        'PLAN_NOT_FOUND',
        'The staged recovery plan could not be approved.',
        'Stage a fresh recovery plan.',
      )
      store.recordOperationError(result, 'Approval rejected')
      return result
    }
    return {
      ok: true,
      status: 'approved',
      media_state_unchanged: before.enabled === after.enabled,
      audio_track: after,
    }
  }

  function rejectPlan(planId = store.recoveryPlan?.id) {
    const rejected = store.rejectPlan(planId)
    if (rejected) return { ok: true, status: 'rejected', audio_track: readAudioState() }
    const result = errorResult(
      'PLAN_NOT_FOUND',
      'The staged recovery plan could not be rejected.',
      'Stage a fresh recovery plan.',
    )
    store.recordOperationError(result, 'Rejection failed')
    return result
  }

  async function applyApprovedRecovery(planId = store.recoveryPlan?.id) {
    const initialPlan = store.recoveryPlan
    const initialAudio = readAudioState()
    if (!initialPlan || initialPlan.status !== 'approved') {
      const result = validatePlanForApplication({
        plan: initialPlan,
        sessionId: store.sessionId,
        sessionEpoch: store.sessionEpoch,
        faultRevision: store.faultRevision,
        snapshotHash: initialPlan?.snapshot_hash,
        actualAudio: initialAudio,
        connection: store.connection,
        now: now(),
      })
      store.recordOperationError(result, 'Recovery application rejected')
      return result
    }
    if (initialPlan.id !== planId) {
      const result = errorResult(
        'PLAN_NOT_FOUND',
        'The requested recovery plan is not the active plan.',
        'Use the currently staged plan identifier.',
      )
      store.recordOperationError(result, 'Recovery application rejected')
      return result
    }

    const currentSnapshot = await captureSnapshot({ stabilize: false })
    const plan = store.recoveryPlan
    const actualBefore = readAudioState()
    if (plan?.id !== planId) {
      const result = errorResult(
        'PLAN_NOT_FOUND',
        'The active recovery plan changed before application.',
        'Inspect the current state and use its active plan identifier.',
      )
      store.recordOperationError(result, 'Recovery application rejected')
      return result
    }
    const validation = validatePlanForApplication({
      plan,
      sessionId: store.sessionId,
      sessionEpoch: store.sessionEpoch,
      faultRevision: store.faultRevision,
      snapshotHash: currentSnapshot.snapshot_hash,
      actualAudio: actualBefore,
      connection: currentSnapshot.connection,
      now: now(),
    })
    if (!validation.ok) {
      store.recordOperationError(validation, 'Recovery application rejected')
      return validation
    }

    store.beginRecovery()
    setAudioEnabled(true)
    const actualAfter = readAudioState()
    if (
      actualAfter.enabled !== true ||
      actualAfter.ready_state !== 'live' ||
      actualAfter.attached !== true
    ) {
      const result = errorResult(
        'RECOVERY_FAILED',
        'The browser did not confirm a live, attached, enabled audio track after mutation.',
        'Reset or restart the lab before another attempt.',
        false,
      )
      store.recordOperationError(result, 'Recovery failed')
      return result
    }
    store.markRecoveryApplied(actualBefore, actualAfter)
    const recoveredSnapshot = await captureSnapshot({ stabilize: true })
    const verification = verifyDisabledAudioRecovery({
      failureSnapshot: store.failureBaseline,
      recoveredSnapshot,
    })
    store.completeVerification(verification, recoveredSnapshot)
    const report = createIncidentReport({
      sessionId: store.sessionId,
      startedAt: store.startedAt,
      diagnosis: store.diagnosis,
      plan: store.recoveryPlan,
      verification,
    })
    store.setIncidentReport(report)
    return {
      ok: verification.verdict === 'recovered',
      action: plan.action,
      previous_state: actualBefore,
      new_state: actualAfter,
      verification,
      report,
    }
  }

  return {
    breakAudioTrack,
    resetScenario,
    diagnoseAndStageRecovery,
    approvePlan,
    rejectPlan,
    applyApprovedRecovery,
  }
}
