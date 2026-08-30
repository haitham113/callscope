import { describe, expect, it } from 'vitest'
import {
  deriveMetrics,
  evaluateHealthyEvidence,
} from '../../src/features/diagnostics/services/healthEngine.js'

function media(packets, bytes, frames = null) {
  return { packets, bytes, frames, framesPerSecond: null }
}

const peers = { outbound: 'connected', inbound: 'connected' }
const tracks = {
  audio: { readyState: 'live', enabled: true, attached: true },
  video: { readyState: 'live', enabled: true, attached: true },
}
const previous = {
  capturedAt: 1000,
  outbound: { audio: media(10, 1000), video: media(10, 2000, 5) },
  inbound: { audio: media(9, 900), video: media(9, 1800, 4) },
}
const current = {
  capturedAt: 2000,
  outbound: { audio: media(20, 2000), video: media(20, 5000, 25) },
  inbound: {
    audio: media(19, 1900),
    video: media(19, 4500, 22),
    packetLoss: 0,
    jitterMs: 4,
  },
  remote: { roundTripTimeMs: 3 },
}

describe('truthful healthy evidence', () => {
  it('requires connected peers, authoritative tracks, and all four media counters', () => {
    const result = evaluateHealthyEvidence({ peers, tracks, previous, current })
    expect(result.healthy).toBe(true)
    expect(Object.values(result.checks)).toEqual([true, true, true])
  })

  it('does not claim healthy when one real counter is stalled', () => {
    const stalled = structuredClone(current)
    stalled.inbound.video = structuredClone(previous.inbound.video)
    const result = evaluateHealthyEvidence({
      peers,
      tracks,
      previous,
      current: stalled,
    })
    expect(result.healthy).toBe(false)
    expect(result.checks.bidirectional_audio_video_progress).toBe(false)
  })

  it('does not treat unavailable track state as healthy', () => {
    const missingTrack = structuredClone(tracks)
    missingTrack.audio.enabled = null
    expect(
      evaluateHealthyEvidence({ peers, tracks: missingTrack, previous, current }).healthy,
    ).toBe(false)
  })

  it('derives rates while preserving unavailable optional metrics', () => {
    expect(deriveMetrics(previous, current)).toEqual({
      outboundBitrateKbps: 32,
      packetLoss: 0,
      latencyMs: 3,
      frameRate: 20,
    })
    expect(deriveMetrics(null, current).outboundBitrateKbps).toBeNull()
  })
})
