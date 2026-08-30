import { describe, expect, it } from 'vitest'
import { createOperationCoordinator } from '../../src/shared/async/operationCoordinator.js'

describe('abortable operation ownership', () => {
  it('allows only one diagnostic or verification sampling window at a time', () => {
    const identity = { sessionId: 'session-1', sessionEpoch: 3, faultRevision: 2 }
    const coordinator = createOperationCoordinator({ readIdentity: () => identity })
    const diagnostic = coordinator.beginSamplingWindow('diagnostic')
    const duplicate = coordinator.beginSamplingWindow('verification')

    expect(diagnostic.ok).toBe(true)
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'INVALID_STATE_TRANSITION' } })
    expect(coordinator.finish(diagnostic.operation)).toBe(true)
    expect(coordinator.beginSamplingWindow('verification').ok).toBe(true)
  })

  it('invalidates ownership after cancellation or any bound identity change', () => {
    const identity = { sessionId: 'session-1', sessionEpoch: 3, faultRevision: 2 }
    const coordinator = createOperationCoordinator({ readIdentity: () => identity })
    const first = coordinator.beginSamplingWindow('diagnostic').operation
    expect(coordinator.isCurrent(first)).toBe(true)
    identity.faultRevision += 1
    expect(coordinator.isCurrent(first)).toBe(false)

    coordinator.finish(first)
    const second = coordinator.beginSamplingWindow('verification').operation
    coordinator.cancelAll()
    expect(second.signal.aborted).toBe(true)
    expect(coordinator.isCurrent(second)).toBe(false)
  })
})
