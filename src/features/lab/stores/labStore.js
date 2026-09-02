import { defineStore } from 'pinia'
import { assertTransition } from '../labMachine.js'
import { sanitizeValue } from '../../diagnostics/services/sanitizer.js'
import { assertRecoveryTransition } from '../../recovery/recoveryMachine.js'
import { errorResult } from '../../../shared/errors/serviceErrors.js'

function emptyMetrics() {
  return {
    outboundBitrateKbps: null,
    packetLoss: null,
    latencyMs: null,
    roundTripTimeMs: null,
    jitterMs: null,
    frameRate: null,
  }
}

function emptyConnection() {
  return { outbound: 'new', inbound: 'new', ice: 'new' }
}

function emptyVideoSender() {
  return {
    attached: false,
    max_bitrate_bps: null,
    bitrate_limited: false,
    readback_confirmed: false,
    profile_restored: false,
    encoding_count: null,
  }
}

function emptyTracks() {
  return {
    audio: { readyState: 'unavailable', enabled: null, attached: false },
    video: { readyState: 'unavailable', enabled: null, attached: false },
  }
}

function emptyEvidenceChecks() {
  return {
    peers_connected: false,
    tracks_live_enabled_attached: false,
    receiver_tracks_live: false,
    bidirectional_audio_video_progress: false,
  }
}

const HEALTH_SEVERITY = Object.freeze({ healthy: 0, degraded: 1, critical: 2 })

function stateAfterVerification(verification, snapshot) {
  const verdictState = verification.verdict === 'recovered'
    ? 'healthy'
    : verification.verdict === 'partially_recovered'
      ? 'degraded'
      : 'critical'
  const snapshotState = Object.hasOwn(HEALTH_SEVERITY, snapshot.health.status)
    ? snapshot.health.status
    : verdictState
  return HEALTH_SEVERITY[snapshotState] > HEALTH_SEVERITY[verdictState]
    ? snapshotState
    : verdictState
}

function healthStatusLabel(state) {
  return state === 'healthy' ? 'Healthy' : state === 'degraded' ? 'Degraded' : 'Critical'
}

function appendTimeline(
  store,
  actor,
  title,
  detail,
  evidence = null,
  { type = 'state_changed', affectsIncident = true } = {},
) {
  const sanitized = sanitizeValue({ title, detail, evidence })
  if (affectsIncident) store.incidentRevision += 1
  store.timeline.push({
    id: crypto.randomUUID(),
    actor,
    type,
    title: sanitized.title,
    detail: sanitized.detail,
    evidence: evidence === null ? null : sanitized.evidence,
    createdAt: new Date().toISOString(),
    incidentRevision: store.incidentRevision,
  })
}

function appendUserTimeline(store, title, detail, evidence = null, options) {
  appendTimeline(store, 'User', title, detail, evidence, options)
}

function appendSystemTimeline(store, title, detail, evidence = null, options) {
  appendTimeline(store, 'System', title, detail, evidence, options)
}

function appendDiagnosticTimeline(store, actor, title, detail, evidence = null, options) {
  appendTimeline(store, actor === 'Agent' ? 'Agent' : 'User', title, detail, evidence, options)
}

