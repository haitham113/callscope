import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLabController } from '../../src/features/lab/services/labController.js'
import { useLabStore } from '../../src/features/lab/stores/labStore.js'

describe('capability-scoped controllers', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps approval and lifecycle capabilities out of the future agent interface', () => {
    const controller = createLabController(useLabStore())

    expect(Object.keys(controller.agent)).toEqual([
      'runDiagnostics',
      'stageRecoveryPlan',
      'applyRecoveryAction',
      'generateIncidentReport',
    ])
    expect(controller.agent.approvePlan).toBeUndefined()
    expect(controller.agent.rejectPlan).toBeUndefined()
    expect(controller.agent.start).toBeUndefined()
    expect(Object.keys(controller.human)).toContain('approvePlan')
    expect(Object.keys(controller.human)).toContain('rejectPlan')
    expect(Object.isFrozen(controller.agent)).toBe(true)
    expect(Object.isFrozen(controller.human)).toBe(true)
  })
})
