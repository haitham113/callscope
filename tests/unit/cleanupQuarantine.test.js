import { describe, expect, it } from 'vitest'
import { createCleanupQuarantine } from '../../src/features/lab/services/cleanupQuarantine.js'

describe('stale cleanup quarantine', () => {
  it('retains retry authority until an incomplete orphan cleanup succeeds', async () => {
    let attempts = 0
    const quarantine = createCleanupQuarantine()
    const first = await quarantine.track(async () => {
      attempts += 1
      return { complete: attempts > 1 }
    })

    expect(first).toEqual({ complete: false })
    expect(quarantine.pendingCount()).toBe(1)

    await expect(quarantine.drain()).resolves.toEqual({ complete: true, pending: 0 })
    expect(attempts).toBe(2)
    expect(quarantine.pendingCount()).toBe(0)
  })

  it('counts in-flight cleanup immediately and joins it during drain', async () => {
    let release
    let attempts = 0
    const gate = new Promise((resolve) => { release = resolve })
    const quarantine = createCleanupQuarantine()
    const tracked = quarantine.track(async () => {
      attempts += 1
      await gate
      return { complete: true }
    })

    expect(quarantine.pendingCount()).toBe(1)
    const drained = quarantine.drain()
    expect(attempts).toBe(1)
    release()

    await expect(tracked).resolves.toEqual({ complete: true })
    await expect(drained).resolves.toEqual({ complete: true, pending: 0 })
    expect(attempts).toBe(1)
  })
})
