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

export async function createLoopbackPeerService(sourceStream, signal) {
  if (!window.RTCPeerConnection) {
    throw new Error('RTCPeerConnection is unavailable in this browser.')
  }

  const outboundPeer = new RTCPeerConnection({ iceServers: [] })
  const inboundPeer = new RTCPeerConnection({ iceServers: [] })
  const remoteStream = new MediaStream()
  const listeners = []
  const candidateErrors = []
  const pendingForOutbound = []
  const pendingForInbound = []
  let cleaned = false

  function listen(target, type, handler) {
    target.addEventListener(type, handler)
    listeners.push(() => target.removeEventListener(type, handler))
  }

  function relayCandidate(targetPeer, pending) {
    return (event) => {
      if (!event.candidate || targetPeer.signalingState === 'closed') return
      if (!targetPeer.remoteDescription) {
        pending.push(event.candidate)
        return
      }
      void targetPeer
        .addIceCandidate(event.candidate)
        .catch((error) => candidateErrors.push(error.name))
    }
  }

  async function flushCandidates(targetPeer, pending) {
    for (const candidate of pending.splice(0)) {
      try {
        await targetPeer.addIceCandidate(candidate)
      } catch (error) {
        candidateErrors.push(error.name)
      }
    }
  }

  listen(outboundPeer, 'icecandidate', relayCandidate(inboundPeer, pendingForInbound))
  listen(inboundPeer, 'icecandidate', relayCandidate(outboundPeer, pendingForOutbound))
  listen(inboundPeer, 'track', (event) => {
    if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
      remoteStream.addTrack(event.track)
    }
  })

  try {
    signal?.throwIfAborted()
    sourceStream.getTracks().forEach((track) => outboundPeer.addTrack(track, sourceStream))

    const offer = await outboundPeer.createOffer()
    signal?.throwIfAborted()
    await outboundPeer.setLocalDescription(offer)
    await inboundPeer.setRemoteDescription(offer)
    await flushCandidates(inboundPeer, pendingForInbound)
    const answer = await inboundPeer.createAnswer()
    await inboundPeer.setLocalDescription(answer)
    await outboundPeer.setRemoteDescription(answer)
    await flushCandidates(outboundPeer, pendingForOutbound)
    await waitForConnected(outboundPeer, inboundPeer, 12_000, signal)
  } catch (error) {
    listeners.splice(0).forEach((remove) => remove())
    remoteStream.getTracks().forEach((track) => track.stop())
    outboundPeer.close()
    inboundPeer.close()
    throw error
  }

  function getSanitizedStatus() {
    const senderTracks = outboundPeer.getSenders().map((sender) => sender.track)
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
      candidate_exchange_errors: candidateErrors.length,
    }
  }

  async function cleanup() {
    if (cleaned) {
      return {
        peer_connections_total: 2,
        peer_connections_closed: 2,
        remote_tracks_total: remoteStream.getTracks().length,
        remote_tracks_ended: remoteStream
          .getTracks()
          .filter((track) => track.readyState === 'ended').length,
        listeners_removed: true,
      }
    }
    cleaned = true
    listeners.splice(0).forEach((remove) => remove())
    const remoteTracks = remoteStream.getTracks()
    remoteTracks.forEach((track) => track.stop())
    outboundPeer.getSenders().forEach((sender) => sender.track?.stop())
    outboundPeer.close()
    inboundPeer.close()
    await Promise.resolve()

    return {
      peer_connections_total: 2,
      peer_connections_closed: [outboundPeer, inboundPeer].filter(
        (peer) => peer.connectionState === 'closed',
      ).length,
      remote_tracks_total: remoteTracks.length,
      remote_tracks_ended: remoteTracks.filter(
        (track) => track.readyState === 'ended',
      ).length,
      listeners_removed: listeners.length === 0,
      candidate_exchange_errors: candidateErrors.length,
    }
  }

  return {
    outboundPeer,
    inboundPeer,
    remoteStream,
    getSanitizedStatus,
    getVideoSender() {
      return outboundPeer.getSenders().find((sender) => sender.track?.kind === 'video')
    },
    cleanup,
  }
}
