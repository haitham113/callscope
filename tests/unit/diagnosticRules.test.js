import { describe, expect, it } from 'vitest'
import {
  AUDIO_RECOVERY_ACTION,
  diagnoseDisabledAudio,
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
