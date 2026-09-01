import { describe, expect, it, vi } from 'vitest'
import { TOOL_NAMES } from '../../src/features/webmcp/toolSchemas.js'
import { registerCallScopeTools } from '../../src/features/webmcp/toolRegistry.js'

function agentCapabilities() {
  return Object.freeze({
    getLabContext: vi.fn(() => ({ ok: true })),
    inspectCallState: vi.fn(() => ({ ok: true })),
    runDiagnostics: vi.fn(() => ({ ok: true, diagnosis: { id: 'd', findings: [], allowed_actions: [] }, snapshot: { metrics: {} } })),
    stageRecoveryPlan: vi.fn(() => ({ ok: true, plan: { id: 'p', status: 'staged' } })),
    applyRecoveryAction: vi.fn(() => ({ ok: true })),
    compareToFailureBaseline: vi.fn(() => ({ ok: true, verification: { limitations: [] } })),
    generateIncidentReport: vi.fn(() => ({ ok: true, report: { id: 'r' } })),
    captureToolInvocation: vi.fn(() => ({
      sessionId: 'session-1',
      sessionEpoch: 1,
      faultRevision: 1,
    })),
    recordToolEvent: vi.fn(),
  })
}

describe('WebMCP lifecycle registration', () => {
  it('feature-detects support and leaves unsupported manual environments untouched', async () => {
    const result = await registerCallScopeTools({ documentRef: {}, agent: agentCapabilities() })
    expect(result).toMatchObject({ supported: false, toolNames: [] })
    expect(result.error).toMatchObject({ ok: false, error: { code: 'WEBMCP_UNSUPPORTED' } })
  })

  it('registers exactly seven tools with one abort signal and prevents remount duplicates', async () => {
    const registrations = []
    const modelContext = {
      registerTool: vi.fn((tool, options) => registrations.push({ tool, options })),
    }
    const documentRef = { modelContext }
    const first = await registerCallScopeTools({ documentRef, agent: agentCapabilities() })
    const second = await registerCallScopeTools({ documentRef, agent: agentCapabilities() })

    expect(first.signal.aborted).toBe(true)
    expect(second.supported).toBe(true)
    expect(second.toolNames).toEqual(TOOL_NAMES)
    expect(modelContext.registerTool).toHaveBeenCalledTimes(14)
    const current = registrations.slice(-7)
    expect(current.map(({ tool }) => tool.name)).toEqual(TOOL_NAMES)
    expect(new Set(current.map(({ options }) => options.signal))).toEqual(new Set([second.signal]))
    expect(current.every(({ tool }) => typeof tool.execute === 'function')).toBe(true)

    second.dispose()
    expect(second.signal.aborted).toBe(true)
    second.dispose()
  })

  it('does not report readiness when asynchronous registration rejects', async () => {
    const modelContext = {
      registerTool: vi.fn(() => Promise.reject(new Error('registration rejected'))),
    }

    const result = await registerCallScopeTools({
      documentRef: { modelContext },
      agent: agentCapabilities(),
    })

    expect(result).toMatchObject({
      supported: false,
      toolNames: [],
      error: { ok: false, error: { code: 'WEBMCP_REGISTRATION_FAILED' } },
    })
  })

  it('aborts an in-flight registration on unmount and lets a remount replace it once', async () => {
    let finishFirstRegistration
    const firstRegistration = new Promise((resolve) => { finishFirstRegistration = resolve })
    const registrations = []
    const modelContext = {
      registerTool: vi.fn((tool, options) => {
        registrations.push({ tool, options })
        if (registrations.length === 1) return firstRegistration
        return undefined
      }),
    }
    const lifecycle = new AbortController()
    const firstPending = registerCallScopeTools({
      documentRef: { modelContext },
      agent: agentCapabilities(),
      lifecycleSignal: lifecycle.signal,
    })

    lifecycle.abort('component unmounted')
    const second = await registerCallScopeTools({
      documentRef: { modelContext },
      agent: agentCapabilities(),
    })
    finishFirstRegistration()
    const first = await firstPending

    expect(first).toMatchObject({
      supported: false,
      error: { ok: false, error: { code: 'OPERATION_CANCELLED' } },
    })
    expect(registrations[0].options.signal.aborted).toBe(true)
    expect(second.supported).toBe(true)
    expect(registrations.filter(({ options }) => !options.signal.aborted)).toHaveLength(7)
    second.dispose()
  })
})
