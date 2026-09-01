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

  it('bounds teardown when a browser stats promise never settles', async () => {
    vi.useFakeTimers()
    try {
      const neverSettles = new Promise(() => {})
      const peer = { getStats: vi.fn(() => neverSettles) }
      const sampler = createStatsSampler({
        outboundPeer: peer,
        inboundPeer: peer,
        drainTimeoutMs: 25,
      })

      void sampler.sample()
      const stopPromise = sampler.stop()
      await vi.advanceTimersByTimeAsync(25)

      await expect(stopPromise).resolves.toEqual({
        sampler_active: false,
        sampling_in_flight: true,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the caller wait while retaining truthful pending-browser evidence', async () => {
    vi.useFakeTimers()
    try {
      const neverSettles = new Promise(() => {})
      const peer = { getStats: vi.fn(() => neverSettles) }
      const controller = new AbortController()
      const sampler = createStatsSampler({
        outboundPeer: peer,
        inboundPeer: peer,
        drainTimeoutMs: 25,
      })

      const sample = sampler.sample({ notify: false, signal: controller.signal })
      controller.abort('Synthetic reset')
      await expect(sample).rejects.toMatchObject({ name: 'AbortError' })

      const stopPromise = sampler.stop()
      await vi.advanceTimersByTimeAsync(25)
      await expect(stopPromise).resolves.toMatchObject({ sampling_in_flight: true })
    } finally {
      vi.useRealTimers()
    }
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

  it('reduces the selected ICE path to safe candidate categories only', async () => {
    const outboundReport = new Map([
      ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
      ['pair', { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
      ['local', {
        id: 'local',
        type: 'local-candidate',
        candidateType: 'host',
        protocol: 'udp',
        address: '192.0.2.10',
        port: 54321,
      }],
      ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'relay', protocol: 'udp' }],
    ])
    const sampler = createStatsSampler({
      outboundPeer: { getStats: async () => outboundReport },
      inboundPeer: { getStats: async () => new Map() },
    })

    const sample = await sampler.sample({ notify: false })

    expect(sample.selectedCandidate).toEqual({
      type: 'host',
      protocol: 'udp',
      path: 'relayed',
      relayed: true,
    })
    expect(JSON.stringify(sample)).not.toContain('192.0.2.10')
    expect(JSON.stringify(sample)).not.toContain('54321')
  })

  it('keeps direct/relayed unavailable when candidate types are not exposed', async () => {
    const report = new Map([
      ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
      ['pair', { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
      ['local', { id: 'local', type: 'local-candidate' }],
      ['remote', { id: 'remote', type: 'remote-candidate' }],
    ])
    const sampler = createStatsSampler({
      outboundPeer: { getStats: async () => report },
      inboundPeer: { getStats: async () => new Map() },
    })

    expect((await sampler.sample({ notify: false })).selectedCandidate).toEqual({
      type: null,
      protocol: null,
      path: null,
      relayed: null,
    })
  })
})
