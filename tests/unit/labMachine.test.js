import { describe, expect, it } from 'vitest'
import { assertTransition, canTransition } from '../../src/features/lab/labMachine.js'

describe('lab state machine', () => {
  it('allows the Milestone 1 lifecycle and restart path', () => {
    expect(canTransition('idle', 'starting')).toBe(true)
    expect(canTransition('starting', 'healthy')).toBe(true)
    expect(canTransition('healthy', 'ended')).toBe(true)
    expect(canTransition('ended', 'starting')).toBe(true)
  })

  it('rejects states that would claim health without startup evidence', () => {
    expect(canTransition('idle', 'healthy')).toBe(false)
    expect(() => assertTransition('idle', 'healthy')).toThrow(
      'Invalid lab transition: idle -> healthy',
    )
  })

  it('supports partial-start failure and a clean retry', () => {
    expect(canTransition('starting', 'failed')).toBe(true)
    expect(canTransition('failed', 'starting')).toBe(true)
  })
})
