import { describe, expect, it, vi } from 'vitest'
import { createStatsSampler } from '../../src/features/diagnostics/services/statsSampler.js'

describe('stats sampler lifecycle', () => {
  it('drains an in-flight browser sample before reporting stopped', async () => {
    let resolveStats
    const statsPromise = new Promise((resolve) => {
      resolveStats = resolve
    })
    const peer = { getStats: vi.fn(() => statsPromise) }
    const onSample = vi.fn()
    const sampler = createStatsSampler({
      outboundPeer: peer,
      inboundPeer: peer,
      onSample,
    })

    void sampler.sample()
    const stopPromise = sampler.stop()
    let stopSettled = false
    void stopPromise.then(() => {
      stopSettled = true
    })
    await Promise.resolve()
    expect(stopSettled).toBe(false)

    resolveStats(new Map())
    await expect(stopPromise).resolves.toEqual({
      sampler_active: false,
      sampling_in_flight: false,
    })
    expect(onSample).not.toHaveBeenCalled()
  })

  it('routes scheduled sampling failures without an unhandled rejection', async () => {
    vi.useFakeTimers()
    const failure = new Error('stats failed')
    const onError = vi.fn()
    const peer = { getStats: vi.fn(() => Promise.reject(failure)) }
    const sampler = createStatsSampler({
      outboundPeer: peer,
      inboundPeer: peer,
      onError,
    })

    sampler.start(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onError).toHaveBeenCalledWith(failure)
    await sampler.stop()
    vi.useRealTimers()
  })

  it('can return an owned sample without publishing it before caller revalidation', async () => {
    const samples = []
    const report = new Map()
    const sampler = createStatsSampler({
      outboundPeer: { getStats: async () => report },
      inboundPeer: { getStats: async () => report },
      onSample: (sample) => samples.push(sample),
    })

    const sample = await sampler.sample({ notify: false })

    expect(sample).toBeTruthy()
    expect(samples).toEqual([])
    await sampler.stop()
  })
})
