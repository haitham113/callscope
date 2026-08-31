import { serviceError } from '../../../shared/errors/serviceErrors.js'

function abortableOperation(operation, signal) {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(new DOMException('Lab startup was cancelled.', 'AbortError'))
  return new Promise((resolve, reject) => {
    function abort() {
      reject(new DOMException('Lab startup was cancelled.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

function waitForConnected(outboundPeer, inboundPeer, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let timeoutId

    function isConnected(peer) {
      return peer.connectionState === 'connected'
    }

    function cleanupListeners() {
      clearTimeout(timeoutId)
      outboundPeer.removeEventListener('connectionstatechange', check)
      inboundPeer.removeEventListener('connectionstatechange', check)
      signal?.removeEventListener('abort', abort)
    }

    function check() {
      if (isConnected(outboundPeer) && isConnected(inboundPeer)) {
        cleanupListeners()
        resolve()
        return
      }
      const states = [outboundPeer.connectionState, inboundPeer.connectionState]
      if (states.some((state) => state === 'failed' || state === 'closed')) {
        cleanupListeners()
        reject(new Error(`Peer connection failed (${states.join(', ')}).`))
      }
    }

    function abort() {
      cleanupListeners()
      reject(new DOMException('Lab startup was cancelled.', 'AbortError'))
    }

    if (signal?.aborted) {
      abort()
      return
    }
    timeoutId = setTimeout(() => {
      cleanupListeners()
      reject(new Error('Timed out while connecting the in-page peers.'))
    }, timeoutMs)
    outboundPeer.addEventListener('connectionstatechange', check)
    inboundPeer.addEventListener('connectionstatechange', check)
    signal?.addEventListener('abort', abort, { once: true })
    check()
  })
}

export async function createLoopbackPeerService(sourceStream, signal, { candidateDrainTimeoutMs = 2000 } = {}) {
  if (!window.RTCPeerConnection) {
    throw serviceError('MEDIA_CAPABILITY_UNSUPPORTED')
  }

  const outboundPeer = new RTCPeerConnection({ iceServers: [] })
  const inboundPeer = new RTCPeerConnection({ iceServers: [] })
  const remoteStream = new MediaStream()
  const listeners = []
  const candidateErrors = []
  let cleanupErrors = []
  const candidateOperations = new Set()
  const pendingForOutbound = []
  const pendingForInbound = []
  const observedRemoteTrackIds = new Set()

  function listen(target, type, handler) {
    target.addEventListener(type, handler)
    listeners.push(() => target.removeEventListener(type, handler))
  }

  function trackCandidateOperation(operation) {
    const trackedOperation = operation
      .catch((error) => candidateErrors.push(error.name))
      .finally(() => candidateOperations.delete(trackedOperation))
    candidateOperations.add(trackedOperation)
    return trackedOperation
  }

  function relayCandidate(targetPeer, pending) {
    return (event) => {
      if (!event.candidate || targetPeer.signalingState === 'closed') return
      if (!targetPeer.remoteDescription) {
        pending.push(event.candidate)
        return
      }
      void trackCandidateOperation(targetPeer.addIceCandidate(event.candidate))
    }
  }

  function flushCandidates(targetPeer, pending) {
    for (const candidate of pending.splice(0)) {
      void trackCandidateOperation(targetPeer.addIceCandidate(candidate))
    }
  }

  async function settleCandidateOperations({ timeoutMs = candidateDrainTimeoutMs, abortSignal } = {}) {
    const deadline = Date.now() + timeoutMs
    while (candidateOperations.size > 0) {
      abortSignal?.throwIfAborted()
      const remaining = Math.max(0, deadline - Date.now())
      const settled = await new Promise((resolve, reject) => {
        let finished = false
        function finish(callback, value) {
          if (finished) return
          finished = true
          clearTimeout(timeoutId)
          abortSignal?.removeEventListener('abort', abort)
          callback(value)
        }
        function abort() {
          finish(reject, new DOMException('Lab startup was cancelled.', 'AbortError'))
        }
        const timeoutId = setTimeout(() => finish(resolve, false), remaining)
        abortSignal?.addEventListener('abort', abort, { once: true })
        Promise.allSettled([...candidateOperations]).then(() => finish(resolve, true))
        if (abortSignal?.aborted) abort()
      })
      if (!settled) return false
    }
    return true
  }

  listen(outboundPeer, 'icecandidate', relayCandidate(inboundPeer, pendingForInbound))
  listen(inboundPeer, 'icecandidate', relayCandidate(outboundPeer, pendingForOutbound))
  listen(inboundPeer, 'track', (event) => {
    observedRemoteTrackIds.add(event.track.id)
    if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
      remoteStream.addTrack(event.track)
    }
  })

  try {
    signal?.throwIfAborted()
    sourceStream.getTracks().forEach((track) => outboundPeer.addTrack(track, sourceStream))

    const offer = await abortableOperation(outboundPeer.createOffer(), signal)
    signal?.throwIfAborted()
    await abortableOperation(outboundPeer.setLocalDescription(offer), signal)
    await abortableOperation(inboundPeer.setRemoteDescription(offer), signal)
    await flushCandidates(inboundPeer, pendingForInbound)
    const answer = await abortableOperation(inboundPeer.createAnswer(), signal)
    await abortableOperation(inboundPeer.setLocalDescription(answer), signal)
    await abortableOperation(outboundPeer.setRemoteDescription(answer), signal)
    await flushCandidates(outboundPeer, pendingForOutbound)
    await waitForConnected(outboundPeer, inboundPeer, 12_000, signal)
    if (!await settleCandidateOperations({ abortSignal: signal })) {
      throw new Error('Timed out while settling in-memory ICE candidate operations.')
    }
  } catch (error) {
    error.peerCleanupReceipt = await cleanup()
    error.retryPeerCleanup = cleanup
    throw error
  }

  function getSanitizedStatus() {
    const senderTracks = outboundPeer.getSenders().map((sender) => sender.track)
    const receiverTracks = inboundPeer
      .getReceivers()
      .map((receiver) => receiver.track)
      .filter(Boolean)
    const tracks = Object.fromEntries(
      ['audio', 'video'].map((kind) => {
        const track = sourceStream.getTracks().find((item) => item.kind === kind)
        return [
          kind,
          {
            readyState: track?.readyState ?? 'unavailable',
            enabled: track?.enabled ?? null,
            attached: Boolean(track && senderTracks.includes(track)),
          },
        ]
      }),
    )
    const receivers = Object.fromEntries(
      ['audio', 'video'].map((kind) => {
        const track = receiverTracks.find((item) => item.kind === kind)
        return [
          kind,
          {
            readyState: track?.readyState ?? 'unavailable',
          },
        ]
      }),
    )
    const iceStates = [outboundPeer.iceConnectionState, inboundPeer.iceConnectionState]
    return {
      connection: {
        outbound: outboundPeer.connectionState,
        inbound: inboundPeer.connectionState,
        ice: iceStates.every((state) => ['connected', 'completed'].includes(state))
          ? 'connected'
          : iceStates.join(' / '),
      },
      tracks,
      receivers,
      candidate_exchange_errors: candidateErrors.length,
      candidate_operations_pending: candidateOperations.size,
    }
  }

  function collectRemoteTracks() {
    return [
      ...new Map(
        [
          ...remoteStream.getTracks(),
          ...inboundPeer
            .getReceivers()
            .map((receiver) => receiver.track)
            .filter(Boolean),
        ].map((track) => [track.id, track]),
      ).values(),
    ]
  }

  function createCleanupReceipt() {
    const remoteTracks = collectRemoteTracks()
    return {
      peer_connections_total: 2,
      peer_connections_closed: [outboundPeer, inboundPeer].filter(
        (peer) => peer.connectionState === 'closed',
      ).length,
      remote_tracks_expected: observedRemoteTrackIds.size,
      remote_tracks_total: remoteTracks.length,
      remote_tracks_ended: remoteTracks.filter(
        (track) => track.readyState === 'ended',
      ).length,
      listeners_removed: listeners.length === 0,
      candidate_exchange_errors: candidateErrors.length,
      candidate_operations_pending: candidateOperations.size,
      cleanup_errors: cleanupErrors.length,
    }
  }

  async function cleanup() {
    cleanupErrors = []
    for (const remove of [...listeners]) {
      try {
        remove()
        listeners.splice(listeners.indexOf(remove), 1)
      } catch (error) {
        cleanupErrors.push(error.name)
      }
    }
    const remoteTracks = collectRemoteTracks()
    remoteTracks.forEach((track) => {
      try { track.stop() } catch (error) { cleanupErrors.push(error.name) }
    })
    outboundPeer.getSenders().forEach((sender) => {
      try { sender.track?.stop() } catch (error) { cleanupErrors.push(error.name) }
    })
    for (const peer of [outboundPeer, inboundPeer]) {
      try { peer.close() } catch (error) { cleanupErrors.push(error.name) }
    }
    await settleCandidateOperations()
    await Promise.resolve()

    return createCleanupReceipt()
  }

  return {
    outboundPeer,
    inboundPeer,
    remoteStream,
    getSanitizedStatus,
    getVideoSender() {
      return outboundPeer.getSenders().find((sender) => sender.track?.kind === 'video')
    },
    getOutboundTrackStatus(kind) {
      const track = sourceStream.getTracks().find((item) => item.kind === kind)
      const sender = outboundPeer.getSenders().find((item) => item.track === track)
      return {
        ready_state: track?.readyState ?? 'unavailable',
        enabled: track?.enabled ?? null,
        attached: Boolean(track && sender?.track === track),
      }
    },
    setOutboundTrackEnabled(kind, enabled) {
      const track = sourceStream.getTracks().find((item) => item.kind === kind)
      const sender = outboundPeer.getSenders().find((item) => item.track === track)
      if (!track || !sender || track.readyState !== 'live') {
        throw new Error(`The outbound ${kind} track is not live and attached.`)
      }
      track.enabled = enabled
      return this.getOutboundTrackStatus(kind)
    },
    cleanup,
  }
}
