import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSnapshot } from '../../src/features/diagnostics/services/snapshotService.js'
import { useLabStore } from '../../src/features/lab/stores/labStore.js'
import { createAudioRescueRuntime } from '../../src/features/recovery/services/audioRescueRuntime.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

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
    metrics: { outboundBitrateKbps: 100, packetLoss: 0, latencyMs: 2, frameRate: 30 },
  })
  store.markHealthy({ captured_at: 'healthy' })
  return store
}

async function harness({
  blockedPhases = [],
  ignoreAbortPhases = [],
  unhealthyPhases = [],
  failedPhases = [],
  mutateAudio,
} = {}) {
  const store = healthyStore()
  const audio = { ready_state: 'live', enabled: true, attached: true }
  const clock = { value: 10_000 }
  const gates = new Map(blockedPhases.map((phase) => [phase, deferred()]))
  const entered = new Map(blockedPhases.map((phase) => [phase, deferred()]))
  let sampleRevision = 0

  async function captureSnapshot({ signal, phase } = {}) {
    sampleRevision += 1
    if (failedPhases.includes(phase)) throw new Error(`Injected ${phase} failure`)
    const gate = gates.get(phase)
    if (gate) {
      entered.get(phase).resolve()
      await new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException('Cancelled', 'AbortError'))
        if (!ignoreAbortPhases.includes(phase)) signal?.addEventListener('abort', onAbort, { once: true })
        gate.promise.then(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        })
      })
    }
    const unhealthy = unhealthyPhases.includes(phase)
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
        outbound_audio: !unhealthy,
        inbound_audio: !unhealthy,
        outbound_video: true,
        inbound_video: true,
      },
      metrics: {
        outbound_bitrate_kbps: 120,
        packet_loss: 0,
        latency_ms: 2,
        frame_rate: 30,
        audio_energy_delta: audio.enabled ? 0.2 : 0,
      },
      health: {
        status: audio.enabled ? (unhealthy ? 'degraded' : 'healthy') : 'critical',
        score: audio.enabled ? (unhealthy ? 80 : 100) : 55,
        deductions: audio.enabled
          ? (unhealthy ? [{ code: 'MEDIA_PROGRESSION_INCOMPLETE', points: 20 }] : [])
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
    now: () => clock.value,
  })

  return {
    store,
    audio,
    runtime,
    clock,
    enter(phase) { return entered.get(phase).promise },
    release(phase) { gates.get(phase).resolve() },
  }
}

