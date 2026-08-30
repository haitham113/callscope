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
    connection: { outbound: 'new', inbound: 'new', ice: 'new' },
    tracks: {
      audio: { readyState: 'unavailable', enabled: null, attached: false },
      video: { readyState: 'unavailable', enabled: null, attached: false },
    },
    metrics: emptyMetrics(),
    audioLevel: 0,
    evidenceChecks: {
      peers_connected: false,
      tracks_live_enabled_attached: false,
      bidirectional_audio_video_progress: false,
    },
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
      this.connection = { outbound: 'new', inbound: 'new', ice: 'new' }
      this.tracks = {
        audio: { readyState: 'unavailable', enabled: null, attached: false },
        video: { readyState: 'unavailable', enabled: null, attached: false },
      }
      this.metrics = emptyMetrics()
      this.audioLevel = 0
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
    markFailed(message) {
      if (this.state !== 'failed') this.transition('failed')
      this.healthStatus = 'Failed'
      this.healthScore = null
      this.error = message
      this.addTimeline('System', 'Lab startup failed', message)
    },
    markEnded(receipt) {
      if (this.state !== 'ended') this.transition('ended')
      this.healthStatus = 'Ended'
      this.healthScore = null
      this.endedAt = new Date().toISOString()
      this.connection = { outbound: 'closed', inbound: 'closed', ice: 'closed' }
      this.tracks = {
        audio: { readyState: 'ended', enabled: false, attached: false },
        video: { readyState: 'ended', enabled: false, attached: false },
      }
      this.metrics = emptyMetrics()
      this.audioLevel = 0
      this.lastCleanupReceipt = receipt
      this.addTimeline('System', 'Lab resources released', 'Cleanup evidence was captured before browser references were discarded.')
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
