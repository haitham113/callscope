import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLabStore } from '../../src/features/lab/stores/labStore.js'

describe('lab store session reset', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('clears prior evidence before a restarted session begins', () => {
    const store = useLabStore()
    store.beginSession()
    store.setLiveEvidence({
      connection: { outbound: 'connected', inbound: 'connected', ice: 'connected' },
      tracks: {
        audio: { readyState: 'live', enabled: true, attached: true },
        video: { readyState: 'live', enabled: true, attached: true },
      },
      checks: {
        peers_connected: true,
        tracks_live_enabled_attached: true,
        receiver_tracks_live: true,
        bidirectional_audio_video_progress: true,
      },
      metrics: {
        outboundBitrateKbps: 100,
        packetLoss: 0,
        latencyMs: 1,
        frameRate: 30,
      },
    })
    store.markHealthy({ captured_at: 'synthetic' })
    store.markEnded({ complete: true })
    store.resetToIdle()
    store.beginSession()

    expect(store.connection).toEqual({ outbound: 'new', inbound: 'new', ice: 'new' })
    expect(Object.values(store.evidenceChecks).every((value) => !value)).toBe(true)
    expect(Object.values(store.metrics).every((value) => value === null)).toBe(true)
    expect(store.healthyBaseline).toBeNull()
  })

  it('assigns timeline actors internally instead of accepting caller provenance', () => {
    const store = useLabStore()
    store.beginSession()

    expect(store.addTimeline).toBeUndefined()
    store.recordSystemEvent('Browser evidence captured', 'Authoritative state sampled.')

    expect(store.timeline.at(-1)).toMatchObject({
      actor: 'System',
      title: 'Browser evidence captured',
      detail: 'Authoritative state sampled.',
    })
  })

  it('uses UUID session IDs and a monotonic epoch across reset and restart', () => {
    const store = useLabStore()
    store.beginSession()
    const first = { id: store.sessionId, epoch: store.sessionEpoch }
    store.markEnded({ complete: true })
    store.resetToIdle()
    store.beginSession()

    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(store.sessionId).not.toBe(first.id)
    expect(store.sessionEpoch).toBe(first.epoch + 1)
  })

  it('increments incident revision for mutations but not inspection or report events', () => {
    const store = useLabStore()
    store.beginSession()
    const afterStart = store.incidentRevision
    store.recordInspectionEvent('State inspected', 'No state changed.', {
      remoteAddress: '10.0.0.8',
      safe: { message: 'Peer 192.168.1.4' },
    })
    expect(store.incidentRevision).toBe(afterStart)
    expect(store.timeline.at(-1).evidence).toEqual({
      safe: { message: 'Peer [redacted IP]' },
    })

    store.recordSystemEvent('State changed', 'Synthetic incident mutation.')
    expect(store.incidentRevision).toBe(afterStart + 1)
    const beforeReport = store.incidentRevision
    store.setIncidentReport({ id: 'incident-id', incident_revision: beforeReport })
    expect(store.incidentRevision).toBe(beforeReport)
  })

  it('sanitizes timeline display strings before they enter shared UI state', () => {
    const store = useLabStore()
    store.beginSession()
    store.recordSystemEvent(
      'Peer 10.0.0.9 failed',
      'SDP v=0\r\no=- 1 1 IN IP4 127.0.0.1',
    )
    expect(store.timeline.at(-1)).toMatchObject({
      title: 'Peer [redacted IP] failed',
      detail: '[redacted protocol description]',
    })
  })

  it('enforces recovery transitions and marks cleanup failures with a stable error', () => {
    const store = useLabStore()
    store.beginSession()
    store.markHealthy({ captured_at: 'synthetic' })
    store.transition('critical')
    store.recoveryPlan = { id: 'plan-1', status: 'staged' }
    expect(store.approvePlan('plan-1')).toBe(true)
    expect(store.rejectPlan('plan-1')).toBe(false)
    expect(store.expirePlan('plan-1')).toBe(true)
    expect(store.state).toBe('critical')
    expect(store.recoveryPlan.status).toBe('expired')

    store.markEnded({
      complete: false,
      peers: {},
      media: {},
      sampler: {},
    })
    expect(store.state).toBe('failed')
    expect(store.error).toContain('CLEANUP_INCOMPLETE')
    expect(store.timeline.at(-1)).toMatchObject({
      type: 'operation_failed',
      title: 'Lab cleanup incomplete',
    })
  })
})
