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

export function createStatsSampler({ outboundPeer, inboundPeer, onSample, onError }) {
  let intervalId = null
  let activeSamplePromise = null
  let stopped = false

  function sample() {
    if (stopped || activeSamplePromise) return Promise.resolve(null)

    const operation = (async () => {
      try {
        const [outboundReport, inboundReport] = await Promise.all([
          outboundPeer.getStats(),
          inboundPeer.getStats(),
        ])
        const snapshot = normalizeStats(outboundReport, inboundReport)
        if (!stopped) onSample?.(snapshot)
        return snapshot
      } finally {
        if (activeSamplePromise === operation) activeSamplePromise = null
      }
    })()
    activeSamplePromise = operation
    return operation
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
        try {
          await pendingSample
        } catch {
          // Teardown waits for browser-owned sampling without hiding its final state.
        }
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
