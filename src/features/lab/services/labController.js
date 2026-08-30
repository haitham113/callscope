import { evaluateHealthyEvidence, deriveMetrics } from '../../diagnostics/services/healthEngine.js'
import { createStatsSampler } from '../../diagnostics/services/statsSampler.js'
import { createDemoMedia } from './demoMediaService.js'
import { createLoopbackPeerService } from './loopbackPeerService.js'

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    function onAbort() {
      clearTimeout(timeoutId)
      reject(new DOMException('Operation cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createLabController(store) {
  let media = null
  let peers = null
  let sampler = null
  let startAbortController = null
  let elapsedIntervalId = null
  let previousSample = null
  let currentSample = null
  let remoteVideoElement = null
  let cleanupPromise = null
  let ending = false
  let consecutiveUnhealthySamples = 0
  let healthFailureScheduled = false

  function activeSessionMatches(sessionId) {
    return (
      !ending &&
      store.sessionId === sessionId &&
      ['starting', 'healthy'].includes(store.state)
    )
  }

  function stopElapsedTimer() {
    if (elapsedIntervalId !== null) clearInterval(elapsedIntervalId)
    elapsedIntervalId = null
  }

  function beginElapsedTimer(sessionId) {
    stopElapsedTimer()
    elapsedIntervalId = setInterval(() => {
      if (!activeSessionMatches(sessionId) || !store.startedAt) return
      store.elapsedSeconds = Math.max(
        0,
        Math.floor((Date.now() - Date.parse(store.startedAt)) / 1000),
      )
    }, 1000)
  }

  function commitEvidence(sessionId) {
    if (!peers || !previousSample || !currentSample || !activeSessionMatches(sessionId)) {
      return null
    }
    const status = peers.getSanitizedStatus()
    const result = evaluateHealthyEvidence({
      peers: status.connection,
      tracks: status.tracks,
      receivers: status.receivers,
      previous: previousSample,
      current: currentSample,
    })
    store.setLiveEvidence({
      connection: status.connection,
      tracks: status.tracks,
      checks: result.checks,
      metrics: deriveMetrics(previousSample, currentSample),
    })
    return result
  }

  function observeActiveHealth(sessionId, result) {
    if (store.state !== 'healthy' || !activeSessionMatches(sessionId)) return
    consecutiveUnhealthySamples = result?.healthy
      ? 0
      : consecutiveUnhealthySamples + 1
    if (consecutiveUnhealthySamples < 3 || healthFailureScheduled) return

    healthFailureScheduled = true
    void Promise.resolve().then(() => {
      void failActiveSession(
        sessionId,
        'Live browser evidence stopped meeting the healthy-call requirements.',
      )
    })
  }

  async function failActiveSession(sessionId, message) {
    if (!activeSessionMatches(sessionId) || store.state !== 'healthy') return
    ending = true
    const receipt = await cleanupResources()
    if (store.sessionId === sessionId && store.state === 'healthy') {
      store.markFailed(message, 'Active lab failed', receipt)
    }
  }

  async function start(canvas, videoElement) {
    if (!['idle', 'ended', 'failed'].includes(store.state)) return
    store.beginSession()
    const sessionId = store.sessionId
    startAbortController = new AbortController()
    const { signal } = startAbortController
    remoteVideoElement = videoElement
    cleanupPromise = null
    ending = false
    consecutiveUnhealthySamples = 0
    healthFailureScheduled = false

    try {
      const createdMedia = await createDemoMedia(canvas)
      if (!activeSessionMatches(sessionId)) {
        await createdMedia.cleanup()
        throw new DOMException('Stale session.', 'AbortError')
      }
      media = createdMedia
      store.addTimeline('System', 'Generated media online', 'Animated canvas video and patterned Web Audio tracks are live.')

      const createdPeers = await createLoopbackPeerService(media.stream, signal)
      if (!activeSessionMatches(sessionId)) {
        await createdPeers.cleanup()
        throw new DOMException('Stale session.', 'AbortError')
      }
      peers = createdPeers
      remoteVideoElement.srcObject = peers.remoteStream
      remoteVideoElement.muted = true
      await remoteVideoElement.play()
      media.startRemoteAudioMeter(peers.remoteStream, (level) => {
        if (activeSessionMatches(sessionId)) store.audioLevel = level
      })
      store.addTimeline('System', 'Loopback peers connected', 'Offer, answer, and ICE candidates were exchanged in page memory.')

      sampler = createStatsSampler({
        outboundPeer: peers.outboundPeer,
        inboundPeer: peers.inboundPeer,
        onSample(snapshot) {
          if (!activeSessionMatches(sessionId)) return
          previousSample = currentSample
          currentSample = snapshot
          const result = commitEvidence(sessionId)
          observeActiveHealth(sessionId, result)
        },
        onError() {
          observeActiveHealth(sessionId, null)
        },
      })

      for (let attempt = 0; attempt < 12; attempt += 1) {
        await sampler.sample()
        const result = commitEvidence(sessionId)
        if (result?.healthy) {
          const baseline = {
            captured_at: new Date().toISOString(),
            checks: result.checks,
            metrics: { ...store.metrics },
            connection: { ...store.connection },
            tracks: {
              audio: { ...store.tracks.audio },
              video: { ...store.tracks.video },
            },
          }
          store.markHealthy(baseline)
          sampler.start(1000)
          beginElapsedTimer(sessionId)
          return
        }
        await abortableDelay(650, signal)
      }
      throw new Error('Real audio/video counters did not progress before the startup deadline.')
    } catch (error) {
      const cancelled = error?.name === 'AbortError'
      const receipt = await cleanupResources(error?.cleanupReceipt)
      if (!cancelled && store.sessionId === sessionId && store.state === 'starting') {
        store.recordCleanup(receipt)
        store.markFailed(error?.message || 'The demo lab could not start.')
      }
    }
  }

  async function cleanupResources(startupMediaReceipt = null) {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      startAbortController?.abort()
      startAbortController = null
      stopElapsedTimer()
      const samplerReceipt = (sampler ? await sampler.stop() : null) ?? {
        sampler_active: false,
        sampling_in_flight: false,
      }
      const peerReceipt = peers
        ? await peers.cleanup()
        : {
            peer_connections_total: 0,
            peer_connections_closed: 0,
            remote_tracks_expected: 0,
            remote_tracks_total: 0,
            remote_tracks_ended: 0,
            listeners_removed: true,
            candidate_exchange_errors: 0,
            candidate_operations_pending: 0,
          }
      const mediaReceipt = media
        ? await media.cleanup()
        : startupMediaReceipt ?? {
            generated_tracks_total: 0,
            generated_tracks_ended: 0,
            audio_context_state: 'not-created',
            audio_nodes_disconnected: true,
            animation_active: false,
            animation_frame_pending: false,
            audio_meter_active: false,
          }

      if (remoteVideoElement) {
        remoteVideoElement.pause()
        remoteVideoElement.srcObject = null
      }
      const complete =
        peerReceipt.peer_connections_closed === peerReceipt.peer_connections_total &&
        peerReceipt.remote_tracks_total === peerReceipt.remote_tracks_expected &&
        peerReceipt.remote_tracks_ended === peerReceipt.remote_tracks_total &&
        mediaReceipt.generated_tracks_ended === mediaReceipt.generated_tracks_total &&
        ['closed', 'not-created'].includes(mediaReceipt.audio_context_state) &&
        mediaReceipt.audio_nodes_disconnected &&
        !mediaReceipt.animation_active &&
        !mediaReceipt.animation_frame_pending &&
        !mediaReceipt.audio_meter_active &&
        !samplerReceipt.sampler_active &&
        !samplerReceipt.sampling_in_flight &&
        peerReceipt.candidate_operations_pending === 0 &&
        elapsedIntervalId === null &&
        peerReceipt.listeners_removed

      const receipt = {
        captured_at: new Date().toISOString(),
        complete,
        peers: peerReceipt,
        media: mediaReceipt,
        sampler: samplerReceipt,
        elapsed_timer_active: elapsedIntervalId !== null,
      }

      sampler = null
      peers = null
      media = null
      previousSample = null
      currentSample = null
      remoteVideoElement = null
      return receipt
    })()
    return cleanupPromise
  }

  async function end() {
    if (store.state === 'idle') return
    if (store.state === 'ended') {
      store.resetToIdle()
      return
    }
    ending = true
    const receipt = await cleanupResources()
    if (store.state !== 'ended') store.markEnded(receipt)
  }

  async function dispose() {
    if (store.state === 'idle' && !media && !peers) return
    ending = true
    const receipt = await cleanupResources()
    if (store.state !== 'ended' && store.state !== 'idle') store.markEnded(receipt)
  }

  return { start, end, dispose }
}