describe('Milestone 3 safety integration', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('rejects unknown diagnoses, incompatible actions, and unknown plans without media mutation', async () => {
    const subject = await harness()
    await subject.runtime.breakAudioTrack()
    expect(subject.audio.enabled).toBe(false)
    expect(subject.runtime.stageRecoveryPlan({
      sessionId: subject.store.sessionId,
      diagnosisId: 'unknown-diagnosis',
      action: 'enable_audio_track',
    }).error.code).toBe('DIAGNOSIS_NOT_FOUND')

    const diagnosis = await subject.runtime.runDiagnostics({ sessionId: subject.store.sessionId, symptom: 'silent_audio' })
    expect(subject.runtime.stageRecoveryPlan({
      sessionId: subject.store.sessionId,
      diagnosisId: diagnosis.diagnosis.id,
      action: 'restore_video_bitrate',
    }).error.code).toBe('ACTION_NOT_ALLOWED')
    expect((await subject.runtime.applyRecoveryAction({
      sessionId: subject.store.sessionId,
      planId: 'unknown-plan',
    })).error.code).toBe('PLAN_NOT_FOUND')
    expect(subject.audio.enabled).toBe(false)
  })

  it('sanitizes agent-authored plan text before it reaches application state', async () => {
    const subject = await harness()
    await subject.runtime.breakAudioTrack()
    const diagnosis = await subject.runtime.runDiagnostics({ sessionId: subject.store.sessionId })
    const staged = subject.runtime.stageRecoveryPlan({
      sessionId: subject.store.sessionId,
      diagnosisId: diagnosis.diagnosis.id,
      action: 'enable_audio_track',
      reason: 'Repair peer 10.0.0.5 using SDP v=0\r\no=- 1 1 IN IP4 127.0.0.1',
      expectedResult: 'Restore peer 2001:db8::9',
    })

    expect(staged.ok).toBe(true)
    expect(subject.store.recoveryPlan.reason).toBe('[redacted protocol description]')
    expect(subject.store.recoveryPlan.expected_result).toBe('Restore peer [redacted IP]')
  })

  it('never claims healthy when fault sampling and rollback both fail', async () => {
    const subject = await harness({
      failedPhases: ['fault_baseline'],
      mutateAudio(audio, enabled) {
        if (enabled) throw new Error('Injected rollback failure')
        audio.enabled = false
      },
    })
    const result = await subject.runtime.breakAudioTrack()

    expect(result).toMatchObject({ ok: false, error: { code: 'FAULT_MUTATION_FAILED' } })
    expect(subject.audio.enabled).toBe(false)
    expect(subject.store.state).toBe('critical')
    expect(subject.store.activeFault).toBe('disabled_audio')
  })

  it.each([
    ['expired', 'PLAN_EXPIRED'],
    ['stale', 'DIAGNOSIS_STALE'],
    ['mismatched', 'SESSION_MISMATCH'],
  ])('rejects an %s approved plan without media mutation', async (kind, code) => {
    const subject = await harness()
    await subject.runtime.breakAudioTrack()
    await subject.runtime.diagnoseAndStageRecovery()
    subject.runtime.approvePlan()
    if (kind === 'expired') subject.clock.value += 90_000
    if (kind === 'stale') subject.store.faultRevision += 1
    const sessionId = kind === 'mismatched' ? 'different-session' : subject.store.sessionId

    const result = await subject.runtime.applyRecoveryAction({
      sessionId,
      planId: subject.store.recoveryPlan.id,
    })

    expect(result.error.code).toBe(code)
    expect(subject.audio.enabled).toBe(false)
    if (kind === 'expired') {
      expect(subject.store.recoveryPlan.status).toBe('expired')
      expect(subject.store.state).toBe('critical')
    }
  })

  it('expires an untouched plan at ninety seconds and exits awaiting approval', async () => {
    vi.useFakeTimers()
    try {
      const subject = await harness()
      await subject.runtime.breakAudioTrack()
      await subject.runtime.diagnoseAndStageRecovery()
      subject.clock.value += 90_000
      await vi.advanceTimersByTimeAsync(90_000)

      expect(subject.store.recoveryPlan.status).toBe('expired')
      expect(subject.store.state).toBe('critical')
      expect(subject.audio.enabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects rejected and used plans without a second mutation', async () => {
    const rejected = await harness()
    await rejected.runtime.breakAudioTrack()
    await rejected.runtime.diagnoseAndStageRecovery()
    rejected.runtime.rejectPlan()
    expect((await rejected.runtime.applyApprovedRecovery(rejected.store.recoveryPlan.id)).error.code).toBe('PLAN_NOT_APPROVED')
    expect(rejected.audio.enabled).toBe(false)

    setActivePinia(createPinia())
    const used = await harness()
    await used.runtime.breakAudioTrack()
    await used.runtime.diagnoseAndStageRecovery()
    used.runtime.approvePlan()
    expect((await used.runtime.applyApprovedRecovery(used.store.recoveryPlan.id)).ok).toBe(true)
    expect((await used.runtime.applyApprovedRecovery(used.store.recoveryPlan.id)).error.code).toBe('PLAN_ALREADY_USED')
    expect(used.audio.enabled).toBe(true)
  })

  it('rejects rapid duplicate diagnostics while one sampling window owns the fault', async () => {
    const subject = await harness({ blockedPhases: ['diagnostic'] })
    await subject.runtime.breakAudioTrack()
    const first = subject.runtime.runDiagnostics({ sessionId: subject.store.sessionId, symptom: 'silent_audio' })
    await subject.enter('diagnostic')
    const duplicate = await subject.runtime.runDiagnostics({ sessionId: subject.store.sessionId, symptom: 'silent_audio' })
    expect(duplicate.error.code).toBe('INVALID_STATE_TRANSITION')
    subject.release('diagnostic')
    expect((await first).ok).toBe(true)
  })

  it('reset cancels diagnosis and ignores a deliberately late completion', async () => {
    const subject = await harness({ blockedPhases: ['diagnostic'], ignoreAbortPhases: ['diagnostic'] })
    await subject.runtime.breakAudioTrack()
    const diagnosis = subject.runtime.runDiagnostics({ sessionId: subject.store.sessionId, symptom: 'silent_audio' })
    await subject.enter('diagnostic')
    const reset = await subject.runtime.resetScenario()
    expect(reset.ok).toBe(true)
    const timelineLength = subject.store.timeline.length
    subject.release('diagnostic')
    expect((await diagnosis).error.code).toBe('OPERATION_CANCELLED')
    expect(subject.store.state).toBe('healthy')
    expect(subject.store.recoveryPlan).toBeNull()
    expect(subject.store.timeline).toHaveLength(timelineLength)
  })

  it.each(['recovery_preflight', 'recovery_verification'])('reset cancels %s with no late state mutation', async (phase) => {
    const subject = await harness({ blockedPhases: [phase], ignoreAbortPhases: [phase] })
    await subject.runtime.breakAudioTrack()
    await subject.runtime.diagnoseAndStageRecovery()
    subject.runtime.approvePlan()
    const application = subject.runtime.applyApprovedRecovery(subject.store.recoveryPlan.id)
    await subject.enter(phase)
    const reset = await subject.runtime.resetScenario()
    expect(reset.ok).toBe(true)
    const timelineLength = subject.store.timeline.length
    subject.release(phase)
    expect((await application).error.code).toBe('OPERATION_CANCELLED')
    expect(subject.store.state).toBe('healthy')
    expect(subject.audio.enabled).toBe(true)
    expect(subject.store.recoveryPlan).toBeNull()
    expect(subject.store.timeline).toHaveLength(timelineLength)
  })

  it('returns the same report while report and inspection events leave incident revision unchanged', async () => {
    const subject = await harness()
    await subject.runtime.breakAudioTrack()
    await subject.runtime.diagnoseAndStageRecovery()
    subject.runtime.approvePlan()
    await subject.runtime.applyApprovedRecovery(subject.store.recoveryPlan.id)
    const first = subject.runtime.generateIncidentReport({ sessionId: subject.store.sessionId })
    const revision = subject.store.incidentRevision
    subject.store.recordInspectionEvent('State inspected', 'Read-only evidence inspected.')
    const repeated = subject.runtime.generateIncidentReport({ sessionId: subject.store.sessionId })

    expect(repeated).toEqual(first)
    expect(subject.store.incidentRevision).toBe(revision)
    expect(subject.store.timeline.filter((event) => event.type === 'report_generated')).toHaveLength(1)
  })

  it('uses success plus an explicit verdict for a completed partial verification', async () => {
    const subject = await harness({ unhealthyPhases: ['recovery_verification'] })
    await subject.runtime.breakAudioTrack()
    await subject.runtime.diagnoseAndStageRecovery()
    subject.runtime.approvePlan()
    const result = await subject.runtime.applyApprovedRecovery(subject.store.recoveryPlan.id)

    expect(result).toMatchObject({
      ok: true,
      recovered: false,
      verification: { verdict: 'partially_recovered' },
    })
    expect(result.error).toBeUndefined()
  })

  it('returns a stable error when scenario reset cannot verify healthy evidence', async () => {
    const subject = await harness({ unhealthyPhases: ['scenario_reset'] })
    await subject.runtime.breakAudioTrack()
    const result = await subject.runtime.resetScenario()

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VERIFICATION_INCOMPLETE' },
    })
    expect(subject.audio.enabled).toBe(true)
    expect(subject.store.state).toBe('critical')
    expect(subject.store.timeline.some((event) => event.title === 'Scenario reset to healthy')).toBe(false)
  })

  it('leaves a resettable critical state when the browser rejects reset mutation', async () => {
    const subject = await harness({
      mutateAudio(audio, enabled) {
        if (enabled) throw new Error('Injected reset mutation failure')
        audio.enabled = false
      },
    })
    await subject.runtime.breakAudioTrack()
    subject.store.beginDiagnosis()
    const result = await subject.runtime.resetScenario()

    expect(result).toMatchObject({ ok: false, error: { code: 'FAULT_MUTATION_FAILED' } })
    expect(subject.audio.enabled).toBe(false)
    expect(subject.store.state).toBe('critical')
    expect(subject.store.activeFault).toBe('disabled_audio')
    expect(subject.store.diagnosis).toBeNull()
    expect(subject.store.recoveryPlan).toBeNull()
  })
})
