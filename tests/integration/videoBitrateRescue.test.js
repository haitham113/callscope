import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { hashSnapshot } from '../../src/features/diagnostics/services/snapshotService.js'
import { useLabStore } from '../../src/features/lab/stores/labStore.js'
import { createAudioRescueRuntime } from '../../src/features/recovery/services/audioRescueRuntime.js'

async function harness({
  deferCap = false,
  failCapture = false,
  failRestore = false,
  resetProgressionIncomplete = false,
} = {}) {
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
      outboundBitrateKbps: null,
      packetLoss: null,
      latencyMs: null,
      roundTripTimeMs: null,
      jitterMs: null,
      frameRate: null,
    },
  })
  store.markHealthy({ captured_at: 'healthy' })
  const audio = { ready_state: 'live', enabled: true, attached: true }
  const video = {
    attached: true,
    max_bitrate_bps: null,
    bitrate_limited: false,
    readback_confirmed: true,
    profile_restored: true,
    encoding_count: 1,
  }
  let releaseCap
  const capGate = deferCap
    ? new Promise((resolve) => { releaseCap = resolve })
    : null

  async function captureSnapshot() {
    if (failCapture) throw new Error('Synthetic failure-baseline sampling failure')
    const resetHasNoisyProgression = resetProgressionIncomplete && store.state === 'verifying'
    const snapshot = {
      session_id: store.sessionId,
      session_epoch: store.sessionEpoch,
      fault_revision: store.faultRevision,
      captured_at: new Date().toISOString(),
      active_fault: store.activeFault,
      connection: { outbound: 'connected', inbound: 'connected', ice: 'connected' },
      tracks: {
        audio: { ...audio },
        video: { ready_state: 'live', enabled: true, attached: true },
      },
      receivers: { audio: { ready_state: 'live' }, video: { ready_state: 'live' } },
      senders: { video: { ...video } },
      selected_candidate: null,
      media_progression: {
        outbound_audio: true,
        inbound_audio: true,
        outbound_video: true,
        inbound_video: true,
      },
      metrics: {
        outbound_bitrate_kbps: null,
        packet_loss: null,
        latency_ms: null,
        round_trip_time_ms: null,
        jitter_ms: null,
        frame_rate: null,
        audio_energy_delta: null,
      },
      health: {
        status: video.bitrate_limited || resetHasNoisyProgression ? 'degraded' : 'healthy',
        score: video.bitrate_limited ? 70 : resetHasNoisyProgression ? 80 : 100,
        deductions: video.bitrate_limited
          ? [{ code: 'VIDEO_BITRATE_CONSTRAINED', severity: 'warning', points: 30 }]
          : resetHasNoisyProgression
            ? [{ code: 'MEDIA_PROGRESSION_INCOMPLETE', severity: 'warning', points: 20 }]
          : [],
      },
    }
    snapshot.snapshot_hash = await hashSnapshot(snapshot)
    return snapshot
  }

  const runtime = createAudioRescueRuntime({
    store,
    captureSnapshot,
    readAudioState: () => ({ ...audio }),
    setAudioEnabled(enabled) { audio.enabled = enabled },
    readVideoState: () => ({ ...video }),
    async applyVideoBitrateCap() {
      const previous_state = { ...video }
      if (capGate) await capGate
      Object.assign(video, { max_bitrate_bps: 80_000, bitrate_limited: true, readback_confirmed: true, profile_restored: false })
      return { previous_state, new_state: { ...video } }
    },
    async restoreVideoBitrateProfile() {
      if (failRestore) throw new Error('Synthetic video profile restoration failure')
      const previous_state = { ...video }
      Object.assign(video, { max_bitrate_bps: null, bitrate_limited: false, readback_confirmed: true, profile_restored: true })
      return { previous_state, new_state: { ...video } }
    },
    now: () => 10_000,
  })
  return { store, runtime, audio, video, releaseCap }
}

