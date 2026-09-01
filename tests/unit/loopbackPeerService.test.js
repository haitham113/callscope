import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLoopbackPeerService } from '../../src/features/lab/services/loopbackPeerService.js'

class FakeStream {
  constructor(tracks = []) {
    this.tracks = [...tracks]
  }

  addTrack(track) { this.tracks.push(track) }
  getTracks() { return [...this.tracks] }
}

function installFakeRtc({
  pendingCandidates = false,
  failOneListenerRemoval = false,
  queueCandidateDuringStartup = false,
  addVideoDefaultsAfterWrite = false,
} = {}) {
  const instances = []
  instances.candidateAdds = 0
  let removalFailureAvailable = failOneListenerRemoval
  instances.failNextListenerRemoval = () => { removalFailureAvailable = true }

  class FakePeer {
    constructor() {
      this.connectionState = 'connected'
      this.iceConnectionState = 'connected'
      this.signalingState = 'stable'
      this.localDescription = null
      this.remoteDescription = null
      this.listeners = new Map()
      this.senders = []
      instances.push(this)
    }

    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) ?? new Set()
      handlers.add(handler)
      this.listeners.set(type, handlers)
    }

    removeEventListener(type, handler) {
      if (removalFailureAvailable) {
        removalFailureAvailable = false
        throw new Error('Injected listener cleanup failure')
      }
      this.listeners.get(type)?.delete(handler)
    }

    emit(type, event) {
      for (const handler of this.listeners.get(type) ?? []) handler(event)
    }

    addTrack(track) {
      let parameters = {
        encodings: track.kind === 'video'
          ? [{ active: true, scaleResolutionDownBy: 1 }]
          : [{}],
      }
      const sender = {
        track,
        getParameters() { return structuredClone(parameters) },
        async setParameters(next) {
          parameters = structuredClone(next)
          if (track.kind === 'video' && addVideoDefaultsAfterWrite) {
            parameters.encodings = parameters.encodings.map((encoding) => ({
              priority: 'low',
              networkPriority: 'low',
              ...encoding,
            }))
          }
        },
      }
      this.senders.push(sender)
      return sender
    }

    getSenders() { return [...this.senders] }
    getReceivers() { return [] }
    async createOffer() { return { type: 'offer', sdp: 'synthetic' } }
    async createAnswer() { return { type: 'answer', sdp: 'synthetic' } }
    async setLocalDescription(description) {
      this.localDescription = description
      if (queueCandidateDuringStartup && this === instances[0]) {
        this.emit('icecandidate', { candidate: { candidate: 'synthetic' } })
      }
    }
    async setRemoteDescription(description) { this.remoteDescription = description }
    addIceCandidate() {
      instances.candidateAdds += 1
      return pendingCandidates ? new Promise(() => {}) : Promise.resolve()
    }
    close() { this.connectionState = 'closed'; this.signalingState = 'closed' }
  }

  globalThis.window = { RTCPeerConnection: FakePeer }
  globalThis.RTCPeerConnection = FakePeer
  globalThis.MediaStream = FakeStream
  return instances
}

function sourceStream() {
  return new FakeStream([
    { id: 'audio-source', kind: 'audio', enabled: true, readyState: 'live', stop() { this.readyState = 'ended' } },
    { id: 'video-source', kind: 'video', enabled: true, readyState: 'live', stop() { this.readyState = 'ended' } },
  ])
}

afterEach(() => {
  vi.useRealTimers()
  delete globalThis.window
  delete globalThis.RTCPeerConnection
  delete globalThis.MediaStream
})

describe('loopback peer cleanup', () => {
  it('preserves the known-good video encoding profile and confirms cap and restore from fresh readback', async () => {
    const peers = installFakeRtc()
    const service = await createLoopbackPeerService(sourceStream())

    const capped = await service.applyVideoBitrateCap()
    expect(capped.previous_state).toMatchObject({
      max_bitrate_bps: null,
      bitrate_limited: false,
      readback_confirmed: true,
    })
    expect(capped.new_state).toMatchObject({
      max_bitrate_bps: 80_000,
      bitrate_limited: true,
      readback_confirmed: true,
    })

    const restored = await service.restoreVideoBitrateProfile()
    expect(restored.new_state).toMatchObject({
      max_bitrate_bps: null,
      bitrate_limited: false,
      readback_confirmed: true,
    })
    expect(service.getVideoSenderEncodingProfile()).toEqual([
      { active: true, scaleResolutionDownBy: 1 },
    ])

    const sender = peers[0].getSenders().find((item) => item.track.kind === 'video')
    const drifted = sender.getParameters()
    drifted.encodings[0].maxFramerate = 12
    await sender.setParameters(drifted)
    expect(service.getVideoSenderState()).toMatchObject({
      readback_confirmed: true,
      profile_restored: false,
    })
  })

  it('normalizes browser-reported encoding defaults without hiding material profile drift', async () => {
    installFakeRtc({ addVideoDefaultsAfterWrite: true })
    const service = await createLoopbackPeerService(sourceStream())

    await expect(service.applyVideoBitrateCap()).resolves.toMatchObject({
      new_state: { readback_confirmed: true, bitrate_limited: true },
    })
    await expect(service.restoreVideoBitrateProfile()).resolves.toMatchObject({
      new_state: { readback_confirmed: true, profile_restored: true },
    })
  })

  it('bounds pending ICE cleanup and reports the operation as still pending', async () => {
    vi.useFakeTimers()
    const peers = installFakeRtc({ pendingCandidates: true })
    const service = await createLoopbackPeerService(sourceStream(), undefined, {
      candidateDrainTimeoutMs: 25,
    })
    peers[0].emit('icecandidate', { candidate: { candidate: 'synthetic' } })

    const cleanupPromise = service.cleanup()
    await vi.advanceTimersByTimeAsync(25)

    await expect(cleanupPromise).resolves.toMatchObject({
      candidate_operations_pending: 1,
      peer_connections_closed: 2,
    })
  })

  it('retains a failed listener remover so cleanup can truthfully retry it', async () => {
    const peers = installFakeRtc()
    const service = await createLoopbackPeerService(sourceStream())
    peers.failNextListenerRemoval()

    await expect(service.cleanup()).resolves.toMatchObject({
      listeners_removed: false,
      cleanup_errors: 1,
    })
    await expect(service.cleanup()).resolves.toMatchObject({
      listeners_removed: true,
      cleanup_errors: 0,
    })
  })

  it('aborts startup while a queued ICE add remains browser-pending', async () => {
    const peers = installFakeRtc({ pendingCandidates: true, queueCandidateDuringStartup: true })
    const controller = new AbortController()
    const startup = createLoopbackPeerService(sourceStream(), controller.signal, {
      candidateDrainTimeoutMs: 25,
    })
    for (let attempt = 0; attempt < 20 && peers.candidateAdds === 0; attempt += 1) {
      await Promise.resolve()
    }
    expect(peers.candidateAdds).toBe(1)

    controller.abort('Synthetic reset')

    await expect(startup).rejects.toMatchObject({ name: 'AbortError' })
  })
})
