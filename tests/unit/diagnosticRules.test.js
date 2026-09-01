import { describe, expect, it } from 'vitest'
import {
  AUDIO_RECOVERY_ACTION,
  VIDEO_BITRATE_RECOVERY_ACTION,
  diagnoseDisabledAudio,
  diagnoseVideoBitrate,
} from '../../src/features/diagnostics/services/diagnosticRules.js'

function snapshot(enabled) {
  return {
    session_id: 'session-1',
    session_epoch: 3,
    fault_revision: 2,
    snapshot_hash: 'snapshot-hash',
    tracks: { audio: { ready_state: 'live', enabled, attached: true } },
    metrics: { audio_energy_delta: null },
  }
}

describe('disabled-audio diagnostic rule', () => {
  it('returns a snapshot-bound critical finding and only the compatible action', () => {
    const diagnosis = diagnoseDisabledAudio(snapshot(false), () => 'diagnosis-1')
    expect(diagnosis).toMatchObject({
      id: 'diagnosis-1',
      session_id: 'session-1',
      session_epoch: 3,
      fault_revision: 2,
      snapshot_hash: 'snapshot-hash',
      allowed_actions: [AUDIO_RECOVERY_ACTION],
    })
    expect(diagnosis.findings[0]).toMatchObject({
      severity: 'critical',
      confidence: 'high',
      allowed_actions: [AUDIO_RECOVERY_ACTION],
    })
    expect(diagnosis.findings[0].evidence[0]).toEqual({
      field: 'tracks.audio.enabled',
      value: false,
      role: 'primary',
    })
    expect(diagnosis.findings[0].limitations).toHaveLength(2)
  })

  it('does not allow a repair when disabled state is not authoritative', () => {
    expect(diagnoseDisabledAudio(snapshot(true)).allowed_actions).toEqual([])
  })
})

describe('video-bitrate diagnostic rule', () => {
  it('uses fresh sender readback as primary evidence and allows only profile restoration', () => {
    const diagnosis = diagnoseVideoBitrate({
      ...snapshot(true),
      senders: {
        video: {
          attached: true,
          max_bitrate_bps: 80_000,
          bitrate_limited: true,
          readback_confirmed: true,
        },
      },
      metrics: { outbound_bitrate_kbps: null, frame_rate: null },
    }, () => 'diagnosis-video')

    expect(diagnosis).toMatchObject({
      id: 'diagnosis-video',
      symptom: 'poor_video',
      allowed_actions: [VIDEO_BITRATE_RECOVERY_ACTION],
    })
    expect(diagnosis.findings[0]).toMatchObject({
      code: 'VIDEO_SENDER_BITRATE_CONSTRAINED',
      severity: 'warning',
      confidence: 'high',
      allowed_actions: [VIDEO_BITRATE_RECOVERY_ACTION],
    })
    expect(diagnosis.findings[0].evidence[0]).toEqual({
      field: 'senders.video.max_bitrate_bps',
      value: 80_000,
      role: 'primary',
    })
    expect(diagnosis.findings[0].limitations).toContain(
      'Measured bitrate and frame rate are supporting evidence only and may be unavailable or unchanged in a local loopback.',
    )
  })
})
