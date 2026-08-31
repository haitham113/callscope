import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLabController } from '../../src/features/lab/services/labController.js'
import { useLabStore } from '../../src/features/lab/stores/labStore.js'

describe('capability-scoped controllers', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps approval and lifecycle capabilities out of the WebMCP agent interface', () => {
    const controller = createLabController(useLabStore())

    expect(Object.keys(controller.agent)).toEqual([
      'getLabContext',
      'inspectCallState',
      'runDiagnostics',
      'stageRecoveryPlan',
      'applyRecoveryAction',
      'compareToFailureBaseline',
      'generateIncidentReport',
      'captureToolInvocation',
      'recordToolEvent',
    ])
    expect(controller.agent.approvePlan).toBeUndefined()
    expect(controller.agent.rejectPlan).toBeUndefined()
    expect(controller.agent.start).toBeUndefined()
    expect(controller.agent.end).toBeUndefined()
    expect(controller.agent.resetScenario).toBeUndefined()
    expect(controller.agent.breakAudioTrack).toBeUndefined()
    expect(Object.keys(controller.human)).toContain('approvePlan')
    expect(Object.keys(controller.human)).toContain('rejectPlan')
    expect(Object.isFrozen(controller.agent)).toBe(true)
    expect(Object.isFrozen(controller.human)).toBe(true)
  })

  it('rejects a tool event whose invocation ownership no longer matches', () => {
    const store = useLabStore()
    const controller = createLabController(store)
    store.beginSession()
    const oldInvocation = controller.agent.captureToolInvocation()
    store.faultRevision += 1

    expect(controller.agent.recordToolEvent('run_call_diagnostics', {
      ok: false,
      error: { code: 'OPERATION_CANCELLED' },
    }, oldInvocation)).toBe(false)
    expect(store.timeline.some(({ title }) => title === 'run_call_diagnostics')).toBe(false)
  })
})
