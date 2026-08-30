import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { hashSnapshot } from '../../src/features/diagnostics/services/snapshotService.js'
import { useLabStore } from '../../src/features/lab/stores/labStore.js'
import { createAudioRescueRuntime } from '../../src/features/recovery/services/audioRescueRuntime.js'

function healthyStore() {
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
      latencyMs: 2,
      frameRate: 30,
    },
  })
  store.markHealthy({ captured_at: 'synthetic healthy baseline' })
  return store
}

async function harness() {
  const store = healthyStore()
  const audio = { ready_state: 'live', enabled: true, attached: true }
  let sampleRevision = 0
  async function captureSnapshot() {
    sampleRevision += 1
    const enabled = audio.enabled
    const snapshot = {
      session_id: store.sessionId,
      session_epoch: store.sessionEpoch,
      fault_revision: store.faultRevision,
      captured_at: new Date(sampleRevision * 1000).toISOString(),
      active_fault: store.activeFault,
      connection: { outbound: 'connected', inbound: 'connected', ice: 'connected' },
      tracks: {
        audio: { ...audio },
        video: { ready_state: 'live', enabled: true, attached: true },
      },
      receivers: { audio: { ready_state: 'live' }, video: { ready_state: 'live' } },
      media_progression: {
        outbound_audio: true,
        inbound_audio: true,
        outbound_video: true,
        inbound_video: true,
      },
      metrics: {
        outbound_bitrate_kbps: 120,
        packet_loss: 0,
        latency_ms: 2,
        frame_rate: 30,
        audio_energy_delta: enabled ? 0.2 : 0,
      },
      health: {
        status: enabled ? 'healthy' : 'critical',
        score: enabled ? 100 : 55,
        deductions: enabled ? [] : [{ code: 'AUDIO_TRACK_DISABLED', points: 45 }],
      },
    }
    snapshot.snapshot_hash = await hashSnapshot(snapshot)
    return snapshot
  }
  const runtime = createAudioRescueRuntime({
    store,
    captureSnapshot,
    readAudioState: () => ({ ...audio }),
    setAudioEnabled(enabled) {
      audio.enabled = enabled
    },
    now: () => 10_000,
  })
  return { store, audio, runtime }
}

describe('complete manual disabled-audio rescue workflow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('cannot apply before approval and then proves the approved recovery', async () => {
    const { store, audio, runtime } = await harness()
    await expect(runtime.breakAudioTrack()).resolves.toMatchObject({ ok: true })
    expect(audio.enabled).toBe(false)
    expect(store.failureBaseline.snapshot_hash).toHaveLength(64)

    const staged = await runtime.diagnoseAndStageRecovery()
    expect(staged).toMatchObject({ ok: true })
    expect(store.diagnosis).toMatchObject({
      session_id: store.sessionId,
      session_epoch: store.sessionEpoch,
      fault_revision: store.faultRevision,
      snapshot_hash: store.failureBaseline.snapshot_hash,
      allowed_actions: ['enable_audio_track'],
    })

    const bypass = await runtime.applyApprovedRecovery(store.recoveryPlan.id)
    expect(bypass.error.code).toBe('PLAN_NOT_APPROVED')
    expect(audio.enabled).toBe(false)

    const approval = runtime.approvePlan()
    expect(approval).toMatchObject({
      ok: true,
      media_state_unchanged: true,
      audio_track: { enabled: false },
    })
    expect(audio.enabled).toBe(false)

    const recovery = await runtime.applyApprovedRecovery(store.recoveryPlan.id)
    expect(recovery.ok).toBe(true)
    expect(audio.enabled).toBe(true)
    expect(store.verification).toMatchObject({
      verdict: 'recovered',
      primary_checks: {
        actual_track_changed_false_to_true: true,
        track_live_and_attached: true,
        both_peers_connected: true,
        fresh_audio_media_progression: true,
      },
    })
    expect(store.incidentReport.root_cause).toBe('Outbound audio track is disabled')
    expect(store.state).toBe('healthy')
  })

  it('keeps the track disabled after rejection and resets the actual scenario', async () => {
    const { store, audio, runtime } = await harness()
    await runtime.breakAudioTrack()
    await runtime.diagnoseAndStageRecovery()
    expect(runtime.rejectPlan()).toMatchObject({ ok: true, status: 'rejected' })
    expect(audio.enabled).toBe(false)
    const rejectedApply = await runtime.applyApprovedRecovery(store.recoveryPlan.id)
    expect(rejectedApply.error.code).toBe('PLAN_NOT_APPROVED')
    expect(audio.enabled).toBe(false)

    await expect(runtime.resetScenario()).resolves.toMatchObject({ ok: true })
    expect(audio.enabled).toBe(true)
    expect(store.state).toBe('healthy')
    expect(store.activeFault).toBeNull()
    expect(store.recoveryPlan).toBeNull()
  })
})
