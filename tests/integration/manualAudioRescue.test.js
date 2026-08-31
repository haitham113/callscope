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

async function harness({ mutateAudio, failSnapshotAt, stallFirstRecoverySample = false } = {}) {
  const store = healthyStore()
  const audio = { ready_state: 'live', enabled: true, attached: true }
  let sampleRevision = 0
  async function captureSnapshot() {
    sampleRevision += 1
    if (sampleRevision === failSnapshotAt) {
      throw new Error('simulated fresh sample failure')
    }
    const enabled = audio.enabled
    const audioProgressing = !(stallFirstRecoverySample && sampleRevision === 4)
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
        outbound_audio: audioProgressing,
        inbound_audio: audioProgressing,
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
        status: enabled ? (audioProgressing ? 'healthy' : 'degraded') : 'critical',
        score: enabled ? (audioProgressing ? 100 : 80) : 55,
        deductions: enabled
          ? audioProgressing
            ? []
            : [{ code: 'MEDIA_PROGRESSION_INCOMPLETE', points: 20 }]
          : [{ code: 'AUDIO_TRACK_DISABLED', points: 45 }],
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
      if (mutateAudio) return mutateAudio(audio, enabled)
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

  it('keeps WebMCP application, fresh comparison, and report generation explicitly sequenced', async () => {
    const { store, audio, runtime } = await harness()
    await runtime.breakAudioTrack()
    const diagnosis = await runtime.runAgentDiagnostics({
      sessionId: store.sessionId,
      symptom: 'silent_audio',
      sampleDurationMs: 1000,
    })
    const staged = runtime.stageAgentRecoveryPlan({
      sessionId: store.sessionId,
      diagnosisId: diagnosis.diagnosis.id,
      action: 'enable_audio_track',
      reason: 'The authoritative outbound audio track is disabled.',
      expectedResult: 'Restore outbound audio on the existing sender.',
    })

    expect((await runtime.applyRecoveryAction({
      sessionId: store.sessionId,
      planId: staged.plan.id,
      publishReport: false,
    })).error.code).toBe('PLAN_NOT_APPROVED')
    expect(audio.enabled).toBe(false)

    runtime.approvePlan(staged.plan.id)
    expect(audio.enabled).toBe(false)
    const applied = await runtime.applyRecoveryAction({
      sessionId: store.sessionId,
      planId: staged.plan.id,
      publishReport: false,
    })
    expect(applied).toMatchObject({
      ok: true,
      action: 'enable_audio_track',
      stabilization_wait_ms: 1150,
    })
    expect(store.incidentReport).toBeNull()

    const compared = await runtime.compareToFailureBaseline({
      sessionId: store.sessionId,
      planId: staged.plan.id,
      sampleDurationMs: 1000,
    })
    expect(compared).toMatchObject({ ok: true, verification: { verdict: 'recovered' } })
    expect(store.incidentReport).toBeNull()

    const report = runtime.generateIncidentReport({
      sessionId: store.sessionId,
      format: 'markdown',
    })
    expect(report).toMatchObject({ ok: true, report: { session_id: store.sessionId } })
    expect(report.markdown).toContain('# CallScope Incident Report')
    expect(store.incidentReport).toEqual(report.report)
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

  it('allows the human to reset safely from a diagnostic state', async () => {
    const { store, audio, runtime } = await harness()
    await runtime.breakAudioTrack()
    store.beginDiagnosis()

    const result = await runtime.resetScenario()

    expect(result).toMatchObject({ ok: true })
    expect(audio.enabled).toBe(true)
    expect(store.state).toBe('healthy')
    expect(store.activeFault).toBeNull()
  })

  it('returns to Critical without mutation when the approved executor fails', async () => {
    const { store, audio, runtime } = await harness({
      mutateAudio(target, enabled) {
        if (enabled) throw new Error('simulated browser mutation failure')
        target.enabled = false
      },
    })
    await runtime.breakAudioTrack()
    await runtime.diagnoseAndStageRecovery()
    runtime.approvePlan()

    const result = await runtime.applyApprovedRecovery(store.recoveryPlan.id)

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'RECOVERY_FAILED', recoverable: false },
    })
    expect(audio.enabled).toBe(false)
    expect(store.state).toBe('critical')
    expect(store.healthStatus).toBe('Critical')
    expect(store.recoveryPlan.status).toBe('approved')
  })

  it('returns to Critical with an unverified applied plan when fresh sampling fails', async () => {
    const { store, audio, runtime } = await harness({ failSnapshotAt: 4 })
    await runtime.breakAudioTrack()
    await runtime.diagnoseAndStageRecovery()
    runtime.approvePlan()

    const result = await runtime.applyApprovedRecovery(store.recoveryPlan.id)

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VERIFICATION_INCOMPLETE', recoverable: true },
    })
    expect(audio.enabled).toBe(true)
    expect(store.state).toBe('critical')
    expect(store.healthStatus).toBe('Critical')
    expect(store.recoveryPlan.status).toBe('applied')
    expect(store.verification).toBeNull()
    expect(store.incidentReport).toBeNull()
  })

  it('waits for a fresh audio-progression sample before claiming recovery', async () => {
    const { store, runtime } = await harness({ stallFirstRecoverySample: true })
    await runtime.breakAudioTrack()
    await runtime.diagnoseAndStageRecovery()
    runtime.approvePlan()

    const result = await runtime.applyApprovedRecovery(store.recoveryPlan.id)

    expect(result.ok).toBe(true)
    expect(result.verification).toMatchObject({
      verdict: 'recovered',
      primary_checks: { fresh_audio_media_progression: true },
    })
    expect(store.state).toBe('healthy')
  })
})
