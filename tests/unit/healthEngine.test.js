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
const receivers = {
  audio: { readyState: 'live' },
  video: { readyState: 'live' },
}
const previous = {
  capturedAt: 1000,
  outbound: { audio: media(10, 1000), video: media(10, 2000, 5) },
  inbound: {
    audio: media(9, 900),
    video: media(9, 1800, 4),
    packetLoss: 0,
  },
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
    const result = evaluateHealthyEvidence({
      peers,
      tracks,
      receivers,
      previous,
      current,
    })
    expect(result.healthy).toBe(true)
    expect(Object.values(result.checks)).toEqual([true, true, true, true])
  })

  it('does not claim healthy when one real counter is stalled', () => {
    const stalled = structuredClone(current)
    stalled.inbound.video = structuredClone(previous.inbound.video)
    const result = evaluateHealthyEvidence({
      peers,
      tracks,
      receivers,
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
      evaluateHealthyEvidence({
        peers,
        tracks: missingTrack,
        receivers,
        previous,
        current,
      }).healthy,
    ).toBe(false)
  })

  it('requires live receiver tracks before claiming Healthy', () => {
    const endedReceiver = structuredClone(receivers)
    endedReceiver.video.readyState = 'ended'
    const result = evaluateHealthyEvidence({
      peers,
      tracks,
      receivers: endedReceiver,
      previous,
      current,
    })
    expect(result.healthy).toBe(false)
    expect(result.checks.receiver_tracks_live).toBe(false)
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

  it('keeps missing or reset counters unavailable instead of inventing zero', () => {
    const unavailable = structuredClone(current)
    unavailable.outbound.audio.bytes = null
    expect(deriveMetrics(previous, unavailable).outboundBitrateKbps).toBeNull()

    const reset = structuredClone(current)
    reset.outbound.video.bytes = 10
    reset.outbound.video.frames = 1
    reset.inbound.packetLoss = -1
    expect(deriveMetrics(previous, reset)).toMatchObject({
      outboundBitrateKbps: null,
      packetLoss: null,
      frameRate: null,
    })
  })

  it('reports packet loss from the current sample interval', () => {
    const withPreviousLoss = structuredClone(previous)
    const withCurrentLoss = structuredClone(current)
    withPreviousLoss.inbound.packetLoss = 2
    withCurrentLoss.inbound.packetLoss = 5
    expect(deriveMetrics(withPreviousLoss, withCurrentLoss).packetLoss).toBe(3)
  })
})
