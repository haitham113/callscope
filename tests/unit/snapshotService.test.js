import { describe, expect, it } from 'vitest'
import {
  createAuthoritativeSnapshot,
  hashSnapshot,
} from '../../src/features/diagnostics/services/snapshotService.js'

function sample(at, offset = 0) {
  const media = (base, frames = null) => ({
    packets: base + offset,
    bytes: (base + offset) * 100,
    frames: frames === null ? null : frames + offset,
    framesPerSecond: null,
  })
  return {
    capturedAt: at,
    outbound: { audio: media(10), video: media(20, 10) },
    inbound: {
      audio: media(9),
      video: media(19, 9),
      packetLoss: 0,
      jitterMs: 2,
      totalAudioEnergy: 1 + offset / 10,
    },
    remote: { roundTripTimeMs: 3 },
  }
}

function peerStatus(audioEnabled = false) {
  return {
    connection: { outbound: 'connected', inbound: 'connected', ice: 'connected' },
    tracks: {
      audio: { readyState: 'live', enabled: audioEnabled, attached: true },
      video: { readyState: 'live', enabled: true, attached: true },
    },
    receivers: { audio: { readyState: 'live' }, video: { readyState: 'live' } },
  }
}

describe('authoritative sanitized snapshots', () => {
  it('uses track state as critical evidence and keeps unavailable metrics nullable', () => {
    const snapshot = createAuthoritativeSnapshot({
      sessionId: 'session-safe',
      sessionEpoch: 2,
      faultRevision: 1,
      activeFault: 'disabled_audio',
      peerStatus: peerStatus(false),
      previousSample: sample(1000),
      currentSample: sample(2000, 2),
    })
    expect(snapshot.tracks.audio).toEqual({
      ready_state: 'live',
      enabled: false,
      attached: true,
    })
    expect(snapshot.health.status).toBe('critical')
    expect(snapshot.health.deductions[0].code).toBe('AUDIO_TRACK_DISABLED')
    expect(snapshot.media_progression.outbound_audio).toBe(true)
  })

  it('hashes stable binding fields while ignoring timestamps and advancing counters', async () => {
    const first = createAuthoritativeSnapshot({
      sessionId: 'session-safe',
      sessionEpoch: 2,
      faultRevision: 1,
      activeFault: 'disabled_audio',
      peerStatus: peerStatus(false),
      previousSample: sample(1000),
      currentSample: sample(2000, 2),
      capturedAt: '2026-01-01T00:00:00.000Z',
    })
    const later = createAuthoritativeSnapshot({
      sessionId: 'session-safe',
      sessionEpoch: 2,
      faultRevision: 1,
      activeFault: 'disabled_audio',
      peerStatus: peerStatus(false),
      previousSample: sample(3000, 5),
      currentSample: sample(4000, 9),
      capturedAt: '2026-01-01T00:00:03.000Z',
    })
    expect(await hashSnapshot(first)).toBe(await hashSnapshot(later))

    const repaired = structuredClone(later)
    repaired.tracks.audio.enabled = true
    expect(await hashSnapshot(repaired)).not.toBe(await hashSnapshot(first))
  })

  it('does not claim Healthy when an authoritative receiver track has ended', () => {
    const status = peerStatus(true)
    status.receivers.audio.readyState = 'ended'

    const snapshot = createAuthoritativeSnapshot({
      sessionId: 'session-safe',
      sessionEpoch: 2,
      faultRevision: 0,
      activeFault: null,
      peerStatus: status,
      previousSample: sample(1000),
      currentSample: sample(2000, 2),
    })

    expect(snapshot.health.status).toBe('critical')
    expect(snapshot.health.deductions).toContainEqual(
      expect.objectContaining({ code: 'AUDIO_RECEIVER_UNAVAILABLE' }),
    )
  })
})
