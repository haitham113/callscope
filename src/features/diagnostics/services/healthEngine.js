function progresses(previous, current, keys) {
  if (!previous || !current) return false

  return keys.some((key) => {
    const before = previous[key]
    const after = current[key]
    return Number.isFinite(before) && Number.isFinite(after) && after > before
  })
}

function nonNegativeDelta(previous, current) {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null
  const delta = current - previous
  return delta >= 0 ? delta : null
}

export function evaluateHealthyEvidence({
  peers,
  tracks,
  receivers,
  previous,
  current,
}) {
  const connectionReady =
    peers?.outbound === 'connected' && peers?.inbound === 'connected'
  const requiredTracks = ['audio', 'video']
  const tracksReady = requiredTracks.every((kind) => {
    const track = tracks?.[kind]
    return track?.readyState === 'live' && track.enabled && track.attached
  })
  const receiversReady = requiredTracks.every(
    (kind) => receivers?.[kind]?.readyState === 'live',
  )
  const countersProgressing =
    progresses(previous?.outbound?.audio, current?.outbound?.audio, [
      'packets',
      'bytes',
    ]) &&
    progresses(previous?.outbound?.video, current?.outbound?.video, [
      'frames',
      'packets',
      'bytes',
    ]) &&
    progresses(previous?.inbound?.audio, current?.inbound?.audio, [
      'packets',
      'bytes',
    ]) &&
    progresses(previous?.inbound?.video, current?.inbound?.video, [
      'frames',
      'packets',
      'bytes',
    ])

  const checks = {
    peers_connected: connectionReady,
    tracks_live_enabled_attached: tracksReady,
    receiver_tracks_live: receiversReady,
    bidirectional_audio_video_progress: countersProgressing,
  }

  return {
    healthy: Object.values(checks).every(Boolean),
    checks,
  }
}

export function deriveMetrics(previous, current) {
  if (!previous || !current || current.capturedAt <= previous.capturedAt) {
    return {
      outboundBitrateKbps: null,
      packetLoss: null,
      latencyMs: null,
      frameRate: null,
    }
  }

  const elapsedSeconds = (current.capturedAt - previous.capturedAt) / 1000
  const outboundByteDeltas = ['audio', 'video'].map((kind) =>
    nonNegativeDelta(
      previous.outbound[kind]?.bytes,
      current.outbound[kind]?.bytes,
    ),
  )
  const outboundBytes = outboundByteDeltas.every(Number.isFinite)
    ? outboundByteDeltas.reduce((total, delta) => total + delta, 0)
    : null
  const beforeFrames = previous.outbound.video?.frames
  const afterFrames = current.outbound.video?.frames
  const frameDelta = nonNegativeDelta(beforeFrames, afterFrames)
  const reportedFrameRate = current.outbound.video?.framesPerSecond
  const frameRate = Number.isFinite(frameDelta)
    ? frameDelta / elapsedSeconds
    : Number.isFinite(reportedFrameRate) && reportedFrameRate >= 0
      ? reportedFrameRate
      : null
  const packetLoss = nonNegativeDelta(
    previous.inbound.packetLoss,
    current.inbound.packetLoss,
  )

  return {
    outboundBitrateKbps: Number.isFinite(outboundBytes)
      ? (outboundBytes * 8) / elapsedSeconds / 1000
      : null,
    packetLoss,
    latencyMs: Number.isFinite(current.remote.roundTripTimeMs)
      ? current.remote.roundTripTimeMs
      : Number.isFinite(current.inbound.jitterMs)
        ? current.inbound.jitterMs
        : null,
    frameRate,
  }
}
