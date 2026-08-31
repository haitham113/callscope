import { diagnoseDisabledAudio } from '../../diagnostics/services/diagnosticRules.js'
import { sanitizeValue } from '../../diagnostics/services/sanitizer.js'
import {
  createIncidentReport,
  createIncidentReportMarkdown,
} from '../../reports/services/reportService.js'
import { createOperationCoordinator } from '../../../shared/async/operationCoordinator.js'
import { errorResult, resultFromError, serviceError } from '../../../shared/errors/serviceErrors.js'
import { createRecoveryPlan, validatePlanForApplication } from './recoveryPlanService.js'
import { verifyDisabledAudioRecovery } from './recoveryVerification.js'

const RECOVERY_SAMPLE_ATTEMPTS = 3
const DEFAULT_SAMPLE_DURATION_MS = 1150

function canAwaitFreshAudioProgression(snapshot) {
  const audio = snapshot.tracks.audio
  return audio.enabled === true && audio.ready_state === 'live' && audio.attached === true &&
    snapshot.connection.outbound === 'connected' && snapshot.connection.inbound === 'connected' &&
    (snapshot.media_progression.outbound_audio !== true || snapshot.media_progression.inbound_audio !== true)
}

function cancellationResult(error) {
  return error?.code === 'OPERATION_CANCELLED' || error?.name === 'AbortError'
    ? errorResult('OPERATION_CANCELLED')
    : null
}

