import { describe, expect, it, vi } from 'vitest'
import { containsSensitiveData } from '../../src/features/diagnostics/services/sanitizer.js'
import { createWebMcpToolHandlers } from '../../src/features/webmcp/toolHandlers.js'

function capabilities(overrides = {}) {
  return Object.freeze({
    getLabContext: vi.fn(() => ({
      ok: true,
      session_id: 'session-1',
      lab_state: 'critical',
      health_status: 'Critical',
      active_fault: 'disabled_audio',
      pending_plan_id: null,
      pending_plan_status: null,
      webmcp_supported: true,
    })),
    inspectCallState: vi.fn(() => ({
      ok: true,
      session_id: 'session-1',
      snapshot_at: '2026-08-31T10:00:00.000Z',
      connection: { outbound: 'connected', inbound: 'connected', ice: 'connected' },
      selected_candidate: { type: null, protocol: null, relayed: null },
      tracks: { audio: { ready_state: 'live', enabled: false, attached: true } },
      senders: { audio: { attached: true, max_bitrate_bps: null } },
      receivers: { audio: { ready_state: 'live' } },
      health: { status: 'critical', score: 55, deductions: [] },
      active_fault: 'disabled_audio',
      limitations: ['Selected candidate details are unavailable.'],
    })),
    runDiagnostics: vi.fn(async () => ({
      ok: true,
      diagnosis: {
        id: 'diagnosis-1',
        allowed_actions: ['enable_audio_track'],
        findings: [{
          rank: 1,
          severity: 'critical',
          confidence: 'high',
          evidence: [{ field: 'tracks.audio.enabled', value: false, role: 'primary' }],
          limitations: ['Audio energy varies by browser.'],
          allowed_actions: ['enable_audio_track'],
        }],
      },
      metrics_at_start: { audio_energy_delta: null },
      snapshot: { metrics: { audio_energy_delta: null } },
    })),
    stageRecoveryPlan: vi.fn(() => ({
      ok: true,
      plan: {
        id: 'plan-1',
        status: 'staged',
        risk: 'low',
        reversible: true,
        expires_at: '2026-08-31T10:01:30.000Z',
      },
    })),
    applyRecoveryAction: vi.fn(async () => ({
      ok: true,
      action: 'enable_audio_track',
      previous_state: { ready_state: 'live', enabled: false, attached: true },
      new_state: { ready_state: 'live', enabled: true, attached: true },
      stabilization_wait_ms: 1150,
    })),
    compareToFailureBaseline: vi.fn(async () => ({
      ok: true,
      verification: {
        verdict: 'recovered',
        before: { health_status: 'critical', health_score: 55 },
        after: { health_status: 'healthy', health_score: 100 },
        health_score_delta: 45,
        primary_checks: { actual_track_changed_false_to_true: true },
        limitations: ['Audio energy is supporting evidence only.'],
      },
    })),
    generateIncidentReport: vi.fn(() => ({
      ok: true,
      report: {
        id: 'report-1',
        session_id: 'session-1',
        root_cause: 'Peer 10.0.0.9 exposed SDP v=0',
        sanitization: { raw_ip_addresses_excluded: true },
      },
    })),
    captureToolInvocation: vi.fn(() => ({
      sessionId: 'session-1',
      sessionEpoch: 1,
      faultRevision: 1,
    })),
    recordToolEvent: vi.fn(),
    ...overrides,
  })
}

describe('WebMCP tool handlers', () => {
  it('validates input before delegation and records the rejected exact tool name', async () => {
    const agent = capabilities()
    const handlers = createWebMcpToolHandlers(agent)

    const result = await handlers.run_call_diagnostics({
      session_id: 'session-1',
      symptom: 'not-an-enum',
      actor: 'User',
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_TOOL_INPUT' } })
    expect(agent.runDiagnostics).not.toHaveBeenCalled()
    expect(agent.recordToolEvent).toHaveBeenCalledWith(
      'run_call_diagnostics',
      result,
      { sessionId: 'session-1', sessionEpoch: 1, faultRevision: 1 },
    )
  })

  it('maps snake-case inputs to the shared services and returns only concise contract output', async () => {
    const agent = capabilities()
    const handlers = createWebMcpToolHandlers(agent)

    const diagnosis = await handlers.run_call_diagnostics({
      session_id: 'session-1',
      symptom: 'silent_audio',
      sample_duration_ms: 1000,
    })
    const staged = await handlers.stage_recovery_plan({
      session_id: 'session-1',
      diagnosis_id: 'diagnosis-1',
      action: 'enable_audio_track',
      reason: 'Fresh track evidence confirms disabled audio.',
      expected_result: 'Restore outbound audio.',
    })

    expect(agent.runDiagnostics).toHaveBeenCalledWith({
      sessionId: 'session-1',
      symptom: 'silent_audio',
      sampleDurationMs: 1000,
    })
    expect(diagnosis).toMatchObject({
      ok: true,
      diagnosis_id: 'diagnosis-1',
      needed_ids: { session_id: 'session-1', diagnosis_id: 'diagnosis-1' },
      suggested_next_tools: ['stage_recovery_plan'],
    })
    expect(diagnosis.snapshot).toBeUndefined()
    expect(staged).toMatchObject({
      ok: true,
      plan_id: 'plan-1',
      status: 'staged',
      approval_applies_repair: false,
      suggested_next_tools: ['apply_recovery_action'],
    })
  })

  it('recursively sanitizes all success output including report data', async () => {
    const agent = capabilities()
    const handlers = createWebMcpToolHandlers(agent)

    const result = await handlers.generate_incident_report({
      session_id: 'session-1',
      format: 'summary',
    })

    expect(result.sections.root_cause).toBe('[redacted protocol description]')
    expect(containsSensitiveData(result)).toBe(false)
  })

  it('rejects unsafe capability objects that expose approval', () => {
    expect(() => createWebMcpToolHandlers({
      ...capabilities(),
      approvePlan: vi.fn(),
    })).toThrow(/approval capabilities/i)
  })

  it('binds late tool-event recording to the ownership captured before delegation', async () => {
    let finishDiagnosis
    const diagnosisGate = new Promise((resolve) => { finishDiagnosis = resolve })
    const agent = capabilities({
      captureToolInvocation: vi.fn(() => ({
        sessionId: 'session-old',
        sessionEpoch: 4,
        faultRevision: 2,
      })),
      runDiagnostics: vi.fn(() => diagnosisGate),
    })
    const handlers = createWebMcpToolHandlers(agent)
    const pending = handlers.run_call_diagnostics({
      session_id: 'session-old',
      symptom: 'silent_audio',
    })

    finishDiagnosis({ ok: false, error: { code: 'OPERATION_CANCELLED' } })
    const result = await pending

    expect(result).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } })
    expect(agent.recordToolEvent).toHaveBeenCalledWith(
      'run_call_diagnostics',
      result,
      { sessionId: 'session-old', sessionEpoch: 4, faultRevision: 2 },
    )
  })
})
