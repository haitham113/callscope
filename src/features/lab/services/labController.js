import { evaluateHealthyEvidence, deriveMetrics } from '../../diagnostics/services/healthEngine.js'
import {
  createAuthoritativeSnapshot,
  hashSnapshot,
} from '../../diagnostics/services/snapshotService.js'
import { createAudioRescueRuntime } from '../../recovery/services/audioRescueRuntime.js'
import { createStatsSampler } from '../../diagnostics/services/statsSampler.js'
import { createCleanupQuarantine } from './cleanupQuarantine.js'
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

function abortableOperation(operation, signal) {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(new DOMException('Operation cancelled.', 'AbortError'))
  return new Promise((resolve, reject) => {
    function onAbort() {
      reject(new DOMException('Operation cancelled.', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function peerCleanupComplete(receipt) {
  return receipt.peer_connections_closed === receipt.peer_connections_total &&
    receipt.remote_tracks_total === receipt.remote_tracks_expected &&
    receipt.remote_tracks_ended === receipt.remote_tracks_total &&
    receipt.candidate_operations_pending === 0 &&
    receipt.cleanup_errors === 0 &&
    receipt.listeners_removed
}

function mediaCleanupComplete(receipt) {
  return receipt.generated_tracks_ended === receipt.generated_tracks_total &&
    ['closed', 'not-created'].includes(receipt.audio_context_state) &&
    receipt.audio_nodes_disconnected &&
    !receipt.animation_active &&
    !receipt.animation_frame_pending &&
    !receipt.audio_meter_active
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
  let startupMediaTask = null
  let startupPeerTask = null
  let partialPeerCleanup = null
  let partialMediaCleanup = null
  let ending = false
  let consecutiveUnhealthySamples = 0
  let healthFailureScheduled = false
  const staleCleanupQuarantine = createCleanupQuarantine()

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
    const snapshot = await sampler.sample({ notify: false, signal })
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
    if (staleCleanupQuarantine.pendingCount() > 0) {
      const orphanReceipt = await staleCleanupQuarantine.drain()
      if (!orphanReceipt.complete) {
        const result = errorResult('CLEANUP_INCOMPLETE')
        store.recordOperationError(result, 'Lab start rejected')
        return result
      }
    }
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
    let ownedMedia = null
    let ownedPeers = null
    let ownedSampler = null

    try {
      const mediaTask = {
        sessionId,
        sessionEpoch,
        promise: createDemoMedia(canvas, signal),
      }
      startupMediaTask = mediaTask
      const createdMedia = await mediaTask.promise
      if (startupMediaTask === mediaTask) startupMediaTask = null
      ownedMedia = createdMedia
      if (!activeSessionMatches(sessionId, sessionEpoch)) {
        await createdMedia.cleanup()
        throw new DOMException('Stale session.', 'AbortError')
      }
      media = createdMedia
      store.recordSystemEvent('Generated media online', 'Animated canvas video and patterned Web Audio tracks are live.')

      const peerTask = {
        sessionId,
        sessionEpoch,
        promise: createLoopbackPeerService(media.stream, signal),
      }
      startupPeerTask = peerTask
      const createdPeers = await peerTask.promise
      if (startupPeerTask === peerTask) startupPeerTask = null
      ownedPeers = createdPeers
      if (!activeSessionMatches(sessionId, sessionEpoch)) {
        await createdPeers.cleanup()
        throw new DOMException('Stale session.', 'AbortError')
      }
      peers = createdPeers
      remoteVideoElement.srcObject = peers.remoteStream
      remoteVideoElement.muted = true
      await abortableOperation(remoteVideoElement.play(), signal)
      assertOperationOwned(startupOwner, signal)
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
      ownedSampler = sampler

      for (let attempt = 0; attempt < 12; attempt += 1) {
        assertOperationOwned(startupOwner, signal)
        const sample = await sampler.sample({ notify: false, signal })
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
      const stillCurrentSession = store.sessionId === sessionId && store.sessionEpoch === sessionEpoch
      if (!stillCurrentSession) {
        await cleanupStaleStartup({
          media: ownedMedia,
          peers: ownedPeers,
          sampler: ownedSampler,
          retryPeerCleanup: error?.retryPeerCleanup,
          retryMediaCleanup: error?.retryMediaCleanup,
        })
        return errorResult('OPERATION_CANCELLED')
      }
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

  async function cleanupStaleStartup({
    media: ownedMedia,
    peers: ownedPeers,
    sampler: ownedSampler,
    retryPeerCleanup,
    retryMediaCleanup,
  }) {
    return staleCleanupQuarantine.track(async () => {
      const samplerReceipt = (ownedSampler ? await ownedSampler.stop() : null) ?? {
        sampler_active: false,
        sampling_in_flight: false,
      }
      const peerReceipt = ownedPeers
        ? await ownedPeers.cleanup()
        : retryPeerCleanup
          ? await retryPeerCleanup()
          : {
              peer_connections_total: 0,
              peer_connections_closed: 0,
              remote_tracks_expected: 0,
              remote_tracks_total: 0,
              remote_tracks_ended: 0,
              listeners_removed: true,
              candidate_operations_pending: 0,
              cleanup_errors: 0,
            }
      const mediaReceipt = ownedMedia
        ? await ownedMedia.cleanup()
        : retryMediaCleanup
          ? await retryMediaCleanup()
          : {
              generated_tracks_total: 0,
              generated_tracks_ended: 0,
              audio_context_state: 'not-created',
              audio_nodes_disconnected: true,
              animation_active: false,
              animation_frame_pending: false,
              audio_meter_active: false,
            }
      return {
        complete: peerCleanupComplete(peerReceipt) && mediaCleanupComplete(mediaReceipt) &&
          !samplerReceipt.sampler_active && !samplerReceipt.sampling_in_flight,
        peers: peerReceipt,
        media: mediaReceipt,
        sampler: samplerReceipt,
      }
    })
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
      let startupPeerReceipt = null
      let startupMediaTaskReceipt = startupMediaReceipt
      const pendingMediaTask = startupMediaTask
      if (pendingMediaTask) {
        try {
          media = media ?? await pendingMediaTask.promise
        } catch (error) {
          startupMediaTaskReceipt = error?.cleanupReceipt ?? startupMediaTaskReceipt
          partialMediaCleanup = error?.retryMediaCleanup ?? partialMediaCleanup
        } finally {
          if (startupMediaTask === pendingMediaTask) startupMediaTask = null
        }
      }
      const pendingPeerTask = startupPeerTask
      if (pendingPeerTask) {
        try {
          peers = peers ?? await pendingPeerTask.promise
        } catch (error) {
          startupPeerReceipt = error?.peerCleanupReceipt ?? startupPeerReceipt
          partialPeerCleanup = error?.retryPeerCleanup ?? partialPeerCleanup
        } finally {
          if (startupPeerTask === pendingPeerTask) startupPeerTask = null
        }
      }
      const samplerReceipt = (sampler ? await sampler.stop() : null) ?? {
        sampler_active: false,
        sampling_in_flight: false,
      }
      const peerReceipt = peers
        ? await peers.cleanup()
        : partialPeerCleanup
          ? await partialPeerCleanup()
        : startupPeerReceipt
          ? startupPeerReceipt
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
        : startupMediaTaskReceipt ?? {
            generated_tracks_total: 0,
            generated_tracks_ended: 0,
            audio_context_state: 'not-created',
            audio_nodes_disconnected: true,
            animation_active: false,
            animation_frame_pending: false,
            audio_meter_active: false,
          }
      const staleCleanupReceipt = await staleCleanupQuarantine.drain()

      if (remoteVideoElement) {
        remoteVideoElement.pause()
        remoteVideoElement.srcObject = null
      }
      const complete =
        peerCleanupComplete(peerReceipt) &&
        mediaCleanupComplete(mediaReceipt) &&
        !samplerReceipt.sampler_active &&
        !samplerReceipt.sampling_in_flight &&
        elapsedIntervalId === null &&
        staleCleanupReceipt.complete

      const receipt = {
        captured_at: new Date().toISOString(),
        complete,
        peers: peerReceipt,
        media: mediaReceipt,
        sampler: samplerReceipt,
        elapsed_timer_active: elapsedIntervalId !== null,
        orphan_cleanups_pending: staleCleanupReceipt.pending,
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
        startupMediaTask = null
        startupPeerTask = null
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
    runDiagnostics: rescueRuntime.runAgentDiagnostics,
    stageRecoveryPlan: rescueRuntime.stageAgentRecoveryPlan,
    applyRecoveryAction: rescueRuntime.applyRecoveryAction,
    generateIncidentReport: rescueRuntime.generateIncidentReport,
  })

  return Object.freeze({ human, agent, dispose })
}
