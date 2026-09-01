function emptyMediaCounters() {
  return {
    audio: { packets: null, bytes: null, frames: null, framesPerSecond: null },
    video: { packets: null, bytes: null, frames: null, framesPerSecond: null },
  }
}

function addValue(existing, value) {
  if (!Number.isFinite(value)) return existing
  return (existing ?? 0) + value
}

function selectedCandidateCategory(report) {
  let selectedPair = null
  report.forEach((entry) => {
    if (entry.type === 'transport' && entry.selectedCandidatePairId) {
      selectedPair = report.get?.(entry.selectedCandidatePairId) ?? selectedPair
    }
    if (
      !selectedPair && entry.type === 'candidate-pair' &&
      entry.state === 'succeeded' && (entry.selected === true || entry.nominated === true)
    ) selectedPair = entry
  })
  if (!selectedPair) return null
  const local = report.get?.(selectedPair.localCandidateId)
  const remote = report.get?.(selectedPair.remoteCandidateId)
  const safeTypes = ['host', 'srflx', 'prflx', 'relay']
  const safeProtocols = ['udp', 'tcp']
  const type = safeTypes.includes(local?.candidateType) ? local.candidateType : null
  const protocolValue = String(local?.protocol ?? remote?.protocol ?? '').toLowerCase()
  const protocol = safeProtocols.includes(protocolValue) ? protocolValue : null
  const exposedTypes = [local?.candidateType, remote?.candidateType].filter((value) =>
    safeTypes.includes(value),
  )
  const relayed = exposedTypes.length
    ? exposedTypes.includes('relay')
    : null
  return {
    type,
    protocol,
    path: relayed === null ? null : relayed ? 'relayed' : 'direct',
    relayed,
  }
}

function normalizeStats(outboundReport, inboundReport) {
  const snapshot = {
    capturedAt: performance.now(),
    outbound: emptyMediaCounters(),
    inbound: {
      ...emptyMediaCounters(),
      packetLoss: null,
      jitterMs: null,
      totalAudioEnergy: null,
    },
    remote: { roundTripTimeMs: null },
    selectedCandidate: selectedCandidateCategory(outboundReport),
  }

  outboundReport.forEach((report) => {
    const kind = report.kind ?? report.mediaType
    if (report.type === 'outbound-rtp' && !report.isRemote && snapshot.outbound[kind]) {
      const media = snapshot.outbound[kind]
      media.packets = addValue(media.packets, report.packetsSent)
      media.bytes = addValue(media.bytes, report.bytesSent)
      media.frames = addValue(media.frames, report.framesEncoded)
      media.framesPerSecond = Number.isFinite(report.framesPerSecond)
        ? report.framesPerSecond
        : media.framesPerSecond
    }
    if (report.type === 'remote-inbound-rtp' && Number.isFinite(report.roundTripTime)) {
      snapshot.remote.roundTripTimeMs = report.roundTripTime * 1000
    }
  })

  inboundReport.forEach((report) => {
    const kind = report.kind ?? report.mediaType
    if (report.type === 'inbound-rtp' && !report.isRemote && snapshot.inbound[kind]) {
      const media = snapshot.inbound[kind]
      media.packets = addValue(media.packets, report.packetsReceived)
      media.bytes = addValue(media.bytes, report.bytesReceived)
      media.frames = addValue(media.frames, report.framesDecoded)
      media.framesPerSecond = Number.isFinite(report.framesPerSecond)
        ? report.framesPerSecond
        : media.framesPerSecond
      snapshot.inbound.packetLoss = addValue(
        snapshot.inbound.packetLoss,
        report.packetsLost,
      )
      if (Number.isFinite(report.jitter)) snapshot.inbound.jitterMs = report.jitter * 1000
      if (kind === 'audio' && Number.isFinite(report.totalAudioEnergy)) {
        snapshot.inbound.totalAudioEnergy = report.totalAudioEnergy
      }
    }
  })

  return snapshot
}

function abortableView(operation, signal) {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(new DOMException('Sampling was cancelled.', 'AbortError'))
  return new Promise((resolve, reject) => {
    function abort() {
      reject(new DOMException('Sampling was cancelled.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value) },
      (error) => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}

export function createStatsSampler({ outboundPeer, inboundPeer, onSample, onError, drainTimeoutMs = 2000 }) {
  let intervalId = null
  let activeSamplePromise = null
  let stopped = false

  function sample({ notify = true, signal, fresh = false } = {}) {
    if (stopped) return Promise.resolve(null)
    if (activeSamplePromise) {
      const activeView = abortableView(activeSamplePromise, signal)
      return fresh
        ? activeView.then(() => sample({ notify, signal, fresh: true }))
        : activeView
    }

    const operation = (async () => {
      try {
        const [outboundReport, inboundReport] = await Promise.all([
          outboundPeer.getStats(),
          inboundPeer.getStats(),
        ])
        const snapshot = normalizeStats(outboundReport, inboundReport)
        if (!stopped && notify) onSample?.(snapshot)
        return snapshot
      } finally {
        if (activeSamplePromise === operation) activeSamplePromise = null
      }
    })()
    activeSamplePromise = operation
    return abortableView(operation, signal)
  }

  return {
    sample,
    start(intervalMs = 1000) {
      if (intervalId !== null || stopped) return
      intervalId = setInterval(() => {
        void sample().catch((error) => onError?.(error))
      }, intervalMs)
    },
    async stop() {
      if (intervalId !== null) clearInterval(intervalId)
      intervalId = null
      stopped = true
      const pendingSample = activeSamplePromise
      if (pendingSample) {
        await new Promise((resolve) => {
          const timeoutId = setTimeout(resolve, drainTimeoutMs)
          pendingSample.then(
            () => { clearTimeout(timeoutId); resolve() },
            () => { clearTimeout(timeoutId); resolve() },
          )
        })
      }
      return {
        sampler_active: false,
        sampling_in_flight: activeSamplePromise !== null,
      }
    },
    isActive() {
      return intervalId !== null
    },
  }
}