export const useLabStore = defineStore('lab', {
  state: () => ({
    sessionId: null,
    sessionEpoch: 0,
    faultRevision: 0,
    incidentRevision: 0,
    state: 'idle',
    healthStatus: 'Ready',
    healthScore: null,
    startedAt: null,
    endedAt: null,
    elapsedSeconds: 0,
    webMcpSupported: false,
    connection: emptyConnection(),
    tracks: emptyTracks(),
    metrics: emptyMetrics(),
    videoSender: emptyVideoSender(),
    selectedCandidate: null,
    audioLevel: 0,
    evidenceChecks: emptyEvidenceChecks(),
    healthyBaseline: null,
    activeFault: null,
    failureBaseline: null,
    latestSnapshot: null,
    diagnosis: null,
    recoveryPlan: null,
    verification: null,
    incidentReport: null,
    timeline: [],
    lastCleanupReceipt: null,
    error: null,
  }),
  actions: {
    setWebMcpSupport(supported) {
      this.webMcpSupported = supported
    },
    beginSession() {
      assertTransition(this.state, 'starting')
      this.sessionId = crypto.randomUUID()
      this.sessionEpoch += 1
      this.faultRevision = 0
      this.incidentRevision = 0
      this.state = 'starting'
      this.healthStatus = 'Starting'
      this.healthScore = null
      this.startedAt = new Date().toISOString()
      this.endedAt = null
      this.elapsedSeconds = 0
      this.connection = emptyConnection()
      this.tracks = emptyTracks()
      this.metrics = emptyMetrics()
      this.videoSender = emptyVideoSender()
      this.selectedCandidate = null
      this.audioLevel = 0
      this.evidenceChecks = emptyEvidenceChecks()
      this.healthyBaseline = null
      this.activeFault = null
      this.failureBaseline = null
      this.latestSnapshot = null
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      this.error = null
      this.timeline = []
      appendUserTimeline(this, 'Lab start requested', 'Generated media only; no permissions requested.')
    },
    transition(next) {
      assertTransition(this.state, next)
      this.state = next
    },
    setLiveEvidence({ connection, tracks, checks, metrics, videoSender, selectedCandidate }) {
      this.connection = connection
      this.tracks = tracks
      this.evidenceChecks = checks
      this.metrics = metrics
      if (videoSender) this.videoSender = videoSender
      this.selectedCandidate = selectedCandidate ?? null
    },
    setLatestSnapshot(snapshot) {
      this.latestSnapshot = snapshot
    },
    markHealthy(baseline) {
      this.transition('healthy')
      this.healthStatus = 'Healthy'
      this.healthScore = 100
      this.healthyBaseline = baseline
      this.latestSnapshot = baseline
      appendSystemTimeline(this, 'Healthy baseline captured', 'Two peers, live tracks, and progressing real media counters verified.')
    },
    beginAudioFault() {
      this.transition('critical')
      this.faultRevision += 1
      this.activeFault = 'disabled_audio'
      this.healthStatus = 'Critical'
      this.healthScore = 55
      this.failureBaseline = null
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      this.error = null
      appendUserTimeline(
        this,
        'Audio fault introduced',
        'The actual outbound audio track was set to enabled=false.',
        { track_kind: 'audio', enabled: false },
      )
    },
    beginVideoBitrateFault(senderState) {
      this.transition('degraded')
      this.faultRevision += 1
      this.activeFault = 'constrained_video_bitrate'
      this.healthStatus = 'Degraded'
      this.healthScore = 70
      this.failureBaseline = null
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      this.error = null
      appendUserTimeline(
        this,
        'Video bitrate fault introduced',
        'RTCRtpSender.setParameters() applied a low maxBitrate and fresh readback confirmed it.',
        { sender: senderState },
      )
    },
    captureFailureBaseline(snapshot) {
      this.failureBaseline = snapshot
      this.latestSnapshot = snapshot
      this.healthStatus = snapshot.health.status === 'degraded' ? 'Degraded' : 'Critical'
      this.healthScore = snapshot.health.score
      appendSystemTimeline(
        this,
        'Failure snapshot captured',
        'Stabilized authoritative track, sender, peer, and media evidence was stored.',
        { snapshot_hash: snapshot.snapshot_hash, fault_revision: this.faultRevision },
      )
    },
    failAudioFault(result, actualAudio, { mutationUncertain = false } = {}) {
      const rollbackConfirmed = !mutationUncertain && actualAudio?.enabled === true &&
        actualAudio?.ready_state === 'live' && actualAudio?.attached === true
      if (rollbackConfirmed && this.state === 'critical') this.transition('healthy')
      if (!rollbackConfirmed && this.state === 'healthy') this.transition('critical')
      this.activeFault = actualAudio?.enabled === false ? 'disabled_audio' : null
      this.failureBaseline = null
      this.faultRevision += 1
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      this.healthStatus = rollbackConfirmed ? 'Healthy' : 'Critical'
      this.recordOperationError(result, 'Audio fault failed', {
        current_state: actualAudio,
        mutation_uncertain: mutationUncertain,
        rollback_confirmed: rollbackConfirmed,
      })
    },
    failVideoBitrateFault(result, actualVideo, { mutationUncertain = false } = {}) {
      const rollbackConfirmed = !mutationUncertain &&
        actualVideo?.attached === true &&
        actualVideo?.bitrate_limited === false &&
        actualVideo?.readback_confirmed === true &&
        actualVideo?.profile_restored === true
      if (rollbackConfirmed && this.state === 'degraded') this.transition('healthy')
      if (!rollbackConfirmed && this.state === 'healthy') this.transition('degraded')
      this.activeFault = rollbackConfirmed ? null : 'constrained_video_bitrate'
      this.failureBaseline = null
      this.faultRevision += 1
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      this.healthStatus = rollbackConfirmed ? 'Healthy' : 'Degraded'
      this.healthScore = rollbackConfirmed ? 100 : 70
      this.recordOperationError(result, 'Video bitrate fault failed', {
        current_state: actualVideo,
        mutation_uncertain: mutationUncertain,
        rollback_confirmed: rollbackConfirmed,
      })
    },
    beginDiagnosis(actor = 'User') {
      this.transition('diagnosing')
      this.healthStatus = 'Diagnosing'
      appendDiagnosticTimeline(
        this,
        actor,
        actor === 'Agent' ? 'Agent diagnosis requested' : 'Manual diagnosis requested',
        'CallScope is sampling the active disabled-audio fault.',
        null,
        { type: 'diagnosis_requested' },
      )
    },
    completeDiagnosis(diagnosis, snapshot, actor = 'System') {
      this.diagnosis = diagnosis
      this.latestSnapshot = snapshot
      const faultState = this.activeFault === 'constrained_video_bitrate' ? 'degraded' : 'critical'
      this.transition(faultState)
      this.healthStatus = faultState === 'degraded' ? 'Degraded' : 'Critical'
      appendTimeline(
        this,
        actor === 'Agent' ? 'Agent' : 'System',
        this.activeFault === 'constrained_video_bitrate' ? 'Video bitrate cap diagnosed' : 'Disabled audio diagnosed',
        this.activeFault === 'constrained_video_bitrate'
          ? 'Fresh sender-parameter readback confirmed the active outbound video bitrate cap.'
          : 'Authoritative track state identified a live, attached, but disabled outbound audio track.',
        {
          diagnosis_id: diagnosis.id,
          severity: diagnosis.findings[0].severity,
          confidence: diagnosis.findings[0].confidence,
          allowed_actions: diagnosis.allowed_actions,
        },
      )
    },
    stageRecoveryPlan(plan, actor = 'System') {
      this.recoveryPlan = plan
      this.transition('awaiting_approval')
      this.healthStatus = this.activeFault === 'constrained_video_bitrate' ? 'Degraded' : 'Critical'
      appendTimeline(
        this,
        actor === 'Agent' ? 'Agent' : 'System',
        'Recovery plan staged',
        plan.action === 'restore_video_bitrate'
          ? 'Restore the preserved known-good video encoding profile after explicit human approval.'
          : 'Enable the actual outbound audio track after explicit human approval.',
        { plan_id: plan.id, action: plan.action, expires_at: plan.expires_at },
        { type: 'recovery_plan_staged' },
      )
    },
    approvePlan(planId) {
      if (this.recoveryPlan?.id !== planId || this.recoveryPlan.status !== 'staged') return false
      assertRecoveryTransition(this.recoveryPlan.status, 'approved')
      this.recoveryPlan.status = 'approved'
      this.recoveryPlan.approved_at = new Date().toISOString()
      appendUserTimeline(
        this,
        'Recovery approved',
        'Approval was recorded in application state. The media track was not changed.',
        { plan_id: planId, media_mutated: false },
      )
      return true
    },
    rejectPlan(planId) {
      if (this.recoveryPlan?.id !== planId || this.recoveryPlan.status !== 'staged') return false
      assertRecoveryTransition(this.recoveryPlan.status, 'rejected')
      this.recoveryPlan.status = 'rejected'
      this.recoveryPlan.rejected_at = new Date().toISOString()
      this.transition(this.activeFault === 'constrained_video_bitrate' ? 'degraded' : 'critical')
      appendUserTimeline(
        this,
        'Recovery rejected',
        'The staged plan was rejected. The media track remains disabled.',
        { plan_id: planId, media_mutated: false },
      )
      return true
    },
    expirePlan(planId) {
      if (
        this.recoveryPlan?.id !== planId ||
        !['staged', 'approved'].includes(this.recoveryPlan.status)
      ) return false
      assertRecoveryTransition(this.recoveryPlan.status, 'expired')
      this.recoveryPlan.status = 'expired'
      if (this.state === 'awaiting_approval') this.transition(this.activeFault === 'constrained_video_bitrate' ? 'degraded' : 'critical')
      this.healthStatus = this.activeFault === 'constrained_video_bitrate' ? 'Degraded' : 'Critical'
      appendSystemTimeline(
        this,
        'Recovery plan expired',
        'The 90-second approval window elapsed without a valid application.',
        { plan_id: planId, media_mutated: false },
        { type: 'plan_expired' },
      )
      return true
    },
    beginRecovery() {
      this.transition('recovering')
      this.healthStatus = 'Recovering'
      this.error = null
    },
    failRecovery(result, { mutationObserved = false, mutationUncertain = false, previousState = null, newState = null } = {}) {
      if ((mutationObserved || mutationUncertain) && this.recoveryPlan?.status === 'approved') {
        assertRecoveryTransition(this.recoveryPlan.status, 'applied')
        this.recoveryPlan.status = 'applied'
        this.recoveryPlan.applied_at = new Date().toISOString()
      }
      const faultState = this.activeFault === 'constrained_video_bitrate' ? 'degraded' : 'critical'
      if (['recovering', 'verifying'].includes(this.state)) this.transition(faultState)
      this.healthStatus = faultState === 'degraded' ? 'Degraded' : 'Critical'
      this.recordOperationError(result, 'Recovery failed', {
        mutation_observed: mutationObserved,
        mutation_uncertain: mutationUncertain,
        previous_state: previousState,
        current_state: newState,
      })
    },
    markRecoveryApplied(previousState, newState) {
      assertRecoveryTransition(this.recoveryPlan.status, 'applied')
      this.recoveryPlan.status = 'applied'
      this.recoveryPlan.applied_at = new Date().toISOString()
      this.transition('verifying')
      this.healthStatus = 'Verification pending'
      appendSystemTimeline(
        this,
        'Approved recovery applied',
        this.recoveryPlan.action === 'restore_video_bitrate'
          ? 'The allowlisted executor restored the preserved video sender encoding profile.'
          : 'The allowlisted executor changed the actual outbound audio track.',
        { previous_state: previousState, new_state: newState },
      )
    },
    beginVerification() {
      if (this.state !== 'verifying') this.transition('verifying')
      this.healthStatus = 'Verifying'
      this.error = null
    },
    completeVerification(verification, snapshot) {
      this.verification = verification
      this.latestSnapshot = snapshot
      if (verification.verdict === 'recovered') {
        assertRecoveryTransition(this.recoveryPlan.status, 'verified')
        this.recoveryPlan.status = 'verified'
        this.recoveryPlan.verified_at = new Date().toISOString()
      }
      const nextState = stateAfterVerification(verification, snapshot)
      this.transition(nextState)
      this.healthStatus = healthStatusLabel(nextState)
      this.healthScore = snapshot.health.score
      if (verification.verdict === 'recovered') this.activeFault = null
      appendSystemTimeline(
        this,
        'Recovery verification completed',
        `Fresh authoritative evidence produced a ${verification.verdict} verdict.`,
        { verdict: verification.verdict, primary_checks: verification.primary_checks },
      )
    },
    failVerification(result) {
      if (this.state !== 'verifying') this.transition('verifying')
      this.healthStatus = 'Verification pending'
      this.recordOperationError(result, 'Verification failed')
    },
    setIncidentReport(report) {
      this.incidentReport = report
      appendSystemTimeline(
        this,
        'Incident report generated',
        'A sanitized on-screen report was built from the diagnosis and verified evidence.',
        { report_id: report.id, raw_ip_addresses_excluded: true, sdp_excluded: true },
        { type: 'report_generated', affectsIncident: false },
      )
    },
    beginScenarioReset() {
      if (this.state !== 'verifying') this.transition('verifying')
      this.faultRevision += 1
      this.activeFault = null
      this.failureBaseline = null
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      this.healthStatus = 'Recovering'
      this.error = null
      appendUserTimeline(
        this,
        'Scenario reset requested',
        'CallScope is restoring the actual audio track and preserved video sender profile, then recapturing healthy evidence.',
      )
    },
    completeScenarioReset(snapshot) {
      this.latestSnapshot = snapshot
      const nextState = Object.hasOwn(HEALTH_SEVERITY, snapshot.health.status)
        ? snapshot.health.status
        : 'critical'
      this.transition(nextState)
      this.healthStatus = healthStatusLabel(nextState)
      this.healthScore = snapshot.health.score
      appendSystemTimeline(
        this,
        nextState === 'healthy' ? 'Scenario reset to healthy' : 'Scenario reset verification incomplete',
        nextState === 'healthy'
          ? 'Actual peers, tracks, receivers, and video sender configuration were restored and confirmed.'
          : 'Actual media state was restored, but fresh evidence did not meet healthy requirements.',
        {
          snapshot_hash: snapshot.snapshot_hash,
          audio_enabled: snapshot.tracks.audio.enabled,
          video_bitrate_limited: snapshot.senders?.video?.bitrate_limited ?? null,
          media_progression: snapshot.media_progression,
          progression_is_supporting_evidence: snapshot.reset_verification?.progression_is_supporting_evidence ?? false,
        },
      )
    },
    failScenarioReset(result, actualState, { faultKind = 'disabled_audio', mutationUncertain = false } = {}) {
      if (this.state !== 'verifying') this.transition('verifying')
      const videoFault = faultKind === 'constrained_video_bitrate'
      const faultStillPresent = videoFault
        ? mutationUncertain || actualState?.bitrate_limited !== false ||
          actualState?.readback_confirmed !== true || actualState?.profile_restored !== true
        : mutationUncertain || actualState?.enabled !== true ||
          actualState?.ready_state !== 'live' || actualState?.attached !== true
      this.activeFault = faultStillPresent ? faultKind : null
      this.failureBaseline = null
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      const failureState = videoFault && faultStillPresent ? 'degraded' : 'critical'
      this.transition(failureState)
      this.healthStatus = failureState === 'degraded' ? 'Degraded' : 'Critical'
      this.healthScore = failureState === 'degraded' ? 70 : 55
      this.recordOperationError(result, 'Scenario reset failed', {
        current_state: actualState,
        fault_kind: faultKind,
        mutation_uncertain: mutationUncertain,
      })
    },
    recordOperationError(result, title = 'Operation rejected', evidence = null) {
      const sanitized = sanitizeValue(result)
      const safeEvidence = sanitizeValue(evidence)
      this.error = `${sanitized.error.code}: ${sanitized.error.message}`
      appendSystemTimeline(
        this,
        title,
        sanitized.error.message,
        { ...safeEvidence, error: sanitized.error },
        { type: 'operation_failed' },
      )
    },
    markFailed(message, title = 'Lab startup failed', receipt = null) {
      if (this.state !== 'failed') this.transition('failed')
      this.healthStatus = 'Failed'
      this.healthScore = null
      this.error = message
      if (receipt) this.setCleanupEvidence(receipt)
      appendSystemTimeline(this, title, message)
    },
    setCleanupEvidence(receipt) {
      const cleanupComplete = Boolean(receipt?.complete)
      this.connection = cleanupComplete
        ? { outbound: 'closed', inbound: 'closed', ice: 'closed' }
        : { outbound: 'unavailable', inbound: 'unavailable', ice: 'unavailable' }
      this.tracks = {
        audio: {
          readyState: cleanupComplete ? 'ended' : 'unavailable',
          enabled: null,
          attached: false,
        },
        video: {
          readyState: cleanupComplete ? 'ended' : 'unavailable',
          enabled: null,
          attached: false,
        },
      }
      this.metrics = emptyMetrics()
      this.videoSender = emptyVideoSender()
      this.selectedCandidate = null
      this.audioLevel = 0
      this.evidenceChecks = emptyEvidenceChecks()
      this.lastCleanupReceipt = receipt
    },
    markEnded(receipt) {
      const cleanupComplete = Boolean(receipt?.complete)
      const nextState = cleanupComplete ? 'ended' : 'failed'
      if (this.state !== nextState) this.transition(nextState)
      this.healthStatus = cleanupComplete ? 'Ended' : 'Failed'
      this.healthScore = null
      this.endedAt = new Date().toISOString()
      this.setCleanupEvidence(receipt)
      if (!cleanupComplete) {
        const result = errorResult('CLEANUP_INCOMPLETE')
        this.error = `${result.error.code}: ${result.error.message}`
      }
      appendSystemTimeline(
        this,
        cleanupComplete ? 'Lab resources released' : 'Lab cleanup incomplete',
        cleanupComplete
          ? 'Cleanup evidence was captured before browser references were discarded.'
          : 'One or more tracked browser resources did not confirm release.',
        cleanupComplete ? null : { error: errorResult('CLEANUP_INCOMPLETE').error },
        { type: cleanupComplete ? 'lab_ended' : 'operation_failed' },
      )
    },
    recordCleanup(receipt) {
      this.lastCleanupReceipt = receipt
    },
    resetToIdle() {
      if (this.state !== 'idle') this.transition('idle')
      this.sessionId = null
      this.incidentRevision = 0
      this.state = 'idle'
      this.healthStatus = 'Ready'
      this.healthScore = null
      this.startedAt = null
      this.endedAt = null
      this.elapsedSeconds = 0
      this.connection = emptyConnection()
      this.tracks = emptyTracks()
      this.metrics = emptyMetrics()
      this.videoSender = emptyVideoSender()
      this.selectedCandidate = null
      this.audioLevel = 0
      this.evidenceChecks = emptyEvidenceChecks()
      this.healthyBaseline = null
      this.activeFault = null
      this.failureBaseline = null
      this.latestSnapshot = null
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      this.timeline = []
      this.error = null
    },
    recordSystemEvent(title, detail, evidence = null) {
      appendSystemTimeline(this, title, detail, evidence)
    },
    recordInspectionEvent(title, detail, evidence = null) {
      appendSystemTimeline(this, title, detail, evidence, {
        type: 'inspection_performed',
        affectsIncident: false,
      })
    },
    recordAgentToolEvent(toolName, result) {
      appendTimeline(
        this,
        'Agent',
        toolName,
        result.ok
          ? 'WebMCP tool completed against CallScope application services.'
          : `WebMCP tool returned ${result.error?.code ?? 'a stable error'}.`,
        {
          ok: result.ok,
          session_id: result.session_id ?? result.needed_ids?.session_id ?? null,
          diagnosis_id: result.diagnosis_id ?? result.needed_ids?.diagnosis_id ?? null,
          plan_id: result.plan_id ?? result.needed_ids?.plan_id ?? null,
          report_id: result.report_id ?? result.needed_ids?.report_id ?? null,
          error_code: result.error?.code ?? null,
        },
        { type: 'webmcp_tool_invoked', affectsIncident: false },
      )
    },
  },
})
