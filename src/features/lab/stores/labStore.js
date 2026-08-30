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
    markHealthy(baseline) {
      this.transition('healthy')
      this.healthStatus = 'Healthy'
      this.healthScore = 100
      this.healthyBaseline = baseline
      this.addTimeline('System', 'Healthy baseline captured', 'Two peers, live tracks, and progressing real media counters verified.')
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
      this.timeline = []
      this.error = null
    },
    addTimeline(actor, title, detail) {
      this.timeline.push({
        id: crypto.randomUUID(),
        actor,
        title,
        detail,
        createdAt: new Date().toISOString(),
      })
    },
  },
})
