import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecoveryPlanCountdown } from '../../src/features/recovery/composables/useRecoveryPlanCountdown.js'

describe('recovery plan countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('derives a decreasing whole-second value from the plan expiration timestamp', () => {
    const plan = ref({
      id: 'plan-a',
      status: 'staged',
      expires_at: '2026-09-02T10:01:30.000Z',
    })
    const scope = effectScope()
    const countdown = scope.run(() => useRecoveryPlanCountdown(plan))

    expect(countdown.remainingSeconds.value).toBe(90)
    expect(countdown.expiryText.value).toBe('Expires in 90 seconds')

    vi.advanceTimersByTime(1_000)
    expect(countdown.remainingSeconds.value).toBe(89)

    vi.advanceTimersByTime(4_000)
    expect(countdown.remainingSeconds.value).toBe(85)

    scope.stop()
  })

  it('reaches the expired state and stops its clock at the authoritative deadline', () => {
    const plan = ref({
      id: 'plan-a',
      status: 'approved',
      expires_at: '2026-09-02T10:00:02.000Z',
    })
    const scope = effectScope()
    const countdown = scope.run(() => useRecoveryPlanCountdown(plan))

    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(2_000)

    expect(countdown.remainingSeconds.value).toBe(0)
    expect(countdown.expired.value).toBe(true)
    expect(countdown.expiryText.value).toBe('Plan expired')
    expect(vi.getTimerCount()).toBe(0)

    scope.stop()
  })

  it('rebinds to a replacement plan and cleans up when the plan is cleared', async () => {
    const plan = ref({
      id: 'plan-a',
      status: 'staged',
      expires_at: '2026-09-02T10:01:30.000Z',
    })
    const scope = effectScope()
    const countdown = scope.run(() => useRecoveryPlanCountdown(plan))

    vi.advanceTimersByTime(5_000)
    expect(countdown.remainingSeconds.value).toBe(85)

    plan.value = {
      id: 'plan-b',
      status: 'staged',
      expires_at: '2026-09-02T10:01:35.000Z',
    }
    await nextTick()

    expect(countdown.remainingSeconds.value).toBe(90)
    expect(vi.getTimerCount()).toBe(1)

    plan.value = null
    await nextTick()
    expect(countdown.remainingSeconds.value).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    scope.stop()
  })

  it.each(['rejected', 'applied', 'verified'])(
    'stops updating after a plan becomes %s',
    async (status) => {
      const plan = ref({
        id: 'plan-a',
        status: 'staged',
        expires_at: '2026-09-02T10:01:30.000Z',
      })
      const scope = effectScope()
      scope.run(() => useRecoveryPlanCountdown(plan))

      plan.value.status = status
      await nextTick()

      expect(vi.getTimerCount()).toBe(0)
      scope.stop()
    },
  )

  it('does not start a clock for a plan that is already expired when rendered', () => {
    const plan = ref({
      id: 'late-plan',
      status: 'staged',
      expires_at: '2026-09-02T09:59:59.000Z',
    })
    const scope = effectScope()
    const countdown = scope.run(() => useRecoveryPlanCountdown(plan))

    expect(countdown.expiryText.value).toBe('Plan expired')
    expect(vi.getTimerCount()).toBe(0)

    scope.stop()
  })
})