describe('complete constrained-video-bitrate rescue workflow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('stages, approves, restores, and verifies from sender readback without metric improvement', async () => {
    const { store, runtime, video } = await harness()

    await expect(runtime.breakVideoBitrate()).resolves.toMatchObject({ ok: true })
    expect(store.state).toBe('degraded')
    expect(video).toMatchObject({ max_bitrate_bps: 80_000, bitrate_limited: true })

    const staged = await runtime.diagnoseAndStageRecovery()
    expect(staged).toMatchObject({
      ok: true,
      diagnosis: { symptom: 'poor_video', allowed_actions: ['restore_video_bitrate'] },
      plan: { action: 'restore_video_bitrate', status: 'staged' },
    })
    expect((await runtime.applyApprovedRecovery()).error.code).toBe('PLAN_NOT_APPROVED')
    expect(video.bitrate_limited).toBe(true)

    expect(runtime.approvePlan()).toMatchObject({
      ok: true,
      media_state_unchanged: true,
      video_sender: { bitrate_limited: true },
    })
    const recovery = await runtime.applyApprovedRecovery()

    expect(recovery).toMatchObject({
      ok: true,
      action: 'restore_video_bitrate',
      verification: { verdict: 'recovered' },
    })
    expect(video).toMatchObject({ max_bitrate_bps: null, bitrate_limited: false })
    expect(store.state).toBe('healthy')
  })

  it('rolls back the real sender and store when failure-baseline sampling fails', async () => {
    const { store, runtime, video } = await harness({ failCapture: true })

    const result = await runtime.breakVideoBitrate()

    expect(result).toMatchObject({ ok: false, error: { code: 'FAULT_MUTATION_FAILED' } })
    expect(video).toMatchObject({
      max_bitrate_bps: null,
      bitrate_limited: false,
      profile_restored: true,
    })
    expect(store).toMatchObject({
      state: 'healthy',
      healthStatus: 'Healthy',
      activeFault: null,
      failureBaseline: null,
    })
  })

  it('does not commit a delayed bitrate mutation after operation ownership is cancelled', async () => {
    const { store, runtime, releaseCap } = await harness({ deferCap: true })

    const pendingFault = runtime.breakVideoBitrate()
    runtime.cancelAll('Synthetic session teardown')
    releaseCap()

    await expect(pendingFault).resolves.toMatchObject({
      ok: false,
      error: { code: 'OPERATION_CANCELLED' },
    })
    expect(store).toMatchObject({
      state: 'healthy',
      healthStatus: 'Healthy',
      activeFault: null,
      failureBaseline: null,
    })
  })

  it('keeps a failed video reset degraded and reports authoritative sender state', async () => {
    const { store, runtime, video } = await harness({ failRestore: true })
    await expect(runtime.breakVideoBitrate()).resolves.toMatchObject({ ok: true })

    const result = await runtime.resetScenario()

    expect(result).toMatchObject({ ok: false, error: { code: 'FAULT_MUTATION_FAILED' } })
    expect(video.bitrate_limited).toBe(true)
    expect(store).toMatchObject({
      state: 'degraded',
      healthStatus: 'Degraded',
      healthScore: 70,
      activeFault: 'constrained_video_bitrate',
    })
    expect(store.timeline.at(-1).evidence).toMatchObject({
      current_state: { bitrate_limited: true, max_bitrate_bps: 80_000 },
      mutation_uncertain: false,
    })
  })

  it('accepts authoritative reset restoration when loopback progression counters are noisy', async () => {
    const { store, runtime } = await harness({ resetProgressionIncomplete: true })
    await expect(runtime.breakVideoBitrate()).resolves.toMatchObject({ ok: true })

    const result = await runtime.resetScenario()

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        health: { status: 'healthy' },
        reset_verification: {
          primary_state_restored: true,
          progression_is_supporting_evidence: true,
        },
      },
    })
    expect(store).toMatchObject({ state: 'healthy', healthStatus: 'Healthy', activeFault: null })
  })
})