export function createAudioRescueRuntime({ store, captureSnapshot, readAudioState, setAudioEnabled, now = () => Date.now() }) {
  const operations = createOperationCoordinator({
    readIdentity: () => ({ sessionId: store.sessionId, sessionEpoch: store.sessionEpoch, faultRevision: store.faultRevision }),
  })

  const success = (value) => sanitizeValue(value)
  const failure = (error, fallbackCode) => cancellationResult(error) ?? resultFromError(error, fallbackCode)
  let planExpiryTimerId = null

  function safeReadAudioState() {
    try {
      return { ok: true, value: readAudioState() }
    } catch {
      return {
        ok: false,
        value: { ready_state: 'unavailable', enabled: null, attached: false },
      }
    }
  }

  function clearPlanExpiry() {
    if (planExpiryTimerId !== null) clearTimeout(planExpiryTimerId)
    planExpiryTimerId = null
  }

  function schedulePlanExpiry(plan) {
    clearPlanExpiry()
    const binding = {
      id: plan.id,
      sessionId: plan.session_id,
      sessionEpoch: plan.session_epoch,
      faultRevision: plan.fault_revision,
    }
    planExpiryTimerId = setTimeout(() => {
      planExpiryTimerId = null
      const current = store.recoveryPlan
      if (current?.id !== binding.id || store.sessionId !== binding.sessionId ||
          store.sessionEpoch !== binding.sessionEpoch || store.faultRevision !== binding.faultRevision ||
          Date.parse(current.expires_at) > now()) return
      store.expirePlan(current.id)
    }, Math.max(0, Date.parse(plan.expires_at) - now()))
  }

  function cancelAll(reason) {
    clearPlanExpiry()
    operations.cancelAll(reason)
  }

  function validateSession(sessionId) {
    if (!store.sessionId || ['idle', 'ended'].includes(store.state)) return errorResult('NO_ACTIVE_SESSION')
    return sessionId === store.sessionId ? { ok: true } : errorResult('SESSION_MISMATCH')
  }

  function reject(result, title) {
    store.recordOperationError(result, title)
    return result
  }

  function beginWindow(kind, title) {
    const result = operations.beginSamplingWindow(kind)
    return result.ok ? result : reject(result, title)
  }

  function assertOwned(operation) {
    if (!operations.isCurrent(operation)) throw serviceError('OPERATION_CANCELLED')
  }

  async function captureOwned(operation, { stabilize, phase, sampleDurationMs }) {
    assertOwned(operation)
    const snapshot = await captureSnapshot({
      stabilize,
      phase,
      sampleDurationMs,
      signal: operation.signal,
      owner: { sessionId: operation.sessionId, sessionEpoch: operation.sessionEpoch, faultRevision: operation.faultRevision },
    })
    assertOwned(operation)
    if (snapshot?.session_id !== operation.sessionId || snapshot?.session_epoch !== operation.sessionEpoch || snapshot?.fault_revision !== operation.faultRevision) {
      throw serviceError('OPERATION_CANCELLED')
    }
    return snapshot
  }

  async function breakAudioTrack() {
    if (store.state !== 'healthy' || store.activeFault) return reject(errorResult('INVALID_STATE_TRANSITION'), 'Audio fault rejected')
    const beforeRead = safeReadAudioState()
    if (!beforeRead.ok) return reject(errorResult('FAULT_MUTATION_FAILED'), 'Audio fault rejected')
    const before = beforeRead.value
    if (before.ready_state !== 'live' || !before.attached) return reject(errorResult('FAULT_MUTATION_FAILED'), 'Audio fault rejected')
    try {
      setAudioEnabled(false)
    } catch (error) {
      const result = resultFromError(error, 'FAULT_MUTATION_FAILED')
      try { setAudioEnabled(true) } catch { /* The authoritative read below decides the state. */ }
      const finalRead = safeReadAudioState()
      store.failAudioFault(result, finalRead.value, { mutationUncertain: !finalRead.ok })
      return result
    }
    const afterRead = safeReadAudioState()
    if (!afterRead.ok || afterRead.value.enabled !== false) {
      const result = errorResult('FAULT_MUTATION_FAILED')
      try { setAudioEnabled(true) } catch { /* The authoritative read below decides the state. */ }
      const finalRead = safeReadAudioState()
      store.failAudioFault(result, finalRead.value, { mutationUncertain: !finalRead.ok })
      return result
    }
    const after = afterRead.value

    store.beginAudioFault()
    const window = beginWindow('fault_baseline', 'Audio fault failed')
    if (!window.ok) {
      try { setAudioEnabled(true) } catch { /* Reset/restart remains available. */ }
      return window
    }
    const { operation } = window
    try {
      const snapshot = await captureOwned(operation, { stabilize: true, phase: 'fault_baseline' })
      store.captureFailureBaseline(snapshot)
      return success({ ok: true, previous_state: before, new_state: after, failure_snapshot: snapshot })
    } catch (error) {
      const result = failure(error, 'FAULT_MUTATION_FAILED')
      if (operations.isCurrent(operation)) {
        try { setAudioEnabled(true) } catch { /* Cleanup/reset remains available. */ }
        const actual = safeReadAudioState()
        store.failAudioFault(result, actual.value, { mutationUncertain: !actual.ok })
      }
      return result
    } finally { operations.finish(operation) }
  }

  async function runDiagnosticsForActor({
    sessionId = store.sessionId,
    symptom = 'silent_audio',
    sampleDurationMs = DEFAULT_SAMPLE_DURATION_MS,
  } = {}, actor) {
    const session = validateSession(sessionId)
    if (!session.ok) return reject(session, 'Diagnosis rejected')
    if (store.state !== 'critical' || store.activeFault !== 'disabled_audio' || symptom !== 'silent_audio') {
      return reject(errorResult('INVALID_STATE_TRANSITION'), 'Diagnosis rejected')
    }
    const window = beginWindow('diagnostic', 'Diagnosis rejected')
    if (!window.ok) return window
    const { operation } = window
    const metricsAtStart = store.latestSnapshot?.metrics ?? store.failureBaseline?.metrics ?? null
    store.beginDiagnosis(actor)
    try {
      const snapshot = await captureOwned(operation, {
        stabilize: true,
        phase: 'diagnostic',
        sampleDurationMs,
      })
      const diagnosis = diagnoseDisabledAudio(snapshot)
      assertOwned(operation)
      store.completeDiagnosis(diagnosis, snapshot, actor)
      return success({
        ok: true,
        diagnosis,
        metrics_at_start: snapshot.sample_window?.start_metrics ?? metricsAtStart,
        snapshot,
      })
    } catch (error) {
      const result = failure(error, 'STATS_UNAVAILABLE')
      if (operations.isCurrent(operation)) {
        if (store.state === 'diagnosing') store.transition('critical')
        store.healthStatus = 'Critical'
        store.recordOperationError(result, 'Diagnosis failed')
      }
      return result
    } finally { operations.finish(operation) }
  }

  function runDiagnostics(input) {
    return runDiagnosticsForActor(input, 'User')
  }

  function runAgentDiagnostics(input) {
    return runDiagnosticsForActor(input, 'Agent')
  }

  function stageRecoveryPlanForActor({
    sessionId = store.sessionId,
    diagnosisId,
    action = 'enable_audio_track',
    reason = 'The live outbound audio track is disabled while remaining live and attached to its intended sender.',
    expectedResult = 'Re-enable audio transmission while keeping both peer connections and the existing sender intact.',
  } = {}, actor = 'System') {
    const session = validateSession(sessionId)
    if (!session.ok) return reject(session, 'Recovery staging rejected')
    const diagnosis = store.diagnosis
    if (!diagnosis || diagnosis.id !== diagnosisId) return reject(errorResult('DIAGNOSIS_NOT_FOUND'), 'Recovery staging rejected')
    if (diagnosis.session_id !== store.sessionId || diagnosis.session_epoch !== store.sessionEpoch ||
        diagnosis.fault_revision !== store.faultRevision || diagnosis.snapshot_hash !== store.latestSnapshot?.snapshot_hash) {
      return reject(errorResult('DIAGNOSIS_STALE'), 'Recovery staging rejected')
    }
    const actualAudio = readAudioState()
    if (actualAudio.enabled !== false || actualAudio.ready_state !== 'live' || actualAudio.attached !== true ||
        store.connection.outbound !== 'connected' || store.connection.inbound !== 'connected') {
      return reject(errorResult('DIAGNOSIS_STALE'), 'Recovery staging rejected')
    }
    if (store.state !== 'critical') return reject(errorResult('INVALID_STATE_TRANSITION'), 'Recovery staging rejected')
    const safeText = sanitizeValue({ reason, expectedResult })
    const planResult = createRecoveryPlan({
      diagnosis,
      action,
      reason: safeText.reason,
      expectedResult: safeText.expectedResult,
      now,
    })
    if (!planResult.ok) return reject(planResult, 'Recovery staging rejected')
    store.stageRecoveryPlan(planResult.plan, actor)
    schedulePlanExpiry(planResult.plan)
    return success({ ok: true, plan: planResult.plan })
  }

  function stageRecoveryPlan(input) {
    return stageRecoveryPlanForActor(input, 'System')
  }

  function stageAgentRecoveryPlan(input) {
    return stageRecoveryPlanForActor(input, 'Agent')
  }

  async function diagnoseAndStageRecovery() {
    const diagnostic = await runDiagnostics({ sessionId: store.sessionId, symptom: 'silent_audio' })
    if (!diagnostic.ok) return diagnostic
    if (diagnostic.diagnosis.allowed_actions.length === 0) return reject(errorResult('ACTION_NOT_ALLOWED'), 'Recovery staging rejected')
    const staged = stageRecoveryPlan({ sessionId: store.sessionId, diagnosisId: diagnostic.diagnosis.id, action: 'enable_audio_track' })
    return staged.ok ? success({ ok: true, diagnosis: diagnostic.diagnosis, plan: staged.plan }) : staged
  }

  function expireIfNeeded(plan) {
    if (plan && ['staged', 'approved'].includes(plan.status) && Date.parse(plan.expires_at) <= now()) {
      store.expirePlan(plan.id)
      clearPlanExpiry()
      return true
    }
    return false
  }

  function approvePlan(planId = store.recoveryPlan?.id) {
    const plan = store.recoveryPlan
    if (!plan || plan.id !== planId) return reject(errorResult('PLAN_NOT_FOUND'), 'Approval rejected')
    if (expireIfNeeded(plan)) return reject(errorResult('PLAN_EXPIRED'), 'Approval rejected')
    const before = safeReadAudioState()
    if (!before.ok) return reject(errorResult('STATS_UNAVAILABLE'), 'Approval rejected')
    if (!store.approvePlan(planId)) return reject(errorResult('PLAN_NOT_APPROVED'), 'Approval rejected')
    return success({ ok: true, status: 'approved', media_state_unchanged: true, audio_track: before.value })
  }

  function rejectPlan(planId = store.recoveryPlan?.id) {
    const plan = store.recoveryPlan
    if (!plan || plan.id !== planId) return reject(errorResult('PLAN_NOT_FOUND'), 'Rejection failed')
    if (expireIfNeeded(plan)) return reject(errorResult('PLAN_EXPIRED'), 'Rejection failed')
    if (!store.rejectPlan(planId)) return reject(errorResult('PLAN_NOT_APPROVED'), 'Rejection failed')
    clearPlanExpiry()
    return success({ ok: true, status: 'rejected', audio_track: readAudioState() })
  }

  function validateActivePlan({ sessionId, planId, snapshotHash }) {
    const session = validateSession(sessionId)
    if (!session.ok) return session
    const plan = store.recoveryPlan
    if (!plan || plan.id !== planId) return errorResult('PLAN_NOT_FOUND')
    const validation = validatePlanForApplication({
      plan,
      sessionId: store.sessionId,
      sessionEpoch: store.sessionEpoch,
      faultRevision: store.faultRevision,
      snapshotHash,
      actualAudio: readAudioState(),
      connection: store.connection,
      now: now(),
    })
    if (validation.error?.code === 'PLAN_EXPIRED') {
      store.expirePlan(plan.id)
      clearPlanExpiry()
    }
    return validation
  }

  function getOrCreateIncidentReport() {
    if (store.incidentReport?.incident_revision === store.incidentRevision) return store.incidentReport
    const report = createIncidentReport({
      sessionId: store.sessionId,
      incidentRevision: store.incidentRevision,
      startedAt: store.startedAt,
      diagnosis: store.diagnosis,
      plan: store.recoveryPlan,
      verification: store.verification,
    })
    store.setIncidentReport(report)
    return report
  }

  function generateIncidentReport({ sessionId = store.sessionId, format = 'summary' } = {}) {
    const session = validateSession(sessionId)
    if (!session.ok) return reject(session, 'Report generation rejected')
    if (!store.diagnosis || !store.recoveryPlan || !store.verification) return reject(errorResult('VERIFICATION_INCOMPLETE'), 'Report generation rejected')
    const report = getOrCreateIncidentReport()
    return success({
      ok: true,
      report,
      ...(format === 'markdown' ? { markdown: createIncidentReportMarkdown(report) } : {}),
    })
  }

  async function applyRecoveryAction({
    sessionId = store.sessionId,
    planId,
    publishReport = true,
  } = {}) {
    const initial = validateActivePlan({ sessionId, planId, snapshotHash: store.recoveryPlan?.snapshot_hash })
    if (!initial.ok) return reject(initial, 'Recovery application rejected')
    const window = beginWindow('verification', 'Recovery application rejected')
    if (!window.ok) return window
    const { operation } = window
    let mutated = false
    let mutationUncertain = false
    let actualBefore = null
    try {
      const currentSnapshot = await captureOwned(operation, { stabilize: false, phase: 'recovery_preflight' })
      const validation = validateActivePlan({ sessionId, planId, snapshotHash: currentSnapshot.snapshot_hash })
      if (!validation.ok) { assertOwned(operation); return reject(validation, 'Recovery application rejected') }

      assertOwned(operation)
      const plan = store.recoveryPlan
      actualBefore = readAudioState()
      clearPlanExpiry()
      store.beginRecovery()
      try {
        setAudioEnabled(true)
      } catch (error) {
        const readback = safeReadAudioState()
        mutated = readback.ok && readback.value.enabled !== actualBefore.enabled
        mutationUncertain = !readback.ok
        throw serviceError('RECOVERY_FAILED', { cause: error })
      }
      const readback = safeReadAudioState()
      if (!readback.ok) {
        mutationUncertain = true
        throw serviceError('RECOVERY_FAILED')
      }
      const actualAfter = readback.value
      mutated = actualAfter.enabled !== actualBefore.enabled ||
        actualAfter.ready_state !== actualBefore.ready_state ||
        actualAfter.attached !== actualBefore.attached
      if (actualAfter.enabled !== true || actualAfter.ready_state !== 'live' || actualAfter.attached !== true) throw serviceError('RECOVERY_FAILED')
      assertOwned(operation)
      store.markRecoveryApplied(actualBefore, actualAfter)

      let recoveredSnapshot
      let stabilizationAttempts = 0
      for (let attempt = 0; attempt < RECOVERY_SAMPLE_ATTEMPTS; attempt += 1) {
        stabilizationAttempts += 1
        recoveredSnapshot = await captureOwned(operation, {
          stabilize: true,
          phase: 'recovery_verification',
          sampleDurationMs: DEFAULT_SAMPLE_DURATION_MS,
        })
        if (!canAwaitFreshAudioProgression(recoveredSnapshot)) break
      }
      const verification = verifyDisabledAudioRecovery({ failureSnapshot: store.failureBaseline, recoveredSnapshot })
      assertOwned(operation)
      store.completeVerification(verification, recoveredSnapshot)
      const report = publishReport ? getOrCreateIncidentReport() : null
      return success({
        ok: true,
        recovered: verification.verdict === 'recovered',
        action: plan.action,
        previous_state: actualBefore,
        new_state: actualAfter,
        stabilization_wait_ms: stabilizationAttempts * DEFAULT_SAMPLE_DURATION_MS,
        verification,
        ...(report ? { report } : {}),
      })
    } catch (error) {
      const result = failure(error, mutated ? 'VERIFICATION_INCOMPLETE' : 'STATS_UNAVAILABLE')
      if (operations.isCurrent(operation)) {
        if (result.error.code === 'RECOVERY_FAILED' || mutated || mutationUncertain ||
            ['recovering', 'verifying'].includes(store.state)) {
          store.failRecovery(result, {
            mutationObserved: mutated,
            mutationUncertain,
            previousState: actualBefore,
            newState: safeReadAudioState().value,
          })
        }
        else store.recordOperationError(result, 'Recovery application failed')
      }
      return result
    } finally { operations.finish(operation) }
  }

  function applyApprovedRecovery(planId = store.recoveryPlan?.id) {
    return applyRecoveryAction({ sessionId: store.sessionId, planId })
  }

  async function compareToFailureBaseline({
    sessionId = store.sessionId,
    planId,
    sampleDurationMs = 2000,
  } = {}) {
    const session = validateSession(sessionId)
    if (!session.ok) return reject(session, 'Verification rejected')
    const plan = store.recoveryPlan
    if (!plan || plan.id !== planId) return reject(errorResult('PLAN_NOT_FOUND'), 'Verification rejected')
    if (plan.session_id !== store.sessionId || plan.session_epoch !== store.sessionEpoch) {
      return reject(errorResult('SESSION_MISMATCH'), 'Verification rejected')
    }
    if (plan.fault_revision !== store.faultRevision) {
      return reject(errorResult('DIAGNOSIS_STALE'), 'Verification rejected')
    }
    if (plan.status !== 'verified' || !store.failureBaseline) {
      return reject(errorResult('VERIFICATION_INCOMPLETE'), 'Verification rejected')
    }
    const window = beginWindow('verification', 'Verification rejected')
    if (!window.ok) return window
    const { operation } = window
    try {
      const snapshot = await captureOwned(operation, {
        stabilize: true,
        phase: 'comparison',
        sampleDurationMs,
      })
      const verification = verifyDisabledAudioRecovery({
        failureSnapshot: store.failureBaseline,
        recoveredSnapshot: snapshot,
      })
      assertOwned(operation)
      store.refreshVerification(verification, snapshot)
      return success({ ok: true, verification, snapshot })
    } catch (error) {
      const result = failure(error, 'VERIFICATION_INCOMPLETE')
      if (operations.isCurrent(operation)) store.recordOperationError(result, 'Verification failed')
      return result
    } finally { operations.finish(operation) }
  }

  async function resetScenario() {
    if (!store.sessionId || ['idle', 'starting', 'ended', 'failed'].includes(store.state)) return reject(errorResult('INVALID_STATE_TRANSITION'), 'Scenario reset rejected')
    if (!store.activeFault && store.state === 'healthy') return success({ ok: true, snapshot: store.latestSnapshot })
    cancelAll('Scenario reset requested.')
    try {
      setAudioEnabled(true)
    } catch (error) {
      const result = resultFromError(error, 'FAULT_MUTATION_FAILED')
      const actual = safeReadAudioState()
      store.failScenarioReset(result, actual.value, { mutationUncertain: !actual.ok })
      return result
    }
    store.beginScenarioReset()
    const window = beginWindow('verification', 'Scenario reset failed')
    if (!window.ok) return window
    const { operation } = window
    try {
      let snapshot
      for (let attempt = 0; attempt < RECOVERY_SAMPLE_ATTEMPTS; attempt += 1) {
        snapshot = await captureOwned(operation, { stabilize: true, phase: 'scenario_reset' })
        if (!canAwaitFreshAudioProgression(snapshot)) break
      }
      store.completeScenarioReset(snapshot)
      if (snapshot.health.status !== 'healthy') {
        return reject(errorResult('VERIFICATION_INCOMPLETE'), 'Scenario reset failed')
      }
      return success({ ok: true, snapshot })
    } catch (error) {
      const result = failure(error, 'VERIFICATION_INCOMPLETE')
      if (operations.isCurrent(operation)) {
        if (store.state === 'verifying') store.transition('critical')
        store.healthStatus = 'Critical'
        store.recordOperationError(result, 'Scenario reset failed')
      }
      return result
    } finally { operations.finish(operation) }
  }

  return Object.freeze({
    breakAudioTrack,
    resetScenario,
    runDiagnostics,
    runAgentDiagnostics,
    stageRecoveryPlan,
    stageAgentRecoveryPlan,
    diagnoseAndStageRecovery,
    approvePlan,
    rejectPlan,
    applyRecoveryAction,
    applyApprovedRecovery,
    compareToFailureBaseline,
    generateIncidentReport,
    cancelAll,
    hasActiveSamplingWindow: operations.hasActiveSamplingWindow,
  })
}
