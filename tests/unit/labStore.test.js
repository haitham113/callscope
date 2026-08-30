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
})
