import { defineStore } from 'pinia'
import { assertTransition } from '../labMachine.js'

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

export const useLabStore = defineStore('lab', {
  state: () => ({
    sessionId: null,
    sessionEpoch: 0,
    faultRevision: 0,
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
      this.addTimeline('User', 'Lab start requested', 'Generated media only; no permissions requested.')
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
      this.addTimeline('System', 'Healthy baseline captured', 'Two peers, live tracks, and progressing real media counters verified.')
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
      this.addTimeline(
        'User',
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
      this.addTimeline(
        'System',
        'Failure snapshot captured',
        'Stabilized authoritative track, sender, peer, and media evidence was stored.',
        { snapshot_hash: snapshot.snapshot_hash, fault_revision: this.faultRevision },
      )
    },
    beginDiagnosis() {
      this.transition('diagnosing')
      this.healthStatus = 'Diagnosing'
      this.addTimeline('User', 'Manual diagnosis requested', 'CallScope is sampling the active disabled-audio fault.')
    },
    completeDiagnosis(diagnosis, snapshot) {
      this.diagnosis = diagnosis
      this.latestSnapshot = snapshot
      this.transition('critical')
      this.healthStatus = 'Critical'
      this.addTimeline(
        'System',
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
      this.addTimeline(
        'System',
        'Recovery plan staged',
        'Enable the actual outbound audio track after explicit human approval.',
        { plan_id: plan.id, action: plan.action, expires_at: plan.expires_at },
      )
    },
    approvePlan(planId) {
      if (this.recoveryPlan?.id !== planId || this.recoveryPlan.status !== 'staged') return false
      this.recoveryPlan.status = 'approved'
      this.recoveryPlan.approved_at = new Date().toISOString()
      this.addTimeline(
        'User',
        'Recovery approved',
        'Approval was recorded in application state. The media track was not changed.',
        { plan_id: planId, media_mutated: false },
      )
      return true
    },
    rejectPlan(planId) {
      if (this.recoveryPlan?.id !== planId || this.recoveryPlan.status !== 'staged') return false
      this.recoveryPlan.status = 'rejected'
      this.recoveryPlan.rejected_at = new Date().toISOString()
      this.transition('critical')
      this.addTimeline(
        'User',
        'Recovery rejected',
        'The staged plan was rejected. The media track remains disabled.',
        { plan_id: planId, media_mutated: false },
      )
      return true
    },
    beginRecovery() {
      this.transition('recovering')
      this.healthStatus = 'Recovering'
      this.error = null
    },
    markRecoveryApplied(previousState, newState) {
      this.recoveryPlan.status = 'applied'
      this.recoveryPlan.applied_at = new Date().toISOString()
      this.transition('verifying')
      this.healthStatus = 'Recovering'
      this.addTimeline(
        'System',
        'Approved recovery applied',
        'The allowlisted executor changed the actual outbound audio track.',
        { previous_state: previousState, new_state: newState },
      )
    },
    completeVerification(verification, snapshot) {
      this.verification = verification
      this.latestSnapshot = snapshot
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
      this.addTimeline(
        'System',
        'Recovery verification completed',
        `Fresh authoritative evidence produced a ${verification.verdict} verdict.`,
        { verdict: verification.verdict, primary_checks: verification.primary_checks },
      )
    },
    setIncidentReport(report) {
      this.incidentReport = report
      this.addTimeline(
        'System',
        'Incident report generated',
        'A sanitized on-screen report was built from the diagnosis and verified evidence.',
        { report_id: report.id, raw_ip_addresses_excluded: true, sdp_excluded: true },
      )
    },
    beginScenarioReset() {
      this.transition('verifying')
      this.faultRevision += 1
      this.activeFault = null
      this.failureBaseline = null
      this.diagnosis = null
      this.recoveryPlan = null
      this.verification = null
      this.incidentReport = null
      this.healthStatus = 'Recovering'
      this.error = null
      this.addTimeline(
        'User',
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
      this.addTimeline(
        'System',
        'Scenario reset to healthy',
        'The actual audio track is enabled and fresh media progression was confirmed.',
        { snapshot_hash: snapshot.snapshot_hash, audio_enabled: snapshot.tracks.audio.enabled },
      )
    },
    recordOperationError(result, title = 'Operation rejected') {
      this.error = `${result.error.code}: ${result.error.message}`
      this.addTimeline('System', title, result.error.message, { error: result.error })
    },
    markFailed(message, title = 'Lab startup failed', receipt = null) {
      if (this.state !== 'failed') this.transition('failed')
      this.healthStatus = 'Failed'
      this.healthScore = null
      this.error = message
      if (receipt) this.setCleanupEvidence(receipt)
      this.addTimeline('System', title, message)
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
      if (this.state !== 'ended') this.transition('ended')
      this.healthStatus = 'Ended'
      this.healthScore = null
      this.endedAt = new Date().toISOString()
      const cleanupComplete = Boolean(receipt?.complete)
      this.setCleanupEvidence(receipt)
      this.addTimeline(
        'System',
        cleanupComplete ? 'Lab resources released' : 'Lab cleanup incomplete',
        cleanupComplete
          ? 'Cleanup evidence was captured before browser references were discarded.'
          : 'One or more tracked browser resources did not confirm release.',
      )
    },
    recordCleanup(receipt) {
      this.lastCleanupReceipt = receipt
    },
    resetToIdle() {
      if (this.state !== 'idle') this.transition('idle')
      this.sessionId = null
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
    addTimeline(actor, title, detail, evidence = null) {
      this.timeline.push({
        id: crypto.randomUUID(),
        actor,
        title,
        detail,
        evidence,
        createdAt: new Date().toISOString(),
      })
    },
  },
})
