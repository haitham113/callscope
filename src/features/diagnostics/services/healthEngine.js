function progresses(previous, current, keys) {
  if (!previous || !current) return false

  return keys.some((key) => {
    const before = previous[key]
    const after = current[key]
    return Number.isFinite(before) && Number.isFinite(after) && after > before
  })
}

export function evaluateHealthyEvidence({ peers, tracks, previous, current }) {
  const connectionReady =
    peers?.outbound === 'connected' && peers?.inbound === 'connected'
  const requiredTracks = ['audio', 'video']
  const tracksReady = requiredTracks.every((kind) => {
    const track = tracks?.[kind]
    return track?.readyState === 'live' && track.enabled && track.attached
  })
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
  const outboundBytes = ['audio', 'video'].reduce((total, kind) => {
    const before = previous.outbound[kind]?.bytes
    const after = current.outbound[kind]?.bytes
    return total + (Number.isFinite(before) && Number.isFinite(after) ? after - before : 0)
  }, 0)
  const beforeFrames = previous.outbound.video?.frames
  const afterFrames = current.outbound.video?.frames
  const frameRate =
    Number.isFinite(beforeFrames) && Number.isFinite(afterFrames)
      ? Math.max(0, (afterFrames - beforeFrames) / elapsedSeconds)
      : current.outbound.video?.framesPerSecond ?? null

  return {
    outboundBitrateKbps: Math.max(0, (outboundBytes * 8) / elapsedSeconds / 1000),
    packetLoss: Number.isFinite(current.inbound.packetLoss)
      ? current.inbound.packetLoss
      : null,
    latencyMs: Number.isFinite(current.remote.roundTripTimeMs)
      ? current.remote.roundTripTimeMs
      : Number.isFinite(current.inbound.jitterMs)
        ? current.inbound.jitterMs
        : null,
    frameRate,
  }
}
