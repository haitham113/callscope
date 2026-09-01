import { describe, expect, it } from 'vitest'
import { verifyVideoBitrateRecovery } from '../../src/features/recovery/services/recoveryVerification.js'

function snapshot({ limited, maxBitrate, profileRestored, bitrate = null, frameRate = null, status }) {
  return {
    health: { status, score: limited ? 70 : 100 },
    connection: { outbound: 'connected', inbound: 'connected' },
    senders: {
      video: {
        attached: true,
        max_bitrate_bps: maxBitrate,
        bitrate_limited: limited,
        readback_confirmed: true,
        profile_restored: profileRestored,
      },
    },
    metrics: {
      outbound_bitrate_kbps: bitrate,
      frame_rate: frameRate,
    },
  }
}

describe('video bitrate recovery verification', () => {
  it('recovers from sender readback even when measured bitrate and frames are unavailable', () => {
    const verification = verifyVideoBitrateRecovery({
      failureSnapshot: snapshot({ limited: true, maxBitrate: 80_000, profileRestored: false, status: 'degraded' }),
      recoveredSnapshot: snapshot({ limited: false, maxBitrate: null, profileRestored: true, status: 'healthy' }),
    })

    expect(verification.verdict).toBe('recovered')
    expect(verification.primary_checks).toEqual({
      sender_cap_removed: true,
      known_good_profile_readback_confirmed: true,
      video_sender_attached: true,
      both_peers_connected: true,
    })
    expect(verification.supporting_evidence).toEqual({
      outbound_bitrate_before_kbps: null,
      outbound_bitrate_after_kbps: null,
      frame_rate_before: null,
      frame_rate_after: null,
    })
  })

  it('does not claim recovery when a cap disappears without matching the preserved profile', () => {
    const verification = verifyVideoBitrateRecovery({
      failureSnapshot: snapshot({ limited: true, maxBitrate: 80_000, profileRestored: false, status: 'degraded' }),
      recoveredSnapshot: snapshot({ limited: false, maxBitrate: null, profileRestored: false, status: 'healthy' }),
    })

    expect(verification.verdict).not.toBe('recovered')
    expect(verification.primary_checks.known_good_profile_readback_confirmed).toBe(false)
  })
})
