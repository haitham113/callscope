import { evaluateHealthyEvidence, deriveMetrics } from '../../diagnostics/services/healthEngine.js'
import {
  createAuthoritativeSnapshot,
  hashSnapshot,
} from '../../diagnostics/services/snapshotService.js'
import { createAudioRescueRuntime } from '../../recovery/services/audioRescueRuntime.js'
import { createStatsSampler } from '../../diagnostics/services/statsSampler.js'
import { createDemoMedia } from './demoMediaService.js'
import { createLoopbackPeerService } from './loopbackPeerService.js'
import { errorResult, resultFromError } from '../../../shared/errors/serviceErrors.js'

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Operation cancelled.', 'AbortError'))
      return
    }
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
  let startupAbortController = null
  let sessionAbortController = null
  let elapsedIntervalId = null
  let previousSample = null
  let currentSample = null
  let remoteVideoElement = null
  let cleanupPromise = null
  let partialPeerCleanup = null
  let partialMediaCleanup = null
  let ending = false
  let consecutiveUnhealthySamples = 0
  let healthFailureScheduled = false

  function activeSessionMatches(sessionId, sessionEpoch = store.sessionEpoch) {
    return (
      !ending &&
      store.sessionId === sessionId &&
      store.sessionEpoch === sessionEpoch &&
      !['idle', 'ended', 'failed'].includes(store.state)
    )
  }

  function combinedSignal(...signals) {
    const activeSignals = signals.filter(Boolean)
    if (activeSignals.length <= 1) return activeSignals[0]
    return globalThis.AbortSignal.any(activeSignals)
  }

  function operationOwned(owner, signal) {
    return Boolean(
      owner &&
      !signal?.aborted &&
      activeSessionMatches(owner.sessionId, owner.sessionEpoch) &&
      store.faultRevision === owner.faultRevision,
    )
  }

  function assertOperationOwned(owner, signal) {
    if (!operationOwned(owner, signal)) {
      throw new DOMException('The active operation no longer owns this session.', 'AbortError')
    }
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

  async function buildCurrentSnapshot(owner, signal) {
    assertOperationOwned(owner, signal)
    if (!peers || !previousSample || !currentSample) {
      throw new Error('Authoritative call evidence is not available yet.')
    }
    const snapshot = createAuthoritativeSnapshot({
      sessionId: owner.sessionId,
      sessionEpoch: owner.sessionEpoch,
      faultRevision: owner.faultRevision,
      activeFault: store.activeFault,
      peerStatus: peers.getSanitizedStatus(),
      previousSample,
      currentSample,
    })
    snapshot.snapshot_hash = await hashSnapshot(snapshot)
    assertOperationOwned(owner, signal)
    return snapshot
  }

  async function takeOwnedSample(owner, signal) {
    assertOperationOwned(owner, signal)
    const snapshot = await sampler.sample({ notify: false })
    assertOperationOwned(owner, signal)
    if (!snapshot) throw new Error('Authoritative WebRTC statistics are unavailable.')
    previousSample = currentSample
    currentSample = snapshot
    commitEvidence(owner.sessionId)
  }

  async function captureSnapshot({ stabilize, signal: operationSignal, owner }) {
    const boundOwner = owner ?? {
      sessionId: store.sessionId,
      sessionEpoch: store.sessionEpoch,
      faultRevision: store.faultRevision,
    }
    const signal = combinedSignal(operationSignal, sessionAbortController?.signal)
    assertOperationOwned(boundOwner, signal)
    if (stabilize) {
      await takeOwnedSample(boundOwner, signal)
      await abortableDelay(1150, signal)
    }
    await takeOwnedSample(boundOwner, signal)
    return buildCurrentSnapshot(boundOwner, signal)
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
      )
    })
  }

  async function failActiveSession(sessionId) {
    if (!activeSessionMatches(sessionId) || store.state !== 'healthy') return
    ending = true
    const receipt = await cleanupResources()
    if (store.sessionId === sessionId && store.state === 'healthy') {
      const result = receipt.complete
        ? errorResult('STATS_UNAVAILABLE')
        : errorResult('CLEANUP_INCOMPLETE')
      store.markFailed(
        `${result.error.code}: ${result.error.message}`,
        'Active lab failed',
        receipt,
      )
    }
  }

  async function start(canvas, videoElement) {
    if (store.lastCleanupReceipt?.complete === false) {
      const result = errorResult('CLEANUP_INCOMPLETE')
      store.recordOperationError(result, 'Lab start rejected')
      return result
    }
    if (!['idle', 'ended', 'failed'].includes(store.state)) {
      const result = errorResult('INVALID_STATE_TRANSITION')
      store.recordOperationError(result, 'Lab start rejected')
      return result
    }
    store.beginSession()
    const sessionId = store.sessionId
    const sessionEpoch = store.sessionEpoch
    sessionAbortController = new AbortController()
    startupAbortController = new AbortController()
    const signal = combinedSignal(
      sessionAbortController.signal,
      startupAbortController.signal,
    )
    const startupOwner = { sessionId, sessionEpoch, faultRevision: 0 }
    remoteVideoElement = videoElement
    cleanupPromise = null
    ending = false
    consecutiveUnhealthySamples = 0
    healthFailureScheduled = false

    try {
      const createdMedia = await createDemoMedia(canvas)
      if (!activeSessionMatches(sessionId, sessionEpoch)) {
        await createdMedia.cleanup()
        throw new DOMException('Stale session.', 'AbortError')
      }
      media = createdMedia
      store.recordSystemEvent('Generated media online', 'Animated canvas video and patterned Web Audio tracks are live.')

      const createdPeers = await createLoopbackPeerService(media.stream, signal)
      if (!activeSessionMatches(sessionId, sessionEpoch)) {
        await createdPeers.cleanup()
        throw new DOMException('Stale session.', 'AbortError')
      }
      peers = createdPeers
      remoteVideoElement.srcObject = peers.remoteStream
      remoteVideoElement.muted = true
      await remoteVideoElement.play()
      media.startRemoteAudioMeter(peers.remoteStream, (level) => {
        if (activeSessionMatches(sessionId, sessionEpoch)) store.audioLevel = level
      })
      store.recordSystemEvent('Loopback peers connected', 'Offer, answer, and ICE candidates were exchanged in page memory.')

      sampler = createStatsSampler({
        outboundPeer: peers.outboundPeer,
        inboundPeer: peers.inboundPeer,
        onSample(snapshot) {
          if (!activeSessionMatches(sessionId, sessionEpoch)) return
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
        assertOperationOwned(startupOwner, signal)
        const sample = await sampler.sample({ notify: false })
        assertOperationOwned(startupOwner, signal)
        previousSample = currentSample
        currentSample = sample
        const result = commitEvidence(sessionId)
        if (result?.healthy) {
          const baseline = await buildCurrentSnapshot(startupOwner, signal)
          assertOperationOwned(startupOwner, signal)
          store.markHealthy(baseline)
          sampler.start(1000)
          beginElapsedTimer(sessionId)
          startupAbortController = null
          return { ok: true, session_id: sessionId, session_epoch: sessionEpoch }
        }
        await abortableDelay(650, signal)
      }
      throw new Error('Real audio/video counters did not progress before the startup deadline.')
    } catch (error) {
      const cancelled = error?.name === 'AbortError'
      partialPeerCleanup = error?.retryPeerCleanup ?? partialPeerCleanup
      partialMediaCleanup = error?.retryMediaCleanup ?? partialMediaCleanup
      const receipt = await cleanupResources(error?.cleanupReceipt)
      if (!cancelled && store.sessionId === sessionId && store.state === 'starting') {
        store.recordCleanup(receipt)
        const result = receipt.complete
          ? resultFromError(error, 'LAB_START_FAILED')
          : errorResult('CLEANUP_INCOMPLETE')
        store.markFailed(`${result.error.code}: ${result.error.message}`, 'Lab startup failed', receipt)
        return result
      }
      return errorResult('OPERATION_CANCELLED')
    }
  }

  async function cleanupResources(startupMediaReceipt = null) {
    if (cleanupPromise) {
      const existingReceipt = await cleanupPromise
      if (existingReceipt.complete) return existingReceipt
      cleanupPromise = null
    }
    cleanupPromise = (async () => {
      startupAbortController?.abort('Startup cleanup requested.')
      startupAbortController = null
      sessionAbortController?.abort('Session cleanup requested.')
      sessionAbortController = null
      rescueRuntime.cancelAll('Session cleanup requested.')
      stopElapsedTimer()
      const samplerReceipt = (sampler ? await sampler.stop() : null) ?? {
        sampler_active: false,
        sampling_in_flight: false,
      }
      const peerReceipt = peers
        ? await peers.cleanup()
        : partialPeerCleanup
          ? await partialPeerCleanup()
        : {
            peer_connections_total: 0,
            peer_connections_closed: 0,
            remote_tracks_expected: 0,
            remote_tracks_total: 0,
            remote_tracks_ended: 0,
            listeners_removed: true,
            candidate_exchange_errors: 0,
            candidate_operations_pending: 0,
            cleanup_errors: 0,
          }
      const mediaReceipt = media
        ? await media.cleanup()
        : partialMediaCleanup
          ? await partialMediaCleanup()
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
        peerReceipt.cleanup_errors === 0 &&
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

      if (complete) {
        sampler = null
        peers = null
        media = null
        partialPeerCleanup = null
        partialMediaCleanup = null
        previousSample = null
        currentSample = null
        remoteVideoElement = null
      }
      return receipt
    })()
    return cleanupPromise
  }

  async function end() {
    if (store.state === 'idle') return errorResult('NO_ACTIVE_SESSION')
    if (store.state === 'ended') {
      store.resetToIdle()
      return { ok: true, state: 'idle' }
    }
    ending = true
    const receipt = await cleanupResources()
    if (store.state !== 'ended' || !receipt.complete) store.markEnded(receipt)
    return receipt.complete ? { ok: true, cleanup: receipt } : errorResult('CLEANUP_INCOMPLETE')
  }

  async function dispose() {
    if (store.state === 'idle' && !media && !peers) return
    ending = true
    const receipt = await cleanupResources()
    if (!['ended', 'idle', 'failed'].includes(store.state) || !receipt.complete) store.markEnded(receipt)
  }

  const rescueRuntime = createAudioRescueRuntime({
    store,
    captureSnapshot,
    readAudioState() {
      if (!peers) {
        return { ready_state: 'unavailable', enabled: null, attached: false }
      }
      return peers.getOutboundTrackStatus('audio')
    },
    setAudioEnabled(enabled) {
      if (!peers) throw new Error('No active peer connection is available.')
      return peers.setOutboundTrackEnabled('audio', enabled)
    },
  })

  const human = Object.freeze({
    start,
    end,
    breakAudioTrack: rescueRuntime.breakAudioTrack,
    resetScenario: rescueRuntime.resetScenario,
    diagnoseAndStageRecovery: rescueRuntime.diagnoseAndStageRecovery,
    approvePlan: rescueRuntime.approvePlan,
    rejectPlan: rescueRuntime.rejectPlan,
    applyApprovedRecovery: rescueRuntime.applyApprovedRecovery,
  })
  const agent = Object.freeze({
    runDiagnostics: rescueRuntime.runDiagnostics,
    stageRecoveryPlan: rescueRuntime.stageRecoveryPlan,
    applyRecoveryAction: rescueRuntime.applyRecoveryAction,
    generateIncidentReport: rescueRuntime.generateIncidentReport,
  })

  return Object.freeze({ human, agent, dispose })
}
