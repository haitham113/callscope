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
    frameRate: null,
  }
}

function emptyConnection() {
  return { outbound: 'new', inbound: 'new', ice: 'new' }
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
    setLiveEvidence({ connection, tracks, checks, metrics }) {
      this.connection = connection
      this.tracks = tracks
      this.evidenceChecks = checks
      this.metrics = metrics
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
    captureFailureBaseline(snapshot) {
      this.failureBaseline = snapshot
      this.latestSnapshot = snapshot
      this.healthStatus = 'Critical'
      this.healthScore = snapshot.health.score
      appendSystemTimeline(
        this,
        'Failure snapshot captured',
        'Stabilized authoritative track, sender, peer, and media evidence was stored.',
        { snapshot_hash: snapshot.snapshot_hash, fault_revision: this.faultRevision },
      )
    },
    beginDiagnosis() {
      this.transition('diagnosing')
      this.healthStatus = 'Diagnosing'
      appendUserTimeline(this, 'Manual diagnosis requested', 'CallScope is sampling the active disabled-audio fault.')
    },
    completeDiagnosis(diagnosis, snapshot) {
      this.diagnosis = diagnosis
      this.latestSnapshot = snapshot
      this.transition('critical')
      this.healthStatus = 'Critical'
      appendSystemTimeline(
        this,
        'Disabled audio diagnosed',
        'Authoritative track state identified a live, attached, but disabled outbound audio track.',
        {
          diagnosis_id: diagnosis.id,
          severity: diagnosis.findings[0].severity,
          confidence: diagnosis.findings[0].confidence,
          allowed_actions: diagnosis.allowed_actions,
        },
      )
    },
    stageRecoveryPlan(plan) {
      this.recoveryPlan = plan
      this.transition('awaiting_approval')
      this.healthStatus = 'Critical'
      appendSystemTimeline(
        this,
        'Recovery plan staged',
        'Enable the actual outbound audio track after explicit human approval.',
        { plan_id: plan.id, action: plan.action, expires_at: plan.expires_at },
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
      this.transition('critical')
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
      if (this.state === 'awaiting_approval') this.transition('critical')
      this.healthStatus = 'Critical'
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
    failRecovery(result) {
      if (['recovering', 'verifying'].includes(this.state)) this.transition('critical')
      this.healthStatus = 'Critical'
      this.recordOperationError(result, 'Recovery failed')
    },
    markRecoveryApplied(previousState, newState) {
      assertRecoveryTransition(this.recoveryPlan.status, 'applied')
      this.recoveryPlan.status = 'applied'
      this.recoveryPlan.applied_at = new Date().toISOString()
      this.transition('verifying')
      this.healthStatus = 'Recovering'
      appendSystemTimeline(
        this,
        'Approved recovery applied',
        'The allowlisted executor changed the actual outbound audio track.',
        { previous_state: previousState, new_state: newState },
      )
    },
    completeVerification(verification, snapshot) {
      this.verification = verification
      this.latestSnapshot = snapshot
      assertRecoveryTransition(this.recoveryPlan.status, 'verified')
      this.recoveryPlan.status = 'verified'
      this.recoveryPlan.verified_at = new Date().toISOString()
      const nextState =
        verification.verdict === 'recovered'
          ? 'healthy'
          : verification.verdict === 'partially_recovered'
            ? 'degraded'
            : 'critical'
      this.transition(nextState)
      this.healthStatus = nextState === 'healthy' ? 'Healthy' : nextState === 'degraded' ? 'Degraded' : 'Critical'
      this.healthScore = snapshot.health.score
      if (verification.verdict === 'recovered') this.activeFault = null
      appendSystemTimeline(
        this,
        'Recovery verification completed',
        `Fresh authoritative evidence produced a ${verification.verdict} verdict.`,
        { verdict: verification.verdict, primary_checks: verification.primary_checks },
      )
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
        'CallScope is restoring the actual audio track and recapturing healthy evidence.',
      )
    },
    completeScenarioReset(snapshot) {
      this.latestSnapshot = snapshot
      const nextState = snapshot.health.status === 'healthy' ? 'healthy' : 'critical'
      this.transition(nextState)
      this.healthStatus = nextState === 'healthy' ? 'Healthy' : 'Critical'
      this.healthScore = snapshot.health.score
      appendSystemTimeline(
        this,
        nextState === 'healthy' ? 'Scenario reset to healthy' : 'Scenario reset verification incomplete',
        nextState === 'healthy'
          ? 'The actual audio track is enabled and fresh media progression was confirmed.'
          : 'The actual audio track is enabled, but fresh evidence did not meet healthy requirements.',
        { snapshot_hash: snapshot.snapshot_hash, audio_enabled: snapshot.tracks.audio.enabled },
      )
    },
    failScenarioReset(result, actualAudio) {
      if (this.state !== 'verifying') this.transition('verifying')
      this.faultRevision += 1
      this.activeFault = actualAudio?.enabled === false ? 'disabled_audio' : null
      this.failureBaseline = null
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      this.transition('critical')
      this.healthStatus = 'Critical'
      this.recordOperationError(result, 'Scenario reset failed')
    },
    recordOperationError(result, title = 'Operation rejected') {
      const sanitized = sanitizeValue(result)
      this.error = `${sanitized.error.code}: ${sanitized.error.message}`
      appendSystemTimeline(
        this,
        title,
        sanitized.error.message,
        { error: sanitized.error },
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
  },
})
